import type { QuizLang } from '../../i18n/contentLanguages';
import { dirOf } from '../../i18n/languageMeta';
import { resolveFieldWithLang } from '../../i18n/resolveText';

interface Props {
  row: unknown;
  field: string;
  /** The quiz's offered languages; one span per distinct text. */
  languages: QuizLang[];
  active: QuizLang;
  base: QuizLang;
}

/**
 * All translations of one text stacked in the same grid cell; only the active one is visible. The box
 * is as large as the longest translation, so switching the question language moves nothing.
 * Hidden spans are aria-hidden and excluded from innerText.
 */
export function LangStack({ row, field, languages, active, base }: Props) {
  const current = resolveFieldWithLang(row, field, active, base);
  const items: { text: string; lang: QuizLang }[] = [];
  for (const l of languages) {
    const r = resolveFieldWithLang(row, field, l, base);
    if (!items.some((i) => i.text === r.text)) items.push(r);
  }
  if (!items.some((i) => i.text === current.text)) items.push(current);
  return (
    <span className="lang-stack">
      {items.map((item) =>
        item.text === current.text ? (
          <span key={item.lang + item.text} lang={current.lang} dir={dirOf(current.lang)}>
            {item.text}
          </span>
        ) : (
          <span key={item.lang + item.text} lang={item.lang} dir={dirOf(item.lang)} aria-hidden="true" className="lang-stack__hidden">
            {item.text}
          </span>
        ),
      )}
    </span>
  );
}
