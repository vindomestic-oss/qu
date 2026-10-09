import { api } from './client';
import { staffApi } from './graderClient';
import type { AiConfig, AiGradingStatus, AnswerGrade } from '../types';

// Wish 7. Layer A (S13): the reference check needs no client call besides this admin action.
// Layer B (S14): the AI configuration and kill switch (admin), and the panel's AI calls (staff).

/**
 * Admin only: adds a participant's answer (its trimmed text) to the question's accepted answers and
 * re-checks the question's answers in every run (grades by people stay). `added: false` when the
 * model answer or an accepted answer already matches it.
 */
export function addAcceptedAnswer(questionId: number, answerId: number) {
  return api<{ accepted_answers: string[]; added: boolean; regraded: number }>(`/questions/${questionId}/accepted-answers`, {
    method: 'POST',
    body: JSON.stringify({ answerId }),
  });
}

// --- Layer B (S14): AI suggestions ------------------------------------------------------------

/** Admin: the server's AI configuration (provider, model, why it is off); never the key. */
export function getAiConfig() {
  return api<AiConfig>('/ai-grading/config');
}

/** Admin: the kill switch. Engaged = no answer is sent to the AI provider, until released. */
export function setAiKillSwitch(engaged: boolean) {
  return api<AiConfig>('/ai-grading/kill-switch', { method: 'PUT', body: JSON.stringify({ engaged }) });
}

/** Staff: progress, counts and agreement of the AI suggestions in this session. */
export function getAiStatus(sessionId: number) {
  return staffApi<AiGradingStatus>(sessionId, '/ai/status');
}

/** Staff: "Run AI pre-check" (and Retry, with includeFailed): the reference check, then the AI queue. */
export function runAi(sessionId: number, opts: { questionId?: number; includeFailed?: boolean } = {}) {
  return staffApi<{ ruleMatched: number; queued: number; skipped: number; modelCallsEnabled: boolean; disabledReason: string | null }>(
    sessionId,
    '/ai/run',
    { method: 'POST', body: JSON.stringify(opts) },
  );
}

/** Staff: "Accept all confident-correct" of one question, exactly the listed rows (each re-checked). */
export function acceptAiCorrect(sessionId: number, questionId: number, items: { answer_id: number; expected_version: number }[]) {
  return staffApi<{ results: { id: number; ok: boolean; error?: 'conflict' | 'not_eligible'; answer?: AnswerGrade; current?: AnswerGrade }[] }>(
    sessionId,
    '/ai/accept-correct',
    { method: 'POST', body: JSON.stringify({ questionId, items }) },
  );
}
