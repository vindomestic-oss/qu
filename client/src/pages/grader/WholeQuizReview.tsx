import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { getAnswerGrades, getWholeQuiz } from '../../api/grading';
import { useLanguage } from '../../i18n/LanguageContext';
import { useContentLanguage } from '../../i18n/useContentLanguage';
import { resolveFieldWithLang } from '../../i18n/resolveText';
import { useGradingEvents, type GradingEvent } from '../../lib/useGradingEvents';
import { GraderHeader } from '../../components/grader/GraderHeader';
import { QuestionReviewCard } from '../../components/grader/QuestionReviewCard';
import { AnswerGradeRow } from '../../components/grader/AnswerGradeRow';
import { AnswerGroupRow } from '../../components/grader/AnswerGroupRow';
import { AcceptVariantSlot, PrecedentHint } from '../../components/grader/AnswerHints';
import { CheckIcon } from '../../components/grader/icons';
import { gradedByViewer, offersAcceptVariant } from '../../components/grader/format';
import { AiGradingBar } from '../../components/grader/AiGradingBar';
import { AiSuggestionBadge } from '../../components/grader/AiSuggestionBadge';
import { groupSuggestion, isAiAcceptable } from '../../components/grader/aiSuggestion';
import { AiAcceptAll, AiAcceptButton } from '../../components/grader/AiAccept';
import { useAiAcceptKey } from '../../lib/useAiAcceptKey';
import { useAiBlindMode } from '../../lib/useAiBlindMode';
import { runAi } from '../../api/aiGrading';
import { QuestionLanguageBar } from '../../components/participant/QuestionLanguageBar';
import type { AiGradingStatus, AnswerGrade, GradingAnswer, GradingQuestion, WholeQuizQuestion, WholeQuizResponse } from '../../types';
import '../../components/grader/grader.css';

type Filter = 'needs_review' | 'all';
type Row = GradingAnswer & { label: number };

interface Snapshot {
  filter: Filter;
  quiz: WholeQuizResponse['quiz'];
  session: WholeQuizResponse['session'];
  viewer: WholeQuizResponse['viewer'];
  /** The questions and answer ids shown, fixed until Refresh, a filter change or "Show". `groups`:
   *  text answers with the same normalized form (wish 7), biggest group first, each in label order. */
  questions: {
    question: WholeQuizQuestion['question'];
    stats: WholeQuizQuestion['stats'];
    ids: number[];
    groups: number[][];
    /** The server's rule_matched minus the shown rows' share, so the count follows rows updated in place. */
    ruleBase: number;
  }[];
}

const FULL_REFRESH_MS = 1000;
const ID_BATCH_MS = 300;
const ID_BATCH_MAX = 200;

/**
 * Identical text answers (same answer_norm: case, accents, niqqud, punctuation and spaces ignored)
 * as groups of ids, biggest first, ties by the first label. Computed once per list, so groups never
 * reshuffle while the grader works; an answer without a comparable form stays alone.
 */
function groupIdentical(answers: Row[]): number[][] {
  const groups = new Map<string, Row[]>();
  for (const a of [...answers].sort((x, y) => x.label - y.label)) {
    const key = a.answer_norm ? `n:${a.answer_norm}` : `id:${a.id}`;
    const list = groups.get(key) ?? [];
    list.push(a);
    groups.set(key, list);
  }
  return [...groups.values()].sort((x, y) => y.length - x.length || x[0].label - y[0].label).map((g) => g.map((a) => a.id));
}

/** Shown rows credited by the reference check. */
function countRule(ids: number[], rows: Map<number, Row>): number {
  let n = 0;
  for (const id of ids) if (rows.get(id)?.grade_source === 'rule') n += 1;
  return n;
}

/** The fields of a question's answer key (wish 7: they can change while the list is open). */
const keyText = (q: GradingQuestion) => JSON.stringify([q.reference_answer, q.accepted_answers, q.grader_notes]);

/**
 * The element whose place on screen must not change when content above it changes: the focused
 * control inside a question card, else the first answer row below the sticky bar.
 */
function captureAnchor(): { el: Element; top: number } | null {
  const active = document.activeElement;
  if (active && active !== document.body && active.closest('.review-card')) return { el: active, top: active.getBoundingClientRect().top };
  const offset = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--grade-sticky-offset')) || 0;
  for (const el of document.querySelectorAll('.review-card .answer-row')) {
    const top = el.getBoundingClientRect().top;
    if (top >= offset) return { el, top };
  }
  return null;
}

/** The question has a model answer or accepted answers, so the reference check applies to it. */
const hasKey = (q: GradingQuestion) => Boolean(q.reference_answer?.trim()) || (q.accepted_answers?.length ?? 0) > 0;

/** Graded text rows among the shown ones ("Graded X of Y" counts text answers of submitted participants). */
function countGradedText(questions: Snapshot['questions'], rows: Map<number, Row>): number {
  let n = 0;
  for (const q of questions) {
    if (q.question.type !== 'text') continue;
    for (const id of q.ids) if (rows.get(id)?.points_awarded != null) n += 1;
  }
  return n;
}

/**
 * /grade/:sessionId/quiz?filter=needs_review|all — every question with its answer key and anonymous
 * answer rows ("Answer 1, 2…"), graded in place (wish 8, mockup 08-b). The list is stable: rows keep
 * their place after grading; changes by others update rows in place; answers that arrive later are
 * only counted ("New answers: N — Show") until the grader reloads the list.
 */
export function WholeQuizReview() {
  const { sessionId } = useParams();
  const id = Number(sessionId);
  const [params, setParams] = useSearchParams();
  const filter: Filter = params.get('filter') === 'all' ? 'all' : 'needs_review';
  const { t } = useLanguage();
  const location = useLocation();
  const navigate = useNavigate();

  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [rows, setRows] = useState<Map<number, Row>>(new Map());
  // Server progress minus the shown rows' share, so a grade given here counts at once.
  const [progressBase, setProgressBase] = useState({ graded: 0, total: 0 });
  const [newCount, setNewCount] = useState(0);
  const [error, setError] = useState(false);
  const [openChoices, setOpenChoices] = useState<Set<number>>(new Set());
  const { contentLanguage, base, setContentLanguage } = useContentLanguage(snapshot?.quiz.offered_languages ?? null);
  // Wish 7 (S14): AI suggestions, the blind mode and the per-question "check the key" hints.
  const [blind, setBlind] = useAiBlindMode();
  const [aiStatus, setAiStatus] = useState<AiGradingStatus | null>(null);
  useAiAcceptKey(snapshot?.quiz.ai_grading_enabled === true && !blind);

  const snapshotRef = useRef<Snapshot | null>(null);
  const rowsRef = useRef(rows);
  useEffect(() => {
    snapshotRef.current = snapshot;
    rowsRef.current = rows;
  });
  const seq = useRef(0);
  /** Set just before a key refresh re-renders the cards; restored after it (useLayoutEffect below). */
  const anchorRef = useRef<{ el: Element; top: number } | null>(null);

  /** Merges newer grades into the shown rows (never older ones); returns the merged rows. */
  const mergeGrades = useCallback((grades: AnswerGrade[]) => {
    const prev = rowsRef.current;
    const next = new Map(prev);
    let changed = false;
    for (const g of grades) {
      const before = prev.get(g.id);
      if (!before || g.grade_version < before.grade_version) continue;
      next.set(g.id, { ...before, ...g });
      changed = true;
    }
    if (changed) {
      rowsRef.current = next;
      setRows(next);
    }
    return next;
  }, []);

  /** A new list: what the filter shows now. */
  const loadSnapshot = useCallback(() => {
    const mine = ++seq.current;
    getWholeQuiz(id, filter)
      .then((r) => {
        if (mine !== seq.current) return;
        const map = new Map<number, Row>();
        for (const q of r.questions) for (const a of q.answers) map.set(a.id, a);
        const questions = r.questions.map((q) => {
          const ids = q.answers.map((a) => a.id);
          return {
            question: q.question,
            stats: q.stats,
            ids,
            groups: q.question.type === 'text' ? groupIdentical(q.answers) : [],
            ruleBase: (q.stats.rule_matched ?? 0) - countRule(ids, map),
          };
        });
        rowsRef.current = map;
        setRows(map);
        setSnapshot({ filter, quiz: r.quiz, session: r.session, viewer: r.viewer, questions });
        setProgressBase({ graded: r.progress.graded - countGradedText(questions, map), total: r.progress.total });
        setNewCount(0);
        setError(false);
      })
      .catch(() => {
        if (mine === seq.current) setError(true);
      });
  }, [id, filter]);

  /** Same list, fresh data: rows update in place, new answers are only counted. */
  const refreshInPlace = useCallback(() => {
    const snap = snapshotRef.current;
    if (!snap) return;
    getWholeQuiz(id, snap.filter)
      .then(async (r) => {
        const shown = new Set(snap.questions.flatMap((q) => q.ids));
        const seen = new Set<number>();
        const grades: AnswerGrade[] = [];
        let fresh = 0;
        for (const q of r.questions) {
          for (const a of q.answers) {
            seen.add(a.id);
            if (shown.has(a.id)) grades.push(a);
            else fresh += 1;
          }
        }
        // Rows the filter no longer returns (graded meanwhile) are asked for by id.
        const missing = [...shown].filter((x) => !seen.has(x));
        for (let i = 0; i < missing.length; i += 200) {
          grades.push(...(await getAnswerGrades(id, missing.slice(i, i + 200))).answers);
        }
        const merged = mergeGrades(grades);
        setProgressBase({ graded: r.progress.graded - countGradedText(snap.questions, merged), total: r.progress.total });
        const statsById = new Map(r.questions.map((q) => [q.question.id, q.stats]));
        // An admin may have changed a model answer or the accepted answers ('key' event): the cards
        // show the new key, and the page keeps the focused control or the top row where it was.
        const keyById = new Map(r.questions.map((q) => [q.question.id, q.question]));
        const keyChanged = snap.questions.some((q) => {
          const fresh = keyById.get(q.question.id);
          return fresh !== undefined && keyText(fresh) !== keyText(q.question);
        });
        if (keyChanged) anchorRef.current = captureAnchor();
        setSnapshot((prev) =>
          prev
            ? {
                ...prev,
                session: r.session,
                questions: prev.questions.map((q) => {
                  const stats = statsById.get(q.question.id) ?? q.stats;
                  const fresh = keyById.get(q.question.id);
                  const question = fresh
                    ? { ...q.question, reference_answer: fresh.reference_answer, accepted_answers: fresh.accepted_answers, grader_notes: fresh.grader_notes }
                    : q.question;
                  return { ...q, question, stats, ruleBase: (stats.rule_matched ?? 0) - countRule(q.ids, merged) };
                }),
              }
            : prev,
        );
        setNewCount(fresh);
        setError(false);
      })
      .catch(() => setError(true));
  }, [id, mergeGrades]);

  useEffect(() => {
    loadSnapshot();
  }, [loadSnapshot]);

  // Scroll anchoring of our own (iPad Safari has none): content above the anchor changed height.
  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    anchorRef.current = null;
    if (!anchor.el.isConnected) return;
    const delta = anchor.el.getBoundingClientRect().top - anchor.top;
    if (Math.abs(delta) >= 1) window.scrollBy(0, delta);
  }, [snapshot]);

  // The sticky bar must never cover a focused control or a jumped-to question (WCAG 2.4.11): the page
  // scrolls with a top padding of the bar's measured height + 8 px (html scroll-padding-top).
  const barRef = useRef<HTMLDivElement>(null);
  const hasSnapshot = snapshot !== null;
  useEffect(() => {
    const bar = barRef.current;
    if (!bar) return;
    const root = document.documentElement;
    const apply = () => root.style.setProperty('--grade-sticky-offset', `${Math.ceil(bar.getBoundingClientRect().height) + 8}px`);
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(bar);
    return () => {
      observer.disconnect();
      root.style.removeProperty('--grade-sticky-offset');
    };
  }, [hasSnapshot]);

  // Jump to a question linked from the overview (#q-<id>) once the list is there.
  const jumped = useRef('');
  useEffect(() => {
    // Only once the list of the current filter is there (a "Show all" jump changes both).
    if (!snapshot || snapshot.filter !== filter || !location.hash || jumped.current === location.hash) return;
    jumped.current = location.hash;
    document.getElementById(location.hash.slice(1))?.scrollIntoView({ block: 'start' });
    // Focus follows the jump (e.g. "Show all"): the question's heading, not the page body.
    document.getElementById(`${location.hash.slice(1)}-title`)?.focus({ preventScroll: true });
  }, [snapshot, filter, location.hash]);

  // Live updates: grades by id (batched), everything else as a throttled in-place refresh.
  const pendingIds = useRef(new Set<number>());
  const idTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fullTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastFull = useRef(0);
  useEffect(
    () => () => {
      if (idTimer.current) clearTimeout(idTimer.current);
      if (fullTimer.current) clearTimeout(fullTimer.current);
    },
    [],
  );

  const scheduleFull = useCallback(() => {
    if (fullTimer.current) return;
    const wait = Math.max(0, lastFull.current + FULL_REFRESH_MS - Date.now());
    fullTimer.current = setTimeout(() => {
      fullTimer.current = null;
      lastFull.current = Date.now();
      refreshInPlace();
    }, wait);
  }, [refreshInPlace]);

  const onEvent = useCallback(
    (e: GradingEvent) => {
      // Grades by people, regrades, the reference check and AI suggestions (wish 7) carry the answers they changed.
      if (
        e.type === 'grading' &&
        (e.kind === 'grade' || e.kind === 'regrade' || e.kind === 'rule' || e.kind === 'ai') &&
        e.answerIds.length > 0 &&
        e.answerIds.length <= ID_BATCH_MAX
      ) {
        for (const x of e.answerIds) if (rowsRef.current.has(x)) pendingIds.current.add(x);
        if (pendingIds.current.size === 0 || idTimer.current) return;
        idTimer.current = setTimeout(() => {
          idTimer.current = null;
          const ids = [...pendingIds.current];
          pendingIds.current.clear();
          if (ids.length > ID_BATCH_MAX) {
            scheduleFull();
            return;
          }
          getAnswerGrades(id, ids)
            .then((r) => mergeGrades(r.answers))
            .catch(() => scheduleFull());
        }, ID_BATCH_MS);
        return;
      }
      scheduleFull();
    },
    [id, mergeGrades, scheduleFull],
  );
  useGradingEvents(id, onEvent);

  function setFilter(next: Filter) {
    if (next === filter) return;
    setParams({ filter: next }, { replace: true });
  }

  if (!snapshot) {
    return (
      <div className="grade-page">
        <p role={error ? 'alert' : 'status'}>{error ? t('grader.error.load') : t('grader.loading')}</p>
      </div>
    );
  }

  const progress = {
    graded: Math.min(progressBase.total, progressBase.graded + countGradedText(snapshot.questions, rows)),
    total: progressBase.total,
  };
  const pct = progress.total > 0 ? Math.round((progress.graded / progress.total) * 100) : 100;
  const languages = snapshot.quiz.offered_languages;
  const ai = snapshot.quiz.ai_grading_enabled === true;
  const retryAi = (questionId: number) => void runAi(id, { questionId, includeFailed: true }).catch(() => {});
  const questionNumber = new Map<number, number>();
  snapshot.questions.forEach((q) => questionNumber.set(q.question.id, q.question.sort_order + 1));

  return (
    <div className="grade-page">
      <GraderHeader
        sessionId={id}
        title={snapshot.quiz.title}
        session={snapshot.session}
        back={{ to: `/grade/${id}`, label: t('grader.header.back') }}
        heading={t('grader.quiz.title')}
      />

      <div className="quiz-bar" ref={barRef}>
        <div className="quiz-bar__progress">
          <span>{t('grader.quiz.progress', { graded: progress.graded, total: progress.total })}</span>
          <span
            className="mini-progress mini-progress--wide"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={progress.total}
            aria-valuenow={progress.graded}
            aria-label={t('grader.quiz.progress', { graded: progress.graded, total: progress.total })}
          >
            <span className="mini-progress__fill" style={{ inlineSize: `${pct}%` }} />
          </span>
        </div>
        {/* Always in the bar with its space kept, so the list never moves and the note is visible
            wherever the grader has scrolled to. */}
        <div className={`quiz-bar__new${newCount > 0 ? ' is-active' : ''}`}>
          <span role="status">{newCount > 0 ? t('grader.quiz.newAnswers', { n: newCount }) : ''}</span>
          <button
            type="button"
            className="small-button"
            onClick={loadSnapshot}
            tabIndex={newCount > 0 ? undefined : -1}
            aria-hidden={newCount > 0 ? undefined : true}
          >
            {t('grader.quiz.show')}
          </button>
        </div>
        <div className="grade-chips" role="group" aria-label={t('grader.quiz.filterLabel')}>
          <button type="button" className="toggle-chip" aria-pressed={filter === 'needs_review'} onClick={() => setFilter('needs_review')}>
            {t('grader.quiz.filterNeedsReview')}
          </button>
          <button type="button" className="toggle-chip" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>
            {t('grader.quiz.filterAll')}
          </button>
        </div>
        <button type="button" className="small-button" onClick={loadSnapshot}>
          {t('grader.quiz.refresh')}
        </button>
      </div>

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
      <AiGradingBar
        sessionId={id}
        quizAiEnabled={ai}
        blind={blind}
        onBlindChange={setBlind}
        onStatus={(s, polled) => {
          setAiStatus(s);
          if (polled) scheduleFull();
        }}
      />

      {snapshot.questions.length === 0 && (
        <div className="grade-empty">
          <p>{snapshot.filter === 'needs_review' ? t('grader.quiz.allGraded') : t('grader.quiz.empty')}</p>
          {snapshot.filter === 'needs_review' && (
            <button type="button" className="small-button" onClick={() => setFilter('all')}>
              {t('grader.quiz.filterAll')}
            </button>
          )}
        </div>
      )}

      {snapshot.questions.map(({ question: q, stats, ids, groups, ruleBase }) => {
        const isText = q.type === 'text';
        const open = isText || openChoices.has(q.id);
        const rowList = ids.map((x) => rows.get(x)).filter((r): r is Row => Boolean(r));
        const isAdmin = snapshot.viewer?.kind === 'admin';
        /** Earlier grades of the same answer in other runs (wish 7). */
        const hintFor = (members: Row[]) => (
          <PrecedentHint precedent={members[0].answer_norm ? q.precedents?.[members[0].answer_norm] : undefined} />
        );
        /** Admins: "Add to accepted answers" once a person credited the answer (its place is kept). */
        const acceptFor = (members: Row[]) => {
          if (!isAdmin) return undefined;
          const offered = members.filter((m) => offersAcceptVariant(snapshot.viewer, m, q.points));
          const mine = offered.find((m) => gradedByViewer(snapshot.viewer, m));
          return (
            <AcceptVariantSlot
              questionId={q.id}
              answerId={(mine ?? offered[0] ?? members[0]).id}
              offered={offered.length > 0}
              mine={Boolean(mine)}
              answerText={members[0].text_answer ?? ''}
            />
          );
        };
        /** Wish 7 (S14): the AI suggestion of a row or group (hidden in blind mode until graded). */
        const aiFor = (members: Row[]) =>
          ai ? (
            <AiSuggestionBadge
              answer={groupSuggestion(members)}
              hidden={blind && members.some((m) => m.points_awarded == null)}
              onRetry={() => retryAi(q.id)}
            />
          ) : null;
        const aiAcceptFor = (members: Row[]) =>
          ai ? (
            <AiAcceptButton
              sessionId={id}
              members={members}
              maxPoints={q.points}
              offered={!blind && members.some(isAiAcceptable)}
              onGrades={(grades) => mergeGrades(grades)}
            />
          ) : null;
        const textRow = (row: Row, withHints: boolean) => (
          <AnswerGradeRow
            key={row.id}
            sessionId={id}
            answer={row}
            maxPoints={q.points}
            heading={t('grader.row.answerOf', { n: row.label })}
            onGrade={(g) => mergeGrades([g])}
            tools={withHints ? acceptFor([row]) : undefined}
          >
            <p className="answer-row__text" dir="auto">
              {row.text_answer}
            </p>
            {withHints && hintFor([row])}
            {withHints && aiFor([row])}
            {withHints && ai && <div className="answer-row__tools">{aiAcceptFor([row])}</div>}
          </AnswerGradeRow>
        );
        // "Accept all confident-correct": the acceptable rows, grouped like the list.
        const acceptGroups = groups
          .map((groupIds) => groupIds.map((x) => rows.get(x)).filter((r): r is Row => Boolean(r) && isAiAcceptable(r!)))
          .filter((members) => members.length > 0)
          .map((members) => ({ text: members[0].text_answer ?? '', members }));
        const ruleMatched = Math.max(0, ruleBase + countRule(ids, rows));
        return (
          <QuestionReviewCard
            key={q.id}
            question={q}
            number={questionNumber.get(q.id) ?? 0}
            lang={contentLanguage}
            base={base}
            choiceCounts={isText ? undefined : stats.choice_counts}
          >
            {/* Always one line, so the card keeps its height when the last participant submits. */}
            <p className="grade-muted review-card__pending">
              {stats.not_submitted_participants > 0
                ? t('grader.quiz.notSubmitted', { n: stats.not_submitted_participants })
                : t('grader.quiz.allSubmitted')}
            </p>
            {/* Answers credited by the reference check (wish 7); always shown for a question with a key,
                so the card keeps its height when the count changes. */}
            {isText && hasKey(q) && (
              <p className="review-card__rule">
                <span>
                  <CheckIcon size={14} /> {t('grader.quiz.ruleMatched', { n: ruleMatched })}
                </span>
                {snapshot.filter === 'needs_review' && (
                  <button
                    type="button"
                    className={`small-button${ruleMatched > 0 ? '' : ' accept-slot__unused'}`}
                    tabIndex={ruleMatched > 0 ? undefined : -1}
                    aria-hidden={ruleMatched > 0 ? undefined : true}
                    onClick={() => navigate({ search: '?filter=all', hash: `#q-${q.id}` }, { replace: true })}
                  >
                    {t('grader.quiz.ruleShowAll')}
                  </button>
                )}
              </p>
            )}
            {!isText && rowList.length > 0 && (
              <button
                type="button"
                className="small-button"
                aria-expanded={open}
                onClick={() =>
                  setOpenChoices((prev) => {
                    const next = new Set(prev);
                    if (next.has(q.id)) next.delete(q.id);
                    else next.add(q.id);
                    return next;
                  })
                }
              >
                {open ? t('grader.quiz.hideAnswers') : t('grader.quiz.showAnswers', { n: rowList.length })}
              </button>
            )}
            {isText && ai && (
              <AiAcceptAll
                sessionId={id}
                questionId={q.id}
                maxPoints={q.points}
                groups={blind ? [] : acceptGroups}
                ambiguous={Boolean(aiStatus?.perQuestion.find((x) => x.questionId === q.id)?.flaggedAmbiguous)}
                onGrades={(grades) => mergeGrades(grades)}
              />
            )}
            {isText && rowList.length === 0 && <p className="grade-muted">{t('grader.quiz.noRows')}</p>}
            {isText &&
              groups.map((groupIds) => {
                const members = groupIds.map((x) => rows.get(x)).filter((r): r is Row => Boolean(r));
                if (members.length === 0) return null;
                if (members.length === 1) return textRow(members[0], true);
                return (
                  <AnswerGroupRow
                    key={`group-${members[0].id}`}
                    sessionId={id}
                    members={members}
                    maxPoints={q.points}
                    text={
                      <p className="answer-row__text" dir="auto">
                        {members[0].text_answer}
                      </p>
                    }
                    label={members[0].text_answer ?? ''}
                    hints={hintFor(members)}
                    actions={acceptFor(members)}
                    ai={
                      ai ? (
                        <>
                          {aiFor(members)}
                          <div className="answer-row__tools">{aiAcceptFor(members)}</div>
                        </>
                      ) : undefined
                    }
                    onGrade={(grades) => mergeGrades(grades)}
                    renderMember={(m) => textRow(m, false)}
                  />
                );
              })}
            {!isText &&
              open &&
              rowList.map((row) => (
                <AnswerGradeRow
                  key={row.id}
                  sessionId={id}
                  answer={row}
                  maxPoints={q.points}
                  heading={t('grader.row.answerOf', { n: row.label })}
                  onGrade={(g) => mergeGrades([g])}
                >
                  <p className="answer-row__text">
                    {(row.selected_choice_ids ?? [])
                      .map((cid) => {
                        const c = q.choices.find((x) => x.id === cid);
                        return c ? resolveFieldWithLang(c, 'text', contentLanguage, base).text : t('grader.row.optionDeleted');
                      })
                      .join(', ') || t('grader.row.nothingSelected')}
                  </p>
                </AnswerGradeRow>
              ))}
          </QuestionReviewCard>
        );
      })}
      <p className="grade-footer-link">
        <Link to={`/grade/${id}`} className="touch-target">
          {t('grader.header.back')}
        </Link>
      </p>
    </div>
  );
}
