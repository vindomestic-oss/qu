import { useLanguage } from '../../i18n/LanguageContext';
import { localizedLanguageName } from '../../i18n/languageMeta';
import type { QuizLang } from '../../i18n/contentLanguages';
import type { GradingLanguageStat } from '../../types';
import { formatPercent } from './format';

/**
 * Wish 8 (S15): the submitted free-text answers per answer language on the overview: how many, the
 * share correct among the graded ones, how often the AI suggestion agreed with the graders' final
 * grade (when the quiz has AI suggestions or there are any) and how often a grade kept the reference
 * check's credit (when it credited any). Not shown without free-text answers, nor for a quiz offered
 * in one language whose answers are all in that language (one row would repeat the overview).
 * Counts only.
 */
export function LanguageStats({
  stats,
  aiEnabled,
  base,
  offered,
}: {
  stats: GradingLanguageStat[];
  aiEnabled: boolean;
  base: QuizLang;
  offered: QuizLang[];
}) {
  const { t, uiLanguage } = useLanguage();
  if (stats.length === 0) return null;
  if (offered.length < 2 && stats.every((s) => s.lang === base)) return null;
  const showAi = aiEnabled || stats.some((s) => s.ai.total > 0);
  const showRule = stats.some((s) => s.rule.total > 0);
  const share = (n: number, total: number) =>
    total > 0 ? (
      t('grader.languages.share', { pct: formatPercent(n / total, uiLanguage), n, total })
    ) : (
      <>
        <span aria-hidden="true">–</span>
        <span className="visually-hidden">{t('grader.languages.noData')}</span>
      </>
    );

  return (
    <section className="grade-section" aria-labelledby="grade-languages-title" data-testid="language-stats">
      <h2 id="grade-languages-title" className="grade-section-title">
        {t('grader.languages.title')}
      </h2>
      {/* Focusable, so the table can be scrolled sideways with the keyboard on a phone. */}
      <div className="table-scroll" tabIndex={0} role="region" aria-labelledby="grade-languages-title">
        <table className="grade-table grade-table--languages">
          <thead>
            <tr>
              <th scope="col">{t('grader.languages.lang')}</th>
              <th scope="col" className="num">
                {t('grader.languages.answers')}
              </th>
              <th scope="col" className="num">
                {t('grader.languages.correct')}
              </th>
              {showAi && (
                <th scope="col" className="num">
                  {t('grader.ai.byLanguage')}
                </th>
              )}
              {showRule && (
                <th scope="col" className="num">
                  {t('grader.languages.rule')}
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {stats.map((s) => (
              <tr key={s.lang ?? 'unknown'}>
                <th scope="row" className="lang-stat__name">
                  {s.lang ? (
                    <>
                      {localizedLanguageName(s.lang, uiLanguage)}{' '}
                      <span className="lang-tag" aria-hidden="true" dir="ltr">
                        {s.lang.toUpperCase()}
                      </span>
                    </>
                  ) : (
                    t('grader.languages.unknown')
                  )}
                </th>
                <td className="num">{s.answers}</td>
                <td className="num">{share(s.correct, s.graded)}</td>
                {showAi && <td className="num">{share(s.ai.agreed, s.ai.total)}</td>}
                {showRule && <td className="num">{share(s.rule.agreed, s.rule.total)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="grade-muted difficult-legend">{t('grader.languages.note')}</p>
    </section>
  );
}
