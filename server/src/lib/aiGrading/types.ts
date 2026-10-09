// Wish 7, layer B (S14): the enums of the AI suggestions. SQLite stores them as TEXT without CHECK
// constraints (migration rules); every write goes through these lists.

export const AI_STATUSES = ['queued', 'running', 'done', 'failed', 'skipped'] as const;
export type AiStatus = (typeof AI_STATUSES)[number];

export const AI_SOURCES = ['model', 'cache'] as const;
export type AiSource = (typeof AI_SOURCES)[number];

export const VERDICTS = ['correct', 'partially_correct', 'incorrect', 'unclear'] as const;
export type Verdict = (typeof VERDICTS)[number];

export const CONFIDENCES = ['high', 'medium', 'low'] as const;
export type Confidence = (typeof CONFIDENCES)[number];

export const isVerdict = (v: unknown): v is Verdict => typeof v === 'string' && (VERDICTS as readonly string[]).includes(v);
export const isConfidence = (v: unknown): v is Confidence =>
  typeof v === 'string' && (CONFIDENCES as readonly string[]).includes(v);

/** answers.ai_rationale and ai_grading_runs.rationale are cut to this many characters. */
export const RATIONALE_MAX_CHARS = 300;
/** answers.ai_error is cut to this many characters. */
export const AI_ERROR_MAX_CHARS = 200;
/** Text answers of quizzes with AI suggestions are limited to this many characters (code points). */
export const TEXT_ANSWER_MAX_CHARS_AI = 300;

/**
 * Exactly what is sent to the provider for ONE unique answer (decision Q-ai-data): the question,
 * its key and points, and the answer text unchanged. Never a name, participant id, session id, join
 * code, timestamp or another participant's answer.
 */
export interface GradePayload {
  quiz: string;
  question: string;
  reference_answer: string | null;
  accepted_answers: string[];
  grader_notes: string | null;
  max_points: number;
  near_match_hint: string | null;
  student_answer: string;
}

/** The model's structured answer after validation (lib/aiGrading/schema.ts). */
export interface GradeResult {
  rationale: string;
  verdict: Verdict;
  confidence: Confidence;
  injection_suspected: boolean;
  answer_language: string;
}

/** Why a provider call produced no usable suggestion; decides what the worker does next. */
export type ProviderErrorKind =
  /** 429 after the adapter's retries: the group goes back to the queue and the worker pauses. */
  | 'rate_limit'
  /** Invalid key or no permission: no further calls until restart. */
  | 'auth'
  /** Unknown model or endpoint: no further calls until restart. */
  | 'config'
  | 'timeout'
  | 'network'
  | 'server'
  | 'bad_request'
  /** Blocked by the provider's safety filters (prompt or answer). */
  | 'safety'
  /** Output cut off before it was complete. */
  | 'max_tokens'
  /** Not valid JSON or not the schema. */
  | 'malformed'
  /** Stopped by the caller before or while sending (kill switch, quiz switched off). */
  | 'aborted'
  | 'other';
