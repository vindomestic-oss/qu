import { useCallback, useEffect, useRef } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getParticipantReview } from '../../api/grading';
import { useLanguage } from '../../i18n/LanguageContext';
import { useContentLanguage } from '../../i18n/useContentLanguage';
import { resolveFieldWithLang } from '../../i18n/resolveText';
import { formatServerTime } from '../../lib/parseServerDate';
import { useStaffLive } from '../../lib/useStaffLive';
import { useLoader } from '../../lib/useLoader';
import { GraderHeader } from '../../components/grader/GraderHeader';
import { QuestionReviewCard } from '../../components/grader/QuestionReviewCard';
import { AnswerGradeRow } from '../../components/grader/AnswerGradeRow';
import { StatusTag } from '../../components/grader/StatusTag';
import { QuestionLanguageBar } from '../../components/participant/QuestionLanguageBar';
import { formatPoints, gradedByViewer, offersAcceptVariant, participantLabel } from '../../components/grader/format';
import { AcceptVariantSlot, PrecedentHint } from '../../components/grader/AnswerHints';
import { AiSuggestionBadge } from '../../components/grader/AiSuggestionBadge';
import { isAiAcceptable } from '../../components/grader/aiSuggestion';
import { AiAcceptButton } from '../../components/grader/AiAccept';
import { useAiAcceptKey } from '../../lib/useAiAcceptKey';
import { useAiBlindMode } from '../../lib/useAiBlindMode';
import { runAi } from '../../api/aiGrading';
import type { AnswerGrade, ParticipantReviewResponse } from '../../types';
import '../../components/grader/grader.css';

/**
 * /grade/:sessionId/participants/:participantId — every question with the answer key and this
 * participant's answer. Live while they answer (read-only until they submit), then gradable.
 */
export function ParticipantReview() {
  const { sessionId, participantId } = useParams();
  const id = Number(sessionId);
  const pid = Number(participantId);
  const { t, uiLanguage } = useLanguage();
  const load = useCallback(() => getParticipantReview(id, pid), [id, pid]);
  const { data, error, reload, setData } = useLoader<ParticipantReviewResponse>(load);
  const { contentLanguage, base, setContentLanguage } = useContentLanguage(data?.quiz.offered_languages ?? null);
  // Wish 7 (S14): the same AI suggestion per answer as in the whole-quiz review.
  const [blind] = useAiBlindMode();
  const ai = data?.quiz.ai_grading_enabled === true;
  useAiAcceptKey(ai && !blind);

  useEffect(() => {
    reload();
  }, [reload, id, pid]);
  // While answering, answers change live; after submission only grades and the session state do.
  useStaffLive(id, reload, {
    events: data?.gradable ? ['grading:changed', 'session:update'] : ['session:live', 'grading:changed', 'session:update'],
  });

  function mergeGrade(grade: AnswerGrade) {
    setData((prev) =>
      prev
        ? {
            ...prev,
            items: prev.items.map((it) =>
              it.answer?.id === grade.id && grade.grade_version >= it.answer.grade_version ? { ...it, answer: { ...it.answer, ...grade } } : it,
            ),
          }
        : prev,
    );
  }

  // Previous / Next: the old participant stays on screen until the new one has loaded, then focus
  // moves to the new name (not to the top of the page).
  const headingRef = useRef<HTMLHeadingElement>(null);
  const shownPid = data?.participant.id ?? null;
  const lastShown = useRef<number | null>(null);
  useEffect(() => {
    if (shownPid === null || shownPid === lastShown.current) return;
    if (lastShown.current !== null) headingRef.current?.focus();
    lastShown.current = shownPid;
  }, [shownPid]);

  if (!data) {
    return (
      <div className="grade-page">
        <p role={error ? 'alert' : 'status'}>{error ? t('grader.error.load') : t('grader.loading')}</p>
      </div>
    );
  }

  const p = data.participant;
  const name = participantLabel(p, t);
  const languages = data.quiz.offered_languages;
  const submittedText =
    p.submitted_at &&
    (p.submit_source === 'session_end'
      ? t('grader.participant.endedAt', { time: formatServerTime(p.submitted_at, uiLanguage) })
      : t('grader.participant.submittedAt', { time: formatServerTime(p.submitted_at, uiLanguage) }));

  return (
    <div className="grade-page" aria-busy={data.participant.id !== pid || undefined}>
      <GraderHeader
        sessionId={id}
        title={data.quiz.title}
        session={data.session}
        back={{ to: `/grade/${id}`, label: t('grader.header.back') }}
      />

      <section className="participant-head" aria-labelledby="participant-name">
        <div className="participant-head__main">
          <h1 id="participant-name" className="grade-header__title" ref={headingRef} tabIndex={-1}>
            <bdi>{name}</bdi>
          </h1>
          <StatusTag status={p.status} />
        </div>
        <p className="participant-head__facts">
          <span>{t('grader.participant.answered', { n: data.totals.answered, total: data.items.length })}</span>
          <span>
            {t('grader.participant.score', {
              score: formatPoints(data.totals.score, uiLanguage),
              max: formatPoints(data.totals.max, uiLanguage),
            })}
          </span>
          {submittedText && <span>{submittedText}</span>}
        </p>
        <nav className="participant-head__arrows" aria-label={t('grader.table.title')}>
          {data.prev_id !== null ? (
            <Link className="arrow-link" to={`/grade/${id}/participants/${data.prev_id}`} rel="prev">
              <span aria-hidden="true">{'‹'}</span>
              <span>{t('grader.participant.prev')}</span>
            </Link>
          ) : (
            <span />
          )}
          {data.next_id !== null && (
            <Link className="arrow-link arrow-link--next" to={`/grade/${id}/participants/${data.next_id}`} rel="next">
              <span>{t('grader.participant.next')}</span>
              <span aria-hidden="true">{'›'}</span>
            </Link>
          )}
        </nav>
      </section>

      {!data.gradable && (
        <p className="grade-banner grade-banner--info" role="status">
          {t('grader.participant.locked')}
        </p>
      )}
      {error && (
        <p className="grade-banner grade-banner--warning" role="alert">
          {t('grader.error.load')}
        </p>
      )}
      {languages.length > 1 && (
        <div className="grade-lang">
          <QuestionLanguageBar languages={languages} value={contentLanguage} onChange={setContentLanguage} idPrefix="grade-qlang" />
        </div>
      )}

      {data.items.map(({ question: q, answer }, i) => (
        <QuestionReviewCard
          key={q.id}
          question={q}
          number={i + 1}
          lang={contentLanguage}
          base={base}
          selectedIds={answer?.selected_choice_ids}
        >
          {answer ? (
            <AnswerGradeRow
              sessionId={id}
              answer={answer}
              maxPoints={q.points}
              disabled={!data.gradable}
              heading={t('grader.question.number', { n: i + 1 })}
              headingHidden
              onGrade={mergeGrade}
              tools={
                // Admins: "Add to accepted answers" once a person credited the answer (wish 7).
                q.type === 'text' && data.viewer?.kind === 'admin' && data.gradable ? (
                  <AcceptVariantSlot
                    key={answer.id}
                    questionId={q.id}
                    answerId={answer.id}
                    offered={offersAcceptVariant(data.viewer, answer, q.points)}
                    mine={gradedByViewer(data.viewer, answer)}
                    answerText={answer.text_answer ?? ''}
                  />
                ) : undefined
              }
            >
              {q.type === 'text' ? (
                <>
                  <p className="answer-row__text" dir="auto">
                    {answer.text_answer}
                  </p>
                  {/* Wish 7: earlier grades of the same answer in other runs. */}
                  <PrecedentHint precedent={answer.answer_norm ? q.precedents?.[answer.answer_norm] : undefined} />
                  {ai && data.gradable && (
                    <AiSuggestionBadge
                      answer={answer}
                      hidden={blind && answer.points_awarded == null}
                      onRetry={
                        data.viewer?.kind === 'admin'
                          ? () => void runAi(id, { questionId: q.id, includeFailed: true }).catch(() => {})
                          : undefined
                      }
                    />
                  )}
                  {ai && data.gradable && (
                    <div className="answer-row__tools">
                      <AiAcceptButton
                        sessionId={id}
                        members={[answer]}
                        maxPoints={q.points}
                        offered={!blind && isAiAcceptable(answer)}
                        onGrades={(grades) => grades.forEach(mergeGrade)}
                      />
                    </div>
                  )}
                </>
              ) : (
                <p className="answer-row__text">
                  {(answer.selected_choice_ids ?? [])
                    .map((cid) => {
                      const c = q.choices.find((x) => x.id === cid);
                      return c ? resolveFieldWithLang(c, 'text', contentLanguage, base).text : t('grader.row.optionDeleted');
                    })
                    .join(', ') || t('grader.row.nothingSelected')}
                </p>
              )}
            </AnswerGradeRow>
          ) : (
            <p className="answer-row answer-row--empty">{t('grader.participant.noAnswer')}</p>
          )}
        </QuestionReviewCard>
      ))}
    </div>
  );
}
