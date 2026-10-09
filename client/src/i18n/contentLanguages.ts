/** Non-base languages that quiz content (title/description/question/choice text) can be translated into. */
export const CONTENT_LANGS = ['de', 'ru', 'fr', 'pl', 'lt', 'he', 'bg', 'cs', 'es', 'fi', 'hu', 'it', 'lv', 'uk'] as const;
export type ContentLangCode = (typeof CONTENT_LANGS)[number];

/** Every language a quiz's content can be written in: the base language ('en' unless the quiz overrides it) plus every CONTENT_LANGS code. Mirrors the server. */
export const QUIZ_LANGS = ['en', ...CONTENT_LANGS] as const;
export type QuizLang = (typeof QUIZ_LANGS)[number];

export function isQuizLang(value: unknown): value is QuizLang {
  return typeof value === 'string' && (QUIZ_LANGS as readonly string[]).includes(value);
}

export function isContentLang(value: unknown): value is ContentLangCode {
  return typeof value === 'string' && (CONTENT_LANGS as readonly string[]).includes(value);
}

/** Order of every language list: the 4 UI languages, then the rest by endonym. Mirrors the server. */
export const LANGUAGE_DISPLAY_ORDER: readonly QuizLang[] = ['en', 'de', 'he', 'ru', 'cs', 'es', 'fr', 'it', 'lv', 'lt', 'hu', 'pl', 'fi', 'bg', 'uk'];

/** Translation languages of a quiz with this base, in display order. English is never a translation
 *  (there are no `*_en` columns); a non-English base's own columns are ignored. */
export function translationLangs(base: QuizLang): ContentLangCode[] {
  return LANGUAGE_DISPLAY_ORDER.filter((l): l is ContentLangCode => l !== base && isContentLang(l));
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

export type LangStatus = 'full' | 'partial' | 'empty';

type TextRow = { text: string } & Partial<Record<`text_${ContentLangCode}`, string | null>>;

/** Structural, so the admin Question, the participant question and editor form state all fit. */
export interface QuestionTexts extends TextRow {
  type: string;
  choices: readonly TextRow[];
}

/** True when `field` has non-blank text in `lang`: the base column for the base, else `${field}_${lang}`. */
export function isFilled(row: unknown, field: string, lang: QuizLang, base: QuizLang): boolean {
  const r = (row ?? {}) as Record<string, unknown>;
  const value = lang === base ? r[field] : r[`${field}_${lang}`];
  return typeof value === 'string' && value.trim() !== '';
}

function statusOf(filled: number, total: number): LangStatus {
  if (total > 0 && filled === total) return 'full';
  return filled === 0 ? 'empty' : 'partial';
}

/** How far one question is translated into `lang`: its text plus every choice of a non-text question. */
export function questionLangStatus(q: QuestionTexts, lang: QuizLang, base: QuizLang): LangStatus {
  const rows: unknown[] = [q, ...(q.type === 'text' ? [] : q.choices)];
  return statusOf(rows.filter((r) => isFilled(r, 'text', lang, base)).length, rows.length);
}

/** The languages a question can be read in completely: the base plus every fully translated language. */
export function questionLanguages(q: QuestionTexts, base: QuizLang): QuizLang[] {
  return [base, ...translationLangs(base).filter((l) => questionLangStatus(q, l, base) === 'full')];
}

/** Translation status of the quiz title and, when the base description is not empty, the description. */
export function metaLangStatus(values: Record<string, unknown>, lang: ContentLangCode): LangStatus {
  const hasDescription = typeof values.description === 'string' && values.description.trim() !== '';
  const fields = hasDescription ? ['title', 'description'] : ['title'];
  const filled = fields.filter((f) => {
    const v = values[`${f}_${lang}`];
    return typeof v === 'string' && v.trim() !== '';
  }).length;
  return statusOf(filled, fields.length);
}
