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
}

export interface GradeProvider {
  name: string;
  /** The requested model. */
  model: string;
  /** Exactly ONE unique answer per call; never several participants in one prompt. Never throws. */
  grade(payload: GradePayload): Promise<GradeOutcome>;
}
