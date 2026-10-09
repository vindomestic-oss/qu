import type Database from 'better-sqlite3';
import { nowIso } from '../time';
import { PROMPT_VERSION } from './prompt';

// Wish 7, layer B (S14): when the server may call the AI provider. Everything is OFF by default:
// model calls need ALL of
//   - AI_GRADING_ENABLED=true (or 1) in the server environment (the global switch; unset = off),
//   - a configured provider (Gemini with GEMINI_API_KEY; the fake provider only outside production),
//   - the admin's kill switch released (ai_grading_settings, survives restarts),
//   - no runtime stop (a rejected key or unknown model stops calls until the next restart),
// and, per quiz, quizzes.ai_grading_enabled = 1 (checked by the queue and the worker).
// The environment is read on every call, never cached; the key is never logged or returned.

export type AiProviderName = 'gemini' | 'fake';

export const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';
export const DEFAULT_GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta';

const truthy = (v: string | undefined) => ['1', 'true', 'yes', 'on'].includes((v ?? '').trim().toLowerCase());

function intEnv(name: string, fallback: number, min: number, max: number): number {
  const n = Number(process.env[name]);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
}

export const isProductionEnv = () => process.env.NODE_ENV === 'production' || process.env.RENDER === 'true';

export interface AiEnv {
  enabled: boolean;
  provider: string;
  model: string;
  endpoint: string;
  keyPresent: boolean;
  concurrency: number;
  maxCallsPerDay: number;
  timeoutMs: number;
}

export function aiEnv(): AiEnv {
  const provider = (process.env.AI_GRADING_PROVIDER ?? '').trim().toLowerCase() || 'gemini';
  return {
    enabled: truthy(process.env.AI_GRADING_ENABLED),
    provider,
    model: provider === 'fake' ? 'fake-grader-1' : (process.env.GEMINI_MODEL ?? '').trim() || DEFAULT_GEMINI_MODEL,
    endpoint: (process.env.GEMINI_ENDPOINT ?? '').trim().replace(/\/+$/, '') || DEFAULT_GEMINI_ENDPOINT,
    keyPresent: (process.env.GEMINI_API_KEY ?? '').trim() !== '',
    concurrency: intEnv('AI_GRADING_CONCURRENCY', 4, 1, 8),
    maxCallsPerDay: intEnv('AI_MAX_CALLS_PER_DAY', 3000, 0, 100_000),
    timeoutMs: intEnv('AI_GRADING_TIMEOUT_MS', 60_000, 1_000, 300_000),
  };
}

// --- Runtime stop (until restart) -------------------------------------------------------------

let runtimeStop: 'auth' | 'config' | null = null;

/** A rejected key ('auth') or an unknown model/endpoint ('config'): no further calls until restart. */
export function stopModelCalls(reason: 'auth' | 'config'): void {
  if (!runtimeStop) console.error(`AI grading: stopped (${reason}); fix the configuration and restart.`);
  runtimeStop = reason;
}

/** Tests only. */
export function resetRuntimeStop(): void {
  runtimeStop = null;
}

// --- Kill switch (persisted) ------------------------------------------------------------------

export interface KillSwitch {
  engaged: boolean;
  updated_at: string | null;
  updated_by: string | null;
}

export function readKillSwitch(db: Database.Database): KillSwitch {
  const row = db.prepare("SELECT value, updated_at, updated_by FROM ai_grading_settings WHERE name = 'kill_switch'").get() as
    | { value: string | null; updated_at: string; updated_by: string | null }
    | undefined;
  return { engaged: row?.value === '1', updated_at: row?.updated_at ?? null, updated_by: row?.updated_by ?? null };
}

export function setKillSwitch(db: Database.Database, engaged: boolean, by: string): KillSwitch {
  db.prepare(
    `INSERT INTO ai_grading_settings (name, value, updated_at, updated_by) VALUES ('kill_switch', ?, ?, ?)
     ON CONFLICT(name) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
  ).run(engaged ? '1' : '0', nowIso(), by);
  return readKillSwitch(db);
}

// --- The combined view -----------------------------------------------------------------------

export type DisabledReason =
  | 'off'
  | 'kill_switch'
  | 'no_key'
  | 'unknown_provider'
  | 'fake_in_production'
  | 'insecure_endpoint'
  | 'auth'
  | 'config';

export interface AiConfig {
  /** AI_GRADING_ENABLED is set. */
  enabled: boolean;
  /** The provider can be used (key present, or the fake provider outside production). */
  configured: boolean;
  /** Provider calls may happen now (still per quiz: quizzes.ai_grading_enabled). */
  modelCallsEnabled: boolean;
  /** The first reason why not, or null. */
  disabledReason: DisabledReason | null;
  provider: string;
  model: string;
  promptVersion: string;
  concurrency: number;
  maxCallsPerDay: number;
  killSwitch: KillSwitch;
}

function notConfiguredReason(env: AiEnv): DisabledReason | null {
  if (env.provider === 'fake') return isProductionEnv() ? 'fake_in_production' : null;
  if (env.provider !== 'gemini') return 'unknown_provider';
  if (!env.keyPresent) return 'no_key';
  if (!env.endpoint.startsWith('https://')) return 'insecure_endpoint';
  return null;
}

export function aiConfig(db: Database.Database): AiConfig {
  const env = aiEnv();
  const killSwitch = readKillSwitch(db);
  const notConfigured = notConfiguredReason(env);
  const disabledReason: DisabledReason | null = !env.enabled
    ? 'off'
    : killSwitch.engaged
      ? 'kill_switch'
      : (notConfigured ?? runtimeStop);
  return {
    enabled: env.enabled,
    configured: notConfigured === null,
    modelCallsEnabled: disabledReason === null,
    disabledReason,
    provider: env.provider,
    model: env.model,
    promptVersion: PROMPT_VERSION,
    concurrency: env.concurrency,
    maxCallsPerDay: env.maxCallsPerDay,
    killSwitch,
  };
}

/** One boot line, never the key: "AI grading: ready (gemini/gemini-2.5-flash)" or "AI grading: disabled (off)". */
export function aiBootLine(db: Database.Database): string {
  const c = aiConfig(db);
  return c.modelCallsEnabled ? `AI grading: ready (${c.provider}/${c.model})` : `AI grading: disabled (${c.disabledReason})`;
}
