import { useEffect, useState } from 'react';
import { getAiConfig, setAiKillSwitch } from '../../api/aiGrading';
import type { AiConfig, Question } from '../../types';
import { parseAccepted } from '../../lib/acceptedAnswers';
import './aiAdmin.css';

// Wish 7, layer B (S14): the quiz editor's "AI suggestions for free-text answers" switch, the
// server's AI status line and the kill switch. Admin UI, English. The switch is saved with "Save
// quiz details"; the kill switch applies at once to every quiz.

const REASONS: Record<string, string> = {
  off: 'AI_GRADING_ENABLED is not set on the server',
  kill_switch: 'stopped with the kill switch',
  no_key: 'GEMINI_API_KEY is missing',
  unknown_provider: 'unknown AI_GRADING_PROVIDER',
  fake_in_production: 'the test provider is refused in production',
  insecure_endpoint: 'GEMINI_ENDPOINT must be https',
  auth: 'the provider rejected the key (restart after fixing it)',
  config: 'the provider does not know the model or endpoint (restart after fixing it)',
};

export function AiQuizSettings({ checked, onChange }: { checked: boolean; onChange: (on: boolean) => void }) {
  const [config, setConfig] = useState<AiConfig | null>(null);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getAiConfig()
      .then(setConfig)
      .catch(() => setError(true));
  }, []);

  async function toggleKill() {
    if (!config || busy) return;
    const engage = !config.killSwitch.engaged;
    if (engage && !confirm('Stop all AI calls now, for every quiz? Answers already checked keep their suggestions.')) return;
    setBusy(true);
    try {
      setConfig(await setAiKillSwitch(engage));
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  const status = !config
    ? error
      ? 'AI status could not be loaded.'
      : 'Loading AI status…'
    : config.modelCallsEnabled
      ? `AI ready · ${config.provider} / ${config.model} · ${config.callsLast24h} of ${config.maxCallsPerDay} calls in the last 24 h`
      : `AI not configured — only exact matches with the reference are auto-checked (${REASONS[config.disabledReason ?? ''] ?? config.disabledReason}).`;

  return (
    <div className="ai-settings">
      <label className="ai-settings__switch">
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        AI suggestions for free-text answers
      </label>
      <p className="ai-settings__hint">
        Only with the DPO&apos;s written approval. Participants see a notice and text answers are limited to 300 characters; the AI only
        suggests, a person grades. Saved with &quot;Save quiz details&quot;.
      </p>
      <div className="ai-settings__row">
        <p className={`ai-settings__status${config?.modelCallsEnabled ? ' ai-settings__status--ready' : ''}`} role="status">
          {status}
        </p>
        {config && (config.enabled || config.killSwitch.engaged) && (
          <button type="button" className="ai-settings__kill" onClick={() => void toggleKill()} disabled={busy}>
            {config.killSwitch.engaged ? 'Resume AI calls' : 'Stop all AI calls (kill switch)'}
          </button>
        )}
      </div>
    </div>
  );
}

/** Under a text question in the list: "reference ✓", or (AI quizzes) "⚠ no reference answer — AI skips this question". */
export function AiReferenceTag({ question, aiEnabled }: { question: Question; aiEnabled: boolean }) {
  if (question.type !== 'text') return null;
  const hasReference = Boolean(question.reference_answer?.trim()) || parseAccepted(question.accepted_answers).length > 0;
  if (hasReference) return <small className="ai-ref-tag">reference ✓</small>;
  if (!aiEnabled) return null;
  return (
    <small className="ai-ref-tag ai-ref-tag--missing">
      <span aria-hidden="true">⚠ </span>no reference answer — AI skips this question
    </small>
  );
}
