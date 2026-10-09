import type { QuizLang } from './contentLanguages';

/**
 * The text to show for `field` in `lang`, and the language it is really in. The base columns hold
 * the quiz's base language (English unless the quiz overrides it, e.g. the German-only Chidon 5787
 * quizzes); `${field}_${lang}` holds a translation. Falls back to the base text, marked with the base.
 */
export function resolveFieldWithLang(row: unknown, field: string, lang: QuizLang, base: QuizLang): { text: string; lang: QuizLang } {
  const r = row as Record<string, unknown>;
  const baseText = { text: (r[field] as string) ?? '', lang: base };
  if (lang === base || lang === 'en') return baseText;
  const override = r[`${field}_${lang}`];
  if (typeof override === 'string' && override.trim()) return { text: override, lang };
  return baseText;
}

export function resolveField(row: unknown, field: string, lang: QuizLang, base: QuizLang = 'en'): string {
  return resolveFieldWithLang(row, field, lang, base).text;
}
