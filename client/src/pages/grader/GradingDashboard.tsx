import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getGradingSummary } from '../../api/grading';
import { useLanguage } from '../../i18n/LanguageContext';
import { useStaffLive } from '../../lib/useStaffLive';
import { useLoader } from '../../lib/useLoader';
import { GraderHeader } from '../../components/grader/GraderHeader';
import { GradingStatsBar } from '../../components/grader/GradingStatsBar';
import { ParticipantTable } from '../../components/grader/ParticipantTable';
import { FlagIcon } from '../../components/grader/icons';
import { formatPercent } from '../../components/grader/format';
import { AiGradingBar } from '../../components/grader/AiGradingBar';
import { DifficultBadge, DifficultLegend } from '../../components/grader/DifficultBadge';
import { LanguageStats } from '../../components/grader/LanguageStats';
import { useAiBlindMode } from '../../lib/useAiBlindMode';
import '../../components/grader/grader.css';

const LIVE_ANNOUNCE_MS = 10_000;

/** /grade/:sessionId — the live overview of one session for admins and graders (wish 8, mockup 08-a). */
export function GradingDashboard() {
  const { sessionId } = useParams();
  const id = Number(sessionId);
  const { t, uiLanguage } = useLanguage();
  const load = useCallback(() => getGradingSummary(id), [id]);
  const { data, error, reload } = useLoader(load);
  const [blind, setBlind] = useAiBlindMode();

  useEffect(() => {
    reload();
  }, [reload, id]);
  useStaffLive(id, reload, { events: ['session:live', 'grading:changed', 'session:update'] });

  // One polite sentence for screen readers, at most every 10 s (not on every live update).
  const needsReview = data?.counters.needs_review ?? null;
  const [announced, setAnnounced] = useState<number | null>(null);
  const lastAnnounce = useRef(0);
  useEffect(() => {
    if (needsReview === null || needsReview === announced) return;
    const wait = Math.max(0, lastAnnounce.current + LIVE_ANNOUNCE_MS - Date.now());
    const timer = setTimeout(() => {
      lastAnnounce.current = Date.now();
      setAnnounced(needsReview);
    }, wait);
    return () => clearTimeout(timer);
  }, [needsReview, announced]);

  if (!data) {
    return (
      <div className="grade-page">
        <p role={error ? 'alert' : 'status'}>{error ? t('grader.error.load') : t('grader.loading')}</p>
      </div>
    );
  }

  const { counters, quiz, session } = data;
  const tiles = [
    { label: t('grader.tiles.joined'), value: String(counters.participants_joined) },
    { label: t('grader.tiles.answering'), value: String(counters.participants_answering) },
    { label: t('grader.tiles.submitted'), value: String(counters.participants_submitted) },
    {
      label: t('grader.tiles.answersGiven'),
      value: t('grader.tiles.ofTotal', { n: counters.answers_given, total: counters.answers_possible }),
    },
  ];

  return (
    <div className="grade-page">
      <GraderHeader sessionId={id} title={quiz.title} session={session} viewer={data.viewer} titleIsHeading />
      {error && (
        <p className="grade-banner grade-banner--warning" role="alert">
          {t('grader.error.load')}
        </p>
      )}

      {/* Wish 7 (S14): the AI pre-check, only for quizzes with AI suggestions. */}
      <AiGradingBar
        sessionId={id}
        quizAiEnabled={quiz.ai_grading_enabled === true}
        canRun={data.viewer.kind === 'admin'}
        blind={blind}
        onBlindChange={setBlind}
      />

      <GradingStatsBar sessionId={id} counters={counters} />

      <ul className="grade-tiles">
        {tiles.map((tile) => (
          <li key={tile.label} className="grade-tile">
            <span className="grade-tile__value">{tile.value}</span>
            <span className="grade-tile__label">{tile.label}</span>
          </li>
        ))}
      </ul>

      <p className="grade-cta-row">
        {/* "All graded" only once nobody is still answering; before that 0 just means "nothing yet". */}
        {counters.needs_review > 0 ||
        (session.status !== 'ended' && counters.participants_submitted < counters.participants_joined) ? (
          <Link className="grade-cta" to={`/grade/${id}/quiz?filter=needs_review`}>
            <FlagIcon size={18} /> {t('grader.cta.review', { n: counters.needs_review })}
          </Link>
        ) : (
          <Link className="grade-cta grade-cta--done" to={`/grade/${id}/quiz?filter=all`}>
            {t('grader.cta.allDone')}
          </Link>
        )}
      </p>
      <p className="visually-hidden" aria-live="polite">
        {announced !== null ? t('grader.live.needsReview', { n: announced }) : ''}
      </p>

      <ParticipantTable sessionId={id} rows={data.participants} questionCount={quiz.question_count} />

      <section className="grade-section" aria-labelledby="grade-questions-title">
        <h2 id="grade-questions-title" className="grade-section-title">
          {t('grader.questions.title')}
        </h2>
        <div className="table-scroll">
          <table className="grade-table grade-table--compact">
            <thead>
              <tr>
                <th scope="col" className="num">
                  {t('grader.questions.number')}
                </th>
                <th scope="col" className="num">
                  {t('grader.questions.answered')}
                </th>
                <th scope="col" className="num">
                  {t('grader.questions.correctRate')}
                </th>
                <th scope="col" className="num">
                  {t('grader.questions.needsReview')}
                </th>
              </tr>
            </thead>
            <tbody>
              {data.questions.map((q, i) => (
                <tr key={q.id}>
                  <th scope="row" className="num" title={q.text}>
                    {i + 1}
                  </th>
                  <td className="num">{t('grader.tiles.ofTotal', { n: q.answered_count, total: counters.participants_joined })}</td>
                  <td className="num">
                    <span className="rate-cell">
                      {q.correct_rate === null ? '–' : formatPercent(q.correct_rate, uiLanguage)}
                      {/* Wish 8 (S15): under 35 % correct of at least 5 graded answers of submitted
                          participants (as on the whole-quiz page); its place is kept. */}
                      <DifficultBadge correct={q.submitted_correct_count ?? 0} graded={q.submitted_graded_count ?? 0} />
                    </span>
                  </td>
                  <td className="num">
                    {q.needs_review_count > 0 ? (
                      <Link
                        to={`/grade/${id}/quiz?filter=needs_review#q-${q.id}`}
                        className="count-link"
                        aria-label={`${t('grader.questions.needsReview')}: ${q.needs_review_count} (${t('grader.question.number', { n: i + 1 })})`}
                      >
                        {q.needs_review_count}
                      </Link>
                    ) : (
                      '–'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <DifficultLegend />
      </section>

      {/* Wish 8 (S15): free-text answers per answer language, with the AI's and the reference check's agreement. */}
      <LanguageStats
        stats={data.languages ?? []}
        aiEnabled={quiz.ai_grading_enabled === true}
        base={quiz.base_language}
        offered={quiz.offered_languages}
      />
    </div>
  );
}
