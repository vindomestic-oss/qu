import { useId, useState } from 'react';
import { CONTENT_LANG_LABELS, type ContentLangCode, type LangStatus, type QuizLang } from '../../i18n/contentLanguages';
import { dirOf, LANGUAGE_META } from '../../i18n/languageMeta';

const GLYPH: Record<LangStatus, { glyph: string; text: string }> = {
  full: { glyph: '✓', text: 'translated' },
  partial: { glyph: '◐', text: 'partly translated' },
  empty: { glyph: '○', text: 'not translated' },
};

interface AddLanguageSelectProps {
  addable: ContentLangCode[];
  onAdd: (lang: ContentLangCode) => Promise<void>;
  /** Called after a successful add (e.g. to open the new language's pair). */
  onAdded?: (lang: ContentLangCode) => void;
}

/** "+ Add language": a native select of the languages the quiz does not declare yet. Adding saves at once. */
export function AddLanguageSelect({ addable, onAdd, onAdded }: AddLanguageSelectProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (addable.length === 0) return null;

  async function handleChange(value: string) {
    const lang = addable.find((l) => l === value);
    if (!lang) return;
    setBusy(true);
    setError(null);
    try {
      await onAdd(lang);
      onAdded?.(lang);
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : 'Could not add the language');
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="add-lang">
      <select aria-label="Add language" value="" disabled={busy} onChange={(e) => handleChange(e.target.value)}>
        <option value="">+ Add language</option>
        {addable.map((l) => (
          <option key={l} value={l}>
            {`${LANGUAGE_META[l].endonym} — ${CONTENT_LANG_LABELS[l]}`}
          </option>
        ))}
      </select>
      {error && (
        <span role="alert" className="add-lang__error">
          {error}
        </span>
      )}
    </span>
  );
}

interface Props {
  base: QuizLang;
  /** Translation languages shown as buttons, in display order. */
  languages: ContentLangCode[];
  /** The quiz's declared languages; a button for any other language is drawn dashed. */
  declared: QuizLang[];
  /** The open pair, or null for "{base} only". */
  active: ContentLangCode | null;
  onSelect: (lang: ContentLangCode | null) => void;
  statusOf?: (lang: ContentLangCode) => LangStatus;
  addable: ContentLangCode[];
  onAdd: (lang: ContentLangCode) => Promise<void>;
}

/**
 * The language-pair switch of the editor forms (wish 6): "{base} only", one button per translation
 * language with a live status glyph, and "+ Add language". The buttons only switch which pair is
 * shown; they never save. Every button is type="button" because this sits inside forms.
 */
export function LanguagePairTabs({ base, languages, declared, active, onSelect, statusOf, addable, onAdd }: Props) {
  const labelId = useId();
  return (
    <div className="pair-tabs" role="group" aria-labelledby={labelId}>
      <span id={labelId} className="pair-tabs__label">
        Translation:
      </span>
      <button type="button" className="toggle-chip" aria-pressed={active === null} onClick={() => onSelect(null)}>
        <bdi lang={base} dir={dirOf(base)}>
          {LANGUAGE_META[base].endonym}
        </bdi>{' '}
        only
      </button>
      {languages.map((l) => {
        const status = statusOf?.(l);
        const undeclared = !declared.includes(l);
        return (
          <button
            key={l}
            type="button"
            className={undeclared ? 'toggle-chip is-undeclared' : 'toggle-chip'}
            aria-pressed={active === l}
            title={undeclared ? 'Not offered to participants' : undefined}
            onClick={() => onSelect(l)}
          >
            <bdi lang={l} dir={dirOf(l)}>
              {LANGUAGE_META[l].endonym}
            </bdi>
            {status && (
              <>
                <span aria-hidden="true" className="pair-tabs__glyph">
                  {GLYPH[status].glyph}
                </span>
                <span className="visually-hidden"> {GLYPH[status].text}</span>
              </>
            )}
            {undeclared && <span className="visually-hidden">, not offered to participants</span>}
          </button>
        );
      })}
      <AddLanguageSelect addable={addable} onAdd={onAdd} onAdded={onSelect} />
    </div>
  );
}
