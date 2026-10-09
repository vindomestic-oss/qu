import { useEffect, useRef, useState } from 'react';
import { bulkGrade } from '../../api/grading';
import { acceptAiCorrect } from '../../api/aiGrading';
import { useLanguage } from '../../i18n/LanguageContext';
import type { AnswerGrade, GradingAnswer } from '../../types';
import { CheckIcon } from './icons';
import { formatPoints } from './format';
import { isAiAcceptable } from './aiSuggestion';
import './ai.css';

// Wish 7, layer B (S14): a person confirms AI suggestions, one answer (or one group of identical
// answers) at a time, or all confident-correct answers of a question at once. Both go through the
// versioned grading writes with source 'ai' (stored as 'ai_confirmed', audited under the grader's
// name). Partial, incorrect, unsure and suspicious suggestions never get an Accept.

type State = { kind: 'idle' } | { kind: 'saving' } | { kind: 'failed' } | { kind: 'changed'; n: number };

/**
 * "Accept: correct, {points} pt" for one answer or a group (all its ungraded members). Its slot keeps
 * its size when it is not offered (hidden, not removed), so rows never grow when a suggestion
 * arrives. Shortcut A through AiRowKeys.
 */
export function AiAcceptButton({
  sessionId,
  members,
  maxPoints,
  offered,
  onGrades,
}: {
  sessionId: number;
  members: GradingAnswer[];
  maxPoints: number;
  offered: boolean;
  onGrades: (grades: AnswerGrade[]) => void;
}) {
  const { t, uiLanguage } = useLanguage();
  const [state, setState] = useState<State>({ kind: 'idle' });
  const busy = useRef(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  async function accept() {
    if (busy.current || !offered) return;
    const items = members.filter(isAiAcceptable).map((m) => ({ answer_id: m.id, expected_version: m.grade_version }));
    if (items.length === 0) return;
    busy.current = true;
    setState({ kind: 'saving' });
    try {
      const { results } = await bulkGrade(sessionId, { items, is_correct: true, points_awarded: maxPoints, source: 'ai' });
      const grades: AnswerGrade[] = [];
      let changed = 0;
      for (const r of results) {
        if (r.ok && r.answer) grades.push(r.answer);
        else {
          changed += 1;
          if (r.current) grades.push(r.current);
        }
      }
      // The button hides once accepted: focus stays in the row, on its (now pressed) "Correct".
      const row = buttonRef.current?.closest('.answer-row');
      onGrades(grades);
      setState(changed > 0 ? { kind: 'changed', n: changed } : { kind: 'idle' });
      if (row && buttonRef.current === document.activeElement) {
        requestAnimationFrame(() => row.querySelector<HTMLButtonElement>('.grade-toggle--correct')?.focus());
      }
    } catch {
      setState({ kind: 'failed' });
    } finally {
      busy.current = false;
    }
  }

  return (
    <span className="ai-accept-slot">
      <button
        ref={buttonRef}
        type="button"
        className={`ai-accept${offered ? '' : ' ai-accept-slot__unused'}`}
        data-ai-accept={offered ? 'offered' : 'unused'}
        tabIndex={offered ? undefined : -1}
        aria-hidden={offered ? undefined : true}
        aria-keyshortcuts={offered ? 'A' : undefined}
        onClick={() => void accept()}
      >
        <CheckIcon /> {t('grader.ai.accept', { points: formatPoints(maxPoints, uiLanguage) })}
        <span className="ai-accept__key" aria-hidden="true" title={t('grader.ai.acceptKey')}>
          A
        </span>
      </button>
      <span role="status" className="ai-question__status">
        {state.kind === 'saving' && <span className="save-chip save-chip--saving">{t('grader.row.saving')}</span>}
        {state.kind === 'failed' && <span className="save-chip save-chip--failed">{t('grader.row.failed')}</span>}
        {state.kind === 'changed' && <span className="save-chip save-chip--failed">{t('grader.ai.changedMeanwhile', { n: state.n })}</span>}
      </span>
    </span>
  );
}

interface AcceptGroup {
  text: string;
  members: GradingAnswer[];
}

/**
 * Per question: "Accept all confident-correct (N)". The dialog lists exactly the groups that will be
 * accepted; only those rows (with the versions shown) are sent, and the server re-checks each one.
 */
export function AiAcceptAll({
  sessionId,
  questionId,
  maxPoints,
  groups,
  ambiguous,
  onGrades,
}: {
  sessionId: number;
  questionId: number;
  maxPoints: number;
  /** Confident-correct, unflagged, ungraded answers, grouped by identical text. */
  groups: AcceptGroup[];
  /** Graders overrode more than 20 % of this question's suggestions (wish 7): check the key. */
  ambiguous: boolean;
  onGrades: (grades: AnswerGrade[]) => void;
}) {
  const { t, uiLanguage } = useLanguage();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const statusRef = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState<AcceptGroup[]>([]);
  const [result, setResult] = useState<{ ok: number; skipped: number } | 'failed' | null>(null);
  const busy = useRef(false);
  const n = groups.reduce((sum, g) => sum + g.members.length, 0);
  const points = formatPoints(maxPoints, uiLanguage);

  useEffect(() => {
    const d = dialogRef.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      // The safe choice has the focus.
      cancelRef.current?.focus();
    } else if (!open && d.open) d.close();
  }, [open]);

  function openDialog() {
    // The list is frozen when the dialog opens: exactly these rows are sent.
    setShown(groups);
    setResult(null);
    setOpen(true);
  }

  function close(focusResult = false) {
    setOpen(false);
    // After accepting, the button is usually gone (nothing left to accept): focus the result.
    if (focusResult) requestAnimationFrame(() => statusRef.current?.focus());
    else buttonRef.current?.focus();
  }

  async function confirm() {
    if (busy.current) return;
    busy.current = true;
    const items = shown.flatMap((g) => g.members.map((m) => ({ answer_id: m.id, expected_version: m.grade_version })));
    try {
      const { results } = await acceptAiCorrect(sessionId, questionId, items);
      const grades: AnswerGrade[] = [];
      let ok = 0;
      for (const r of results) {
        if (r.ok && r.answer) {
          ok += 1;
          grades.push(r.answer);
        } else if (r.current) grades.push(r.current);
      }
      onGrades(grades);
      setResult({ ok, skipped: results.length - ok });
    } catch {
      setResult('failed');
    } finally {
      busy.current = false;
      close(true);
    }
  }

  const shownCount = shown.reduce((sum, g) => sum + g.members.length, 0);
  return (
    <>
      <div className="ai-question">
        <button
          ref={buttonRef}
          type="button"
          className={`ai-accept-all${n > 0 ? '' : ' ai-accept-slot__unused'}`}
          tabIndex={n > 0 ? undefined : -1}
          aria-hidden={n > 0 ? undefined : true}
          aria-haspopup="dialog"
          onClick={openDialog}
        >
          <CheckIcon /> {t('grader.ai.acceptAll', { n })}
        </button>
        <span role="status" className="ai-question__status" ref={statusRef} tabIndex={-1}>
          {result === 'failed' && <span className="save-chip save-chip--failed">{t('grader.ai.acceptAllFailed')}</span>}
          {result && result !== 'failed' && (
            <span className={`save-chip ${result.skipped ? 'save-chip--failed' : 'save-chip--saved'}`}>
              {result.skipped
                ? t('grader.ai.acceptAllSkipped', { n: result.ok, skipped: result.skipped })
                : t('grader.ai.acceptAllDone', { n: result.ok })}
            </span>
          )}
        </span>
        {/* Always here (hidden while not needed), so it never pushes the answers down when it appears. */}
        <p className={`ai-question__warn${ambiguous ? '' : ' is-hidden'}`} aria-hidden={ambiguous ? undefined : true}>
          {t('grader.ai.ambiguousReference')}
        </p>
      </div>
      <dialog ref={dialogRef} className="ai-dialog" aria-labelledby={`ai-accept-${questionId}`} onClose={() => setOpen(false)}>
        <h2 id={`ai-accept-${questionId}`}>{t('grader.ai.acceptAllTitle')}</h2>
        <p>{t('grader.ai.acceptAllBody', { points })}</p>
        <ul className="ai-dialog__list">
          {shown.map((g) => (
            <li key={g.members[0].id}>
              <bdi dir="auto">«{g.text}»</bdi> <bdi dir="ltr">{`×${g.members.length}`}</bdi>
            </li>
          ))}
        </ul>
        <div className="ai-dialog__actions">
          <button type="button" className="small-button" onClick={() => close()} ref={cancelRef}>
            {t('grader.ai.cancel')}
          </button>
          <button type="button" onClick={() => void confirm()}>
            {t('grader.ai.acceptAllConfirm', { n: shownCount })}
          </button>
        </div>
      </dialog>
    </>
  );
}
