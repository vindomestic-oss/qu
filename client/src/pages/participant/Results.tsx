import { useEffect, useMemo, useState } from 'react';
import { getMyResults } from '../../api/participant';
import type { ResultsResponse } from '../../types';
import { ApiError } from '../../api/client';
import { useLanguage } from '../../i18n/LanguageContext';
import { useContentLanguage } from '../../i18n/useContentLanguage';
import { questionLanguages, sanitizeOffered } from '../../i18n/contentLanguages';
import { resolveFieldWithLang } from '../../i18n/resolveText';
import { dirOf } from '../../i18n/languageMeta';
import { QuestionLanguageBar } from '../../components/participant/QuestionLanguageBar';
import { Logo } from '../../components/Logo';

export function Results() {
  const { t } = useLanguage();
  const [results, setResults] = useState<ResultsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const offered = useMemo(
    () => (results ? sanitizeOffered(results.offered_languages, results.base_language) : null),
    [results],
  );
  const { contentLanguage, base, setContentLanguage } = useContentLanguage(offered);

  useEffect(() => {
    let attempts = 0;
    let cancelled = false;

    async function load() {
      try {
        const data = await getMyResults();
        if (!cancelled) setResults(data);
      } catch (err) {
        // The session may not have ended on the server yet (device clock ahead, or the server was
        // restarting at 0:00); the server ends it by its timer, so keep asking for up to a minute.
        if (err instanceof ApiError && err.status === 400 && attempts < 30) {
          attempts += 1;
          setTimeout(load, 2000);
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

  if (error) return <p style={{ margin: 40, color: 'var(--danger)' }}>{error}</p>;
  if (!results || !offered) return <p style={{ margin: 40 }}>{t('results.loading')}</p>;

  return (
    <div style={{ maxWidth: 640, margin: '16px auto', paddingInline: 16 }}>
      <Logo />
      <h1>{t('results.title')}</h1>
      <p style={{ fontSize: 20 }}>
        {t('results.score')} <strong>{results.scoredPoints}</strong> / {results.maxPoints}
        {results.pendingGrading > 0 && <span> {t('results.pendingSuffix', { count: results.pendingGrading })}</span>}
      </p>
      <div style={{ marginBottom: 12 }}>
        <QuestionLanguageBar idPrefix="qlang-results" languages={offered} value={contentLanguage} onChange={setContentLanguage} />
      </div>

      {results.breakdown.map((item, i) => {
        const correctChoiceIds = new Set(item.question.choices.filter((c) => c.is_correct).map((c) => c.id));
        // Same rule as /play: the whole question in the picked language, or wholly in the base.
        const shownLang = questionLanguages(item.question, base).includes(contentLanguage) ? contentLanguage : base;
        const questionText = resolveFieldWithLang(item.question, 'text', shownLang, base);
        return (
          <div
            key={item.question.id}
            style={{ border: '1px solid var(--border-subtle)', padding: 12, marginBottom: 8, background: 'var(--surface)', borderRadius: 8 }}
          >
            <p style={{ fontWeight: 'bold' }}>
              {i + 1}.{' '}
              <span lang={questionText.lang} dir={dirOf(questionText.lang)}>
                {questionText.text}
              </span>{' '}
              {t('results.ptsSuffix', { points: item.question.points })}
            </p>
            {item.question.type !== 'text' ? (
              <ul dir={dirOf(shownLang)}>
                {item.question.choices.map((c) => {
                  const wasSelected = item.answer?.selected_choice_ids.includes(c.id) ?? false;
                  const isCorrectChoice = correctChoiceIds.has(c.id);
                  const choiceText = resolveFieldWithLang(c, 'text', shownLang, base);
                  return (
                    <li
                      key={c.id}
                      style={{
                        fontWeight: wasSelected ? 'bold' : 'normal',
                        color: isCorrectChoice ? 'var(--success)' : wasSelected ? 'var(--danger)' : undefined,
                      }}
                    >
                      <span lang={choiceText.lang} dir={dirOf(choiceText.lang)}>
                        {choiceText.text}
                      </span>{' '}
                      {wasSelected ? t('results.yourAnswer') : ''}{' '}
                      {isCorrectChoice ? t('results.correct') : ''}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p>
                {t('results.yourAnswerLabel')}{' '}
                {item.answer?.text_answer ? <span dir="auto">{item.answer.text_answer}</span> : <em>{t('results.noAnswer')}</em>}
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
