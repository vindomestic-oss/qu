import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getMyQuiz, getMySession, submitChoiceAnswer, submitTextAnswer } from '../../api/participant';
import type { QuizMeta } from '../../api/participant';
import type { ParticipantQuestion, QuizLanguageInfo, QuizSession } from '../../types';
import { ApiError } from '../../api/client';
import { useParticipant } from '../../auth/ParticipantContext';
import { getSocket, joinSessionRoom } from '../../lib/socket';
import { useLanguage } from '../../i18n/LanguageContext';
import { useContentLanguage } from '../../i18n/useContentLanguage';
import { sanitizeOffered } from '../../i18n/contentLanguages';
import { resolveField } from '../../i18n/resolveText';
import { UiLanguageMenu } from '../../components/UiLanguageMenu';
import { QuestionLanguageControl } from '../../components/QuestionLanguageControl';
import { Logo } from '../../components/Logo';

const DEFAULT_LANGUAGE_INFO: QuizLanguageInfo = { base_language: 'en', offered_languages: ['en'] };

function sanitizeLanguageInfo(info: QuizLanguageInfo): QuizLanguageInfo {
  return { base_language: info.base_language, offered_languages: sanitizeOffered(info.offered_languages, info.base_language) };
}

function formatCountdown(endsAt: string, now: number): string {
  const remainingMs = new Date(endsAt).getTime() - now;
  if (remainingMs <= 0) return '0:00';
  const totalSeconds = Math.ceil(remainingMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/**
 * Waits for an image to finish loading (and reserve its layout space) before
 * the caller reveals anything below it — otherwise a late-loading image can
 * shift the choices down mid-click, causing the wrong option to be selected.
 */
function useImageReady(src: string | null): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!src) {
      setReady(true);
      return;
    }
    setReady(false);
    const img = new Image();
    img.onload = () => setReady(true);
    img.onerror = () => setReady(true);
    img.src = src;
    if (img.complete) setReady(true);
  }, [src]);
  return ready;
}

export function Play() {
  const navigate = useNavigate();
  const { leave } = useParticipant();
  const { t, isRtl } = useLanguage();

  const [session, setSession] = useState<QuizSession | null>(null);
  const [quizMeta, setQuizMeta] = useState<QuizMeta | null>(null);
  const [languageInfo, setLanguageInfo] = useState<QuizLanguageInfo>(DEFAULT_LANGUAGE_INFO);
  const { contentLanguage, setContentLanguage } = useContentLanguage(languageInfo.offered_languages);
  const [questions, setQuestions] = useState<ParticipantQuestion[] | null>(null);
  const [index, setIndex] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [textSaveStatus, setTextSaveStatus] = useState<{ questionId: number; state: 'saving' | 'saved' } | null>(
    null,
  );
  const finishedRef = useRef(false);
  const currentQuestion = questions?.[index] ?? null;
  const imageReady = useImageReady(currentQuestion?.image_path ?? null);

  async function loadQuiz() {
    try {
      const { session, quiz, questions } = await getMyQuiz();
      setSession(session);
      setQuizMeta(quiz);
      setLanguageInfo(sanitizeLanguageInfo(quiz));
      setQuestions(questions);
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
        const { session, quiz } = await getMySession();
        setSession(session);
        if (quiz) setLanguageInfo(sanitizeLanguageInfo(quiz));
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

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, []);

  // Fallback poll of session status while waiting, in case the socket event is missed.
  useEffect(() => {
    if (!session || session.status !== 'pending') return;
    const poll = setInterval(async () => {
      try {
        const { session: updated, quiz } = await getMySession();
        setSession(updated);
        if (quiz) setLanguageInfo(sanitizeLanguageInfo(quiz));
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
    joinSessionRoom(session.id, 'participant');
    const handler = async (updated: QuizSession) => {
      if (updated.id !== session.id) return;
      setSession(updated);
      if (updated.status === 'active' && !questions) await loadQuiz();
      if (updated.status === 'ended') goToResults();
    };
    socket.on('session:update', handler);
    return () => {
      socket.off('session:update', handler);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.id]);

  // Client-side countdown expiry as a second safety net.
  useEffect(() => {
    if (session?.status === 'active' && session.ends_at && new Date(session.ends_at).getTime() <= now) {
      goToResults();
    }
  }, [now, session]);

  async function handleChoiceChange(question: ParticipantQuestion, choiceId: number, checked: boolean) {
    if (!questions) return;
    const current = question.myAnswer?.selected_choice_ids ?? [];
    const next =
      question.type === 'single' ? [choiceId] : checked ? [...current, choiceId] : current.filter((id) => id !== choiceId);

    setQuestions(questions.map((q) => (q.id === question.id ? { ...q, myAnswer: { ...q.myAnswer, selected_choice_ids: next, text_answer: null } } : q)));

    try {
      await submitChoiceAnswer(question.id, next);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save answer');
    }
  }

  async function handleTextChange(question: ParticipantQuestion, text: string) {
    if (!questions) return;
    setQuestions(questions.map((q) => (q.id === question.id ? { ...q, myAnswer: { selected_choice_ids: [], text_answer: text } } : q)));
    setTextSaveStatus((prev) => (prev?.questionId === question.id ? null : prev));
  }

  async function handleTextSave(question: ParticipantQuestion) {
    const text = question.myAnswer?.text_answer ?? '';
    setTextSaveStatus({ questionId: question.id, state: 'saving' });
    try {
      await submitTextAnswer(question.id, text);
      setTextSaveStatus({ questionId: question.id, state: 'saved' });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save answer');
      setTextSaveStatus(null);
    }
  }

  if (loading) return <p style={{ margin: 40 }}>{t('play.loading')}</p>;

  if (session && session.status === 'pending') {
    return (
      <div dir={isRtl ? 'rtl' : 'ltr'} style={{ maxWidth: 480, margin: '80px auto', textAlign: 'center' }}>
        <Logo />
        <UiLanguageMenu />
        <h1>{t('play.youreIn')}</h1>
        <p>{t('play.waitingForHost')}</p>
        <p>
          {t('play.joinCode')} <strong style={{ fontSize: 24, letterSpacing: 2 }}>{session.join_code}</strong>
        </p>
        <p>
          <QuestionLanguageControl
            languages={languageInfo.offered_languages}
            value={contentLanguage}
            onChange={setContentLanguage}
            label={t('play.questionLanguage')}
          />
        </p>
      </div>
    );
  }

  if (error && !questions) {
    return <p style={{ margin: 40, color: 'red' }}>{error}</p>;
  }

  if (!questions || !quizMeta || !session) {
    return <p style={{ margin: 40 }}>{t('play.loadingQuiz')}</p>;
  }

  if (questions.length === 0) {
    return <p style={{ margin: 40 }}>{t('play.noQuestions')}</p>;
  }

  const question = questions[index];
  const questionText = resolveField(question, 'text', contentLanguage, languageInfo.base_language);
  const quizTitle = resolveField(quizMeta, 'title', contentLanguage, languageInfo.base_language);

  return (
    <div dir={isRtl ? 'rtl' : 'ltr'} style={{ maxWidth: 640, margin: '40px auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <h1>{quizTitle}</h1>
        <div>
          {t('play.timeLeft')} <strong>{session.ends_at ? formatCountdown(session.ends_at, now) : '--'}</strong>
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
        <p style={{ margin: 0 }}>{t('play.questionOf', { n: index + 1, total: questions.length })}</p>
        <QuestionLanguageControl
          languages={languageInfo.offered_languages}
          value={contentLanguage}
          onChange={setContentLanguage}
          label={t('play.questionLanguage')}
        />
      </div>
      {error && <p style={{ color: 'red' }}>{error}</p>}

      <div style={{ border: '1px solid #ccc', padding: 16 }}>
        <p style={{ fontWeight: 'bold' }}>{questionText}</p>
        {question.image_path && (
          <img
            src={question.image_path}
            alt=""
            style={{ maxWidth: '100%', marginBottom: 12, border: '1px solid #ccc' }}
          />
        )}

        {!imageReady ? (
          <p style={{ color: '#888' }}>{t('play.loadingImage')}</p>
        ) : question.type !== 'text' ? (
          <div>
            {question.choices.map((c) => (
              <label key={c.id} style={{ display: 'block', marginBottom: 8 }}>
                <input
                  type={question.type === 'single' ? 'radio' : 'checkbox'}
                  name={`question-${question.id}`}
                  checked={question.myAnswer?.selected_choice_ids.includes(c.id) ?? false}
                  onChange={(e) => handleChoiceChange(question, c.id, e.target.checked)}
                />{' '}
                {resolveField(c, 'text', contentLanguage, languageInfo.base_language)}
              </label>
            ))}
          </div>
        ) : (
          <div>
            <textarea
              value={question.myAnswer?.text_answer ?? ''}
              onChange={(e) => handleTextChange(question, e.target.value)}
              onBlur={() => handleTextSave(question)}
              style={{ width: '100%', minHeight: 100 }}
            />
            <button
              onClick={() => handleTextSave(question)}
              disabled={textSaveStatus?.questionId === question.id && textSaveStatus.state === 'saving'}
            >
              {textSaveStatus?.questionId === question.id && textSaveStatus.state === 'saving'
                ? t('play.saving')
                : t('play.saveAnswer')}
            </button>
            {textSaveStatus?.questionId === question.id && textSaveStatus.state === 'saved' && (
              <span style={{ color: 'green', marginLeft: 8 }}>{t('play.saved')}</span>
            )}
          </div>
        )}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 12 }}>
        <button onClick={() => setIndex((i) => Math.max(0, i - 1))} disabled={index === 0}>
          {t('play.previous')}
        </button>
        <button onClick={() => setIndex((i) => Math.min(questions.length - 1, i + 1))} disabled={index === questions.length - 1}>
          {t('play.next')}
        </button>
      </div>
    </div>
  );
}
