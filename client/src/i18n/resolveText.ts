import type { Language } from './translations';

/**
 * Returns the `${field}_${language}` override if present, falling back to the original
 * `${field}` column — which holds the quiz's base language (English unless the quiz
 * overrides it with a non-English base, e.g. the German-only Chidon 5787 quizzes).
 */
export function resolveField(row: unknown, field: string, language: Language, base: Language = 'en'): string {
  const r = row as Record<string, unknown>;
  if (language !== base) {
    const override = r[`${field}_${language}`];
    if (typeof override === 'string' && override) return override;
  }
  return (r[field] as string) ?? '';
}
