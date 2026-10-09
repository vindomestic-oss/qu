import { useId, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { bulkGrade } from '../../api/grading';
import { StaffApiError } from '../../api/graderClient';
import { useLanguage } from '../../i18n/LanguageContext';
import { formatServerTime } from '../../lib/parseServerDate';
import type { AnswerGrade, GradingAnswer } from '../../types';
import { CheckIcon, CrossIcon } from './icons';
import { AUTO_SOURCES, formatPoints, graderIdentity, groupGrade } from './format';
import { Interpolate } from './Interpolate';
import { RuleMatchedLabel } from './AnswerHints';

type Member = GradingAnswer & { label: number };
type Item = { answer_id: number; expected_version: number };

interface Attempt {
  is_correct: boolean;
  points_awarded: number;
}

type SaveState =
  | { kind: 'idle' }
  | { kind: 'saving' }
  /** `versions`: the grade_version each saved answer got; a newer grade from someone else hides "Saved". */
  | { kind: 'saved'; versions: Record<number, number> }
  | { kind: 'failed'; attempt: Attempt }
  | { kind: 'invalid' }
  /** Answers someone else graded meanwhile: keep their grades or replace them with this attempt. */
  | { kind: 'conflict'; ids: number[]; attempt: Attempt };

interface Props {
  sessionId: number;
  /** The identical answers (same normalized text), in label order; fixed while the list is shown. */
  members: Member[];
  maxPoints: number;
  /** The answer text as shown for the whole group. */
  text: ReactNode;
  /** The same as plain text, for the group's accessible name ("3 identical answers: ismael"). */
  label: string;
  /** The precedent hint, under the text. */
  hints?: ReactNode;
  /** The admin's "Add to accepted answers", next to "Show the N answers" (below the controls on
   *  narrow screens, so it never pushes the grading buttons). */
  actions?: ReactNode;
  /** Wish 7 (S14): the group's AI suggestion and its Accept, under the hints. */
  ai?: ReactNode;
  /** Saved grades, or the other graders' grades from conflicts, for the parent's list. */
  onGrade: (grades: AnswerGrade[]) => void;
  /** One member as its own row, shown when the group is opened. */
  renderMember: (member: Member) => ReactNode;
}

const samePoints = (a: number | null, b: number | null) => a === b || (a !== null && b !== null && Math.abs(a - b) < 1e-9);
const isHalfStep = (v: number) => Math.abs(v * 2 - Math.round(v * 2)) < 1e-9;

/**
 * Identical answers to one question as one row "Same answer ×N" (wish 7): "Correct", "Incorrect"
 * or points grade every answer of the group at once (bulk-grade, one transaction, each answer with
 * the grade_version the grader saw). Answers already holding that grade are left alone. Answers
 * someone else graded in the meantime are reported, never overwritten: keep theirs or replace them.
 * The group can be opened to grade its answers one by one. Its layout does not change when grades
 * arrive (fixed status line), so nothing moves under the grader's finger.
 */
export function AnswerGroupRow({ sessionId, members, maxPoints, text, label, hints, actions, ai, onGrade, renderMember }: Props) {
  const { t, tCount, uiLanguage } = useLanguage();
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const correctRef = useRef<HTMLButtonElement>(null);
  const incorrectRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  // The versions the grader saw when they started typing: grades that arrive meanwhile are conflicts.
  const [draftBase, setDraftBase] = useState<Record<number, number> | null>(null);
  const [state, setState] = useState<SaveState>({ kind: 'idle' });
  const inFlight = useRef(false);

  const n = members.length;
  const agg = groupGrade(members);
  const max = formatPoints(maxPoints, uiLanguage);

  /** The members that do not hold this grade yet, with the version to expect. */
  function itemsFor(attempt: Attempt, only?: Set<number>, base?: Record<number, number> | null): Item[] {
    return members
      .filter((m) => !only || only.has(m.id))
      .filter((m) => !(m.points_awarded !== null && m.is_correct === (attempt.is_correct ? 1 : 0) && samePoints(m.points_awarded, attempt.points_awarded)))
      .map((m) => ({ answer_id: m.id, expected_version: base?.[m.id] ?? m.grade_version }));
  }

  async function save(attempt: Attempt, items: Item[]) {
    if (inFlight.current) return;
    if (items.length === 0) {
      setDraft(null);
      setDraftBase(null);
      setState({ kind: 'idle' });
      return;
    }
    inFlight.current = true;
    setState({ kind: 'saving' });
    try {
      const { results } = await bulkGrade(sessionId, { items, ...attempt });
      const grades: AnswerGrade[] = [];
      const conflicts: number[] = [];
      const versions: Record<number, number> = {};
      let failed = false;
      for (const r of results) {
        if (r.ok && r.answer) {
          grades.push(r.answer);
          versions[r.id] = r.answer.grade_version;
        } else if (r.error === 'conflict' && r.current) {
          grades.push(r.current);
          conflicts.push(r.id);
        } else {
          failed = true;
        }
      }
      setDraft(null);
      setDraftBase(null);
      onGrade(grades);
      if (conflicts.length > 0) setState({ kind: 'conflict', ids: conflicts, attempt });
      else if (failed) setState({ kind: 'failed', attempt });
      else setState({ kind: 'saved', versions });
    } catch (err) {
      if (err instanceof StaffApiError && err.status === 400) setState({ kind: 'invalid' });
      else setState({ kind: 'failed', attempt });
    } finally {
      inFlight.current = false;
    }
  }

  function focusVerdict(isCorrect: boolean) {
    (isCorrect ? correctRef : incorrectRef).current?.focus();
  }

  function verdict(isCorrect: boolean) {
    if (inFlight.current) return;
    setDraft(null);
    setDraftBase(null);
    const attempt = { is_correct: isCorrect, points_awarded: isCorrect ? maxPoints : 0 };
    void save(attempt, itemsFor(attempt));
  }

  function commitPoints() {
    if (draft === null || inFlight.current) return;
    const value = inputRef.current?.valueAsNumber ?? Number.NaN;
    if (draft.trim() === '' || !Number.isFinite(value) || value < 0 || value > maxPoints || !isHalfStep(value)) {
      setState({ kind: 'invalid' });
      return;
    }
    // A shared verdict stays (e.g. "incorrect, 0.5 for effort"); otherwise points decide it.
    const isCorrect = agg.uniform && agg.uniform.is_correct !== null ? agg.uniform.is_correct === 1 : value > 0;
    void save({ is_correct: isCorrect, points_awarded: value }, itemsFor({ is_correct: isCorrect, points_awarded: value }, undefined, draftBase));
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitPoints();
    } else if (e.key === 'Escape' && draft !== null) {
      e.preventDefault();
      setDraft(null);
      setDraftBase(null);
      setState({ kind: 'idle' });
    }
  }

  const pointsValue = draft ?? (agg.uniform ? String(agg.uniform.points_awarded) : '');
  const savedShown =
    state.kind === 'saved' && members.every((m) => state.versions[m.id] === undefined || state.versions[m.id] === m.grade_version);

  const meta = (() => {
    if (agg.graded === 0) return t('grader.row.notGraded');
    if (!agg.uniform) return t('grader.group.mixed', { graded: agg.graded, n });
    if (agg.allRule) return <RuleMatchedLabel count={n} />;
    // The latest grade of the group says who decided it.
    const latest = members.reduce((a, b) => ((b.graded_at ?? '') > (a.graded_at ?? '') ? b : a));
    if (latest.grade_source === 'rule') return <RuleMatchedLabel />;
    if (latest.grade_source && AUTO_SOURCES.has(latest.grade_source)) return t('grader.row.auto');
    const who = graderIdentity(latest.graded_by, t('grader.row.admin'));
    return (
      <Interpolate
        template={t('grader.row.gradedBy')}
        values={{ name: <bdi title={who.title}>{who.name}</bdi>, time: <bdi>{formatServerTime(latest.graded_at, uiLanguage)}</bdi> }}
      />
    );
  })();

  return (
    <div className="answer-group">
      <div className="answer-row answer-row--group answer-row--tools" role="group" aria-labelledby={`${id}-name`}>
        <div className="answer-row__content">
          {/* The group's name for screen readers: the count in words and the answer (not "×"). */}
          <span id={`${id}-name`} className="visually-hidden">
            {tCount('grader.group.label', n)}: <bdi>{label}</bdi>
          </span>
          <div className="answer-row__heading" aria-hidden="true">
            <span className="group-count">
              <Interpolate template={t('grader.group.heading')} values={{ count: <bdi dir="ltr">{`×${n}`}</bdi> }} />
            </span>
          </div>
          {text}
          {hints}
          {ai}
        </div>

        <div className="answer-row__controls">
          <div className="answer-row__actions">
            <button
              ref={correctRef}
              type="button"
              className="grade-toggle grade-toggle--correct"
              aria-pressed={agg.uniform?.is_correct === 1}
              onClick={() => verdict(true)}
            >
              <CheckIcon /> {t('grader.row.correct')}
            </button>
            <button
              ref={incorrectRef}
              type="button"
              className="grade-toggle grade-toggle--incorrect"
              aria-pressed={agg.uniform?.is_correct === 0}
              onClick={() => verdict(false)}
            >
              <CrossIcon /> {t('grader.row.incorrect')}
            </button>
            <label className="points-field">
              <span className="points-field__label">{t('grader.group.points', { max })}</span>
              <input
                ref={inputRef}
                type="number"
                min={0}
                max={maxPoints}
                step={0.5}
                inputMode="decimal"
                value={pointsValue}
                placeholder={agg.uniform ? undefined : '–'}
                aria-invalid={state.kind === 'invalid' || undefined}
                aria-describedby={`${id}-status`}
                onChange={(e) => {
                  if (draft === null) setDraftBase(Object.fromEntries(members.map((m) => [m.id, m.grade_version])));
                  setDraft(e.target.value);
                }}
                onBlur={commitPoints}
                onKeyDown={onKeyDown}
              />
            </label>
          </div>

          <div id={`${id}-status`} className="answer-row__status">
            <span role="status" className="answer-row__live">
              {state.kind === 'conflict' && (
                <span className="conflict-prompt__text">{tCount('grader.group.conflict', state.ids.length)}</span>
              )}
              {state.kind === 'saving' && <span className="save-chip save-chip--saving">{t('grader.row.saving')}</span>}
              {savedShown && <span className="save-chip save-chip--saved">{t('grader.row.saved')}</span>}
              {state.kind === 'failed' && <span className="save-chip save-chip--failed">{t('grader.row.failed')}</span>}
              {state.kind === 'invalid' && <span className="save-chip save-chip--failed">{t('grader.row.invalidPoints', { max })}</span>}
            </span>
            {state.kind === 'conflict' ? (
              <span className="conflict-prompt">
                <button
                  type="button"
                  className="small-button"
                  onClick={() => {
                    focusVerdict(state.attempt.is_correct);
                    setState({ kind: 'idle' });
                  }}
                >
                  {t('grader.row.keepTheirs')}
                </button>
                <button
                  type="button"
                  className="small-button"
                  onClick={() => {
                    focusVerdict(state.attempt.is_correct);
                    void save(state.attempt, itemsFor(state.attempt, new Set(state.ids)));
                  }}
                >
                  {t('grader.row.replaceMine')} (<bdi dir="ltr">{formatPoints(state.attempt.points_awarded, uiLanguage)}</bdi>)
                </button>
              </span>
            ) : (
              <>
                {state.kind === 'failed' && (
                  <button
                    type="button"
                    className="small-button"
                    onClick={() => {
                      focusVerdict(state.attempt.is_correct);
                      void save(state.attempt, itemsFor(state.attempt));
                    }}
                  >
                    {t('grader.row.retry')}
                  </button>
                )}
                <span className="answer-row__meta">{meta}</span>
              </>
            )}
          </div>
        </div>
        <div className="answer-row__tools">
          <button
            type="button"
            className="small-button"
            aria-expanded={open}
            aria-controls={`${id}-members`}
            aria-label={`${open ? t('grader.group.hide') : t('grader.group.show', { n })}: ${label}`}
            onClick={() => setOpen((o) => !o)}
          >
            {open ? t('grader.group.hide') : t('grader.group.show', { n })}
          </button>
          {actions}
        </div>
      </div>
      {/* Always present (empty while closed), so aria-controls points at it. */}
      <div id={`${id}-members`} className="answer-group__members" hidden={!open}>
        {open && members.map(renderMember)}
      </div>
    </div>
  );
}
