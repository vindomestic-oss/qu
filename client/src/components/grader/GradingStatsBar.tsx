import { Link } from 'react-router-dom';
import { useLanguage } from '../../i18n/LanguageContext';
import type { GradingSummary } from '../../types';
import { CheckIcon, CrossIcon, FlagIcon, HourglassIcon } from './icons';

type Counters = GradingSummary['counters'];

const SEGMENTS = [
  { key: 'correct', label: 'grader.stats.correct', filter: 'all', Icon: CheckIcon },
  { key: 'incorrect', label: 'grader.stats.incorrect', filter: 'all', Icon: CrossIcon },
  { key: 'needs_review', label: 'grader.stats.needsReview', filter: 'needs_review', Icon: FlagIcon },
  { key: 'awaiting_submission', label: 'grader.stats.awaiting', filter: 'all', Icon: HourglassIcon },
] as const;

/**
 * One stacked bar (a CSS flex row, widths proportional to the counts) and its legend. Every segment
 * and legend item links to the whole-quiz review: "needs review" with that filter, the rest with all.
 * The legend carries the accessible version; the bar is the same links for pointer users.
 */
export function GradingStatsBar({ sessionId, counters }: { sessionId: number; counters: Counters }) {
  const { t } = useLanguage();
  const total = SEGMENTS.reduce((n, s) => n + counters[s.key], 0);
  const href = (filter: string) => `/grade/${sessionId}/quiz?filter=${filter}`;

  return (
    <section className="grade-stats" aria-labelledby="grade-stats-title">
      <h2 id="grade-stats-title" className="grade-section-title">
        {t('grader.stats.title')}
      </h2>
      {total === 0 ? (
        <p className="grade-muted">{t('grader.stats.empty')}</p>
      ) : (
        <div className="grade-bar" aria-hidden="true">
          {SEGMENTS.filter((s) => counters[s.key] > 0).map(({ key, filter, Icon }) => (
            <Link
              key={key}
              to={href(filter)}
              tabIndex={-1}
              className={`grade-bar__seg grade-bar__seg--${key}`}
              style={{ flexGrow: counters[key] }}
            >
              <Icon size={14} />
              <span>{counters[key]}</span>
            </Link>
          ))}
        </div>
      )}
      <ul className="grade-legend">
        {SEGMENTS.map(({ key, label, filter, Icon }) => (
          <li key={key}>
            <Link to={href(filter)} className={`grade-legend__item grade-legend__item--${key}`}>
              <span className="grade-legend__glyph">
                <Icon />
              </span>
              <span>{t(label)}</span>
              <strong>{counters[key]}</strong>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
