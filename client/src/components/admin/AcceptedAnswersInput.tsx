import { useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { ACCEPTED_MAX_CHARS, withDraft } from '../../lib/acceptedAnswers';

interface Props {
  value: string[];
  onChange: (next: string[]) => void;
  /** The text typed but not added yet (the form adds it when the question is saved). */
  draft: string;
  onDraftChange: (draft: string) => void;
}

/** Where focus goes after the list changed: a chip's remove button (by index) or the text field. */
type FocusTarget = number | 'field' | null;

/**
 * "Accepted answers / spellings" of a text question (wish 7, admin, English): a chip list. Enter in
 * the field adds a chip and never submits the surrounding question form; × removes one. A submitted
 * answer that equals the model answer or one of these, ignoring case, accents, niqqud, punctuation,
 * spaces and a leading article, gets full points automatically (labelled, and graders can change it).
 * Focus never drops to the page: after × it moves to the next chip's ×, else the previous one, else
 * the field; after Add it returns to the field.
 */
export function AcceptedAnswersInput({ value, onChange, draft, onDraftChange }: Props) {
  const id = useId();
  const [message, setMessage] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const removeRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const focusAfter = useRef<FocusTarget>(null);

  useEffect(() => {
    const target = focusAfter.current;
    if (target === null) return;
    focusAfter.current = null;
    const button = typeof target === 'number' ? removeRefs.current[target] : null;
    (button ?? inputRef.current)?.focus();
  });

  function add() {
    const next = withDraft(value, draft);
    focusAfter.current = 'field';
    if (next.error) {
      setMessage(next.error);
      return;
    }
    if (next.list !== value) onChange(next.list);
    onDraftChange('');
    setMessage('');
  }

  function remove(index: number) {
    const rest = value.filter((_, j) => j !== index);
    // The chip that takes this one's place, else the one before it, else the field.
    focusAfter.current = rest.length === 0 ? 'field' : Math.min(index, rest.length - 1);
    onChange(rest);
    setMessage('');
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      // The field sits inside the question form: Enter adds a chip instead of saving the question.
      e.preventDefault();
      add();
    }
  }

  return (
    <div className="accepted-field">
      <label htmlFor={`${id}-input`} className="accepted-field__label">
        Accepted answers / spellings
      </label>
      {value.length > 0 && (
        <ul className="accepted-chips" aria-label="Accepted answers">
          {value.map((v, i) => (
            <li key={`${v}-${i}`} className="accepted-chip">
              <bdi dir="auto">{v}</bdi>
              <button
                ref={(el) => {
                  removeRefs.current[i] = el;
                }}
                type="button"
                className="accepted-chip__remove"
                aria-label={`Remove ${v}`}
                onClick={() => remove(i)}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="accepted-field__add">
        <input
          ref={inputRef}
          id={`${id}-input`}
          type="text"
          value={draft}
          maxLength={ACCEPTED_MAX_CHARS}
          placeholder="e.g. Ishmael"
          dir="auto"
          aria-describedby={`${id}-hint ${id}-msg`}
          onChange={(e) => {
            onDraftChange(e.target.value);
            if (message) setMessage('');
          }}
          onKeyDown={onKeyDown}
        />
        <button type="button" onClick={add} disabled={!draft.trim()}>
          Add
        </button>
      </div>
      <small id={`${id}-hint`} className="accepted-field__hint">
        Press Enter to add. Case, accents, niqqud, punctuation, hyphens, spaces and a leading the/a/an/der/die/das are
        ignored, so list only other spellings or wordings. Because accents and umlauts are ignored, “Bruder” also
        accepts “Brüder”. A submitted answer that matches the model answer or one of these gets full points
        automatically, marked “Auto”; graders can change it.
      </small>
      <p id={`${id}-msg`} role="status" className="accepted-field__message">
        {message}
      </p>
    </div>
  );
}
