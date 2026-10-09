import { useState } from 'react';
import type { FormEvent } from 'react';
import type { Question, QuestionInput, QuestionType } from '../../types';
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
  onActiveLangChange: (lang: ContentLangCode | null) => void;
  /** Declares a new language for the whole quiz (saved at once). */
  onAddLanguage: (lang: ContentLangCode) => Promise<void>;
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

export function QuestionForm({ initial, onSubmit, onCancel, baseLang, quizLanguages, activeLang, onActiveLangChange, onAddLanguage }: Props) {
  const [type, setType] = useState<QuestionType>(initial?.type ?? 'single');
  const [text, setText] = useState(initial?.text ?? '');
  // All 14 translations stay in state (and in the payload) even while hidden: a save never erases them.
  const [textTranslations, setTextTranslations] = useState<Record<ContentLangCode, string>>(
    unflattenTranslations('text', initial),
  );
  const [points, setPoints] = useState(initial?.points ?? 1);
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
    setSubmitting(true);
    try {
      await onSubmit({
        type,
        text,
        ...flattenTranslations('text', textTranslations),
        points,
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
      style={{ border: '1px solid var(--border)', padding: 16, marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}
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
          value={points}
          onChange={(e) => setPoints(Number(e.target.value))}
          required
          style={{ display: 'block', width: 100 }}
        />
      </label>

      {type !== 'text' && (
        <div>
          <div>Choices ({type === 'single' ? 'mark one correct' : 'mark one or more correct'})</div>
          {choices.map((c, i) => (
            <div key={c.id ?? `new-${i}`} style={{ border: '1px solid var(--border-subtle)', padding: 8, marginTop: 4 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                <input
                  type={type === 'single' ? 'radio' : 'checkbox'}
                  name="correct"
                  aria-label={`Choice ${i + 1} is correct`}
                  checked={c.is_correct}
                  onChange={(e) => setCorrect(i, e.target.checked)}
                  style={{ marginTop: 10, flexShrink: 0 }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
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
                  <button type="button" onClick={() => removeChoice(i)}>
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

      {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}

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
