import { useEffect, useState } from 'react';
import { getMyResults } from '../../api/participant';
import type { ResultsResponse } from '../../types';
import { ApiError } from '../../api/client';
import { useLanguage } from '../../i18n/LanguageContext';
import { resolveField } from '../../i18n/resolveText';
import { LanguageSwitcher } from '../../components/LanguageSwitcher';
import { Logo } from '../../components/Logo';

export function Results() {
  const { t, language, isRtl } = useLanguage();
  const [results, setResults] = useState<ResultsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let attempts = 0;
    let cancelled = false;

    async function load() {
      try {
        const data = await getMyResults();
        if (!cancelled) setResults(data);
      } catch (err) {
        // Session may not have flipped to "ended" server-side yet right at the countdown boundary; retry briefly.
        if (err instanceof ApiError && err.status === 400 && attempts < 5) {
          attempts += 1;
          setTimeout(load, 1000);
        } else if (!cancelled) {
          setError(err instanceof ApiError ? err.message : 'Failed to load results');
        }
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) return <p style={{ margin: 40, color: 'red' }}>{error}</p>;
  if (!results) return <p style={{ margin: 40 }}>{t('results.loading')}</p>;

  return (
    <div dir={isRtl ? 'rtl' : 'ltr'} style={{ maxWidth: 640, margin: '40px auto' }}>
      <Logo />
      <LanguageSwitcher />
      <h1>{t('results.title')}</h1>
      <p style={{ fontSize: 20 }}>
        {t('results.score')} <strong>{results.scoredPoints}</strong> / {results.maxPoints}
        {results.pendingGrading > 0 && <span> {t('results.pendingSuffix', { count: results.pendingGrading })}</span>}
      </p>

      {results.breakdown.map((item, i) => {
        const correctChoiceIds = new Set(item.question.choices.filter((c) => c.is_correct).map((c) => c.id));
        const questionText = resolveField(item.question, 'text', language);
        return (
          <div key={item.question.id} style={{ border: '1px solid #ddd', padding: 12, marginBottom: 8 }}>
            <p style={{ fontWeight: 'bold' }}>
              {i + 1}. {questionText} {t('results.ptsSuffix', { points: item.question.points })}
            </p>
            {item.question.type !== 'text' ? (
              <ul>
                {item.question.choices.map((c) => {
                  const wasSelected = item.answer?.selected_choice_ids.includes(c.id) ?? false;
                  const isCorrectChoice = correctChoiceIds.has(c.id);
                  return (
                    <li
                      key={c.id}
                      style={{
                        fontWeight: wasSelected ? 'bold' : 'normal',
                        color: isCorrectChoice ? 'green' : wasSelected ? 'red' : undefined,
                      }}
                    >
                      {resolveField(c, 'text', language)} {wasSelected ? t('results.yourAnswer') : ''}{' '}
                      {isCorrectChoice ? t('results.correct') : ''}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p>
                {t('results.yourAnswerLabel')} {item.answer?.text_answer || <em>{t('results.noAnswer')}</em>}
              </p>
            )}
            <p>
              {item.question.type === 'text' && item.answer && item.answer.points_awarded == null
                ? t('results.pendingManualGrading')
                : t('results.pointsOf', { awarded: item.answer?.points_awarded ?? 0, max: item.question.points })}
            </p>
          </div>
        );
      })}
    </div>
  );
}
