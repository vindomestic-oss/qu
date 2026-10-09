/** Non-base languages that quiz content (title/description/question/choice text) can be translated into. */
export const CONTENT_LANGS = ['de', 'ru', 'fr', 'pl', 'lt', 'he', 'bg', 'cs', 'es', 'fi', 'hu', 'it', 'lv', 'uk'] as const;
export type ContentLang = (typeof CONTENT_LANGS)[number];

/** Every language a quiz's content can be written in, including the base ('en' unless a quiz overrides it). */
export const QUIZ_LANGS = ['en', ...CONTENT_LANGS] as const;
export type QuizLang = (typeof QUIZ_LANGS)[number];

export function isQuizLang(value: unknown): value is QuizLang {
  return typeof value === 'string' && (QUIZ_LANGS as readonly string[]).includes(value);
}

/** Order of every language list sent to clients: the 4 UI languages, then the rest alphabetically
 *  by endonym (Latin script before Cyrillic). Clients render lists as received. */
export const LANGUAGE_DISPLAY_ORDER: readonly QuizLang[] = ['en', 'de', 'he', 'ru', 'cs', 'es', 'fr', 'it', 'lv', 'lt', 'hu', 'pl', 'fi', 'bg', 'uk'];
