/** Non-base languages that quiz content (title/description/question/choice text) can be translated into. */
export const CONTENT_LANGS = ['de', 'ru', 'fr', 'pl', 'lt', 'he', 'bg', 'cs', 'es', 'fi', 'hu', 'it', 'lv', 'uk'] as const;
export type ContentLang = (typeof CONTENT_LANGS)[number];
