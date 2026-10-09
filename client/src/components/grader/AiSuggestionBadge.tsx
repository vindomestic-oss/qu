import { useState } from 'react';
import type { ReactNode } from 'react';
import { useLanguage } from '../../i18n/LanguageContext';
import type { AiSuggestionFields, GradingAnswer } from '../../types';
import { CheckIcon, CrossIcon } from './icons';
import { AlertIcon, ApproxIcon, DashIcon, EyeOffIcon, QuestionIcon, SyncIcon, WarningIcon } from './aiIcons';
import './ai.css';

// Wish 7, layer B (S14): the AI suggestion next to a free-text answer in the grading panel. The AI
// only suggests: nothing here sets points. Every state has an icon and words (WCAG 1.4.1), the
// confidence is a word, the English rationale is clamped to two lines with an expander.

type Answer = Partial<AiSuggestionFields> & Pick<GradingAnswer, 'points_awarded' | 'grade_source'>;

const VERDICT_ICON = {
  correct: CheckIcon,
  partially_correct: ApproxIcon,
  incorrect: CrossIcon,
  unclear: QuestionIcon,
} as const;
const VERDICT_KEY = {
  correct: 'grader.ai.correct',
  partially_correct: 'grader.ai.partial',
  incorrect: 'grader.ai.incorrect',
  unclear: 'grader.ai.unclear',
} as const;
const LONG_RATIONALE = 110;

interface Props {
  answer: Answer;
  /** Blind mode: the suggestion stays hidden until the answer is graded. */
  hidden: boolean;
  /** "Retry" of a failed suggestion (runs the AI pre-check of the question again; admins only). */
  onRetry?: () => void;
}

export function AiSuggestionBadge({ answer, hidden, onRetry }: Props) {
  const { t } = useLanguage();
  const [expanded, setExpanded] = useState(false);
  const graded = answer.points_awarded !== null;
  const status = answer.ai_status ?? null;

  let line: ReactNode;
  let rationale: string | null = null;
  // A slot that can still receive a suggestion keeps the room for it (no jump when it arrives).
  let final = false;

  if (hidden && !graded) {
    line = (
      <span className="ai-muted">
        <EyeOffIcon size={14} /> {t('grader.ai.hidden')}
      </span>
    );
  } else if (status === 'queued' || status === 'running') {
    line = (
      <span className="ai-chip ai-chip--pending">
        <SyncIcon size={14} className="ai-spin" /> {t('grader.ai.checking')}
      </span>
    );
  } else if (status === 'failed') {
    line = (
      <>
        <span className="ai-chip ai-chip--error" title={answer.ai_error ?? undefined}>
          <AlertIcon size={14} /> {answer.ai_error === 'daily_cap' ? t('grader.ai.errorDailyCap') : t('grader.ai.error')}
        </span>
        {onRetry && (
          <button type="button" className="small-button" onClick={onRetry}>
            {t('grader.ai.retry')}
          </button>
        )}
      </>
    );
  } else if (status === 'done' && answer.ai_verdict) {
    rationale = answer.ai_rationale ?? null;
    if (answer.ai_flagged) {
      line = (
        <span className="ai-chip ai-chip--flagged">
          <WarningIcon size={14} /> {t('grader.ai.flagged')}
        </span>
      );
    } else {
      const Icon = VERDICT_ICON[answer.ai_verdict];
      line = (
        <span className={`ai-chip ai-chip--${answer.ai_verdict}`}>
          <Icon size={14} /> <span className="ai-chip__src">{t('grader.ai.label')}:</span> {t(VERDICT_KEY[answer.ai_verdict])}
          {answer.ai_confidence && (
            <span className="ai-chip__conf">
              {' · '}
              {t('grader.ai.confidence', { level: t(`grader.ai.confidence.${answer.ai_confidence}`) })}
            </span>
          )}
        </span>
      );
    }
  } else if (status === 'skipped') {
    final = true;
    const key =
      answer.ai_error === 'no_reference'
        ? 'grader.ai.skippedNoReference'
        : answer.ai_error === 'precedent'
          ? 'grader.ai.skippedPrecedent'
          : 'grader.ai.skippedGraded';
    line = (
      <span className="ai-muted">
        <DashIcon size={14} /> {t(key)}
      </span>
    );
  } else if (answer.grade_source === 'rule') {
    final = true;
    line = (
      <span className="ai-muted">
        <CheckIcon size={14} /> {t('grader.ai.notNeeded')}
      </span>
    );
  } else {
    final = graded;
    line = (
      <span className="ai-muted">
        <DashIcon size={14} /> {t('grader.ai.notChecked')}
      </span>
    );
  }

  const long = (rationale?.length ?? 0) > LONG_RATIONALE;
  // The expander sits on the status line, so the reserved two rationale lines are never exceeded.
  return (
    <div className={`ai-suggestion${final ? ' ai-suggestion--final' : ''}`}>
      <div className="ai-suggestion__line">
        {line}
        {long && (
          <button type="button" className="ai-link-button" aria-expanded={expanded} onClick={() => setExpanded((x) => !x)}>
            {expanded ? t('grader.ai.less') : t('grader.ai.more')}
          </button>
        )}
      </div>
      {rationale && (
        <p className={`ai-rationale${long && !expanded ? ' ai-rationale--clamped' : ''}`} lang="en" dir="ltr">
          {rationale}
        </p>
      )}
    </div>
  );
}
