import { useLayoutEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { Question, Quiz, QuizSection } from '../../types';
import { createSection, deleteSection, reorderSections, updateSection } from '../../api/quizzes';
import {
  flattenTranslations,
  translationLangs,
  unflattenTranslations,
  type ContentLangCode,
  type LangStatus,
  type QuizLang,
} from '../../i18n/contentLanguages';
import { sectionColors } from '../../lib/navGroups';
import { sectionStyle } from '../../lib/navLabels';
import { LanguagePairTabs } from './LanguagePairTabs';
import { PairField } from './PairField';

interface Props {
  quizId: number;
  /** The quiz's base language: the main name field is written in it. */
  base: QuizLang;
  /** The quiz's declared languages (base first). */
  declared: QuizLang[];
  sections: QuizSection[];
  questions: Question[];
  /** The open language pair, shared with every other form of the editor; null = base only. */
  activeLang: ContentLangCode | null;
  onActiveLangChange: (lang: ContentLangCode | null, anchor?: HTMLElement) => void;
  addable: ContentLangCode[];
  onAddLanguage: (lang: ContentLangCode, anchor?: HTMLElement) => Promise<void>;
  /** A seeded Chidon quiz: once all its rubrics are deleted, the next server start brings them back. */
  seededRubrics?: boolean;
  /** Every change saves at once and answers with the whole quiz. */
  onQuizChange: (quiz: Quiz) => void;
}

/** Where keyboard focus goes once a change has been saved and the list re-rendered. */
type FocusTarget = { sectionId: number; part: 'name' | 'up' | 'down' } | 'heading';

interface NameDraft {
  name: string;
  translations: Record<ContentLangCode, string>;
}

const hasText = (v: string | undefined) => typeof v === 'string' && v.trim() !== '';

function draftOf(section: QuizSection | undefined): NameDraft {
  return { name: section?.name ?? '', translations: unflattenTranslations('name', section) };
}

function sameDraft(a: NameDraft, b: NameDraft): boolean {
  return a.name === b.name && Object.keys(a.translations).every((l) => a.translations[l as ContentLangCode] === b.translations[l as ContentLangCode]);
}

/** "1–5", or "1–2, 7" when a rubric's questions are not next to each other. */
function numberRanges(numbers: number[]): string {
  const parts: string[] = [];
  let start = numbers[0];
  let prev = numbers[0];
  for (const n of [...numbers.slice(1), Number.NaN]) {
    if (n === prev + 1) {
      prev = n;
      continue;
    }
    parts.push(start === prev ? String(start) : `${start}–${prev}`);
    start = n;
    prev = n;
  }
  return parts.join(', ');
}

function statusOf(drafts: NameDraft[], lang: ContentLangCode): LangStatus {
  const filled = drafts.filter((d) => hasText(d.translations[lang])).length;
  if (drafts.length > 0 && filled === drafts.length) return 'full';
  return filled === 0 ? 'empty' : 'partial';
}

/**
 * "Rubrics" block of the quiz editor (wish 10): the author's groups of questions, shown to
 * participants as labelled, coloured groups in the question strip. Name + translations (one language
 * pair at a time, as everywhere in the editor), order (↑/↓), add, save, delete. Admin only, English.
 */
export function RubricsEditor({
  quizId,
  base,
  declared,
  sections,
  questions,
  activeLang,
  onActiveLangChange,
  addable,
  onAddLanguage,
  seededRubrics = false,
  onQuizChange,
}: Props) {
  // Unsaved edits per rubric id; a rubric without an entry shows its saved name.
  const [drafts, setDrafts] = useState<Record<number, NameDraft>>({});
  const [newDraft, setNewDraft] = useState<NameDraft>(() => draftOf(undefined));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const rootRef = useRef<HTMLElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const pendingFocus = useRef<FocusTarget | null>(null);

  // Buttons are never disabled while a request runs (aria-disabled instead), so focus stays where it
  // is; after a change it moves to the control the author works with next. Runs after every render,
  // because the saved quiz arrives through the parent a render later.
  useLayoutEffect(() => {
    const target = pendingFocus.current;
    const root = rootRef.current;
    if (!target || !root) return;
    if (target === 'heading') {
      pendingFocus.current = null;
      headingRef.current?.focus();
      return;
    }
    const row = root.querySelector<HTMLElement>(`[data-section-id="${target.sectionId}"]`);
    if (!row) return; // the saved list has not arrived yet
    pendingFocus.current = null;
    const name = row.querySelector<HTMLElement>('.pair-field input');
    if (target.part === 'name') {
      name?.focus();
      return;
    }
    // The same arrow in the moved rubric's row; at an edge (disabled there) the other arrow.
    const arrow = (part: 'up' | 'down') => row.querySelector<HTMLButtonElement>(`[data-move="${part}"]:not(:disabled)`);
    (arrow(target.part) ?? arrow(target.part === 'up' ? 'down' : 'up') ?? name)?.focus();
  });

  const colors = sectionColors(sections);
  const ordered = [...colors.values()];
  const rowDraft = (s: QuizSection) => drafts[s.id] ?? draftOf(s);
  const numbersOf = (sectionId: number) => questions.flatMap((q, i) => (q.section_id === sectionId ? [i + 1] : []));

  // Languages with a pair button: declared ones plus any language a rubric name already has. The
  // status glyph counts the rubrics only (not the empty "New rubric" field).
  const rowDrafts = ordered.map(({ section }) => rowDraft(section));
  const tabLanguages = translationLangs(base).filter(
    (l) => declared.includes(l) || [...rowDrafts, newDraft].some((d) => hasText(d.translations[l])),
  );
  const shownLang = activeLang && tabLanguages.includes(activeLang) ? activeLang : null;

  async function run(action: () => Promise<{ quiz: Quiz }>, done?: (quiz: Quiz) => void, message?: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const { quiz } = await action();
      onQuizChange(quiz);
      done?.(quiz);
      if (message) setNotice(message);
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : 'Could not save the rubrics');
    } finally {
      setBusy(false);
    }
  }

  function edit(sectionId: number, section: QuizSection, change: (d: NameDraft) => NameDraft) {
    setDrafts((prev) => ({ ...prev, [sectionId]: change(prev[sectionId] ?? draftOf(section)) }));
  }

  function forget(sectionId: number) {
    setDrafts((prev) => {
      const next = { ...prev };
      delete next[sectionId];
      return next;
    });
  }

  function save(e: FormEvent, section: QuizSection) {
    e.preventDefault();
    if (busy) return;
    const d = rowDraft(section);
    void run(
      () => updateSection(section.id, { name: d.name, ...flattenTranslations('name', d.translations) }),
      () => {
        forget(section.id);
        pendingFocus.current = { sectionId: section.id, part: 'name' };
      },
      `Saved "${d.name.trim()}".`,
    );
  }

  function undo(section: QuizSection) {
    if (busy) return;
    forget(section.id);
    pendingFocus.current = { sectionId: section.id, part: 'name' };
  }

  function remove(index: number, section: QuizSection) {
    if (busy) return;
    const count = numbersOf(section.id).length;
    const what =
      count === 0
        ? 'It has no questions.'
        : count === 1
          ? 'Its question stays in the quiz, without a rubric.'
          : `Its ${count} questions stay in the quiz, without a rubric.`;
    const comesBack =
      seededRubrics && ordered.length === 1
        ? ' It is the last rubric of this Chidon quiz: the standard Chidon rubrics come back the next time the server starts.'
        : '';
    if (!confirm(`Delete the rubric "${section.name}"? ${what}${comesBack}`)) return;
    const next = ordered[index + 1]?.section.id;
    void run(
      () => deleteSection(section.id),
      () => {
        forget(section.id);
        pendingFocus.current = next !== undefined ? { sectionId: next, part: 'name' } : 'heading';
      },
      `Deleted "${section.name}".`,
    );
  }

  function move(index: number, direction: -1 | 1) {
    if (busy) return;
    const ids = ordered.map(({ section }) => section.id);
    const other = index + direction;
    if (other < 0 || other >= ids.length) return;
    const moved = ids[index];
    [ids[index], ids[other]] = [ids[other], ids[index]];
    void run(
      () => reorderSections(quizId, ids),
      () => {
        pendingFocus.current = { sectionId: moved, part: direction === -1 ? 'up' : 'down' };
      },
    );
  }

  function add(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const before = new Set(sections.map((s) => s.id));
    void run(
      () => createSection(quizId, { name: newDraft.name, ...flattenTranslations('name', newDraft.translations) }),
      (quiz) => {
        setNewDraft(draftOf(undefined));
        const added = (quiz.sections ?? []).find((s) => !before.has(s.id));
        if (added) pendingFocus.current = { sectionId: added.id, part: 'name' };
      },
      `Added "${newDraft.name.trim()}".`,
    );
  }

  const busyProps = busy ? { 'aria-disabled': true as const } : {};

  return (
    <section className="rubrics" aria-labelledby="rubrics-title" ref={rootRef}>
      <h2 id="rubrics-title" className="rubrics__title" tabIndex={-1} ref={headingRef}>
        Rubrics
      </h2>
      <p className="rubrics__hint">
        Rubrics group the questions in the participants&apos; question strip, each with its name and colour. Assign a rubric
        in each question&apos;s form. Without rubrics, participants see one group without a name.
      </p>
      <LanguagePairTabs
        base={base}
        languages={tabLanguages}
        declared={declared}
        active={shownLang}
        onSelect={onActiveLangChange}
        statusOf={(l) => statusOf(rowDrafts, l)}
        addable={addable}
        onAdd={onAddLanguage}
      />
      {ordered.length > 0 && (
        <ol className="rubrics__list">
          {ordered.map(({ section, colorIndex }, i) => {
            const d = rowDraft(section);
            const dirty = !sameDraft(d, draftOf(section));
            const numbers = numbersOf(section.id);
            return (
              <li
                key={section.id}
                className="rubric-row"
                style={sectionStyle(colorIndex)}
                data-testid="rubric-row"
                data-section-id={section.id}
              >
                <form aria-label={`Rubric ${i + 1}`} onSubmit={(e) => save(e, section)}>
                  <PairField
                    required
                    label={`Rubric ${i + 1}`}
                    baseLang={base}
                    baseValue={d.name}
                    onBaseChange={(value) => edit(section.id, section, (prev) => ({ ...prev, name: value }))}
                    translations={d.translations}
                    onTranslationChange={(lang, value) =>
                      edit(section.id, section, (prev) => ({ ...prev, translations: { ...prev.translations, [lang]: value } }))
                    }
                    activeLang={shownLang}
                  />
                  <p className="rubric-row__meta">
                    {numbers.length === 0
                      ? 'No questions yet'
                      : `${numbers.length} question${numbers.length === 1 ? '' : 's'}: ${numberRanges(numbers)}`}
                  </p>
                  <div className="rubric-row__actions">
                    <button
                      type="button"
                      data-move="up"
                      aria-label={`Move rubric ${i + 1} up`}
                      disabled={i === 0}
                      {...busyProps}
                      onClick={() => move(i, -1)}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      data-move="down"
                      aria-label={`Move rubric ${i + 1} down`}
                      disabled={i === ordered.length - 1}
                      {...busyProps}
                      onClick={() => move(i, 1)}
                    >
                      ↓
                    </button>
                    <button type="submit" aria-label={`Save rubric ${i + 1}`} disabled={!dirty} {...busyProps}>
                      Save
                    </button>
                    {dirty && (
                      <button type="button" aria-label={`Undo rubric ${i + 1}`} {...busyProps} onClick={() => undo(section)}>
                        Undo
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn-outline-danger"
                      aria-label={`Delete rubric ${i + 1}`}
                      {...busyProps}
                      onClick={() => remove(i, section)}
                    >
                      Delete
                    </button>
                  </div>
                </form>
              </li>
            );
          })}
        </ol>
      )}
      <form className="rubrics__add" aria-label="New rubric" onSubmit={add}>
        <PairField
          required
          label="New rubric"
          baseLang={base}
          baseValue={newDraft.name}
          onBaseChange={(value) => setNewDraft((prev) => ({ ...prev, name: value }))}
          translations={newDraft.translations}
          onTranslationChange={(lang, value) => setNewDraft((prev) => ({ ...prev, translations: { ...prev.translations, [lang]: value } }))}
          activeLang={shownLang}
        />
        <button type="submit" {...busyProps}>
          Add rubric
        </button>
      </form>
      {error && (
        <p role="alert" className="rubrics__error">
          {error}
        </p>
      )}
      <p role="status" className="rubrics__status">
        {notice}
      </p>
    </section>
  );
}
