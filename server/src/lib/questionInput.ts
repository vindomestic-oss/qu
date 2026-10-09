import { CONTENT_LANGS, ContentLang } from './languages';
import { isValidPoints, roundPoints } from './grading';
import { cleanAccepted } from './aiGrading/accepted';

export type QuestionType = 'single' | 'multiple' | 'text';

export type Translations = Partial<Record<ContentLang, string | null>>;

export interface ChoiceInput {
  /** Id of an existing choice of this question (kept, updated in place); null = a new choice. */
  id: number | null;
  text: string;
  translations: Translations;
  is_correct: boolean;
}

export interface QuestionInput {
  type: QuestionType;
  text: string;
  translations: Translations;
  points: number;
  choices: ChoiceInput[];
  /** The question's rubric. Absent = not sent (a new question gets none, an edit keeps the stored
   *  one); null = no rubric; a number = that rubric (the route checks it belongs to the quiz). */
  section_id?: number | null;
  /** Text questions only (wish 8): the graders' model answer and notes. undefined = the key was not
   *  sent, so the stored value stays; '' = cleared. Always undefined for choice types (stored as NULL). */
  reference_answer?: string;
  grader_notes?: string;
  /** Text questions only (wish 7): accepted answers and spellings, cleaned (trimmed, deduplicated by
   *  normalizeForMatch, ≤ 30 × ≤ 120 characters). undefined = not sent, the stored list stays. */
  accepted_answers?: string[];
}

export const GRADER_FIELD_MAX = 2000;

export function optionalText(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

/**
 * Extracts `${prefix}_de`, `${prefix}_ru`, etc. from a flat request body into a translations map.
 * An absent key becomes NULL, so clients must always send all 14 `${prefix}_${lang}` keys, including
 * languages the editor currently hides; otherwise a save would erase those translations.
 */
export function extractTranslations(body: any, prefix: string): Translations {
  const translations: Translations = {};
  for (const lang of CONTENT_LANGS) {
    translations[lang] = optionalText(body?.[`${prefix}_${lang}`]);
  }
  return translations;
}

/** The three states of an optional `section_id` in a request body; an error for any other value. */
function parseSectionId(body: any): { section_id?: number | null } | { error: string } {
  if (body?.section_id === undefined) return {};
  if (body.section_id === null) return { section_id: null };
  if (Number.isSafeInteger(body.section_id) && body.section_id > 0) return { section_id: body.section_id };
  return { error: 'section_id must be a positive integer or null' };
}

export function parseQuestionInput(body: any): QuestionInput | { error: string } {
  const { type, text, points, choices } = body ?? {};

  if (type !== 'single' && type !== 'multiple' && type !== 'text') {
    return { error: 'type must be "single", "multiple", or "text"' };
  }
  if (typeof text !== 'string' || !text.trim()) {
    return { error: 'text is required' };
  }
  const rawPoints = typeof points === 'string' && points.trim() ? Number(points) : points;
  if (!isValidPoints(rawPoints)) {
    return { error: 'points must be a positive whole or half number (0.5, 1, 1.5, …) of at most 100' };
  }
  const parsedPoints = roundPoints(rawPoints);

  const translations = extractTranslations(body, 'text');
  const section = parseSectionId(body);
  if ('error' in section) return section;

  if (type === 'text') {
    const graderFields: Pick<QuestionInput, 'reference_answer' | 'grader_notes' | 'accepted_answers'> = {};
    for (const key of ['reference_answer', 'grader_notes'] as const) {
      const v = body?.[key];
      if (v === undefined) continue;
      if (v !== null && typeof v !== 'string') return { error: `${key} must be a string` };
      const trimmed = (v ?? '').trim();
      if (trimmed.length > GRADER_FIELD_MAX) return { error: `${key} must be at most ${GRADER_FIELD_MAX} characters` };
      graderFields[key] = trimmed;
    }
    if (body?.accepted_answers !== undefined) {
      const accepted = cleanAccepted(body.accepted_answers);
      if (!Array.isArray(accepted)) return accepted;
      graderFields.accepted_answers = accepted;
    }
    return { type, text: text.trim(), translations, points: parsedPoints, choices: [], ...section, ...graderFields };
  }

  if (!Array.isArray(choices) || choices.length < 2) {
    return { error: 'single/multiple questions need at least 2 choices' };
  }
  const parsedChoices: ChoiceInput[] = [];
  const seenIds = new Set<number>();
  for (const c of choices) {
    if (typeof c?.text !== 'string' || !c.text.trim()) {
      return { error: 'each choice needs non-empty text' };
    }
    let id: number | null = null;
    if (c.id !== undefined && c.id !== null) {
      if (!Number.isSafeInteger(c.id) || c.id <= 0) return { error: 'choice id must be a positive integer' };
      if (seenIds.has(c.id)) return { error: 'duplicate choice id' };
      seenIds.add(c.id);
      id = c.id;
    }
    parsedChoices.push({
      id,
      text: c.text.trim(),
      translations: extractTranslations(c, 'text'),
      is_correct: Boolean(c.is_correct),
    });
  }
  const correctCount = parsedChoices.filter((c) => c.is_correct).length;
  if (correctCount === 0) {
    return { error: 'at least one choice must be marked correct' };
  }
  if (type === 'single' && correctCount !== 1) {
    return { error: 'single-choice questions must have exactly one correct choice' };
  }

  return { type, text: text.trim(), translations, points: parsedPoints, choices: parsedChoices, ...section };
}
