import { CONTENT_LANGS } from './languages';
import type { Translations } from './questionInput';

export function translationColumns(prefix: string): string[] {
  return CONTENT_LANGS.map((lang) => `${prefix}_${lang}`);
}

export function translationValues(translations: Translations): (string | null)[] {
  return CONTENT_LANGS.map((lang) => translations[lang] ?? null);
}
