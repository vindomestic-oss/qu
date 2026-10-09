import { answerLooksLikeInjection } from '../guard';
import { matchKey, normalizeForMatch } from '../normalize';
import type { GradePayload, GradeResult } from '../types';
import type { GradeOutcome, GradeProvider } from './types';

// Wish 7, layer B (S14): a deterministic stand-in for a real model, for tests, the offline eval's
// pipeline check and local browser checks. No network, no data leaves the process. Selected with
// AI_GRADING_PROVIDER=fake and refused in production (config.ts). It is NOT a grader: it knows no
// translations or synonyms, so its eval numbers only prove the pipeline, never a model.
//
// Rules, in order:
//   the answer contains "simulate ai error"  → a provider failure (to see "AI error" + Retry);
//   the keyword guard matches, or the answer addresses the AI / a checker, asks to mark or accept
//   it, or calls the key wrong (a crude stand-in for what the system prompt asks a model to flag)
//                                            → unclear / low, injection_suspected;
//   "I don't know" in EN/DE/RU/HE            → incorrect / high;
//   equals the model answer or an accepted one (match key) → correct / high;
//   contains one of them as words            → correct / medium;
//   the near-match hint is set (1–2 letters off an accepted answer) → correct / high (a real model
//   must still notice a DIFFERENT name one letter away, e.g. Ahimelech for Abimelech: the eval's traps);
//   names some but not all parts of a multi-part answer ("A to B", "A and B") → partially_correct / medium;
//   otherwise                                → incorrect / medium.

const DONT_KNOW_RE = /^(i (do not|dont) know|no idea|keine ahnung|ich wei(ss|ß) (es )?nicht|wei(ss|ß) nicht|не знаю|не помню|\u05DC\u05D0 \u05D9\u05D5\u05D3\u05E2(\u05EA)?)$/;
const PART_SPLIT_RE = / (?:and|und|to|zu|и) | ?[,/] ?/;
const FAIL_MARKER = 'simulate ai error';
/** Stand-in for the model's injection judgement (EN, DE, RU, HE). Not used in production. */
const SUSPICIOUS_RE =
  /(\b(ai|a\.i\.|ki|model|assistant|checker|teacher|examiner)\b|(^|[^а-яё])ии([^а-яё]|$)|модел|проверя|учител|\u05D1\u05D5\u05D3\u05E7|\u05DE\u05DC\u05D0\u05DB\u05D5\u05EA\u05D9\u05EA|\bmark (it|this|as)\b|markier|отметь|\u05E1\u05DE\u05DF|accept (it|this)|give \d+ points?|(key|reference|musterantwort|эталон)\S* (is )?(wrong|outdated|falsch|неверн))/i;

export interface FakeOptions {
  latencyMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

const words = (s: string) => ` ${s} `;

function judge(p: GradePayload): GradeResult {
  const answer = normalizeForMatch(p.student_answer);
  const result = (verdict: GradeResult['verdict'], confidence: GradeResult['confidence'], rationale: string, injection = false): GradeResult => ({
    rationale,
    verdict,
    confidence,
    injection_suspected: injection,
    answer_language: /[\u0590-\u05FF]/.test(p.student_answer) ? 'he' : /[\u0400-\u04FF]/.test(p.student_answer) ? 'ru' : 'und',
  });
  if (answerLooksLikeInjection(p.student_answer) || SUSPICIOUS_RE.test(p.student_answer)) {
    return result('unclear', 'low', 'The answer addresses the grader instead of answering the question.', true);
  }
  if (DONT_KNOW_RE.test(answer)) return result('incorrect', 'high', 'The answer does not attempt an answer.');
  const candidates = [p.reference_answer ?? '', ...p.accepted_answers].map(normalizeForMatch).filter((c) => c !== '');
  if (candidates.some((c) => matchKey(c) === matchKey(answer))) return result('correct', 'high', 'Matches the reference answer.');
  if (candidates.some((c) => words(answer).includes(words(c)))) {
    return result('correct', 'medium', 'Contains the reference answer with extra words.');
  }
  if (p.near_match_hint) return result('correct', 'high', 'A close spelling of the reference answer.');
  for (const c of candidates) {
    const parts = c.split(PART_SPLIT_RE).map((x) => x.trim()).filter((x) => x !== '');
    if (parts.length < 2) continue;
    const named = parts.filter((part) => words(answer).includes(words(part))).length;
    if (named > 0 && named < parts.length) return result('partially_correct', 'medium', 'Names only part of the expected answer.');
  }
  return result('incorrect', 'medium', 'Names something other than the reference answer.');
}

export function createFakeProvider(opts: FakeOptions = {}): GradeProvider {
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  return {
    name: 'fake',
    model: 'fake-grader-1',
    async grade(p: GradePayload): Promise<GradeOutcome> {
      if (opts.latencyMs) await sleep(opts.latencyMs);
      const usage = { inputTokens: Math.ceil(JSON.stringify(p).length / 4), outputTokens: 40 };
      if (normalizeForMatch(p.student_answer).includes(FAIL_MARKER)) {
        return { stopReason: 'http_503', usage: { inputTokens: 0, outputTokens: 0 }, error: 'simulated provider error', errorKind: 'server' };
      }
      return { result: judge(p), servedModel: 'fake-grader-1', stopReason: 'STOP', usage, requestId: `fake-${Date.now()}` };
    },
  };
}
