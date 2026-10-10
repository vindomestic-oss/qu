import { useLanguage } from '../../i18n/LanguageContext';
import { DIFFICULT_BELOW, DIFFICULT_MIN_GRADED, isDifficult } from './difficulty';
import { formatPercent } from './format';
import { TrendDownIcon } from './icons';

/**
 * "Difficult" (icon and word, never colour alone) for a question with fewer than 35 % correct among
 * at least 5 graded answers (wish 8). The badge keeps its place while it is not shown (hidden, not
 * removed), so a row or card never moves when it appears with a grade.
 */
export function DifficultBadge({ correct, graded }: { correct: number; graded: number }) {
  const { t, uiLanguage } = useLanguage();
  const on = isDifficult(correct, graded);
  return (
    <span
      className={`difficult-badge${on ? '' : ' is-unused'}`}
      aria-hidden={on ? undefined : true}
      title={on ? t('grader.difficult.title', { pct: formatPercent(DIFFICULT_BELOW, uiLanguage), correct, graded }) : undefined}
      data-testid={on ? 'difficult-badge' : undefined}
    >
      <TrendDownIcon size={14} /> <span className="difficult-badge__word">{t('grader.difficult.badge')}</span>
    </span>
  );
}

/** The rule in one line, under the dashboard's question table (tooltips do not exist on iPads). */
export function DifficultLegend() {
  const { t, uiLanguage } = useLanguage();
  return (
    <p className="grade-muted difficult-legend">
      <span className="difficult-badge">
        <TrendDownIcon size={14} /> {t('grader.difficult.badge')}
      </span>{' '}
      {t('grader.difficult.legend', { pct: formatPercent(DIFFICULT_BELOW, uiLanguage), n: DIFFICULT_MIN_GRADED })}
    </p>
  );
}
