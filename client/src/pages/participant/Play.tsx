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
  // Status slot of the current question: saving / saved / error. Never shown for another question.
  const [status, setStatus] = useState<{ questionId: number; state: 'saving' | 'saved' | 'error'; message?: string } | null>(
    null,
  );
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
    setIndex(target);
  }

  async function handleChoiceChange(question: ParticipantQuestion, choiceId: number, checked: boolean) {
    if (!questions) return;
    const current = question.myAnswer?.selected_choice_ids ?? [];
    const next =
      question.type === 'single' ? [choiceId] : checked ? [...current, choiceId] : current.filter((id) => id !== choiceId);

    setQuestions(questions.map((q) => (q.id === question.id ? { ...q, myAnswer: { ...q.myAnswer, selected_choice_ids: next, text_answer: null } } : q)));

    try {
      await submitChoiceAnswer(question.id, next);
      setStatus((prev) => (prev?.questionId === question.id && prev.state === 'error' ? null : prev));
    } catch (err) {
      // 409: this participant already finished (e.g. in another tab): show the submitted screen.
      if (err instanceof ApiError && err.status === 409) setSubmitted(true);
      else setStatus({ questionId: question.id, state: 'error', message: err instanceof ApiError ? err.message : t('play.saveFailed') });
    }
  }

  async function handleTextChange(question: ParticipantQuestion, text: string) {
    if (!questions) return;
    setQuestions(questions.map((q) => (q.id === question.id ? { ...q, myAnswer: { selected_choice_ids: [], text_answer: text } } : q)));
    setStatus((prev) => (prev?.questionId === question.id && prev.state === 'saved' ? null : prev));
  }

  async function handleTextSave(question: ParticipantQuestion) {
    const text = question.myAnswer?.text_answer ?? '';
    setStatus({ questionId: question.id, state: 'saving' });
    try {
      await submitTextAnswer(question.id, text);
      setStatus((prev) => (prev?.questionId === question.id ? { questionId: question.id, state: 'saved' } : prev));
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) setSubmitted(true);
      else setStatus({ questionId: question.id, state: 'error', message: err instanceof ApiError ? err.message : t('play.saveFailed') });
    }
  }

  async function handleFinish() {
    if (!window.confirm(t('play.finishConfirm'))) return;
    setFinishing(true);
    setError(null);
    try {
      await submitQuiz();
      setSubmitted(true);
    } catch (err) {
      // A 409 here means some other request already marked this participant finished
      // (e.g. a duplicate click or a second tab) — that's the outcome we wanted anyway.
      if (err instanceof ApiError && err.status === 409) {
        setSubmitted(true);
      } else {
        setError(err instanceof ApiError ? err.message : 'Failed to finish');
      }
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

  const header = (
    <header className="play-header">
      <h1 className="play-title" title={quizMeta ? resolveFieldWithLang(quizMeta, 'title', contentLanguage, base).text : undefined}>
        {quizMeta && <LangStack row={quizMeta} field="title" languages={offered ?? [base]} active={contentLanguage} base={base} />}
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
            <h2 tabIndex={-1} ref={headingRef}>
              <LangStack row={question} field="text" languages={languages} active={contentLanguage} base={base} />
            </h2>
            {question.image_path && (
              <div className="qcard-media">
                <img src={question.image_path} alt={t('play.questionImage', { n: index + 1 })} decoding="async" />
              </div>
            )}
            {question.type !== 'text' ? (
              <div className="choices" dir={dirOf(contentLanguage)}>
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
          <div
            className={
              statusForQuestion?.state === 'error'
                ? 'qcard-status qcard-status--error'
                : statusForQuestion?.state === 'saved'
                  ? 'qcard-status qcard-status--saved'
                  : 'qcard-status'
            }
            role="status"
            aria-live="polite"
          >
            {statusForQuestion?.state === 'saving' && t('play.saving')}
            {statusForQuestion?.state === 'saved' && t('play.saved')}
            {statusForQuestion?.state === 'error' && statusForQuestion.message}
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
