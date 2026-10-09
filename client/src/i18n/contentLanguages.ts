/** Non-base languages that quiz content (title/description/question/choice text) can be translated into. */
export const CONTENT_LANGS = ['de', 'ru', 'fr', 'pl', 'lt', 'he', 'bg', 'cs', 'es', 'fi', 'hu', 'it', 'lv', 'uk'] as const;
export type ContentLangCode = (typeof CONTENT_LANGS)[number];

/** Every language a quiz's content can be written in: the base language ('en' unless the quiz overrides it) plus every CONTENT_LANGS code. Mirrors the server. */
export const QUIZ_LANGS = ['en', ...CONTENT_LANGS] as const;
export type QuizLang = (typeof QUIZ_LANGS)[number];

export function isQuizLang(value: unknown): value is QuizLang {
  return typeof value === 'string' && (QUIZ_LANGS as readonly string[]).includes(value);
}

/** Validates a server-provided offered-languages list: known codes only, no duplicates, base first. */
export function sanitizeOffered(list: unknown, base: QuizLang): QuizLang[] {
  const valid = Array.isArray(list) ? list.filter(isQuizLang) : [];
  return Array.from(new Set<QuizLang>([base, ...valid]));
}

export const CONTENT_LANG_LABELS: Record<ContentLangCode, string> = {
  de: 'German',
  ru: 'Russian',
  fr: 'French',
  pl: 'Polish',
  lt: 'Lithuanian',
  he: 'Hebrew',
  bg: 'Bulgarian',
  cs: 'Czech',
  es: 'Spanish',
  fi: 'Finnish',
  hu: 'Hungarian',
  it: 'Italian',
  lv: 'Latvian',
  uk: 'Ukrainian',
};

/** Generates `${Base}_de`, `${Base}_ru`, etc. as nullable string fields — used for API response shapes. */
export type WithTranslations<Base extends string> = {
  [K in ContentLangCode as `${Base}_${K}`]: string | null;
};

/** Same field names but required strings — used for form/request payload shapes. */
export type WithTranslationInputs<Base extends string> = {
  [K in ContentLangCode as `${Base}_${K}`]: string;
};

export function flattenTranslations<Base extends string>(
  prefix: Base,
  translations: Record<ContentLangCode, string>,
): WithTranslationInputs<Base> {
  const out = {} as Record<string, string>;
  for (const lang of CONTENT_LANGS) out[`${prefix}_${lang}`] = translations[lang] ?? '';
  return out as WithTranslationInputs<Base>;
}

export function unflattenTranslations(prefix: string, source: unknown): Record<ContentLangCode, string> {
  const out = {} as Record<ContentLangCode, string>;
  const row = (source ?? {}) as Record<string, unknown>;
  for (const lang of CONTENT_LANGS) out[lang] = (row[`${prefix}_${lang}`] as string) ?? '';
  return out;
}
