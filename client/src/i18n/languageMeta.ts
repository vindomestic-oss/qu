import { CONTENT_LANG_LABELS, type QuizLang } from './contentLanguages';

/** The only endonym table: each language's own name for itself, and its writing direction. */
export const LANGUAGE_META: Record<QuizLang, { endonym: string; dir: 'ltr' | 'rtl' }> = {
  en: { endonym: 'English', dir: 'ltr' },
  de: { endonym: 'Deutsch', dir: 'ltr' },
  he: { endonym: 'עברית', dir: 'rtl' },
  ru: { endonym: 'Русский', dir: 'ltr' },
  fr: { endonym: 'Français', dir: 'ltr' },
  pl: { endonym: 'Polski', dir: 'ltr' },
  lt: { endonym: 'Lietuvių', dir: 'ltr' },
  bg: { endonym: 'Български', dir: 'ltr' },
  cs: { endonym: 'Čeština', dir: 'ltr' },
  es: { endonym: 'Español', dir: 'ltr' },
  fi: { endonym: 'Suomi', dir: 'ltr' },
  hu: { endonym: 'Magyar', dir: 'ltr' },
  it: { endonym: 'Italiano', dir: 'ltr' },
  lv: { endonym: 'Latviešu', dir: 'ltr' },
  uk: { endonym: 'Українська', dir: 'ltr' },
};

export function dirOf(code: QuizLang): 'ltr' | 'rtl' {
  return LANGUAGE_META[code]?.dir ?? 'ltr';
}

/** The language's name in the interface language (e.g. "Deutsch" → "German" in an English UI). */
export function localizedLanguageName(code: QuizLang, ui: string): string {
  try {
    const name = new Intl.DisplayNames([ui], { type: 'language' }).of(code);
    if (name) return name;
  } catch {
    // Intl.DisplayNames missing or the locale is unsupported: use the static English name
  }
  return code === 'en' ? 'English' : CONTENT_LANG_LABELS[code];
}
