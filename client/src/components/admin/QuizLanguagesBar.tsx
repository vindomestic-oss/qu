import { useEffect, useId, useRef, useState } from 'react';
import type { Question } from '../../types';
import { isContentLang, questionLangStatus, type ContentLangCode, type QuizLang } from '../../i18n/contentLanguages';
import { LANGUAGE_META } from '../../i18n/languageMeta';
import { AddLanguageSelect } from './LanguagePairTabs';

interface Props {
  base: QuizLang;
  declared: QuizLang[];
  offered: QuizLang[];
  questions: Question[];
  addable: ContentLangCode[];
  onAdd: (lang: ContentLangCode, anchor?: HTMLElement) => Promise<void>;
  onRemove: (lang: ContentLangCode) => Promise<void>;
}

/**
 * "Languages of this quiz" (wish 6): the base, every declared translation with its coverage
 * ("Deutsch 50/50 ✓", or "Lietuvių 47/50 — hidden from participants" while incomplete, decision
 * Q-partial-languages), "×" to stop offering a language and "+ Add language". Counts come from the
 * saved questions; adding and removing save at once and never touch any text.
 */
export function QuizLanguagesBar({ base, declared, offered, questions, addable, onAdd, onRemove }: Props) {
  const headingId = useId();
  const sectionRef = useRef<HTMLElement>(null);
  // Position of a removed chip: once it is gone, focus moves to the chip now in that place.
  const focusAfterRemove = useRef<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const total = questions.length;
  const translations = declared.filter(isContentLang).filter((l) => l !== base);
  const others = offered.filter((l) => l !== base).length;
  const translationsKey = translations.join(',');

  useEffect(() => {
    const index = focusAfterRemove.current;
    if (index === null || !sectionRef.current) return;
    focusAfterRemove.current = null;
    const removeButtons = sectionRef.current.querySelectorAll<HTMLButtonElement>('.lang-chip__remove');
    const target = removeButtons[index] ?? sectionRef.current.querySelector<HTMLElement>('.add-lang select');
    target?.focus({ preventScroll: true });
  }, [translationsKey]);

  async function handleRemove(lang: ContentLangCode) {
    const name = LANGUAGE_META[lang].endonym;
    if (!confirm(`Stop offering ${name} to participants? Existing translations are kept and come back if you add the language again.`)) {
      return;
    }
    setError(null);
    try {
      focusAfterRemove.current = translations.indexOf(lang);
      await onRemove(lang);
    } catch (err) {
      focusAfterRemove.current = null;
      setError(err instanceof Error && err.message ? err.message : `Could not remove ${name}`);
    }
  }

  return (
    <section ref={sectionRef} className="quiz-langs" aria-labelledby={headingId}>
      <h2 id={headingId} className="quiz-langs__title">
        Languages of this quiz
      </h2>
      <ul className="quiz-langs__list">
        <li className="lang-chip lang-chip--base">
          <bdi lang={base}>{LANGUAGE_META[base].endonym}</bdi> · base
        </li>
        {translations.map((l) => {
          const done = questions.filter((q) => questionLangStatus(q, l, base) === 'full').length;
          const complete = total > 0 && done === total;
          const name = LANGUAGE_META[l].endonym;
          return (
            <li key={l} className={complete ? 'lang-chip' : 'lang-chip lang-chip--warning'}>
              <span>
                <bdi lang={l}>{name}</bdi> {done}/{total}
                {complete ? (
                  <>
                    {' '}
                    <span aria-hidden="true">✓</span>
                    <span className="visually-hidden">, offered to participants</span>
                  </>
                ) : (
                  ' — hidden from participants'
                )}
              </span>
              <button type="button" className="lang-chip__remove" aria-label={`Remove ${name}`} title={`Remove ${name}`} onClick={() => handleRemove(l)}>
                ×
              </button>
            </li>
          );
        })}
      </ul>
      <AddLanguageSelect addable={addable} onAdd={onAdd} />
      {error && (
        <p role="alert" className="quiz-langs__error">
          {error}
        </p>
      )}
      <p className="quiz-langs__summary">
        Participants see: <bdi lang={base}>{LANGUAGE_META[base].endonym}</bdi>
        {others === 0 ? ' only.' : ` + ${others} ${others === 1 ? 'language' : 'languages'}.`}
      </p>
    </section>
  );
}
