import type { ContentLangCode, QuizLang } from '../../i18n/contentLanguages';
import { dirOf, LANGUAGE_META } from '../../i18n/languageMeta';

interface Props {
  label: string;
  /** Keep the label for screen readers only (choice rows, where a placeholder says "Choice 1"). */
  hideLabel?: boolean;
  baseLang: QuizLang;
  baseValue: string;
  onBaseChange: (value: string) => void;
  /** All 14 translations, also the hidden ones: the form always sends every key. */
  translations: Record<ContentLangCode, string>;
  onTranslationChange: (lang: ContentLangCode, value: string) => void;
  /** The open pair; null shows only the base field. */
  activeLang: ContentLangCode | null;
  multiline?: boolean;
  required?: boolean;
  basePlaceholder?: string;
}

/**
 * A text in the quiz's base language with, directly below it, its translation into the open pair's
 * language: labelled with that language's own name, written in its direction, and showing the base
 * text as placeholder so a translator never has to scroll.
 */
export function PairField({
  label,
  hideLabel,
  baseLang,
  baseValue,
  onBaseChange,
  translations,
  onTranslationChange,
  activeLang,
  multiline,
  required,
  basePlaceholder,
}: Props) {
  const Field = multiline ? 'textarea' : 'input';
  return (
    <div className="pair-field">
      <label>
        <span className={hideLabel ? 'visually-hidden' : undefined}>
          {label}{' '}
          <span className="pair-field__base">
            (<bdi lang={baseLang}>{LANGUAGE_META[baseLang].endonym}</bdi>, base)
          </span>
        </span>
        <Field
          lang={baseLang}
          dir={dirOf(baseLang)}
          value={baseValue}
          onChange={(e) => onBaseChange(e.target.value)}
          placeholder={basePlaceholder}
          required={required}
        />
      </label>
      {activeLang && (
        <label className="pair-field__translation">
          <span className="pair-field__lang" dir={dirOf(activeLang)}>
            {hideLabel && <span className="visually-hidden">{label}, </span>}
            <span lang={activeLang}>{LANGUAGE_META[activeLang].endonym}</span>
          </span>
          <Field
            lang={activeLang}
            dir={dirOf(activeLang)}
            value={translations[activeLang] ?? ''}
            onChange={(e) => onTranslationChange(activeLang, e.target.value)}
            placeholder={baseValue}
          />
        </label>
      )}
    </div>
  );
}
