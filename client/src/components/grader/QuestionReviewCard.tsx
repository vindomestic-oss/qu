import { useLanguage } from '../../i18n/LanguageContext';
import { resolveFieldWithLang } from '../../i18n/resolveText';
import type { QuizLang } from '../../i18n/contentLanguages';
import type { GradingQuestion } from '../../types';
import { CheckIcon } from './icons';
import { formatPoints } from './format';
import { normalizeForMatch } from '../../lib/acceptedAnswers';

/** Accepted answers that say more than the model answer itself (or one of its " / " parts). */
function extraAccepted(reference: string | null, accepted: string[] | undefined): string[] {
  const covered = new Set([reference ?? '', ...(reference ?? '').split(' / ')].map(normalizeForMatch));
  return (accepted ?? []).filter((a) => !covered.has(normalizeForMatch(a)));
}

interface Props {
  question: GradingQuestion;
  /** 1-based position in the quiz. */
  number: number;
  lang: QuizLang;
  base: QuizLang;
  /** Participant page: the participant's selection. */
  selectedIds?: number[];
  /** Whole-quiz page: how many submitted answers chose each option. */
  choiceCounts?: Record<string, number>;
  /** In the head, before the points (wish 8: the "difficult" badge). */
  badge?: React.ReactNode;
  children?: React.ReactNode;
}

/**
 * A question as graders see it: number, type, picture, text in the chosen content language (base
 * fallback), max points, and the answer key: correct options, or the model answer, the accepted
 * answers (wish 7) and the notes of a text question. Grading rows go in `children`.
 */
export function QuestionReviewCard({ question: q, number, lang, base, selectedIds, choiceCounts, badge, children }: Props) {
  const { t, uiLanguage } = useLanguage();
  const text = resolveFieldWithLang(q, 'text', lang, base);
  const known = new Set(q.choices.map((c) => c.id));
  const deletedSelections = (selectedIds ?? []).filter((id) => !known.has(id)).length;
  const maxCount = choiceCounts ? Math.max(1, ...Object.values(choiceCounts)) : 1;
  const alsoAccepted = q.type === 'text' ? extraAccepted(q.reference_answer, q.accepted_answers) : [];

  return (
    <article className="review-card" id={`q-${q.id}`} aria-labelledby={`q-${q.id}-title`}>
      <header className="review-card__head">
        {/* Focusable, so a jump to the question (e.g. "Show all") can move focus here. */}
        <span id={`q-${q.id}-title`} className="review-card__number" tabIndex={-1}>
          {t('grader.question.number', { n: number })}
        </span>
        <span>{t(`grader.question.type.${q.type}`)}</span>
        {badge}
        <span className="review-card__points">{t('grader.question.maxPoints', { points: formatPoints(q.points, uiLanguage) })}</span>
      </header>

      {q.image_path && (
        <img className="review-card__img" src={q.image_path} alt={t('grader.question.image', { n: number })} height={200} loading="lazy" />
      )}
      <p className="review-card__text" lang={text.lang} dir="auto">
        {text.text}
      </p>

      {q.type === 'text' ? (
        <div className="review-card__key">
          {q.reference_answer ? (
            <p className="review-card__reference">
              <span className="review-card__key-label">{t('grader.quiz.reference')}:</span>{' '}
              <span dir="auto">{q.reference_answer}</span>
            </p>
          ) : (
            <p className="grade-muted">{t('grader.quiz.noReference')}</p>
          )}
          {alsoAccepted.length > 0 && (
            <p className="review-card__accepted">
              <span className="review-card__key-label">{t('grader.quiz.accepted')}:</span>{' '}
              {alsoAccepted.map((a, i) => (
                <span key={`${a}-${i}`}>
                  {i > 0 && ' · '}
                  <bdi dir="auto">{a}</bdi>
                </span>
              ))}
            </p>
          )}
          {q.grader_notes && (
            <p className="review-card__notes">
              <span className="review-card__key-label">{t('grader.quiz.notes')}:</span> <span dir="auto">{q.grader_notes}</span>
            </p>
          )}
        </div>
      ) : (
        <ul className="review-choices">
          {q.choices.map((c) => {
            const choice = resolveFieldWithLang(c, 'text', lang, base);
            const selected = selectedIds?.includes(c.id) ?? false;
            const count = choiceCounts?.[String(c.id)];
            return (
              <li key={c.id} className={`review-choice${c.is_correct ? ' is-correct' : ''}${selected ? ' is-selected' : ''}`}>
                <span className="review-choice__mark">{c.is_correct ? <CheckIcon /> : null}</span>
                <span className="review-choice__text" lang={choice.lang} dir="auto">
                  {choice.text}
                </span>
                {c.is_correct ? <span className="review-choice__tag">{t('grader.question.correctOption')}</span> : null}
                {selected && <span className="review-choice__tag review-choice__tag--chosen">{t('grader.question.chosen')}</span>}
                {count !== undefined && (
                  <span className="review-choice__count">
                    <span className="mini-progress" aria-hidden="true">
                      <span className="mini-progress__fill" style={{ inlineSize: `${Math.round((count / maxCount) * 100)}%` }} />
                    </span>{' '}
                    {t('grader.quiz.chosenBy', { n: count })}
                  </span>
                )}
              </li>
            );
          })}
          {deletedSelections > 0 && <li className="review-choice is-selected grade-muted">{t('grader.row.optionDeleted')}</li>}
        </ul>
      )}
      {children}
    </article>
  );
}
