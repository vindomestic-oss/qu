import { useCallback, useEffect } from 'react';
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
import { formatPoints, participantLabel } from '../../components/grader/format';
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

  if (!data || data.participant.id !== pid) {
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
    <div className="grade-page">
      <GraderHeader
        sessionId={id}
        title={data.quiz.title}
        session={data.session}
        back={{ to: `/grade/${id}`, label: t('grader.header.back') }}
      />

      <section className="participant-head" aria-labelledby="participant-name">
        <div className="participant-head__main">
          <h1 id="participant-name" className="grade-header__title">
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
              <span aria-hidden="true">{'‹'}</span> {t('grader.participant.prev')}
            </Link>
          ) : (
            <span />
          )}
          {data.next_id !== null && (
            <Link className="arrow-link" to={`/grade/${id}/participants/${data.next_id}`} rel="next">
              {t('grader.participant.next')} <span aria-hidden="true">{'›'}</span>
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
              onGrade={mergeGrade}
            >
              {q.type === 'text' ? (
                <p className="answer-row__text" dir="auto">
                  {answer.text_answer}
                </p>
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
