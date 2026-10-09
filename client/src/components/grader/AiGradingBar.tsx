import { useCallback, useEffect, useRef, useState } from 'react';
import { getAiStatus, runAi } from '../../api/aiGrading';
import { useLanguage } from '../../i18n/LanguageContext';
import { useStaffLive } from '../../lib/useStaffLive';
import type { AiGradingStatus } from '../../types';
import { SyncIcon } from './aiIcons';
import './ai.css';

// Wish 7, layer B (S14): the AI pre-check's progress at the top of the whole-quiz review and the
// overview: "AI checked X of Y", the time left, counts, how often the AI agreed with the graders,
// "Run AI pre-check" and the blind-mode switch. Hidden when the quiz's AI switch is off (the
// reference check's counts stay on the question cards). Polls every 5 s while answers wait.

const POLL_MS = 5_000;

interface Props {
  sessionId: number;
  /** The quiz's AI switch (from the panel payload). */
  quizAiEnabled: boolean;
  blind: boolean;
  onBlindChange: (on: boolean) => void;
  /** Every status (for per-question hints); `polled` = from the 5 s poll with changed counts, so the
   *  page refreshes the shown suggestions in case a live event was missed. */
  onStatus?: (status: AiGradingStatus, polled: boolean) => void;
}

export function AiGradingBar({ sessionId, quizAiEnabled, blind, onBlindChange, onStatus }: Props) {
  const { t } = useLanguage();
  const [status, setStatus] = useState<AiGradingStatus | null>(null);
  const [run, setRun] = useState<{ kind: 'idle' } | { kind: 'starting' } | { kind: 'queued'; n: number } | { kind: 'failed' }>({ kind: 'idle' });
  const lastKey = useRef('');
  const onStatusRef = useRef(onStatus);
  useEffect(() => {
    onStatusRef.current = onStatus;
  });

  const fetchStatus = useCallback(
    (fromPoll: boolean) => {
      if (!quizAiEnabled) return;
      getAiStatus(sessionId)
        .then((s) => {
          setStatus(s);
          const key = JSON.stringify(s.counts);
          const changed = lastKey.current !== '' && key !== lastKey.current;
          lastKey.current = key;
          onStatusRef.current?.(s, fromPoll && changed);
        })
        .catch(() => {
          // the next event or poll tries again
        });
    },
    [sessionId, quizAiEnabled],
  );
  const load = useCallback(() => fetchStatus(false), [fetchStatus]);
  const poll = useCallback(() => fetchStatus(true), [fetchStatus]);

  useEffect(() => {
    load();
  }, [load]);
  useStaffLive(quizAiEnabled ? sessionId : null, load, { events: ['grading:changed'] });
  const waiting = (status?.counts.queued ?? 0) + (status?.counts.running ?? 0);
  useEffect(() => {
    if (!quizAiEnabled || waiting === 0) return;
    const timer = setInterval(poll, POLL_MS);
    return () => clearInterval(timer);
  }, [quizAiEnabled, waiting, poll]);

  if (!quizAiEnabled) return null;

  async function start() {
    if (run.kind === 'starting') return;
    setRun({ kind: 'starting' });
    try {
      const r = await runAi(sessionId, { includeFailed: true });
      setRun({ kind: 'queued', n: r.queued });
      load();
    } catch {
      setRun({ kind: 'failed' });
    }
  }

  const c = status?.counts;
  const total = c ? c.done + c.queued + c.running : 0;
  const pct = total > 0 && c ? Math.round((c.done / total) * 100) : 0;
  const eta =
    status && waiting > 0 && status.etaSeconds !== null
      ? status.etaSeconds < 60
        ? t('grader.ai.etaSoon')
        : t('grader.ai.eta', { n: Math.ceil(status.etaSeconds / 60) })
      : '';
  const off = status && !status.modelCallsEnabled;
  const offText =
    status?.disabledReason === 'kill_switch'
      ? t('grader.ai.offKillSwitch')
      : status?.disabledReason === 'auth' || status?.disabledReason === 'config'
        ? t('grader.ai.offAuth')
        : t('grader.ai.off');

  // Fixed lines (head, time left, counts, actions), so the bar keeps its height while the queue
  // runs and the list below never moves (iPad Safari has no scroll anchoring).
  return (
    <section className="ai-bar" aria-labelledby={`ai-bar-${sessionId}`}>
      <div className="ai-bar__head">
        <h2 id={`ai-bar-${sessionId}`} className="ai-bar__title">
          {t('grader.ai.title')}
        </h2>
        <span className="ai-bar__progress">
          <SyncIcon size={14} className={waiting > 0 ? 'ai-spin' : 'ai-bar__idle'} /> {t('grader.ai.progress', { done: c?.done ?? 0, total })}
        </span>
        <span
          className="mini-progress"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={c?.done ?? 0}
          aria-label={t('grader.ai.progress', { done: c?.done ?? 0, total })}
        >
          <span className="mini-progress__fill" style={{ inlineSize: `${pct}%` }} />
        </span>
      </div>
      {/* "Off" (rare, e.g. the kill switch) may wrap; the time left is always one line. */}
      <p className={`ai-bar__meta ai-bar__line${off ? ' ai-bar__line--off' : ''}`} role={off ? 'status' : undefined}>
        {off ? offText : eta}
      </p>
      <p className="ai-bar__meta">
        {t('grader.ai.counts', { rule: c?.ruleMatched ?? 0, flagged: c?.flagged ?? 0, failed: c?.failed ?? 0 })} ·{' '}
        {t('grader.ai.agreement', { agreed: status?.agreement.agreed ?? 0, total: status?.agreement.total ?? 0 })}
      </p>
      <div className="ai-bar__actions">
        <label className="ai-blind">
          <input type="checkbox" checked={blind} onChange={(e) => onBlindChange(e.target.checked)} />
          {t('grader.ai.hideUntilDecided')}
        </label>
        <button type="button" className="small-button" onClick={() => void start()}>
          {run.kind === 'starting' ? t('grader.ai.runStarting') : t('grader.ai.run')}
        </button>
        <span role="status" className="ai-bar__run-status">
          {run.kind === 'queued' && <span className="save-chip save-chip--saved">{t('grader.ai.runQueued', { n: run.n })}</span>}
          {run.kind === 'failed' && <span className="save-chip save-chip--failed">{t('grader.ai.runFailed')}</span>}
        </span>
      </div>
    </section>
  );
}
