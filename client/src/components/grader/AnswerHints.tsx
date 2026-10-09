import { useState } from 'react';
import { addAcceptedAnswer } from '../../api/aiGrading';
import { useLanguage } from '../../i18n/LanguageContext';
import type { Precedent } from '../../types';
import { CheckIcon, HistoryIcon } from './icons';
import { formatPoints } from './format';

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
      <bdi>{t(agreed ? 'grader.ai.precedent' : 'grader.ai.precedentDisagree', { points, n: precedent.n })}</bdi>
    </p>
  );
}

type AcceptState = { kind: 'idle' } | { kind: 'adding' } | { kind: 'added'; more: number } | { kind: 'failed' };

/**
 * Admins only: adds this answer's text to the question's accepted answers, so the same answer is
 * credited automatically in every run from now on (grades by people stay). The slot keeps its
 * height whether or not the button is offered, so rows never move when a grade arrives.
 */
export function AcceptVariantSlot({ questionId, answerId, offered }: { questionId: number; answerId: number; offered: boolean }) {
  const { t } = useLanguage();
  const [state, setState] = useState<AcceptState>({ kind: 'idle' });

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

  if (state.kind === 'added') {
    return (
      <div className="accept-slot">
        <span className="save-chip save-chip--saved" role="status">
          {state.more > 0 ? t('grader.accept.addedMore', { n: state.more }) : t('grader.accept.added')}
        </span>
      </div>
    );
  }
  return (
    <div className="accept-slot">
      <button
        type="button"
        className={`small-button${offered ? '' : ' accept-slot__unused'}`}
        onClick={add}
        tabIndex={offered ? undefined : -1}
        aria-hidden={offered ? undefined : true}
      >
        {state.kind === 'adding' ? t('grader.accept.adding') : t('grader.accept.add')}
      </button>
      <span role="status" className="accept-slot__status">
        {state.kind === 'failed' && offered ? <span className="save-chip save-chip--failed">{t('grader.accept.failed')}</span> : null}
      </span>
    </div>
  );
}
