import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  createQuestion,
  deleteQuestion,
  deleteQuestionImage,
  getQuiz,
  reorderQuestions,
  setQuizLanguages,
  updateQuestion,
  updateQuiz,
  uploadQuestionImage,
} from '../../api/quizzes';
import { listSessions } from '../../api/sessions';
import type { Quiz, Question, QuestionInput, QuizSession } from '../../types';
import { ApiError } from '../../api/client';
import { QuestionForm } from '../../components/admin/QuestionForm';
import { SessionPanel } from '../../components/admin/SessionPanel';
import { LanguagePairTabs } from '../../components/admin/LanguagePairTabs';
import { PairField } from '../../components/admin/PairField';
import { QuizLanguagesBar } from '../../components/admin/QuizLanguagesBar';
import { RubricsEditor } from '../../components/admin/RubricsEditor';
import { AiQuizSettings, AiReferenceTag } from '../../components/admin/AiQuizSettings';
import {
  flattenTranslations,
  isContentLang,
  metaLangStatus,
  questionLangStatus,
  translationLangs,
  unflattenTranslations,
  QUIZ_LANGS,
  type ContentLangCode,
  type QuizLang,
} from '../../i18n/contentLanguages';
import { LANGUAGE_META } from '../../i18n/languageMeta';
import { formatJoinCode } from '../../lib/joinLink';
import { sectionColors } from '../../lib/navGroups';
import { sectionStyle } from '../../lib/navLabels';

// The open language pair is remembered per browser tab, so the next question opens with it too.
const PAIR_STORAGE_KEY = 'quiz_editor_pair_lang';

function readStoredPair(): ContentLangCode | null {
  try {
    const v = sessionStorage.getItem(PAIR_STORAGE_KEY);
    return isContentLang(v) ? v : null;
  } catch {
    return null;
  }
}

const BASE_CHANGE_NOTE =
  'The main language says which language the main fields are written in. No text is moved or translated. Click Save quiz details to apply.';

const hasText = (v: string | undefined) => typeof v === 'string' && v.trim() !== '';

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
  const [baseLanguage, setBaseLanguage] = useState<QuizLang>('en');
  // A string draft, like the points field of a question.
  const [defaultPointsText, setDefaultPointsText] = useState('1');
  // Wish 7 (S14): the quiz's AI switch, saved with the details.
  const [aiEnabled, setAiEnabled] = useState(false);
  const [savingMeta, setSavingMeta] = useState(false);

  const [formMode, setFormMode] = useState<'none' | 'create' | number>('none');
  const [storedPair, setStoredPair] = useState<ContentLangCode | null>(readStoredPair);
  // The clicked pair button and its position on screen. A pair change opens or closes fields in every
  // form, also above the click; without scroll anchoring (iPad Safari) the page would jump.
  const scrollAnchor = useRef<{ el: HTMLElement; top: number } | null>(null);

  useLayoutEffect(() => {
    const anchor = scrollAnchor.current;
    if (!anchor) return;
    scrollAnchor.current = null;
    if (!anchor.el.isConnected) return;
    const shift = anchor.el.getBoundingClientRect().top - anchor.top;
    if (Math.abs(shift) >= 1) window.scrollBy(0, shift);
  });

  function setPairLang(lang: ContentLangCode | null, anchor?: HTMLElement) {
    if (anchor) {
      scrollAnchor.current = { el: anchor, top: anchor.getBoundingClientRect().top };
      // Nothing re-renders when the pair did not change: drop the anchor after this frame.
      requestAnimationFrame(() => {
        if (scrollAnchor.current?.el === anchor) scrollAnchor.current = null;
      });
    }
    setStoredPair(lang);
    try {
      if (lang) sessionStorage.setItem(PAIR_STORAGE_KEY, lang);
      else sessionStorage.removeItem(PAIR_STORAGE_KEY);
    } catch {
      // storage blocked: the pair applies until reload
    }
  }

  // Adding or removing a language saves at once and only replaces `quiz`: unsaved title,
  // description and question edits stay as they are (no refresh()).
  async function handleAddLanguage(lang: ContentLangCode, anchor?: HTMLElement) {
    if (!quiz) return;
    const { quiz: updated } = await setQuizLanguages(quizId, [...quiz.content_languages, lang]);
    setQuiz(updated);
    setPairLang(lang, anchor);
  }

  async function handleRemoveLanguage(lang: ContentLangCode) {
    if (!quiz) return;
    const { quiz: updated } = await setQuizLanguages(
      quizId,
      quiz.content_languages.filter((l) => l !== lang),
    );
    setQuiz(updated);
  }

  function handleBaseLanguageChange(next: QuizLang) {
    if (next === baseLanguage) return;
    if (!confirm(BASE_CHANGE_NOTE)) return;
    setBaseLanguage(next);
  }

  async function refresh() {
    try {
      const { quiz } = await getQuiz(quizId);
      setQuiz(quiz);
      setTitle(quiz.title);
      setTitleTranslations(unflattenTranslations('title', quiz));
      setDescription(quiz.description ?? '');
      setDescriptionTranslations(unflattenTranslations('description', quiz));
      setTimeLimitMinutes(Math.round(quiz.time_limit_seconds / 60));
      setBaseLanguage(quiz.base_language);
      setDefaultPointsText(String(quiz.default_points ?? 1));
      setAiEnabled(quiz.ai_grading_enabled === 1);
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
        base_language: baseLanguage,
        default_points: Number(defaultPointsText),
        ai_grading_enabled: aiEnabled,
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
  if (!quiz) return <p style={{ margin: 40, color: 'var(--danger)' }}>{error ?? 'Quiz not found'}</p>;

  const questions = [...(quiz.questions ?? [])].sort((a, b) => a.sort_order - b.sort_order);
  // Everything language-related follows the SAVED base and declared list, not unsaved form state.
  const base = quiz.base_language;
  const declared = quiz.content_languages ?? [base];
  const candidates = translationLangs(base);
  const pairLang = storedPair && candidates.includes(storedPair) ? storedPair : null;
  const addable = candidates.filter((l) => !declared.includes(l));
  const declaredTranslations = candidates.filter((l) => declared.includes(l));
  const metaValues: Record<string, unknown> = {
    title,
    description,
    ...flattenTranslations('title', titleTranslations),
    ...flattenTranslations('description', descriptionTranslations),
  };
  const metaTabLanguages = candidates.filter(
    (l) => declared.includes(l) || hasText(titleTranslations[l]) || hasText(descriptionTranslations[l]),
  );
  const metaPairLang = pairLang && metaTabLanguages.includes(pairLang) ? pairLang : null;
  const sections = quiz.sections ?? [];
  const rubricById = sectionColors(sections);
  const questionFormProps = {
    baseLang: base,
    quizLanguages: declared,
    activeLang: pairLang,
    onActiveLangChange: setPairLang,
    onAddLanguage: handleAddLanguage,
    sections,
    defaultPoints: quiz.default_points ?? 1,
  };
  const totalPoints = quiz.total_points ?? questions.reduce((sum, q) => sum + q.points, 0);

  return (
    <div className="editor-page">
      <Link to="/admin">&larr; Back to quizzes</Link>
      <h1>{quiz.title}</h1>
      <QuizLanguagesBar
        base={base}
        declared={declared}
        offered={quiz.offered_languages ?? [base]}
        questions={questions}
        addable={addable}
        onAdd={handleAddLanguage}
        onRemove={handleRemoveLanguage}
      />
      {error && (
        <p role="alert" style={{ color: 'var(--danger)' }}>
          {error}
        </p>
      )}

      <form
        aria-label="Quiz details"
        onSubmit={handleSaveMeta}
        style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
      >
        <LanguagePairTabs
          base={base}
          languages={metaTabLanguages}
          declared={declared}
          active={metaPairLang}
          onSelect={setPairLang}
          statusOf={(l) => metaLangStatus(metaValues, l)}
          addable={addable}
          onAdd={handleAddLanguage}
        />
        <PairField
          required
          label="Title"
          baseLang={base}
          baseValue={title}
          onBaseChange={setTitle}
          translations={titleTranslations}
          onTranslationChange={(lang, value) => setTitleTranslations((prev) => ({ ...prev, [lang]: value }))}
          activeLang={metaPairLang}
        />
        <PairField
          multiline
          label="Description"
          baseLang={base}
          baseValue={description}
          onBaseChange={setDescription}
          translations={descriptionTranslations}
          onTranslationChange={(lang, value) => setDescriptionTranslations((prev) => ({ ...prev, [lang]: value }))}
          activeLang={metaPairLang}
        />
        <label>
          Time limit (minutes)
          <input
            type="number"
            min={1}
            value={timeLimitMinutes}
            onChange={(e) => setTimeLimitMinutes(Number(e.target.value))}
            required
            style={{ display: 'block', width: 160 }}
          />
        </label>
        <label>
          Main language of the texts
          <select
            value={baseLanguage}
            onChange={(e) => handleBaseLanguageChange(e.target.value as QuizLang)}
            style={{ display: 'block' }}
          >
            {QUIZ_LANGS.map((code) => (
              <option key={code} value={code}>
                {LANGUAGE_META[code].endonym}
              </option>
            ))}
          </select>
        </label>
        <label>
          Points for new questions
          <input
            type="number"
            min={0.5}
            max={100}
            step={0.5}
            inputMode="decimal"
            value={defaultPointsText}
            onChange={(e) => setDefaultPointsText(e.target.value)}
            required
            style={{ display: 'block', width: 100 }}
          />
        </label>
        <AiQuizSettings checked={aiEnabled} onChange={setAiEnabled} />
        <button type="submit" disabled={savingMeta} style={{ alignSelf: 'flex-start' }}>
          {savingMeta ? 'Saving…' : 'Save quiz details'}
        </button>
      </form>

      <SessionPanel
        quizId={quizId}
        initialSession={sessionHistory.find((s) => s.status !== 'ended')}
        onSessionEnded={refreshSessionHistory}
        onSessionChanged={refreshSessionHistory}
      />

      {sessionHistory.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <h3>Session history</h3>
          <ul style={{ listStyle: 'none', padding: 0 }}>
            {sessionHistory.map((s) => (
              <li key={s.id} style={{ padding: '4px 0' }}>
                <bdi dir="ltr">{formatJoinCode(s.join_code)}</bdi> — {s.status}
                {s.started_at ? ` — started ${new Date(s.started_at).toLocaleString()}` : ''}{' '}
                <Link to={`/admin/sessions/${s.id}/results`}>View results</Link> ·{' '}
                <Link to={`/grade/${s.id}`}>Grading</Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      <RubricsEditor
        quizId={quizId}
        base={base}
        declared={declared}
        sections={sections}
        questions={questions}
        activeLang={pairLang}
        onActiveLangChange={setPairLang}
        addable={addable}
        onAddLanguage={handleAddLanguage}
        seededRubrics={quiz.seeded_rubrics}
        onQuizChange={setQuiz}
      />

      <h2 style={{ marginTop: 32 }}>
        Questions <small style={{ fontWeight: 400, fontSize: 16, color: 'var(--text-muted)' }}>· Total points: {totalPoints}</small>
      </h2>
      {questions.length === 0 && <p>No questions yet.</p>}
      {questions.map((q, i) => (
        <div key={q.id} style={{ border: '1px solid var(--border-subtle)', padding: 12, marginBottom: 8 }}>
          {formMode === q.id ? (
            <QuestionForm
              initial={q}
              onSubmit={(input) => handleUpdateQuestion(q.id, input)}
              onCancel={() => setFormMode('none')}
              {...questionFormProps}
            />
          ) : (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                <div style={{ flex: '1 1 260px', textAlign: 'start' }}>
                  <strong style={{ display: 'block' }}>
                    {i + 1}. [{q.type}] <span lang={base}>{q.text}</span> ({q.points} pt{q.points !== 1 ? 's' : ''})
                  </strong>
                  <RubricTag rubric={q.section_id != null ? rubricById.get(q.section_id) : undefined} base={base} />
                  <AiReferenceTag question={q} aiEnabled={quiz.ai_grading_enabled === 1} />
                  <MissingTranslations languages={declaredTranslations.filter((l) => questionLangStatus(q, l, base) !== 'full')} />
                </div>
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
                    style={{ maxWidth: 200, display: 'block', border: '1px solid var(--border)', background: 'var(--image-bg)' }}
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
        <QuestionForm onSubmit={handleCreateQuestion} onCancel={() => setFormMode('none')} {...questionFormProps} />
      ) : (
        <button onClick={() => setFormMode('create')}>Add question</button>
      )}
    </div>
  );
}

/** The question's rubric under its title in the list: the rubric's colour and its name. */
function RubricTag({ rubric, base }: { rubric?: { section: { name: string }; colorIndex: number }; base: QuizLang }) {
  if (!rubric) return null;
  return (
    <small className="rubric-badge" style={sectionStyle(rubric.colorIndex)}>
      <span className="visually-hidden">Rubric: </span>
      <span lang={base}>{rubric.section.name}</span>
    </small>
  );
}

/** "⚠ Missing translation: Lietuvių, Latviešu" under a question of the list. */
function MissingTranslations({ languages }: { languages: ContentLangCode[] }) {
  if (languages.length === 0) return null;
  return (
    <small className="q-missing">
      <span aria-hidden="true">⚠ </span>Missing translation:{' '}
      {languages.map((l, i) => (
        <span key={l}>
          {i > 0 && ', '}
          <bdi lang={l}>{LANGUAGE_META[l].endonym}</bdi>
        </span>
      ))}
    </small>
  );
}
