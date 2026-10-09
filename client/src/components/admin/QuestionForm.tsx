import { useState } from 'react';
import type { FormEvent } from 'react';
import type { Question, QuestionInput, QuestionType, QuizSection } from '../../types';
import { ApiError } from '../../api/client';
import {
  flattenTranslations,
  questionLangStatus,
  translationLangs,
  unflattenTranslations,
  type ContentLangCode,
  type QuizLang,
} from '../../i18n/contentLanguages';
import { LanguagePairTabs } from './LanguagePairTabs';
import { PairField } from './PairField';
import { AcceptedAnswersInput } from './AcceptedAnswersInput';
import { parseAccepted, withDraft } from '../../lib/acceptedAnswers';

interface Props {
  initial?: Question;
  onSubmit: (input: QuestionInput) => Promise<void>;
  onCancel: () => void;
  /** The quiz's base language: the main fields are written in it. */
  baseLang: QuizLang;
  /** The quiz's declared languages (base first). */
  quizLanguages: QuizLang[];
  /** The open language pair, shared by every form of the editor; null = base only. */
  activeLang: ContentLangCode | null;
  /** `anchor` is the clicked button, which the editor keeps in place while fields open elsewhere. */
  onActiveLangChange: (lang: ContentLangCode | null, anchor?: HTMLElement) => void;
  /** Declares a new language for the whole quiz (saved at once). */
  onAddLanguage: (lang: ContentLangCode, anchor?: HTMLElement) => Promise<void>;
  /** The quiz's rubrics, in order (wish 10). */
  sections: QuizSection[];
  /** Points a new question starts with (the quiz's default). */
  defaultPoints?: number;
}

interface ChoiceState {
  /** The saved choice this row edits; sent back so answers keep pointing at it. */
  id?: number;
  text: string;
  translations: Record<ContentLangCode, string>;
  is_correct: boolean;
}

function emptyChoice(): ChoiceState {
  return { text: '', translations: unflattenTranslations('text', undefined), is_correct: false };
}

function emptyChoices(): ChoiceState[] {
  return [emptyChoice(), emptyChoice()];
}

const hasText = (v: string | undefined) => typeof v === 'string' && v.trim() !== '';

export function QuestionForm({
  initial,
  onSubmit,
  onCancel,
  baseLang,
  quizLanguages,
  activeLang,
  onActiveLangChange,
  onAddLanguage,
  sections,
  defaultPoints = 1,
}: Props) {
  const [type, setType] = useState<QuestionType>(initial?.type ?? 'single');
  const [sectionId, setSectionId] = useState<number | null>(initial?.section_id ?? null);
  const [text, setText] = useState(initial?.text ?? '');
  // All 14 translations stay in state (and in the payload) even while hidden: a save never erases them.
  const [textTranslations, setTextTranslations] = useState<Record<ContentLangCode, string>>(
    unflattenTranslations('text', initial),
  );
  // A string draft: clearing the field shows an empty field (not "0"), and typing never gives "03".
  const [pointsText, setPointsText] = useState(String(initial?.points ?? defaultPoints));
  // Text questions only, for graders (wish 8): never shown to participants.
  const [referenceAnswer, setReferenceAnswer] = useState(initial?.reference_answer ?? '');
  const [graderNotes, setGraderNotes] = useState(initial?.grader_notes ?? '');
  // Accepted answers / spellings (wish 7): matching answers are credited automatically.
  const [accepted, setAccepted] = useState<string[]>(() => parseAccepted(initial?.accepted_answers));
  const [acceptedDraft, setAcceptedDraft] = useState('');
  const [choices, setChoices] = useState<ChoiceState[]>(
    initial && initial.choices.length > 0
      ? initial.choices.map((c) => ({
          id: c.id,
          text: c.text,
          translations: unflattenTranslations('text', c),
          is_correct: Boolean(c.is_correct),
        }))
      : emptyChoices(),
  );
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Live form state in the row shape the status helpers read.
  const formRow = {
    type,
    text,
    ...flattenTranslations('text', textTranslations),
    choices: choices.map((c) => ({ text: c.text, ...flattenTranslations('text', c.translations) })),
  };
  // A rubric deleted while this form was open is gone: the form shows and sends "— none —".
  const effectiveSectionId = sectionId !== null && sections.some((s) => s.id === sectionId) ? sectionId : null;
  const candidates = translationLangs(baseLang);
  // Declared languages plus any language this form already has text in (e.g. after a "×").
  const tabLanguages = candidates.filter(
    (l) =>
      quizLanguages.includes(l) ||
      hasText(textTranslations[l]) ||
      (type !== 'text' && choices.some((c) => hasText(c.translations[l]))),
  );
  const shownLang = activeLang && tabLanguages.includes(activeLang) ? activeLang : null;
  const addable = candidates.filter((l) => !quizLanguages.includes(l));

  function handleTypeChange(next: QuestionType) {
    setType(next);
    if (next !== 'text' && choices.length < 2) {
      setChoices(emptyChoices());
    }
  }

  function updateChoiceText(index: number, value: string) {
    setChoices((prev) => prev.map((c, i) => (i === index ? { ...c, text: value } : c)));
  }

  function updateChoiceTranslation(index: number, lang: ContentLangCode, value: string) {
    setChoices((prev) =>
      prev.map((c, i) => (i === index ? { ...c, translations: { ...c.translations, [lang]: value } } : c)),
    );
  }

  function setCorrect(index: number, checked: boolean) {
    setChoices((prev) =>
      prev.map((c, i) => {
        if (type === 'single') return { ...c, is_correct: i === index };
        return i === index ? { ...c, is_correct: checked } : c;
      }),
    );
  }

  function addChoice() {
    setChoices((prev) => [...prev, emptyChoice()]);
  }

  function removeChoice(index: number) {
    setChoices((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    // A variant typed but not added with Enter is saved too (unless it is a duplicate or invalid).
    const acceptedToSave = withDraft(accepted, acceptedDraft).list;
    setSubmitting(true);
    try {
      await onSubmit({
        type,
        text,
        ...flattenTranslations('text', textTranslations),
        points: Number(pointsText),
        // Always sent: "— none —" clears the rubric.
        section_id: effectiveSectionId,
        ...(type === 'text' ? { reference_answer: referenceAnswer, accepted_answers: acceptedToSave, grader_notes: graderNotes } : {}),
        choices:
          type === 'text'
            ? []
            : choices.map((c) => ({
                ...(c.id !== undefined ? { id: c.id } : {}),
                text: c.text,
                ...flattenTranslations('text', c.translations),
                is_correct: c.is_correct,
              })),
      });
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && err.message === 'has_answers') {
        setError('This question already has answers, so it cannot switch between a text answer and choices. Create a new question instead.');
      } else if (err instanceof ApiError && err.status === 409 && err.code === 'stale_editor') {
        // The server refuses choices without ids on an answered question. This form sends the id of
        // every kept choice, so here it means every original choice was removed.
        setError(
          choices.some((c) => c.id !== undefined)
            ? 'This editor is out of date. Reload the page and edit again.'
            : 'This question already has answers. Keep at least one of its choices (change its text instead of removing it).',
        );
      } else {
        setError(err instanceof Error ? err.message : 'Failed to save question');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      aria-label="Question"
      data-testid="question-form"
      onSubmit={handleSubmit}
      className="question-form"
    >
      <LanguagePairTabs
        base={baseLang}
        languages={tabLanguages}
        declared={quizLanguages}
        active={shownLang}
        onSelect={onActiveLangChange}
        statusOf={(l) => questionLangStatus(formRow, l, baseLang)}
        addable={addable}
        onAdd={onAddLanguage}
      />

      <label>
        Type
        <select value={type} onChange={(e) => handleTypeChange(e.target.value as QuestionType)} style={{ display: 'block' }}>
          <option value="single">Single choice</option>
          <option value="multiple">Multiple choice</option>
          <option value="text">Text answer</option>
        </select>
      </label>

      <label>
        Rubric
        <select
          value={effectiveSectionId ?? ''}
          onChange={(e) => setSectionId(e.target.value ? Number(e.target.value) : null)}
          style={{ display: 'block', maxWidth: '100%' }}
        >
          <option value="">— none —</option>
          {[...sections]
            .sort((a, b) => a.sort_order - b.sort_order || a.id - b.id)
            .map((s) => (
              <option key={s.id} value={s.id} lang={baseLang}>
                {s.name}
              </option>
            ))}
        </select>
      </label>

      <PairField
        multiline
        required
        label="Question text"
        baseLang={baseLang}
        baseValue={text}
        onBaseChange={setText}
        translations={textTranslations}
        onTranslationChange={(lang, value) => setTextTranslations((prev) => ({ ...prev, [lang]: value }))}
        activeLang={shownLang}
      />

      <label>
        Points
        <input
          type="number"
          min={0.5}
          max={100}
          step={0.5}
          inputMode="decimal"
          value={pointsText}
          onChange={(e) => setPointsText(e.target.value)}
          required
          style={{ display: 'block', width: 100 }}
        />
      </label>

      {type === 'text' && (
        <>
          <label>
            Model answer (graders only)
            <textarea
              value={referenceAnswer}
              onChange={(e) => setReferenceAnswer(e.target.value)}
              rows={2}
              maxLength={2000}
              style={{ display: 'block', width: '100%' }}
            />
          </label>
          <AcceptedAnswersInput value={accepted} onChange={setAccepted} draft={acceptedDraft} onDraftChange={setAcceptedDraft} />
          <label>
            Grader notes
            <textarea
              value={graderNotes}
              onChange={(e) => setGraderNotes(e.target.value)}
              rows={2}
              maxLength={2000}
              placeholder="e.g. partial answer (only one of the two named): grader decides the points"
              style={{ display: 'block', width: '100%' }}
            />
          </label>
        </>
      )}

      {type !== 'text' && (
        <div>
          <div>Choices ({type === 'single' ? 'mark one correct' : 'mark one or more correct'})</div>
          {choices.map((c, i) => (
            <div key={c.id ?? `new-${i}`} style={{ border: '1px solid var(--border-subtle)', padding: 8, marginTop: 4 }}>
              <div className="choice-row">
                <input
                  type={type === 'single' ? 'radio' : 'checkbox'}
                  name="correct"
                  aria-label={`Choice ${i + 1} is correct`}
                  checked={c.is_correct}
                  onChange={(e) => setCorrect(i, e.target.checked)}
                  className="choice-row__correct"
                />
                <div className="choice-row__fields">
                  <PairField
                    hideLabel
                    required
                    label={`Choice ${i + 1}`}
                    basePlaceholder={`Choice ${i + 1}`}
                    baseLang={baseLang}
                    baseValue={c.text}
                    onBaseChange={(value) => updateChoiceText(i, value)}
                    translations={c.translations}
                    onTranslationChange={(lang, value) => updateChoiceTranslation(i, lang, value)}
                    activeLang={shownLang}
                  />
                </div>
                {choices.length > 2 && (
                  <button
                    type="button"
                    className="choice-row__remove"
                    aria-label={`Remove choice ${i + 1}`}
                    onClick={() => removeChoice(i)}
                  >
                    Remove
                  </button>
                )}
              </div>
            </div>
          ))}
          <button type="button" onClick={addChoice} style={{ marginTop: 8 }}>
            Add choice
          </button>
        </div>
      )}

      {error && (
        <p role="alert" style={{ color: 'var(--danger)' }}>
          {error}
        </p>
      )}

      <div style={{ display: 'flex', gap: 8 }}>
        <button type="submit" disabled={submitting}>
          {submitting ? 'Saving…' : 'Save question'}
        </button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
