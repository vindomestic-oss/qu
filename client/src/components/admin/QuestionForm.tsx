import { useState } from 'react';
import type { FormEvent } from 'react';
import type { Question, QuestionInput, QuestionType } from '../../types';
import { flattenTranslations, unflattenTranslations, type ContentLangCode } from '../../i18n/contentLanguages';
import { TranslationFields } from './TranslationFields';

interface Props {
  initial?: Question;
  onSubmit: (input: QuestionInput) => Promise<void>;
  onCancel: () => void;
}

interface ChoiceState {
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

export function QuestionForm({ initial, onSubmit, onCancel }: Props) {
  const [type, setType] = useState<QuestionType>(initial?.type ?? 'single');
  const [text, setText] = useState(initial?.text ?? '');
  const [textTranslations, setTextTranslations] = useState<Record<ContentLangCode, string>>(
    unflattenTranslations('text', initial),
  );
  const [points, setPoints] = useState(initial?.points ?? 1);
  const [choices, setChoices] = useState<ChoiceState[]>(
    initial && initial.choices.length > 0
      ? initial.choices.map((c) => ({
          text: c.text,
          translations: unflattenTranslations('text', c),
          is_correct: Boolean(c.is_correct),
        }))
      : emptyChoices(),
  );
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

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
                text: c.text,
                ...flattenTranslations('text', c.translations),
                is_correct: c.is_correct,
              })),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save question');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      style={{ border: '1px solid #ccc', padding: 16, marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}
    >
      <label>
        Type
        <select value={type} onChange={(e) => handleTypeChange(e.target.value as QuestionType)} style={{ display: 'block' }}>
          <option value="single">Single choice</option>
          <option value="multiple">Multiple choice</option>
          <option value="text">Text answer</option>
        </select>
      </label>

      <label>
        Question text
        <textarea value={text} onChange={(e) => setText(e.target.value)} required style={{ display: 'block', width: '100%' }} />
      </label>
      <TranslationFields values={textTranslations} onChange={(lang, value) => setTextTranslations((prev) => ({ ...prev, [lang]: value }))} />

      <label>
        Points
        <input
          type="number"
          min={1}
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
            <div key={i} style={{ border: '1px solid #eee', padding: 8, marginTop: 4 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  type={type === 'single' ? 'radio' : 'checkbox'}
                  name="correct"
                  checked={c.is_correct}
                  onChange={(e) => setCorrect(i, e.target.checked)}
                />
                <input
                  value={c.text}
                  onChange={(e) => updateChoiceText(i, e.target.value)}
                  placeholder={`Choice ${i + 1}`}
                  required
                  style={{ flex: 1 }}
                />
                {choices.length > 2 && (
                  <button type="button" onClick={() => removeChoice(i)}>
                    Remove
                  </button>
                )}
              </div>
              <div style={{ marginLeft: 24 }}>
                <TranslationFields values={c.translations} onChange={(lang, value) => updateChoiceTranslation(i, lang, value)} />
              </div>
            </div>
          ))}
          <button type="button" onClick={addChoice} style={{ marginTop: 8 }}>
            Add choice
          </button>
        </div>
      )}

      {error && <p style={{ color: 'red' }}>{error}</p>}

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
