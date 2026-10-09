import type { QuizLang } from '../../i18n/contentLanguages';
import { LANGUAGE_META } from '../../i18n/languageMeta';
import { useLanguage } from '../../i18n/LanguageContext';
import { LanguageMenu } from '../LanguageMenu';

interface Props {
  languages: QuizLang[];
  value: QuizLang;
  onChange: (lang: QuizLang) => void;
  idPrefix: string;
  note?: string;
}

/**
 * Question-language control (decision Q-card-languages): 1 language → static text, 2 → two chips,
 * 3 or more → one menu with a count. Switching never touches answers: no request, no remount.
 */
export function QuestionLanguageBar({ languages, value, onChange, idPrefix, note }: Props) {
  const { t, tCount } = useLanguage();
  return (
    <div className="qlang" role="group" aria-labelledby={`${idPrefix}-label`}>
      <span id={`${idPrefix}-label`} className="qlang__label">
        {t('play.questionLanguage')}
      </span>
      {languages.length <= 1 ? (
        <span lang={languages[0] ?? value} className="qlang__static">
          {LANGUAGE_META[languages[0] ?? value].endonym}
        </span>
      ) : languages.length === 2 ? (
        languages.map((l) => (
          <button key={l} type="button" className="toggle-chip" lang={l} aria-pressed={l === value} onClick={() => onChange(l)}>
            {LANGUAGE_META[l].endonym}
          </button>
        ))
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
      {note && <span className="qlang__note">{note}</span>}
    </div>
  );
}
