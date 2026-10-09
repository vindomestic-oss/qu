import type { GradePayload, GradeResult, ProviderErrorKind } from '../types';

// Wish 7, layer B (S14): one interface per AI provider (decision Q-ai-provider). Each provider is
// one file implementing it with the same prompt (prompt.ts), payload and schema (schema.ts); a
// refusal, a cut-off or unparsable output is a failure, so the answer stays with a person.

export interface GradeOutcome {
  /** Set only for a complete, schema-valid answer. */
  result?: GradeResult;
  /** The model that served the request (may differ from the requested one). */
  servedModel?: string;
  /** The provider's finish reason, e.g. 'STOP', 'MAX_TOKENS', 'SAFETY', 'blocked:SAFETY', 'http_429'. */
  stopReason: string;
  usage: { inputTokens: number; outputTokens: number };
  requestId?: string;
  /** Short, safe description of the failure (never the key, never the whole response). */
  error?: string;
  errorKind?: ProviderErrorKind;
  /** Rate limit: how long the provider asked to wait (ms), when it said so. */
  retryAfterMs?: number;
}

/** The caller's say over every attempt (S14 review): data never leaves after a switch went off. */
export interface GradeOptions {
  /** Checked right before every attempt (also before retries); false = stop, errorKind 'aborted'. */
  allowed?: () => boolean;
  /** Aborts a request on its way (kill switch engaged, quiz switched off). */
  signal?: AbortSignal;
}

export interface GradeProvider {
  name: string;
  /** The requested model. */
  model: string;
  /** Exactly ONE unique answer per call; never several participants in one prompt. Never throws. */
  grade(payload: GradePayload, opts?: GradeOptions): Promise<GradeOutcome>;
}
