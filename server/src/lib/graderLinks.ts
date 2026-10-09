import { createHash, randomInt } from 'crypto';
import { CODE_CHARS } from './sessions';

// Grader codes (wish 8): 16 characters from CODE_CHARS (80 bits), shown as XXXX-XXXX-XXXX-XXXX.
// Only the sha256 of the normalised code is stored; the plain code is returned once, on creation.

export const GRADER_CODE_LENGTH = 16;
export const GRADER_LINK_DAYS = [1, 7, 30] as const;
export const GRADER_LABEL_MAX = 60;
export const GRADER_NAME_MAX = 40;
/** A grader token lives at most this long, and never past its link's expiry. */
export const GRADER_TOKEN_MAX_SECONDS = 12 * 60 * 60;

export function generateGraderCode(): string {
  let code = '';
  for (let i = 0; i < GRADER_CODE_LENGTH; i++) code += CODE_CHARS[randomInt(CODE_CHARS.length)];
  return code;
}

export function formatGraderCode(code: string): string {
  return code.match(/.{1,4}/g)?.join('-') ?? code;
}

/** Upper case, letters and digits only: "abcd-efgh jkl…" and pasted links with spaces still match. */
export function normalizeGraderCode(raw: unknown): string {
  return typeof raw === 'string' ? raw.toUpperCase().replace(/[^A-Z0-9]/g, '') : '';
}

export function hashGraderCode(normalized: string): string {
  return createHash('sha256').update(normalized).digest('hex');
}

/** expires_at of a new link: N days after the session's end when that is still ahead, else after now. */
export function graderLinkExpiry(endsAt: string | null, days: number, now = Date.now()): string {
  const end = endsAt ? Date.parse(endsAt) : NaN;
  const from = Number.isFinite(end) && end > now ? end : now;
  return new Date(from + days * 24 * 60 * 60 * 1000).toISOString();
}
