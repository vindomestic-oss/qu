import { GRADER_SYSTEM_PROMPT, userMessage } from '../prompt';
import { GEMINI_RESPONSE_SCHEMA, parseGradeJson } from '../schema';
import type { GradePayload, ProviderErrorKind } from '../types';
import type { GradeOutcome, GradeProvider } from './types';

// Wish 7, layer B (S14): the Google Gemini API adapter (lead's decision: Gemini, not Anthropic).
// Node's built-in fetch against the REST endpoint models/{model}:generateContent with structured
// output (responseMimeType application/json + responseSchema); no SDK, no dependency.
//
// - One unique answer per request: system instruction = GRADER_SYSTEM_PROMPT, one user message =
//   the JSON payload (prompt.ts). Nothing else is sent: no names, ids or other answers.
// - The key goes in the x-goog-api-key header (never in the URL, so it never reaches a log).
// - Retries: 429 and 5xx and network errors are retried twice with backoff (429 honours the
//   server's delay, at most 30 s); a timeout is not retried.
// - Success only with finishReason STOP and output that parses as the schema. Anything else
//   (prompt blocked, safety stop, MAX_TOKENS, malformed JSON, HTTP error, timeout) is a failure
//   with an errorKind the worker acts on; the answer then stays with a person.
// - temperature is left at the model default (Google advises against lowering it on Gemini 3).
//
// Data protection: the Gemini Developer API (generativelanguage.googleapis.com) has no
// zero-data-retention option and keeps prompts for abuse monitoring; Vertex AI with an EU endpoint
// is the alternative and would be one more adapter file (different URL and OAuth). See README.

export interface GeminiOptions {
  apiKey: string;
  model: string;
  /** Base URL up to the API version, e.g. https://generativelanguage.googleapis.com/v1beta */
  endpoint: string;
  timeoutMs?: number;
  maxRetries?: number;
  /** Tests inject a mock; production uses the global fetch. */
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

const SAFETY_STOPS = new Set(['SAFETY', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'SPII', 'RECITATION', 'IMAGE_SAFETY']);
const MAX_RETRY_DELAY_MS = 30_000;
const MAX_OUTPUT_TOKENS = 8192;

/** Only clearly harmful content is blocked: Bible answers about wars and killings must get through. */
const SAFETY_SETTINGS = [
  'HARM_CATEGORY_HARASSMENT',
  'HARM_CATEGORY_HATE_SPEECH',
  'HARM_CATEGORY_SEXUALLY_EXPLICIT',
  'HARM_CATEGORY_DANGEROUS_CONTENT',
].map((category) => ({ category, threshold: 'BLOCK_ONLY_HIGH' }));

interface GeminiPart {
  text?: unknown;
  thought?: unknown;
}
interface GeminiResponse {
  candidates?: { content?: { parts?: GeminiPart[] }; finishReason?: unknown }[];
  promptFeedback?: { blockReason?: unknown };
  usageMetadata?: { promptTokenCount?: unknown; candidatesTokenCount?: unknown; thoughtsTokenCount?: unknown };
  modelVersion?: unknown;
  responseId?: unknown;
}
interface GeminiErrorBody {
  error?: { code?: unknown; status?: unknown; message?: unknown; details?: { reason?: unknown; retryDelay?: unknown }[] };
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const str = (v: unknown) => (typeof v === 'string' ? v : undefined);

/** The request body for one payload (exported for the adapter tests). */
export function geminiRequestBody(payload: GradePayload) {
  return {
    systemInstruction: { parts: [{ text: GRADER_SYSTEM_PROMPT }] },
    contents: [{ role: 'user', parts: [{ text: userMessage(payload) }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: GEMINI_RESPONSE_SCHEMA,
      candidateCount: 1,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
    },
    safetySettings: SAFETY_SETTINGS,
  };
}

/** "30s" / "1.5s" (google.rpc.RetryInfo) or a Retry-After header in seconds, as milliseconds. */
function retryDelayMs(res: Response, body: GeminiErrorBody | null, attempt: number): number {
  const header = Number(res.headers.get('retry-after'));
  if (Number.isFinite(header) && header > 0) return Math.min(header * 1000, MAX_RETRY_DELAY_MS);
  for (const d of body?.error?.details ?? []) {
    const m = typeof d.retryDelay === 'string' ? /^(\d+(?:\.\d+)?)s$/.exec(d.retryDelay) : null;
    if (m) return Math.min(Number(m[1]) * 1000, MAX_RETRY_DELAY_MS);
  }
  return Math.min(1000 * 2 ** attempt, MAX_RETRY_DELAY_MS);
}

export function createGeminiProvider(opts: GeminiOptions): GradeProvider {
  const model = opts.model.replace(/^models\//, '');
  const url = `${opts.endpoint.replace(/\/+$/, '')}/models/${encodeURIComponent(model)}:generateContent`;
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const maxRetries = opts.maxRetries ?? 2;
  const doFetch = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  /** A message safe for logs and the database: short, and never containing the key. */
  const safe = (s: string) => {
    const cleaned = opts.apiKey ? s.split(opts.apiKey).join('[key]') : s;
    return [...cleaned].slice(0, 160).join('');
  };
  const fail = (kind: ProviderErrorKind, stopReason: string, error: string, extra: Partial<GradeOutcome> = {}): GradeOutcome => ({
    stopReason,
    usage: { inputTokens: 0, outputTokens: 0 },
    error: safe(error),
    errorKind: kind,
    ...extra,
  });

  async function grade(payload: GradePayload): Promise<GradeOutcome> {
    const body = JSON.stringify(geminiRequestBody(payload));
    for (let attempt = 0; ; attempt++) {
      const canRetry = attempt < maxRetries;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let res: Response;
      try {
        res = await doFetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': opts.apiKey },
          body,
          signal: controller.signal,
        });
      } catch (err) {
        clearTimeout(timer);
        if (controller.signal.aborted) return fail('timeout', 'timeout', `timeout after ${timeoutMs} ms`);
        if (canRetry) {
          await sleep(Math.min(1000 * 2 ** attempt, MAX_RETRY_DELAY_MS));
          continue;
        }
        return fail('network', 'network_error', `network error: ${err instanceof Error ? err.message : String(err)}`);
      }

      let text: string;
      try {
        text = await res.text();
      } catch {
        clearTimeout(timer);
        if (controller.signal.aborted) return fail('timeout', 'timeout', `timeout after ${timeoutMs} ms`);
        return fail('network', 'network_error', 'response body could not be read');
      }
      clearTimeout(timer);

      if (!res.ok) {
        let errBody: GeminiErrorBody | null = null;
        try {
          errBody = JSON.parse(text) as GeminiErrorBody;
        } catch {
          errBody = null;
        }
        const status = str(errBody?.error?.status) ?? '';
        const message = `http ${res.status}${status ? ` ${status}` : ''}: ${str(errBody?.error?.message) ?? ''}`;
        const reasons = (errBody?.error?.details ?? []).map((d) => str(d.reason));
        if (res.status === 429 || res.status >= 500) {
          if (canRetry) {
            await sleep(retryDelayMs(res, errBody, attempt));
            continue;
          }
          return fail(res.status === 429 ? 'rate_limit' : 'server', `http_${res.status}`, message);
        }
        if (res.status === 401 || res.status === 403 || reasons.includes('API_KEY_INVALID') || /api key not valid/i.test(message)) {
          return fail('auth', `http_${res.status}`, message);
        }
        if (res.status === 404) return fail('config', `http_${res.status}`, message);
        return fail(res.status === 400 ? 'bad_request' : 'other', `http_${res.status}`, message);
      }

      let data: GeminiResponse;
      try {
        data = JSON.parse(text) as GeminiResponse;
      } catch {
        return fail('malformed', 'invalid_json', 'the response is not JSON');
      }
      const usage = {
        inputTokens: num(data.usageMetadata?.promptTokenCount),
        outputTokens: num(data.usageMetadata?.candidatesTokenCount) + num(data.usageMetadata?.thoughtsTokenCount),
      };
      const meta = { usage, servedModel: str(data.modelVersion), requestId: str(data.responseId) };
      const blocked = str(data.promptFeedback?.blockReason);
      if (blocked) return fail('safety', `blocked:${blocked}`, `prompt blocked (${blocked})`, meta);
      const candidate = data.candidates?.[0];
      if (!candidate) return fail('malformed', 'no_candidates', 'the response has no candidates', meta);
      const finish = str(candidate.finishReason) ?? 'UNKNOWN';
      if (finish !== 'STOP') {
        if (finish === 'MAX_TOKENS') return fail('max_tokens', finish, 'output cut off (MAX_TOKENS)', meta);
        if (SAFETY_STOPS.has(finish)) return fail('safety', finish, `stopped by safety filter (${finish})`, meta);
        return fail('other', finish, `unexpected finish reason ${finish}`, meta);
      }
      const output = (candidate.content?.parts ?? [])
        .filter((p) => typeof p.text === 'string' && p.thought !== true)
        .map((p) => p.text as string)
        .join('');
      const result = parseGradeJson(output);
      if (!result) return fail('malformed', finish, 'output is not the expected JSON', meta);
      return { result, stopReason: finish, ...meta };
    }
  }

  return { name: 'gemini', model, grade };
}
