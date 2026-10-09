import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useLanguage } from '../../i18n/LanguageContext';
import type { GradingSummary } from '../../types';
import { StatusTag } from './StatusTag';
import { formatPoints, participantLabel } from './format';

type Row = GradingSummary['participants'][number];
type Filter = 'all' | 'needs_review' | 'answering';

/**
 * Participants with progress, status, open reviews and score. Needs-review first, then by name (or
 * number). The whole row opens the participant page; the name is the link for keyboard users.
 */
export function ParticipantTable({ sessionId, rows, questionCount }: { sessionId: number; rows: Row[]; questionCount: number }) {
  const { t, uiLanguage } = useLanguage();
  const navigate = useNavigate();
  const [filter, setFilter] = useState<Filter>('all');

  const shown = rows
    .filter((p) => (filter === 'all' ? true : filter === 'needs_review' ? p.status === 'needs_review' : p.status === 'answering' || p.status === 'not_started'))
    .map((p) => ({ p, label: participantLabel(p, t) }))
    .sort((a, b) => {
      const review = Number(b.p.status === 'needs_review') - Number(a.p.status === 'needs_review');
      if (review !== 0) return review;
      if (a.p.display_name === undefined || b.p.display_name === undefined) return a.p.number - b.p.number;
      return a.label.localeCompare(b.label, uiLanguage);
    });

  const chips: { key: Filter; label: string }[] = [
    { key: 'all', label: t('grader.table.filterAll') },
    { key: 'needs_review', label: t('grader.table.filterNeedsReview') },
    { key: 'answering', label: t('grader.table.filterAnswering') },
  ];

  return (
    <section className="grade-section" aria-labelledby="grade-participants-title">
      <div className="grade-section__head">
        <h2 id="grade-participants-title" className="grade-section-title">
          {t('grader.table.title')}
        </h2>
        <div className="grade-chips" role="group" aria-label={t('grader.table.filterLabel')}>
          {chips.map((c) => (
            <button key={c.key} type="button" className="toggle-chip" aria-pressed={filter === c.key} onClick={() => setFilter(c.key)}>
              {c.label}
            </button>
          ))}
        </div>
      </div>
      {shown.length === 0 ? (
        <p className="grade-muted">{t('grader.table.empty')}</p>
      ) : (
        <div className="table-scroll">
          <table className="grade-table">
            <thead>
              <tr>
                <th scope="col">{t('grader.table.name')}</th>
                <th scope="col">{t('grader.table.progress')}</th>
                <th scope="col">{t('grader.table.status')}</th>
                <th scope="col" className="num">
                  {t('grader.table.needsReview')}
                </th>
                <th scope="col" className="num">
                  {t('grader.table.score')}
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map(({ p, label }) => {
                const href = `/grade/${sessionId}/participants/${p.id}`;
                const pct = questionCount > 0 ? Math.round((p.answered_count / questionCount) * 100) : 0;
                return (
                  <tr key={p.id} className="is-clickable" onClick={() => navigate(href)}>
                    <td>
                      <Link to={href} onClick={(e) => e.stopPropagation()} className="grade-table__name">
                        <bdi>{label}</bdi>
                      </Link>
                    </td>
                    <td>
                      <span className="mini-progress" aria-hidden="true">
                        <span className="mini-progress__fill" style={{ inlineSize: `${pct}%` }} />
                      </span>{' '}
                      <span className="nowrap">{t('grader.table.ofTotal', { n: p.answered_count, total: questionCount })}</span>
                    </td>
                    <td>
                      <StatusTag status={p.status} />
                    </td>
                    <td className="num">{p.needs_review_count > 0 ? p.needs_review_count : '–'}</td>
                    <td className="num nowrap">
                      <bdi dir="ltr">
                        {formatPoints(p.score, uiLanguage)} / {formatPoints(p.max_score, uiLanguage)}
                      </bdi>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
