import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  createQuestion,
  deleteQuestion,
  deleteQuestionImage,
  getQuiz,
  reorderQuestions,
  updateQuestion,
  updateQuiz,
  uploadQuestionImage,
} from '../../api/quizzes';
import { listSessions } from '../../api/sessions';
import type { Quiz, Question, QuestionInput, QuizSession } from '../../types';
import { ApiError } from '../../api/client';
import { QuestionForm } from '../../components/admin/QuestionForm';
import { SessionPanel } from '../../components/admin/SessionPanel';
import { TranslationFields } from '../../components/admin/TranslationFields';
import { flattenTranslations, unflattenTranslations, type ContentLangCode } from '../../i18n/contentLanguages';

export function QuizEditor() {
  const { id } = useParams();
  const quizId = Number(id);

  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sessionHistory, setSessionHistory] = useState<QuizSession[]>([]);

  const [title, setTitle] = useState('');
  const [titleTranslations, setTitleTranslations] = useState<Record<ContentLangCode, string>>(
    unflattenTranslations('title', undefined),
  );
  const [description, setDescription] = useState('');
  const [descriptionTranslations, setDescriptionTranslations] = useState<Record<ContentLangCode, string>>(
    unflattenTranslations('description', undefined),
  );
  const [timeLimitMinutes, setTimeLimitMinutes] = useState(10);
  const [savingMeta, setSavingMeta] = useState(false);

  const [formMode, setFormMode] = useState<'none' | 'create' | number>('none');

  async function refresh() {
    try {
      const { quiz } = await getQuiz(quizId);
      setQuiz(quiz);
      setTitle(quiz.title);
      setTitleTranslations(unflattenTranslations('title', quiz));
      setDescription(quiz.description ?? '');
      setDescriptionTranslations(unflattenTranslations('description', quiz));
      setTimeLimitMinutes(Math.round(quiz.time_limit_seconds / 60));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load quiz');
    } finally {
      setLoading(false);
    }
  }

  async function refreshSessionHistory() {
    try {
      const { sessions } = await listSessions(quizId);
      setSessionHistory(sessions);
    } catch {
      // non-critical; leave history as-is on failure
    }
  }

  useEffect(() => {
    refresh();
    refreshSessionHistory();
  }, [quizId]);

  async function handleSaveMeta(e: FormEvent) {
    e.preventDefault();
    setSavingMeta(true);
    setError(null);
    try {
      const { quiz } = await updateQuiz(quizId, {
        title,
        description,
        ...flattenTranslations('title', titleTranslations),
        ...flattenTranslations('description', descriptionTranslations),
        time_limit_seconds: timeLimitMinutes * 60,
      });
      setQuiz(quiz);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save quiz');
    } finally {
      setSavingMeta(false);
    }
  }

  async function handleCreateQuestion(input: QuestionInput) {
    const { quiz } = await createQuestion(quizId, input);
    setQuiz(quiz);
    setFormMode('none');
  }

  async function handleUpdateQuestion(questionId: number, input: QuestionInput) {
    const { quiz } = await updateQuestion(questionId, input);
    setQuiz(quiz);
    setFormMode('none');
  }

  async function handleDeleteQuestion(questionId: number) {
    if (!confirm('Delete this question?')) return;
    try {
      const { quiz } = await deleteQuestion(questionId);
      setQuiz(quiz);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to delete question');
    }
  }

  async function handleMove(question: Question, direction: -1 | 1) {
    if (!quiz?.questions) return;
    const ordered = [...quiz.questions].sort((a, b) => a.sort_order - b.sort_order);
    const index = ordered.findIndex((q) => q.id === question.id);
    const swapWith = index + direction;
    if (swapWith < 0 || swapWith >= ordered.length) return;
    [ordered[index], ordered[swapWith]] = [ordered[swapWith], ordered[index]];
    try {
      const { quiz: updated } = await reorderQuestions(quizId, ordered.map((q) => q.id));
      setQuiz(updated);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to reorder questions');
    }
  }

  async function handleImageChange(questionId: number, file: File | null) {
    try {
      const { quiz: updated } = file
        ? await uploadQuestionImage(questionId, file)
        : await deleteQuestionImage(questionId);
      setQuiz(updated);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to update image');
    }
  }

  if (loading) return <p style={{ margin: 40 }}>Loading…</p>;
  if (!quiz) return <p style={{ margin: 40, color: 'red' }}>{error ?? 'Quiz not found'}</p>;

  const questions = [...(quiz.questions ?? [])].sort((a, b) => a.sort_order - b.sort_order);

  return (
    <div style={{ maxWidth: 720, margin: '40px auto' }}>
      <Link to="/admin">&larr; Back to quizzes</Link>
      <h1>{quiz.title}</h1>
      {error && <p style={{ color: 'red' }}>{error}</p>}

      <form onSubmit={handleSaveMeta} style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 400 }}>
        <label>
          Title
          <input value={title} onChange={(e) => setTitle(e.target.value)} required style={{ display: 'block', width: '100%' }} />
        </label>
        <TranslationFields
          values={titleTranslations}
          onChange={(lang, value) => setTitleTranslations((prev) => ({ ...prev, [lang]: value }))}
        />
        <label>
          Description
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            style={{ display: 'block', width: '100%' }}
          />
        </label>
        <TranslationFields
          values={descriptionTranslations}
          onChange={(lang, value) => setDescriptionTranslations((prev) => ({ ...prev, [lang]: value }))}
        />
        <label>
          Time limit (minutes)
          <input
            type="number"
            min={1}
            value={timeLimitMinutes}
            onChange={(e) => setTimeLimitMinutes(Number(e.target.value))}
            required
            style={{ display: 'block', width: '100%' }}
          />
        </label>
        <button type="submit" disabled={savingMeta} style={{ alignSelf: 'flex-start' }}>
          {savingMeta ? 'Saving…' : 'Save quiz details'}
        </button>
      </form>

      <SessionPanel
        quizId={quizId}
        initialSession={sessionHistory.find((s) => s.status !== 'ended')}
        onSessionEnded={refreshSessionHistory}
      />

      {sessionHistory.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <h3>Session history</h3>
          <ul style={{ listStyle: 'none', padding: 0 }}>
            {sessionHistory.map((s) => (
              <li key={s.id} style={{ padding: '4px 0' }}>
                {s.join_code} — {s.status}
                {s.started_at ? ` — started ${new Date(s.started_at).toLocaleString()}` : ''}{' '}
                <Link to={`/admin/sessions/${s.id}/results`}>View results</Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      <h2 style={{ marginTop: 32 }}>Questions</h2>
      {questions.length === 0 && <p>No questions yet.</p>}
      {questions.map((q, i) => (
        <div key={q.id} style={{ border: '1px solid #ddd', padding: 12, marginBottom: 8 }}>
          {formMode === q.id ? (
            <QuestionForm
              initial={q}
              onSubmit={(input) => handleUpdateQuestion(q.id, input)}
              onCancel={() => setFormMode('none')}
            />
          ) : (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                <strong style={{ flex: '1 1 260px', textAlign: 'left' }}>
                  {i + 1}. [{q.type}] {q.text} ({q.points} pt{q.points !== 1 ? 's' : ''})
                </strong>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', flexShrink: 0 }}>
                  <button onClick={() => handleMove(q, -1)} disabled={i === 0}>
                    ↑
                  </button>
                  <button onClick={() => handleMove(q, 1)} disabled={i === questions.length - 1}>
                    ↓
                  </button>
                  <button onClick={() => setFormMode(q.id)}>Edit</button>
                  <button onClick={() => handleDeleteQuestion(q.id)}>Delete</button>
                </div>
              </div>

              {q.type !== 'text' && (
                <ul>
                  {q.choices.map((c) => (
                    <li key={c.id} style={{ fontWeight: c.is_correct ? 'bold' : 'normal' }}>
                      {c.text} {c.is_correct ? '✓' : ''}
                    </li>
                  ))}
                </ul>
              )}

              {q.image_path && (
                <div style={{ marginTop: 8 }}>
                  <img
                    src={q.image_path}
                    alt=""
                    style={{ maxWidth: 200, display: 'block', border: '1px solid #ccc' }}
                  />
                  <button onClick={() => handleImageChange(q.id, null)}>Remove image</button>
                </div>
              )}
              <div style={{ marginTop: 8 }}>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  onChange={(e) => e.target.files?.[0] && handleImageChange(q.id, e.target.files[0])}
                />
              </div>
            </>
          )}
        </div>
      ))}

      {formMode === 'create' ? (
        <QuestionForm onSubmit={handleCreateQuestion} onCancel={() => setFormMode('none')} />
      ) : (
        <button onClick={() => setFormMode('create')}>Add question</button>
      )}
    </div>
  );
}
