/** Non-base languages that quiz content (title/description/question/choice text) can be translated into. */
export const CONTENT_LANGS = ['de', 'ru', 'fr', 'pl', 'lt', 'he'] as const;
export type ContentLang = (typeof CONTENT_LANGS)[number];
