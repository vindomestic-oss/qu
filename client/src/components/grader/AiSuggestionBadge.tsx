import { useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useLanguage } from '../../i18n/LanguageContext';
import type { AiSuggestionFields, GradingAnswer } from '../../types';
import { CheckIcon, CrossIcon } from './icons';
import { AlertIcon, ApproxIcon, DashIcon, EyeOffIcon, QuestionIcon, SyncIcon, WarningIcon } from './aiIcons';
import './ai.css';

// Wish 7, layer B (S14): the AI suggestion next to a free-text answer in the grading panel. The AI
// only suggests: nothing here sets points. Every state has an icon and words (WCAG 1.4.1), the
// confidence is a word, the English rationale is clamped to two lines with an expander.
//
// The block has the same size in every state (waiting, checking, suggestion, error, skipped,
// hidden, graded): one status line (one line, ellipsis; the full text stays in the DOM and in the
// tooltip) and one row for the rationale (two lines) or Retry, plus More/Less there when the
// rationale overflows. So a row never grows or shrinks when a suggestion arrives or a grade is
// given; only the grader's own "More" makes it taller.

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

/** ai_error as the grader reads it, in the interface language (never the provider's raw message). */
function errorKey(error: string | null | undefined): string {
  const e = error ?? '';
  if (e === 'daily_cap') return 'grader.ai.errorDailyCap';
  if (e === 'auth' || e === 'config') return 'grader.ai.errorAuth';
  if (/^(timeout|network|server|rate_limit)\b/.test(e)) return 'grader.ai.errorUnavailable';
  if (/^safety\b/.test(e)) return 'grader.ai.errorSafety';
  return 'grader.ai.error';
}

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
  const [overflows, setOverflows] = useState(false);
  const textRef = useRef<HTMLParagraphElement>(null);
  const graded = answer.points_awarded !== null;
  const status = answer.ai_status ?? null;

  let line: ReactNode;
  let label = '';
  let rationale: string | null = null;
  let retry = false;

  if (hidden && !graded) {
    label = t('grader.ai.hidden');
    line = (
      <span className="ai-muted" title={label}>
        <EyeOffIcon size={14} /> {label}
      </span>
    );
  } else if (status === 'queued' || status === 'running') {
    label = t('grader.ai.checking');
    line = (
      <span className="ai-chip ai-chip--pending" title={label}>
        <SyncIcon size={14} className="ai-spin" /> {label}
      </span>
    );
  } else if (status === 'failed') {
    label = t(errorKey(answer.ai_error));
    line = (
      <span className="ai-chip ai-chip--error" title={label}>
        <AlertIcon size={14} /> {label}
      </span>
    );
    retry = Boolean(onRetry);
  } else if (status === 'done' && answer.ai_verdict) {
    rationale = answer.ai_rationale ?? null;
    if (answer.ai_flagged) {
      label = t('grader.ai.flagged');
      line = (
        <span className="ai-chip ai-chip--flagged" title={label}>
          <WarningIcon size={14} /> {label}
        </span>
      );
    } else {
      const Icon = VERDICT_ICON[answer.ai_verdict];
      const confidence = answer.ai_confidence ? t('grader.ai.confidence', { level: t(`grader.ai.confidence.${answer.ai_confidence}`) }) : '';
      label = `${t('grader.ai.label')}: ${t(VERDICT_KEY[answer.ai_verdict])}${confidence ? ` · ${confidence}` : ''}`;
      line = (
        <span className={`ai-chip ai-chip--${answer.ai_verdict}`} title={label}>
          <Icon size={14} /> <span className="ai-chip__src">{t('grader.ai.label')}:</span> {t(VERDICT_KEY[answer.ai_verdict])}
          {confidence && <span className="ai-chip__conf"> · {confidence}</span>}
        </span>
      );
    }
  } else if (status === 'skipped') {
    const key =
      answer.ai_error === 'no_reference'
        ? 'grader.ai.skippedNoReference'
        : answer.ai_error === 'precedent'
          ? 'grader.ai.skippedPrecedent'
          : answer.ai_error === 'too_long'
            ? 'grader.ai.skippedTooLong'
            : 'grader.ai.skippedGraded';
    label = t(key);
    line = (
      <span className="ai-muted" title={label}>
        <DashIcon size={14} /> {label}
      </span>
    );
  } else if (answer.grade_source === 'rule') {
    label = t('grader.ai.notNeeded');
    line = (
      <span className="ai-muted" title={label}>
        <CheckIcon size={14} /> {label}
      </span>
    );
  } else {
    label = t('grader.ai.notChecked');
    line = (
      <span className="ai-muted" title={label}>
        <DashIcon size={14} /> {label}
      </span>
    );
  }

  // More/Less only when the clamped rationale really overflows. The observer reports once at start
  // and again whenever the width changes (iPad rotation, language switch).
  useLayoutEffect(() => {
    const el = textRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      if (el.classList.contains('ai-rationale--clamped')) setOverflows(el.scrollHeight > el.clientHeight + 1);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [rationale]);

  return (
    <div className="ai-suggestion">
      <div className="ai-suggestion__line">{line}</div>
      <div className="ai-suggestion__why">
        {rationale && (
          <p ref={textRef} className={`ai-rationale${expanded ? '' : ' ai-rationale--clamped'}`} lang="en" dir="ltr">
            {rationale}
          </p>
        )}
        {rationale && (overflows || expanded) && (
          <button type="button" className="ai-link-button" aria-expanded={expanded} onClick={() => setExpanded((x) => !x)}>
            {expanded ? t('grader.ai.less') : t('grader.ai.more')}
          </button>
        )}
        {retry && (
          <button type="button" className="small-button" onClick={onRetry}>
            {t('grader.ai.retry')}
          </button>
        )}
      </div>
    </div>
  );
}
