import { useId, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { gradeAnswer } from '../../api/grading';
import { StaffApiError } from '../../api/graderClient';
import { useLanguage } from '../../i18n/LanguageContext';
import { formatServerTime } from '../../lib/parseServerDate';
import type { AnswerGrade } from '../../types';
import { CheckIcon, CrossIcon } from './icons';
import { AUTO_SOURCES, formatPoints, graderIdentity } from './format';
import { Interpolate } from './Interpolate';
import { RuleMatchedLabel } from './AnswerHints';
import { useGradeShortcut, useShortcutsEnabled } from '../../lib/graderShortcuts';
import { AnswerTextIdContext } from './answerTextId';

interface Attempt {
  is_correct: boolean;
  points_awarded: number;
  expected_version: number;
}

type SaveState =
  | { kind: 'idle' }
  | { kind: 'saving' }
  /** `version`: the grade_version this row saved; a newer grade from someone else hides "Saved". */
  | { kind: 'saved'; version: number }
  | { kind: 'failed'; attempt: Attempt }
  | { kind: 'invalid' }
  | { kind: 'not_submitted' }
  | { kind: 'conflict'; current: AnswerGrade; attempt: Attempt };

interface Props {
  sessionId: number;
  /** The answer's grade as the server last reported it. */
  answer: AnswerGrade;
  maxPoints: number;
  /** Not submitted yet: everything is read-only. */
  disabled?: boolean;
  /** Row heading and group label, e.g. "Answer 3" in whole-quiz mode. */
  heading?: string;
  /** Only for screen readers (the participant page's card already shows "Question N"). */
  headingHidden?: boolean;
  /** The answer itself (text or selected options). */
  children: React.ReactNode;
  /** Beside the heading (wish 8: the answer's language tag). */
  tag?: React.ReactNode;
  /** Secondary actions (wish 7: "Add to accepted answers"): under the answer beside the grading
   *  controls, below them on narrow screens, so they never push the grading buttons. */
  tools?: React.ReactNode;
  /** A saved grade, or the other grader's grade from a conflict, for the parent's list. */
  onGrade: (grade: AnswerGrade) => void;
}

const isHalfStep = (v: number) => Math.abs(v * 2 - Math.round(v * 2)) < 1e-9;

/**
 * One gradable answer: "Correct" (full points) and "Incorrect" (0) save at once; the points field
 * saves on blur or Enter. Every save sends the grade_version the grader saw, so a grade someone else
 * gave in the meantime is never silently overwritten: the row shows who graded it and lets this
 * grader keep theirs or replace it. A typed value stays until it is saved or discarded (Escape),
 * whatever arrives from the server meanwhile.
 */
export function AnswerGradeRow({
  sessionId,
  answer,
  maxPoints,
  disabled = false,
  heading,
  headingHidden = false,
  children,
  tag,
  tools,
  onGrade,
}: Props) {
  const { t, uiLanguage } = useLanguage();
  const inputRef = useRef<HTMLInputElement>(null);
  const correctRef = useRef<HTMLButtonElement>(null);
  const incorrectRef = useRef<HTMLButtonElement>(null);
  const [draft, setDraft] = useState<string | null>(null);
  // The version the grader saw when they started typing: a grade that arrives meanwhile is a conflict.
  const [draftBase, setDraftBase] = useState<number | null>(null);
  const [state, setState] = useState<SaveState>({ kind: 'idle' });
  // One save at a time. Controls stay enabled (a disabled field would lose focus, and its blur would
  // save a second time); actions during a save are ignored instead.
  const inFlight = useRef(false);
  const id = useId();
  const rowRef = useRef<HTMLDivElement>(null);
  const keysOn = useShortcutsEnabled();

  const graded = answer.points_awarded !== null;
  const max = formatPoints(maxPoints, uiLanguage);

  async function save(attempt: Attempt) {
    if (inFlight.current) return;
    inFlight.current = true;
    setState({ kind: 'saving' });
    try {
      const { answer: saved } = await gradeAnswer(sessionId, answer.id, attempt);
      setDraft(null);
      setDraftBase(null);
      onGrade(saved);
      setState({ kind: 'saved', version: saved.grade_version });
    } catch (err) {
      if (err instanceof StaffApiError && err.status === 409 && err.code === 'CONFLICT') {
        const current = err.body.current as AnswerGrade;
        setDraft(null);
        setDraftBase(null);
        onGrade(current);
        setState({ kind: 'conflict', current, attempt });
      } else if (err instanceof StaffApiError && err.status === 409) {
        setState({ kind: 'not_submitted' });
      } else if (err instanceof StaffApiError && err.status === 400) {
        setState({ kind: 'invalid' });
      } else {
        setState({ kind: 'failed', attempt });
      }
    } finally {
      inFlight.current = false;
    }
  }

  /** After Keep theirs / Replace with mine / Retry (whose buttons disappear): focus stays in the row, on
   *  the toggle of the resulting verdict (not the points field, which would open the iPad keyboard). */
  function focusVerdict(isCorrect: boolean | null) {
    (isCorrect === false ? incorrectRef : correctRef).current?.focus();
  }

  function verdict(isCorrect: boolean) {
    if (inFlight.current) return;
    setDraft(null);
    setDraftBase(null);
    void save({ is_correct: isCorrect, points_awarded: isCorrect ? maxPoints : 0, expected_version: answer.grade_version });
  }

  function commitPoints() {
    if (draft === null || inFlight.current) return;
    const value = inputRef.current?.valueAsNumber ?? Number.NaN;
    if (draft.trim() === '' || !Number.isFinite(value) || value < 0 || value > maxPoints || !isHalfStep(value)) {
      setState({ kind: 'invalid' });
      return;
    }
    // Without a verdict yet, points decide it; an existing verdict stays (e.g. "incorrect, 0.5 for effort").
    const isCorrect = graded && answer.is_correct !== null ? answer.is_correct === 1 : value > 0;
    if (graded && Math.abs((answer.points_awarded ?? 0) - value) < 1e-9 && draftBase === answer.grade_version) {
      setDraft(null);
      setDraftBase(null);
      return;
    }
    void save({ is_correct: isCorrect, points_awarded: value, expected_version: draftBase ?? answer.grade_version });
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

  // Wish 8 (S15): grade keys aimed at this row (GraderShortcuts). A digit is that many points: 0 and
  // the maximum are "Incorrect" and "Correct"; other points follow the field's rule (an existing
  // verdict stays, otherwise points > 0 count as correct).
  useGradeShortcut(rowRef, (action) => {
    if (disabled) return 'not_gradable';
    if (inFlight.current) return 'busy';
    if (action.kind === 'correct' || action.kind === 'incorrect') {
      verdict(action.kind === 'correct');
      return 'ok';
    }
    if (action.kind === 'editPoints') {
      inputRef.current?.focus();
      inputRef.current?.select();
      return 'ok';
    }
    const value = action.points;
    if (value > maxPoints + 1e-9) return { result: 'too_high', max: maxPoints };
    if (value === 0 || Math.abs(value - maxPoints) < 1e-9) {
      verdict(value > 0);
      return 'ok';
    }
    setDraft(null);
    setDraftBase(null);
    const isCorrect = graded && answer.is_correct !== null ? answer.is_correct === 1 : value > 0;
    if (graded && Math.abs((answer.points_awarded ?? 0) - value) < 1e-9 && (answer.is_correct === 1) === isCorrect) return 'ok';
    void save({ is_correct: isCorrect, points_awarded: value, expected_version: answer.grade_version });
    return 'ok';
  });

  const pointsValue = draft ?? (graded ? String(answer.points_awarded) : '');
  const meta = (() => {
    if (!graded) return t('grader.row.notGraded');
    // Wish 7: credited because it matches the model answer or an accepted answer.
    if (answer.grade_source === 'rule') return <RuleMatchedLabel />;
    if (answer.grade_source && AUTO_SOURCES.has(answer.grade_source)) return t('grader.row.auto');
    return (
      <Interpolate
        template={t('grader.row.gradedBy')}
        values={{
          name: <GraderName gradedBy={answer.graded_by} adminLabel={t('grader.row.admin')} />,
          time: <bdi>{formatServerTime(answer.graded_at, uiLanguage)}</bdi>,
        }}
      />
    );
  })();

  const headingEl = heading && (
    <div id={`${id}-h`} className={headingHidden ? 'visually-hidden' : 'answer-row__heading'}>
      {heading}
    </div>
  );

  return (
    <div
      ref={rowRef}
      className={`answer-row${disabled ? ' is-disabled' : ''}${tools ? ' answer-row--tools' : ''}`}
      role="group"
      aria-labelledby={heading ? `${id}-h` : undefined}
      // Wish 8 (S15): J/K/N move the focus here (programmatic only, never a Tab stop); the answer
      // (AnswerText) and its grade line describe the row, so moving there reads more than "Answer 3".
      tabIndex={-1}
      aria-describedby={`${id}-text ${id}-status`}
      data-grade-row=""
      data-graded={graded ? 'true' : 'false'}
      data-gradable={disabled ? 'false' : 'true'}
      data-saving={state.kind === 'saving' ? 'true' : undefined}
    >
      <div className="answer-row__content">
        {tag ? (
          <div className="answer-row__headline">
            {headingEl}
            {tag}
          </div>
        ) : (
          headingEl
        )}
        <AnswerTextIdContext.Provider value={`${id}-text`}>{children}</AnswerTextIdContext.Provider>
      </div>

      <div className="answer-row__controls">
        <div className="answer-row__actions">
          <button
            ref={correctRef}
            type="button"
            className="grade-toggle grade-toggle--correct"
            aria-pressed={graded && answer.is_correct === 1}
            disabled={disabled}
            aria-keyshortcuts={keysOn ? 'C' : undefined}
            title={keysOn ? t('grader.keys.tooltip', { key: 'C' }) : undefined}
            onClick={() => verdict(true)}
          >
            <CheckIcon /> {t('grader.row.correct')}
          </button>
          <button
            ref={incorrectRef}
            type="button"
            className="grade-toggle grade-toggle--incorrect"
            aria-pressed={graded && answer.is_correct === 0}
            disabled={disabled}
            aria-keyshortcuts={keysOn ? 'X' : undefined}
            title={keysOn ? t('grader.keys.tooltip', { key: 'X' }) : undefined}
            onClick={() => verdict(false)}
          >
            <CrossIcon /> {t('grader.row.incorrect')}
          </button>
          <label className="points-field">
            <span className="points-field__label">{t('grader.row.points', { max })}</span>
            <input
              ref={inputRef}
              type="number"
              min={0}
              max={maxPoints}
              step={0.5}
              inputMode="decimal"
              value={pointsValue}
              disabled={disabled}
              aria-invalid={state.kind === 'invalid' || undefined}
              aria-describedby={`${id}-status`}
              onChange={(e) => {
                if (draft === null) setDraftBase(answer.grade_version);
                setDraft(e.target.value);
              }}
              onBlur={commitPoints}
              onKeyDown={onKeyDown}
            />
          </label>
        </div>

        <div id={`${id}-status`} className="answer-row__status">
          {/* Only the save state and a conflict are announced; the meta line changes with every refresh. */}
          <span role="status" className="answer-row__live">
            {state.kind === 'conflict' && (
              <span className="conflict-prompt__text">
                <Interpolate
                  template={t('grader.row.conflict')}
                  values={{
                    name: <GraderName gradedBy={state.current.graded_by} adminLabel={t('grader.row.admin')} />,
                    points: <bdi dir="ltr">{`${formatPoints(state.current.points_awarded, uiLanguage)} / ${max}`}</bdi>,
                  }}
                />
              </span>
            )}
            {state.kind === 'saving' && <span className="save-chip save-chip--saving">{t('grader.row.saving')}</span>}
            {state.kind === 'saved' && state.version === answer.grade_version && (
              <span className="save-chip save-chip--saved">{t('grader.row.saved')}</span>
            )}
            {state.kind === 'failed' && <span className="save-chip save-chip--failed">{t('grader.row.failed')}</span>}
            {state.kind === 'invalid' && <span className="save-chip save-chip--failed">{t('grader.row.invalidPoints', { max })}</span>}
            {state.kind === 'not_submitted' && <span className="save-chip save-chip--failed">{t('grader.row.notSubmitted')}</span>}
          </span>
          {state.kind === 'conflict' ? (
            <span className="conflict-prompt">
              <button
                type="button"
                className="small-button"
                onClick={() => {
                  focusVerdict(state.current.is_correct === null ? null : state.current.is_correct === 1);
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
                  void save({ ...state.attempt, expected_version: state.current.grade_version });
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
                    void save({ ...state.attempt, expected_version: answer.grade_version });
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
      {tools && <div className="answer-row__tools">{tools}</div>}
    </div>
  );
}

/** The grader's name as people read it; the stored "(link #N)" / "admin:" form is in the tooltip. */
function GraderName({ gradedBy, adminLabel }: { gradedBy: string | null; adminLabel: string }) {
  const { name, title } = graderIdentity(gradedBy, adminLabel);
  return <bdi title={title}>{name}</bdi>;
}
