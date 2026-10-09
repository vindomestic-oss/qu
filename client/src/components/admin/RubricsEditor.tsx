import { useState } from 'react';
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
  /** Every change saves at once and answers with the whole quiz. */
  onQuizChange: (quiz: Quiz) => void;
}

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
  onQuizChange,
}: Props) {
  // Unsaved edits per rubric id; a rubric without an entry shows its saved name.
  const [drafts, setDrafts] = useState<Record<number, NameDraft>>({});
  const [newDraft, setNewDraft] = useState<NameDraft>(() => draftOf(undefined));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

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
    const d = rowDraft(section);
    void run(
      () => updateSection(section.id, { name: d.name, ...flattenTranslations('name', d.translations) }),
      () => forget(section.id),
      `Saved "${d.name.trim()}".`,
    );
  }

  function remove(section: QuizSection) {
    const count = numbersOf(section.id).length;
    const what = count === 1 ? 'Its question stays' : `Its ${count} questions stay`;
    if (!confirm(`Delete the rubric "${section.name}"? ${what} in the quiz, without a rubric.`)) return;
    void run(
      () => deleteSection(section.id),
      () => forget(section.id),
      `Deleted "${section.name}".`,
    );
  }

  function move(index: number, direction: -1 | 1) {
    const ids = ordered.map(({ section }) => section.id);
    const other = index + direction;
    if (other < 0 || other >= ids.length) return;
    [ids[index], ids[other]] = [ids[other], ids[index]];
    void run(() => reorderSections(quizId, ids));
  }

  function add(e: FormEvent) {
    e.preventDefault();
    void run(
      () => createSection(quizId, { name: newDraft.name, ...flattenTranslations('name', newDraft.translations) }),
      () => setNewDraft(draftOf(undefined)),
      `Added "${newDraft.name.trim()}".`,
    );
  }

  return (
    <section className="rubrics" aria-labelledby="rubrics-title">
      <h2 id="rubrics-title" className="rubrics__title">
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
              <li key={section.id} className="rubric-row" style={sectionStyle(colorIndex)} data-testid="rubric-row">
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
                    <button type="button" aria-label={`Move rubric ${i + 1} up`} disabled={busy || i === 0} onClick={() => move(i, -1)}>
                      ↑
                    </button>
                    <button
                      type="button"
                      aria-label={`Move rubric ${i + 1} down`}
                      disabled={busy || i === ordered.length - 1}
                      onClick={() => move(i, 1)}
                    >
                      ↓
                    </button>
                    <button type="submit" disabled={busy || !dirty}>
                      Save
                    </button>
                    {dirty && (
                      <button type="button" disabled={busy} onClick={() => forget(section.id)}>
                        Undo
                      </button>
                    )}
                    <button type="button" className="btn-outline-danger" disabled={busy} onClick={() => remove(section)}>
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
        <button type="submit" disabled={busy}>
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
