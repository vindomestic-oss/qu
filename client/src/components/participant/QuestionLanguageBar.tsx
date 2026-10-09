import type { QuizLang } from '../../i18n/contentLanguages';
import { LANGUAGE_META, dirOf } from '../../i18n/languageMeta';
import { useLanguage } from '../../i18n/LanguageContext';
import { LanguageMenu } from '../LanguageMenu';

interface Props {
  /** The quiz's offered languages (declared and complete), base first. */
  languages: QuizLang[];
  value: QuizLang;
  onChange: (lang: QuizLang) => void;
  idPrefix: string;
  /**
   * Defensive fallback only: "No Deutsch translation, shown in English" when the current question is
   * not complete in the picked language. Pass a string (empty = nothing to say) where it can happen:
   * the live region then exists before its text arrives, so screen readers announce it.
   */
  note?: string;
  /** Centre the label and control when they wrap (waiting room). */
  centered?: boolean;
}

/**
 * Question-language control (decision Q-card-languages): 1 language → static text, 2 → two chips,
 * 3 or more → one menu with a count. Switching never touches answers: no request, no remount.
 */
export function QuestionLanguageBar({ languages, value, onChange, idPrefix, note, centered }: Props) {
  const { t, tCount } = useLanguage();
  const only = languages[0] ?? value;
  const className = ['qlang', centered && 'qlang--center', note && 'qlang--note'].filter(Boolean).join(' ');
  return (
    <div className={className} role="group" aria-labelledby={`${idPrefix}-label`}>
      <span id={`${idPrefix}-label`} className="qlang__label">
        {t('play.questionLanguage')}
      </span>
      {languages.length <= 1 ? (
        <span lang={only} dir={dirOf(only)} className="qlang__static">
          {LANGUAGE_META[only].endonym}
        </span>
      ) : languages.length === 2 ? (
        <span className="qlang__chips">
          {languages.map((l) => (
            <button
              key={l}
              type="button"
              className="toggle-chip"
              lang={l}
              dir={dirOf(l)}
              aria-pressed={l === value}
              onClick={() => onChange(l)}
            >
              {LANGUAGE_META[l].endonym}
            </button>
          ))}
        </span>
      ) : (
        <LanguageMenu
          idPrefix={idPrefix}
          labelledBy={`${idPrefix}-label`}
          options={languages}
          value={value}
          onChange={onChange}
          icon="none"
          countLabel={tCount('lang.count', languages.length)}
        />
      )}
      {note !== undefined && (
        <span className="qlang__note" aria-live="polite" title={note || undefined}>
          {note ? `⚠ ${note}` : null}
        </span>
      )}
    </div>
  );
}
