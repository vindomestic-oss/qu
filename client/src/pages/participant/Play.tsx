import { useEffect, useRef, useState } from 'react';
import './play.css';
import { useNavigate } from 'react-router-dom';
import { getMyQuiz, getMySession, submitChoiceAnswer, submitQuiz, submitTextAnswer } from '../../api/participant';
import type { QuizMeta } from '../../api/participant';
import type { ParticipantQuestion, QuizSession } from '../../types';
import { ApiError } from '../../api/client';
import { useParticipant } from '../../auth/ParticipantContext';
import { getSocket, joinRoom, leaveRoom } from '../../lib/socket';
import { useLanguage } from '../../i18n/LanguageContext';
import { useContentLanguage } from '../../i18n/useContentLanguage';
import { sanitizeOffered, type QuizLang } from '../../i18n/contentLanguages';
import { resolveFieldWithLang } from '../../i18n/resolveText';
import { dirOf } from '../../i18n/languageMeta';
import { Countdown } from '../../components/participant/Countdown';
import { LangStack } from '../../components/participant/LangStack';
import { ThemeToggle } from '../../components/ThemeToggle';
import { QuestionLanguageBar } from '../../components/participant/QuestionLanguageBar';
import { Logo } from '../../components/Logo';
import { formatJoinCode } from '../../lib/joinLink';

function offeredOf(info: { base_language: QuizLang; offered_languages: unknown }): QuizLang[] {
  return sanitizeOffered(info.offered_languages, info.base_language);
}

export function Play() {
  const navigate = useNavigate();
  const { leave } = useParticipant();
  const { t, setUiLanguageLocked } = useLanguage();

  const [session, setSession] = useState<QuizSession | null>(null);
  const [quizMeta, setQuizMeta] = useState<QuizMeta | null>(null);
  const [offered, setOffered] = useState<QuizLang[] | null>(null);
  const { contentLanguage, base, setContentLanguage } = useContentLanguage(offered);
  const [questions, setQuestions] = useState<ParticipantQuestion[] | null>(null);
  const [index, setIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // Saving / saved of a text answer, shown only on its own question.
  const [status, setStatus] = useState<{ questionId: number; state: 'saving' | 'saved' } | null>(null);
  // Answers whose last save failed, by question id. Kept across Previous/Next, so a failed save is
  // never lost silently; cleared by that question's next successful save.
  const [failed, setFailed] = useState<Record<number, string>>({});
  const [finishError, setFinishError] = useState<string | null>(null);
  // Per-question request counter: only the newest save of a question may set or clear its failure.
  const saveSeqRef = useRef<Record<number, number>>({});
  const [submitted, setSubmitted] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const finishedRef = useRef(false);
  // Read by socket handlers registered once per session; a closure would see a stale value.
  const questionsRef = useRef<ParticipantQuestion[] | null>(null);
  useEffect(() => {
    questionsRef.current = questions;
  }, [questions]);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const movedRef = useRef(false);

  async function loadQuiz() {
    try {
      const { session, quiz, questions, participant } = await getMyQuiz();
      setSession(session);
      setQuizMeta(quiz);
      setOffered(offeredOf(quiz));
      setQuestions(questions);
      setSubmitted(Boolean(participant.submitted_at));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load quiz');
    }
  }

  function goToResults() {
    if (finishedRef.current) return;
    finishedRef.current = true;
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

  // Fallback poll of session status while waiting, in case the socket event is missed.
  useEffect(() => {
    if (!session || session.status !== 'pending') return;
    const poll = setInterval(async () => {
      try {
        const { session: updated, quiz, participant } = await getMySession();
        setSession(updated);
        if (quiz) setOffered(offeredOf(quiz));
        setSubmitted(Boolean(participant.submitted_at));
        if (updated.status === 'active') await loadQuiz();
        if (updated.status === 'ended') goToResults();
      } catch {
        // ignore transient errors while polling
      }
    }, 3000);
    return () => clearInterval(poll);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.status]);

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

  // After Previous/Next: back to the top, and the new question's heading gets focus (announced by
  // screen readers) without scrolling.
  useEffect(() => {
    if (!movedRef.current) return;
    movedRef.current = false;
    window.scrollTo({ top: 0, behavior: 'instant' });
    headingRef.current?.focus({ preventScroll: true });
  }, [index]);

  // Load the next question's picture in the background, so it is there when the child moves on.
  useEffect(() => {
    const next = questions?.[index + 1];
    if (next?.image_path) new Image().src = next.image_path;
  }, [questions, index]);

  function goTo(i: number) {
    if (!questions) return;
    const target = Math.max(0, Math.min(questions.length - 1, i));
    if (target === index) return;
    movedRef.current = true;
    setStatus(null);
    setFinishError(null);
    setIndex(target);
    const pending = Object.keys(failed).map(Number);
    if (pending.length > 0) void retryFailed(pending);
  }

  function saveErrorMessage(err: unknown): string {
    // 4xx messages explain the refusal; network errors and 5xx get the translated hint.
    return err instanceof ApiError && err.status < 500 ? err.message : t('play.saveFailed');
  }

  /**
   * Sends one answer and records the outcome. Returns false only when the save failed; a 409 means
   * the participant already finished (e.g. in another tab), so the submitted screen is shown.
   */
  async function sendAnswer(question: ParticipantQuestion, send: () => Promise<unknown>): Promise<boolean> {
    const seq = (saveSeqRef.current[question.id] ?? 0) + 1;
    saveSeqRef.current[question.id] = seq;
    const isLatest = () => saveSeqRef.current[question.id] === seq;
    try {
      await send();
      if (isLatest()) {
        setFailed((prev) => {
          if (!(question.id in prev)) return prev;
          const rest = { ...prev };
          delete rest[question.id];
          return rest;
        });
      }
      return true;
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setSubmitted(true);
        return true;
      }
      if (isLatest()) setFailed((prev) => ({ ...prev, [question.id]: saveErrorMessage(err) }));
      return false;
    }
  }

  function sendCurrent(question: ParticipantQuestion) {
    return sendAnswer(question, () =>
      question.type === 'text'
        ? submitTextAnswer(question.id, question.myAnswer?.text_answer ?? '')
        : submitChoiceAnswer(question.id, question.myAnswer?.selected_choice_ids ?? []),
    );
  }

  /** Re-sends the local answer of every failed question; returns how many still fail. */
  async function retryFailed(ids: number[]): Promise<number> {
    const all = questionsRef.current ?? [];
    const results = await Promise.all(
      ids.map((id) => {
        const q = all.find((x) => x.id === id);
        return q ? sendCurrent(q) : Promise.resolve(true);
      }),
    );
    return results.filter((ok) => !ok).length;
  }

  async function handleChoiceChange(question: ParticipantQuestion, choiceId: number, checked: boolean) {
    if (!questions) return;
    const current = question.myAnswer?.selected_choice_ids ?? [];
    const next =
      question.type === 'single' ? [choiceId] : checked ? [...current, choiceId] : current.filter((id) => id !== choiceId);

    setQuestions(questions.map((q) => (q.id === question.id ? { ...q, myAnswer: { ...q.myAnswer, selected_choice_ids: next, text_answer: null } } : q)));
    await sendAnswer(question, () => submitChoiceAnswer(question.id, next));
  }

  async function handleTextChange(question: ParticipantQuestion, text: string) {
    if (!questions) return;
    setQuestions(questions.map((q) => (q.id === question.id ? { ...q, myAnswer: { selected_choice_ids: [], text_answer: text } } : q)));
    setStatus((prev) => (prev?.questionId === question.id && prev.state === 'saved' ? null : prev));
  }

  async function handleTextSave(question: ParticipantQuestion) {
    setStatus({ questionId: question.id, state: 'saving' });
    const ok = await sendAnswer(question, () => submitTextAnswer(question.id, question.myAnswer?.text_answer ?? ''));
    setStatus((prev) => (prev?.questionId === question.id ? (ok ? { questionId: question.id, state: 'saved' } : null) : prev));
  }

  async function handleRetry() {
    const pending = Object.keys(failed).map(Number);
    if (pending.length > 0) await retryFailed(pending);
  }

  async function handleFinish() {
    setFinishError(null);
    // An answer that failed to save must not be dropped by finishing: retry first, stop if it still fails.
    const pending = Object.keys(failed).map(Number);
    if (pending.length > 0) {
      setFinishing(true);
      const stillFailing = await retryFailed(pending);
      setFinishing(false);
      if (stillFailing > 0) return;
    }
    if (!window.confirm(t('play.finishConfirm'))) return;
    setFinishing(true);
    try {
      await submitQuiz();
      setSubmitted(true);
    } catch (err) {
      // A 409 here means some other request already marked this participant finished
      // (e.g. a duplicate click or a second tab) — that's the outcome we wanted anyway.
      if (err instanceof ApiError && err.status === 409) setSubmitted(true);
      else setFinishError(err instanceof ApiError && err.status < 500 ? err.message : t('play.finishFailed'));
    } finally {
      setFinishing(false);
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
      {session?.ends_at && session.status === 'active' && <Countdown endsAt={session.ends_at} onExpire={goToResults} />}
      <ThemeToggle />
    </header>
  );

  if (submitted) {
    return (
      <div className="play">
        {header}
        <div className="play-nav" />
        <main className="play-main" style={{ textAlign: 'center' }}>
          <Logo />
          <h2>{t('play.submittedTitle')}</h2>
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
  const isLast = index === questions.length - 1;
  const statusForQuestion = status?.questionId === question.id ? status : null;
  // One status slot per card: this question's failed save, then other unsaved questions, then a
  // failed Finish, then saving / saved.
  const otherUnsaved = questions.flatMap((q, i) => (q.id !== question.id && q.id in failed ? [i + 1] : []));
  const slot: { tone: 'error' | 'saved' | 'muted'; text: string; retry?: boolean } | null =
    question.id in failed
      ? { tone: 'error', text: failed[question.id], retry: true }
      : otherUnsaved.length > 0
        ? { tone: 'error', text: t('play.notSavedOthers', { list: otherUnsaved.join(', ') }), retry: true }
        : finishError
          ? { tone: 'error', text: finishError }
          : statusForQuestion?.state === 'saving'
            ? { tone: 'muted', text: t('play.saving') }
            : statusForQuestion?.state === 'saved'
              ? { tone: 'saved', text: t('play.saved') }
              : null;

  return (
    <div className="play">
      {header}
      <div className="play-nav" />
      <main className="play-main">
        <article className="qcard" data-testid="question-card">
          <div className="qcard-head">
            <span className="qcard-head__count">{t('play.questionOf', { n: index + 1, total: questions.length })}</span>
            <span className="qcard-head__lang">
              <QuestionLanguageBar idPrefix="qlang-play" languages={languages} value={contentLanguage} onChange={setContentLanguage} />
            </span>
          </div>
          <div className="qcard-body" key={question.id}>
            <h2 tabIndex={-1} ref={headingRef} id={`question-${question.id}-text`}>
              <LangStack row={question} field="text" languages={languages} active={contentLanguage} base={base} />
            </h2>
            {question.image_path && (
              <div className="qcard-media">
                <img src={question.image_path} alt={t('play.questionImage', { n: index + 1 })} decoding="async" />
              </div>
            )}
            {question.type !== 'text' ? (
              <div
                className="choices"
                dir={dirOf(contentLanguage)}
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
                    <LangStack row={c} field="text" languages={languages} active={contentLanguage} base={base} />
                  </label>
                ))}
              </div>
            ) : (
              <div className="text-answer">
                <textarea
                  rows={4}
                  value={question.myAnswer?.text_answer ?? ''}
                  onChange={(e) => handleTextChange(question, e.target.value)}
                  onBlur={() => handleTextSave(question)}
                  dir="auto"
                  aria-label={t('play.yourAnswer')}
                />
                <button type="button" onClick={() => handleTextSave(question)} disabled={statusForQuestion?.state === 'saving'}>
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
              <button type="button" className="qcard-status__retry" onClick={handleRetry}>
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
        <span>
          {isLast && (
            <button type="button" onClick={handleFinish} disabled={finishing}>
              {finishing ? t('play.finishing') : t('play.finish')}
            </button>
          )}
        </span>
        <button type="button" data-testid="nav-next" className="btn-stack" onClick={() => goTo(index + 1)} disabled={isLast}>
          <span className={isLast ? 'is-hidden' : undefined} aria-hidden={isLast || undefined}>
            {t('play.next')}
          </span>
          <span className={isLast ? undefined : 'is-hidden'} aria-hidden={!isLast || undefined}>
            {t('play.toOverview')}
          </span>
        </button>
      </footer>
    </div>
  );
}
