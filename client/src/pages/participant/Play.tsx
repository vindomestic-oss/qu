import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './play.css';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { getMyQuiz, getMySession, submitQuiz } from '../../api/participant';
import type { QuizMeta } from '../../api/participant';
import type { ParticipantQuestion, QuizSection, QuizSession } from '../../types';
import { ApiError } from '../../api/client';
import { useParticipant } from '../../auth/ParticipantContext';
import { getSocket, joinRoom, leaveRoom } from '../../lib/socket';
import { useLanguage } from '../../i18n/LanguageContext';
import { useContentLanguage } from '../../i18n/useContentLanguage';
import { questionLanguages, sanitizeOffered, type QuizLang } from '../../i18n/contentLanguages';
import { resolveFieldWithLang } from '../../i18n/resolveText';
import { LANGUAGE_META, dirOf } from '../../i18n/languageMeta';
import { AnswerSaver, type Payload } from '../../lib/answerSaver';
import { buildNavGroups } from '../../lib/navGroups';
import { Countdown } from '../../components/participant/Countdown';
import { LangStack } from '../../components/participant/LangStack';
import { QuestionNavigator } from '../../components/participant/QuestionNavigator';
import { QuestionOverviewDialog } from '../../components/participant/QuestionOverviewDialog';
import { ThemeToggle } from '../../components/ThemeToggle';
import { QuestionLanguageBar } from '../../components/participant/QuestionLanguageBar';
import { Logo } from '../../components/Logo';
import { formatJoinCode } from '../../lib/joinLink';

const AUTOSAVE_MS = 1500;

function offeredOf(info: { base_language: QuizLang; offered_languages: unknown }): QuizLang[] {
  return sanitizeOffered(info.offered_languages, info.base_language);
}

function confirmedPayload(q: ParticipantQuestion): Payload {
  return q.type === 'text'
    ? { kind: 'text', text: q.myAnswer?.text_answer ?? '' }
    : { kind: 'choice', ids: q.myAnswer?.selected_choice_ids ?? [] };
}

function readFlags(sessionId: number): Set<number> {
  try {
    const raw = sessionStorage.getItem(`quiz_flags_${sessionId}`);
    const list = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(list) ? list.filter((n) => Number.isInteger(n)) : []);
  } catch {
    return new Set();
  }
}

function FlagIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M5 21V4M5 4h11l-2 4 2 4H5" />
    </svg>
  );
}

export function Play() {
  const navigate = useNavigate();
  const { leave } = useParticipant();
  const { t, setUiLanguageLocked } = useLanguage();
  const [params, setParams] = useSearchParams();

  const [session, setSession] = useState<QuizSession | null>(null);
  const [quizMeta, setQuizMeta] = useState<QuizMeta | null>(null);
  const [offered, setOffered] = useState<QuizLang[] | null>(null);
  const { contentLanguage, base, setContentLanguage } = useContentLanguage(offered);
  // myAnswer.text_answer holds only what the server has saved; typing lives in drafts.
  const [questions, setQuestions] = useState<ParticipantQuestion[] | null>(null);
  const [sections, setSections] = useState<QuizSection[]>([]);
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [flagged, setFlagged] = useState<Set<number>>(new Set());
  const [overviewOpen, setOverviewOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // Saving / saved of a text answer, shown only on its own question.
  const [status, setStatus] = useState<{ questionId: number; state: 'saving' | 'saved' } | null>(null);
  // Questions whose last save failed. Shown on every question until saved, so a failed save is never
  // lost silently when the child moves on.
  const [failedIds, setFailedIds] = useState<Set<number>>(new Set());
  const [submitted, setSubmitted] = useState(false);
  const finishedRef = useRef(false);
  // Read by handlers registered once (sockets, page events, the saver); a closure would be stale.
  const questionsRef = useRef<ParticipantQuestion[] | null>(null);
  const draftsRef = useRef<Record<number, string>>({});
  useEffect(() => {
    questionsRef.current = questions;
    draftsRef.current = drafts;
  }, [questions, drafts]);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const submittedRef = useRef<HTMLHeadingElement>(null);
  const movedRef = useRef(false);
  const timersRef = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  // The position is mirrored into ?q= (1-based), so a reload stays on the same question; ?q= is not
  // written on load. The page itself switches at once from local state: router navigations are
  // deferred, and typing right after a tap must not land in the previous question.
  const [pickedIndex, setPickedIndex] = useState<number | null>(null);
  const rawQ = Number.parseInt(params.get('q') ?? '', 10);
  const total = questions?.length ?? 0;
  const urlIndex = total ? (Number.isInteger(rawQ) ? Math.min(Math.max(rawQ - 1, 0), total - 1) : 0) : 0;
  const index = pickedIndex !== null && pickedIndex < total ? pickedIndex : urlIndex;

  const saverRef = useRef<AnswerSaver | null>(null);
  if (!saverRef.current) {
    saverRef.current = new AnswerSaver({ onConfirmed: () => {}, onFailed: () => {}, onSubmitted: () => {} });
  }
  const saver = saverRef.current;
  useEffect(() => {
    saver.setHandlers({
      onConfirmed: (qid, payload, { superseded }) => {
        setFailedIds((prev) => {
          if (!prev.has(qid)) return prev;
          const next = new Set(prev);
          next.delete(qid);
          return next;
        });
        if (payload.kind === 'text') {
          setQuestions((prev) =>
            prev
              ? prev.map((q) => (q.id === qid ? { ...q, myAnswer: { selected_choice_ids: [], text_answer: payload.text.trim() } } : q))
              : prev,
          );
          // "Saved" only when the field holds exactly what the server has; while a newer save waits it
          // stays "Saving…", and while newer typing waits for its autosave the slot is empty.
          const draft = draftsRef.current[qid];
          const upToDate = draft === undefined || draft.trim() === payload.text.trim();
          if (!superseded) {
            setStatus((prev) => (prev?.questionId === qid ? (upToDate ? { questionId: qid, state: 'saved' } : null) : prev));
          }
        } else if (!superseded) {
          // A retried choice comes back into view once the server has it. A superseded confirmation is
          // older than what the child picked since, so the screen keeps the newer pick.
          setQuestions((prev) =>
            prev ? prev.map((q) => (q.id === qid ? { ...q, myAnswer: { selected_choice_ids: payload.ids, text_answer: null } } : q)) : prev,
          );
        }
      },
      onFailed: (qid, confirmed) => {
        if (confirmed?.kind === 'choice') {
          // Show what the server really has, so "answered" stays honest.
          setQuestions((prev) =>
            prev
              ? prev.map((q) =>
                  q.id === qid ? { ...q, myAnswer: { selected_choice_ids: confirmed.ids, text_answer: null } } : q,
                )
              : prev,
          );
        }
        setStatus((prev) => (prev?.questionId === qid ? null : prev));
        setFailedIds((prev) => new Set(prev).add(qid));
      },
      onSubmitted: () => {
        setFailedIds(new Set());
        setSubmitted(true);
      },
    });
  });

  async function loadQuiz() {
    try {
      const { session, quiz, sections, questions, participant } = await getMyQuiz();
      setSession(session);
      setQuizMeta(quiz);
      setOffered(offeredOf(quiz));
      setSections(sections);
      for (const q of questions) saver.setConfirmed(q.id, confirmedPayload(q));
      setQuestions(questions);
      setFlagged(readFlags(session.id));
      setSubmitted(Boolean(participant.submitted_at));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load quiz');
    }
  }

  /** Saves a question's draft when it differs from what the server has. */
  const flushTextSave = useCallback(
    (questionId: number, opts: { keepalive?: boolean; immediate?: boolean } = {}) => {
      const timer = timersRef.current.get(questionId);
      if (timer) clearTimeout(timer);
      timersRef.current.delete(questionId);
      const q = questionsRef.current?.find((x) => x.id === questionId);
      const draft = draftsRef.current[questionId];
      if (!q || q.type !== 'text' || draft === undefined) return;
      // Compare with the newest intent (a save may already be on its way, e.g. blur then tap). On page
      // exit the request on its way may be aborted, so only what the server confirmed counts.
      const latest = opts.immediate ? saver.confirmedOf(questionId) : saver.latest(questionId);
      const latestText = latest?.kind === 'text' ? latest.text.trim() : (q.myAnswer?.text_answer ?? '');
      if (draft.trim() === latestText) return;
      setStatus({ questionId, state: 'saving' });
      // The untrimmed draft goes to the server (it trims); the draft itself is never replaced, so
      // keystrokes typed while the request runs are not lost.
      saver.save(questionId, { kind: 'text', text: draft }, opts);
    },
    [saver],
  );

  const flushAllDrafts = useCallback(
    (opts: { keepalive?: boolean; immediate?: boolean } = {}) => {
      if (opts.immediate) saver.sendQueuedNow();
      for (const id of Object.keys(draftsRef.current)) flushTextSave(Number(id), opts);
    },
    [flushTextSave, saver],
  );

  function goToResults() {
    if (finishedRef.current) return;
    finishedRef.current = true;
    flushAllDrafts({ keepalive: true });
    navigate('/results');
  }

  useEffect(() => {
    async function init() {
      try {
        const { session, quiz, participant } = await getMySession();
        setSession(session);
        if (quiz) setOffered(offeredOf(quiz));
        setSubmitted(Boolean(participant.submitted_at));
        if (session.status === 'ended') {
          goToResults();
        } else if (session.status === 'active') {
          await loadQuiz();
        }
      } catch (err) {
        if (err instanceof ApiError && (err.status === 401 || err.status === 404)) {
          leave();
          navigate('/join');
          return;
        }
        setError(err instanceof ApiError ? err.message : 'Failed to load session');
      } finally {
        setLoading(false);
      }
    }
    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The interface-language menu is offered in the waiting room only (decision Q-ui-lang-after-join),
  // also while a reload of a running quiz is still loading.
  useEffect(() => {
    setUiLanguageLocked(session?.status !== 'pending');
    return () => setUiLanguageLocked(false);
  }, [session?.status, setUiLanguageLocked]);

  // Fallback poll while waiting in the lobby (every 3 s) and after submitting (every 5 s), in case a
  // socket event is missed.
  useEffect(() => {
    if (!session || !(session.status === 'pending' || submitted)) return;
    const poll = setInterval(
      async () => {
        try {
          const { session: updated, quiz, participant } = await getMySession();
          setSession(updated);
          if (quiz) setOffered(offeredOf(quiz));
          setSubmitted(Boolean(participant.submitted_at));
          if (updated.status === 'active' && !questionsRef.current) await loadQuiz();
          if (updated.status === 'ended') goToResults();
        } catch {
          // ignore transient errors while polling
        }
      },
      submitted ? 5000 : 3000,
    );
    return () => clearInterval(poll);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.status, submitted]);

  useEffect(() => {
    if (!session) return;
    const socket = getSocket();
    const sessionId = session.id;
    joinRoom('session', sessionId);
    const handler = async (updated: QuizSession) => {
      if (updated.id !== sessionId) return;
      // Lock toggles also broadcast during the lobby; merge so nothing local is lost.
      setSession((prev) => (prev ? { ...prev, ...updated } : updated));
      if (updated.status === 'active' && !questionsRef.current) await loadQuiz();
      if (updated.status === 'ended') goToResults();
    };
    // After a reconnect, events sent while offline are lost: ask for the current state. Only the
    // session and the submitted flag are refreshed; loaded questions (with unsaved typing) stay.
    const onReconnect = async () => {
      try {
        const { session: fresh, participant } = await getMySession();
        setSession(fresh);
        setSubmitted(Boolean(participant.submitted_at));
        if (fresh.status === 'active' && !questionsRef.current) await loadQuiz();
        if (fresh.status === 'ended') goToResults();
      } catch {
        // the countdown and the polls are further safety nets
      }
    };
    socket.on('session:update', handler);
    socket.on('connect', onReconnect);
    return () => {
      socket.off('session:update', handler);
      socket.off('connect', onReconnect);
      leaveRoom('session', sessionId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.id]);

  // Leaving the page or hiding it (tab switch, iPad locked) saves every pending draft at once, with
  // keepalive: iOS may freeze or close a hidden tab without a pagehide.
  useEffect(() => {
    const onHidden = () => {
      if (document.visibilityState === 'hidden') flushAllDrafts({ keepalive: true, immediate: true });
    };
    const onPageHide = () => flushAllDrafts({ keepalive: true, immediate: true });
    document.addEventListener('visibilitychange', onHidden);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      document.removeEventListener('visibilitychange', onHidden);
      window.removeEventListener('pagehide', onPageHide);
    };
  }, [flushAllDrafts]);

  useEffect(() => {
    const timers = timersRef.current;
    return () => timers.forEach((timer) => clearTimeout(timer));
  }, []);

  // After a move: back to the top, and the new question's heading gets focus (announced by screen
  // readers) without scrolling.
  useEffect(() => {
    if (!movedRef.current) return;
    movedRef.current = false;
    window.scrollTo({ top: 0, behavior: 'instant' });
    headingRef.current?.focus({ preventScroll: true });
  }, [index]);

  // After the submit the dialog and the question are gone: the "Submitted" heading takes the focus,
  // so screen readers announce it and focus does not fall back to the page.
  useEffect(() => {
    if (submitted && !loading) submittedRef.current?.focus({ preventScroll: true });
  }, [submitted, loading]);

  // Load the next question's picture in the background, so it is there when the child moves on.
  useEffect(() => {
    const next = questions?.[index + 1];
    if (next?.image_path) new Image().src = next.image_path;
  }, [questions, index]);

  const groups = useMemo(() => (questions ? buildNavGroups(questions, sections) : []), [questions, sections]);
  // Stale data only (the offer rule normally prevents it): some question cannot be read in some
  // offered language. Then the card head keeps the note's ⚠ slot for the whole quiz, so the note
  // appearing on one question never moves the row.
  const noteSlot = useMemo(
    () =>
      Boolean(
        questions &&
          offered &&
          questions.some((q) => {
            const readable = questionLanguages(q, base);
            return offered.some((l) => !readable.includes(l));
          }),
      ),
    [questions, offered, base],
  );

  /** Sends every failed save again, then any newer typing. */
  function retryFailed() {
    saver.retryFailed();
    flushAllDrafts();
  }

  function goTo(i: number) {
    if (!questions) return;
    const target = Math.max(0, Math.min(questions.length - 1, i));
    flushTextSave(questions[index].id);
    if (failedIds.size > 0) retryFailed();
    if (target === index) return;
    movedRef.current = true;
    setStatus(null);
    setPickedIndex(target);
    setParams({ q: String(target + 1) }, { replace: true });
  }

  function openOverview() {
    flushAllDrafts();
    setOverviewOpen(true);
  }

  function handleChoiceChange(question: ParticipantQuestion, choiceId: number, checked: boolean) {
    const current = question.myAnswer?.selected_choice_ids ?? [];
    const next =
      question.type === 'single' ? [choiceId] : checked ? [...current, choiceId] : current.filter((id) => id !== choiceId);
    setQuestions((prev) =>
      prev ? prev.map((q) => (q.id === question.id ? { ...q, myAnswer: { selected_choice_ids: next, text_answer: null } } : q)) : prev,
    );
    saver.save(question.id, { kind: 'choice', ids: next });
  }

  function handleTextChange(question: ParticipantQuestion, text: string) {
    setDrafts((prev) => ({ ...prev, [question.id]: text }));
    draftsRef.current = { ...draftsRef.current, [question.id]: text };
    setStatus((prev) => (prev?.questionId === question.id && prev.state === 'saved' ? null : prev));
    const old = timersRef.current.get(question.id);
    if (old) clearTimeout(old);
    timersRef.current.set(
      question.id,
      setTimeout(() => flushTextSave(question.id), AUTOSAVE_MS),
    );
  }

  function toggleFlag(questionId: number) {
    if (!session) return;
    setFlagged((prev) => {
      const next = new Set(prev);
      if (next.has(questionId)) next.delete(questionId);
      else next.add(questionId);
      try {
        sessionStorage.setItem(`quiz_flags_${session.id}`, JSON.stringify([...next]));
      } catch {
        // storage blocked: the marks last until reload
      }
      return next;
    });
  }

  /** The overview's finish step: every draft is saved first; a failed save stops the submit. */
  async function finish(): Promise<'ok' | 'save-failed' | 'error'> {
    retryFailed();
    await saver.flushAll();
    // Anything typed or retried while waiting is saved too before the submit.
    flushAllDrafts();
    const ok = await saver.flushAll();
    if (!ok) return 'save-failed';
    try {
      await submitQuiz();
      setOverviewOpen(false);
      setSubmitted(true);
      return 'ok';
    } catch (err) {
      // 409: already submitted (a second tab, or the session ended): the outcome we wanted.
      if (err instanceof ApiError && err.status === 409) {
        setOverviewOpen(false);
        setSubmitted(true);
        return 'ok';
      }
      return 'error';
    }
  }

  if (loading) return <p style={{ margin: 40 }}>{t('play.loading')}</p>;

  if (session && session.status === 'pending') {
    return (
      <div style={{ maxWidth: 480, margin: '24px auto', paddingInline: 16, textAlign: 'center' }}>
        <Logo />
        <h1>{t('play.youreIn')}</h1>
        <p>{t('play.waitingForHost')}</p>
        <p>
          {t('play.joinCode')}{' '}
          <strong style={{ fontSize: 24, letterSpacing: 2 }}>
            <bdi dir="ltr">{formatJoinCode(session.join_code)}</bdi>
          </strong>
        </p>
        {offered && (
          <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 16, display: 'flex', justifyContent: 'center' }}>
            <QuestionLanguageBar
              idPrefix="qlang-wait"
              languages={offered}
              value={contentLanguage}
              onChange={setContentLanguage}
              centered
            />
          </div>
        )}
      </div>
    );
  }

  const title = quizMeta ? resolveFieldWithLang(quizMeta, 'title', contentLanguage, base) : null;
  const header = (
    <header className="play-header">
      <h1 className="play-title" title={title?.text}>
        {title && (
          <span className="play-title__text" lang={title.lang} dir={dirOf(title.lang)}>
            {title.text}
          </span>
        )}
      </h1>
      {session?.ends_at && session.status === 'active' && (
        <Countdown endsAt={session.ends_at} onExpire={goToResults} onAlmostOver={() => flushAllDrafts({ keepalive: true })} />
      )}
      <ThemeToggle />
    </header>
  );

  if (submitted) {
    return (
      <div className="play">
        {header}
        <div className="play-nav play-nav--empty" />
        <main className="play-main" style={{ textAlign: 'center' }}>
          <Logo />
          <h2 className="play-submitted__title" tabIndex={-1} ref={submittedRef}>
            {t('play.submittedTitle')}
          </h2>
          <p>{t('play.submittedBody')}</p>
        </main>
      </div>
    );
  }

  if (error && !questions) {
    return <p style={{ margin: 40, color: 'var(--danger)' }}>{error}</p>;
  }

  if (!questions || !quizMeta || !session) {
    return <p style={{ margin: 40 }}>{t('play.loadingQuiz')}</p>;
  }

  if (questions.length === 0) {
    return <p style={{ margin: 40 }}>{t('play.noQuestions')}</p>;
  }

  const question = questions[index];
  const languages = offered ?? [base];
  // Wish 9: a question is shown in the picked language only when its text and every choice are
  // translated, otherwise wholly in the base language, so one question never mixes languages. With
  // the offer rule (declared and complete) this always is the pick; the ⚠ note covers stale data.
  const readableIn = questionLanguages(question, base);
  const shownLang = readableIn.includes(contentLanguage) ? contentLanguage : base;
  const stackLangs = languages.filter((l) => readableIn.includes(l));
  const langNote =
    shownLang === contentLanguage
      ? ''
      : t('lang.shownInBase', { lang: LANGUAGE_META[contentLanguage].endonym, base: LANGUAGE_META[base].endonym });
  const isLast = index === questions.length - 1;
  const statusForQuestion = status?.questionId === question.id ? status : null;
  const isFlagged = flagged.has(question.id);
  // One status slot per card: this question's failed save, then other unsaved questions, then
  // saving / saved.
  const otherUnsaved = questions.flatMap((q, i) => (q.id !== question.id && failedIds.has(q.id) ? [i + 1] : []));
  // The slot holds two lines next to "Try again": the short message there (the button says the rest).
  const slot: { tone: 'error' | 'saved' | 'muted'; text: string; retry?: boolean } | null = failedIds.has(question.id)
    ? { tone: 'error', text: t('play.saveFailedShort'), retry: true }
    : otherUnsaved.length > 0
      ? {
          tone: 'error',
          text: t(otherUnsaved.length > 1 ? 'play.notSavedOthersMany' : 'play.notSavedOthers', { list: otherUnsaved.join(', ') }),
          retry: true,
        }
      : statusForQuestion?.state === 'saving'
        ? { tone: 'muted', text: t('play.saving') }
        : statusForQuestion?.state === 'saved'
          ? { tone: 'saved', text: t('play.saved') }
          : null;

  return (
    <div className="play">
      {header}
      <div className="play-nav">
        <QuestionNavigator
          questions={questions}
          groups={groups}
          currentIndex={index}
          flagged={flagged}
          contentLanguage={contentLanguage}
          base={base}
          onSelect={goTo}
          onOpenOverview={openOverview}
        />
      </div>
      <main className="play-main">
        <article className="qcard" data-testid="question-card">
          <div className="qcard-head">
            {/* The hidden "Question 50 of 50" reserves the widest count, so the flag never moves. */}
            <span className="qcard-head__count">
              <span>{t('play.questionOf', { n: index + 1, total: questions.length })}</span>
              <span className="is-hidden" aria-hidden="true">
                {t('play.questionOf', { n: questions.length, total: questions.length })}
              </span>
            </span>
            <button
              type="button"
              className="flag-toggle"
              aria-pressed={isFlagged}
              aria-label={t('play.flag')}
              title={t('play.flag')}
              onClick={() => toggleFlag(question.id)}
            >
              <FlagIcon />
              <span className="flag-toggle__label" aria-hidden="true">
                {t('play.flag')}
              </span>
            </button>
            <span className="qcard-head__lang">
              <QuestionLanguageBar
                idPrefix="qlang-play"
                languages={languages}
                value={contentLanguage}
                onChange={setContentLanguage}
                note={noteSlot ? langNote : undefined}
                noteKey={question.id}
              />
            </span>
          </div>
          <div className="qcard-body" key={question.id}>
            <h2 tabIndex={-1} ref={headingRef} id={`question-${question.id}-text`}>
              <LangStack row={question} field="text" languages={stackLangs} active={shownLang} base={base} />
            </h2>
            {question.image_path && (
              <div className="qcard-media">
                <img src={question.image_path} alt={t('play.questionImage', { n: index + 1 })} decoding="async" />
              </div>
            )}
            {question.type !== 'text' ? (
              <div
                className="choices"
                dir={dirOf(shownLang)}
                role={question.type === 'single' ? 'radiogroup' : 'group'}
                aria-labelledby={`question-${question.id}-text`}
              >
                {question.choices.map((c) => (
                  <label key={c.id} className="choice">
                    <input
                      type={question.type === 'single' ? 'radio' : 'checkbox'}
                      name={`question-${question.id}`}
                      checked={question.myAnswer?.selected_choice_ids.includes(c.id) ?? false}
                      onChange={(e) => handleChoiceChange(question, c.id, e.target.checked)}
                    />
                    <LangStack row={c} field="text" languages={stackLangs} active={shownLang} base={base} />
                  </label>
                ))}
              </div>
            ) : (
              <div className="text-answer">
                <textarea
                  rows={4}
                  value={drafts[question.id] ?? question.myAnswer?.text_answer ?? ''}
                  onChange={(e) => handleTextChange(question, e.target.value)}
                  onBlur={() => flushTextSave(question.id)}
                  dir="auto"
                  aria-label={t('play.yourAnswer')}
                />
                <button type="button" onClick={() => flushTextSave(question.id)} disabled={statusForQuestion?.state === 'saving'}>
                  {t('play.saveAnswer')}
                </button>
              </div>
            )}
          </div>
          <div className="qcard-status" data-tone={slot?.tone}>
            <span className="qcard-status__text" role="status" aria-live="polite">
              {slot?.text}
            </span>
            {slot?.retry && (
              <button type="button" className="qcard-status__retry" onClick={retryFailed}>
                {t('play.retry')}
              </button>
            )}
          </div>
        </article>
      </main>
      <footer className="play-actionbar">
        <button type="button" onClick={() => goTo(index - 1)} disabled={index === 0}>
          {t('play.previous')}
        </button>
        <span />
        <button
          type="button"
          data-testid="nav-next"
          className="btn-stack"
          aria-haspopup={isLast ? 'dialog' : undefined}
          onClick={() => (isLast ? openOverview() : goTo(index + 1))}
        >
          <span className={isLast ? 'is-hidden' : undefined} aria-hidden={isLast || undefined}>
            {t('play.next')}
          </span>
          <span className={isLast ? undefined : 'is-hidden'} aria-hidden={!isLast || undefined}>
            {t('play.toOverview')}
          </span>
        </button>
      </footer>
      <QuestionOverviewDialog
        open={overviewOpen}
        questions={questions}
        groups={groups}
        currentIndex={index}
        flagged={flagged}
        contentLanguage={contentLanguage}
        base={base}
        onSelect={goTo}
        onClose={() => setOverviewOpen(false)}
        onFinish={finish}
      />
    </div>
  );
}
