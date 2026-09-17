import { CONTENT_LANGS, ContentLang } from './languages';

export type QuestionType = 'single' | 'multiple' | 'text';

export type Translations = Partial<Record<ContentLang, string | null>>;

export interface ChoiceInput {
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
}

export function optionalText(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

/** Extracts `${prefix}_de`, `${prefix}_ru`, etc. from a flat request body into a translations map. */
export function extractTranslations(body: any, prefix: string): Translations {
  const translations: Translations = {};
  for (const lang of CONTENT_LANGS) {
    translations[lang] = optionalText(body?.[`${prefix}_${lang}`]);
  }
  return translations;
}

export function parseQuestionInput(body: any): QuestionInput | { error: string } {
  const { type, text, points, choices } = body ?? {};

  if (type !== 'single' && type !== 'multiple' && type !== 'text') {
    return { error: 'type must be "single", "multiple", or "text"' };
  }
  if (typeof text !== 'string' || !text.trim()) {
    return { error: 'text is required' };
  }
  const parsedPoints = Number(points);
  if (!Number.isFinite(parsedPoints) || parsedPoints <= 0) {
    return { error: 'points must be a positive number' };
  }

  const translations = extractTranslations(body, 'text');

  if (type === 'text') {
    return { type, text: text.trim(), translations, points: parsedPoints, choices: [] };
  }

  if (!Array.isArray(choices) || choices.length < 2) {
    return { error: 'single/multiple questions need at least 2 choices' };
  }
  const parsedChoices: ChoiceInput[] = [];
  for (const c of choices) {
    if (typeof c?.text !== 'string' || !c.text.trim()) {
      return { error: 'each choice needs non-empty text' };
    }
    parsedChoices.push({
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

  return { type, text: text.trim(), translations, points: parsedPoints, choices: parsedChoices };
}
