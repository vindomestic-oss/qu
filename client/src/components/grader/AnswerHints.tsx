import { useLayoutEffect, useRef, useState } from 'react';
import { addAcceptedAnswer } from '../../api/aiGrading';
import { useLanguage } from '../../i18n/LanguageContext';
import type { Precedent } from '../../types';
import { CheckIcon, HistoryIcon } from './icons';
import { formatPoints } from './format';
import { Interpolate } from './Interpolate';

// Hints of the reference check (wish 7, S13) next to a text answer: the rule label, earlier grades
// of the same answer in other runs, and the admin's "Add to accepted answers".

/** "Auto: matches the model answer", with an icon (never colour alone). */
export function RuleMatchedLabel({ count }: { count?: number }) {
  const { t } = useLanguage();
  return (
    <span className="rule-chip">
      <CheckIcon size={14} /> {count === undefined ? t('grader.ai.ruleMatched') : t('grader.group.allRule', { n: count })}
    </span>
  );
}

/** "Same answer graded before: 1 pt (3×)", or "Graders disagreed before: 0 / 1 pt (3×)". */
export function PrecedentHint({ precedent }: { precedent: Precedent | undefined }) {
  const { t, uiLanguage } = useLanguage();
  if (!precedent || precedent.n === 0 || precedent.points.length === 0) return null;
  const agreed = precedent.points.length === 1;
  const points = precedent.points.map((p) => formatPoints(p, uiLanguage)).join(' / ');
  return (
    <p className={`answer-hint${agreed ? '' : ' answer-hint--disagree'}`}>
      <HistoryIcon size={14} />{' '}
      <span>
        {/* Points and "3×" as LTR isolates, so "(3×)" never mirrors to "(×3)" in Hebrew. */}
        <Interpolate
          template={t(agreed ? 'grader.ai.precedent' : 'grader.ai.precedentDisagree')}
          values={{ points: <bdi dir="ltr">{points}</bdi>, count: <bdi dir="ltr">{`${precedent.n}×`}</bdi> }}
        />
      </span>
    </p>
  );
}

type AcceptState = { kind: 'idle' } | { kind: 'adding' } | { kind: 'added'; more: number } | { kind: 'failed' };

interface AcceptProps {
  questionId: number;
  answerId: number;
  /** A person credited the answer in full and the key does not cover it yet. */
  offered: boolean;
  /** The answer as shown, so every button has its own name for screen readers. */
  answerText: string;
  /** This admin gave the grade that makes it offered. Narrow screens (one column, the slot below the
   *  grading buttons) show the button only then, so another grader's grade never adds a line. */
  mine: boolean;
}

/**
 * Admins only: adds this answer's text to the question's accepted answers, so the same answer is
 * credited automatically in every run from now on (grades by people stay). The slot keeps its
 * place while the button is not offered (hidden, class is-unused; narrow screens drop it, where it
 * sits below the grading buttons), so nothing moves when a grade arrives. One status region stays
 * in place and receives the result; focus moves to the slot when the button goes away.
 */
export function AcceptVariantSlot({ questionId, answerId, offered, answerText, mine }: AcceptProps) {
  const { t } = useLanguage();
  const [state, setState] = useState<AcceptState>({ kind: 'idle' });
  const slotRef = useRef<HTMLDivElement>(null);

  async function add() {
    if (state.kind === 'adding') return;
    setState({ kind: 'adding' });
    try {
      const r = await addAcceptedAnswer(questionId, answerId);
      setState({ kind: 'added', more: r.regraded });
    } catch {
      setState({ kind: 'failed' });
    }
  }

  // The button is gone once added: keep focus in the row, on the slot that now says what happened
  // (right after the commit, before the browser paints).
  const added = state.kind === 'added';
  useLayoutEffect(() => {
    if (added) slotRef.current?.focus();
  }, [added]);

  const unused = !offered && state.kind === 'idle';
  const othersOnly = offered && !mine && state.kind === 'idle';
  const buttonText = state.kind === 'adding' ? t('grader.accept.adding') : t('grader.accept.add');
  const message =
    state.kind === 'added'
      ? state.more > 0
        ? t('grader.accept.addedMore', { n: state.more })
        : t('grader.accept.added')
      : state.kind === 'failed' && offered
        ? t('grader.accept.failed')
        : '';
  return (
    <div className={`accept-slot${unused ? ' is-unused' : ''}${othersOnly ? ' is-others' : ''}`} ref={slotRef} tabIndex={-1}>
      {state.kind !== 'added' && (
        <button
          type="button"
          className={`small-button${offered ? '' : ' accept-slot__unused'}`}
          onClick={add}
          tabIndex={offered ? undefined : -1}
          aria-hidden={offered ? undefined : true}
          // Its own name in every row: the visible text followed by the answer.
          aria-label={`${buttonText}: ${answerText}`}
        >
          {buttonText}
        </button>
      )}
      <span role="status" className="accept-slot__status">
        {message && (
          <span className={`save-chip ${state.kind === 'added' ? 'save-chip--saved' : 'save-chip--failed'}`}>{message}</span>
        )}
      </span>
    </div>
  );
}
