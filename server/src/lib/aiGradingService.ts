import { db } from '../db';
import { broadcastGradingChanged } from '../socket';
import { onSessionEnded } from './sessions';
import { aiBootLine, aiEnv } from './aiGrading/config';
import { createAiWorker, type AiChange } from './aiGrading/worker';
import { createGeminiProvider } from './aiGrading/providers/gemini';
import { createFakeProvider } from './aiGrading/providers/fake';
import type { GradeProvider } from './aiGrading/providers/types';
import { queueParticipant, queueSession, recoverRunning, requeueQuestionForAi, unqueueQuiz, type QueueOutcome } from './aiGrading/queue';
import { purgeAiData } from './aiGrading/retention';

// Wish 7, layer B (S14): the process-wide AI worker and its triggers, next to the reference check's
// triggers (autoCheck.ts): "Finish and submit", the end of a session, the panel's "Run AI pre-check",
// a changed question key and the quiz's switch. AI events go only to the staff room
// ('grading:changed' with kind 'ai'); nothing AI-related is ever sent to participants.

let providerOverride: GradeProvider | null = null;

/** Tests: a spy or fake instead of the configured provider (null restores it). */
export function setAiProviderForTests(p: GradeProvider | null): void {
  providerOverride = p;
}

/** The configured provider, created per call from the environment (the key is never stored elsewhere). */
function currentProvider(): GradeProvider {
  if (providerOverride) return providerOverride;
  const env = aiEnv();
  if (env.provider === 'fake') {
    const latency = Number(process.env.AI_FAKE_LATENCY_MS);
    return createFakeProvider({ latencyMs: Number.isFinite(latency) && latency > 0 ? Math.min(latency, 10_000) : 0 });
  }
  return createGeminiProvider({
    apiKey: (process.env.GEMINI_API_KEY ?? '').trim(),
    model: env.model,
    endpoint: env.endpoint,
    timeoutMs: env.timeoutMs,
  });
}

function broadcastAi(bySession: Map<number, AiChange>): void {
  for (const [sessionId, change] of bySession) {
    broadcastGradingChanged(sessionId, { kind: 'ai', answerIds: change.answerIds, questionIds: change.questionIds });
  }
}

export const aiWorker = createAiWorker({ db, provider: currentProvider, onChanged: broadcastAi });

/** Notifies the staff room about answers whose suggestion state changed, and wakes the worker. */
function afterQueue(out: QueueOutcome | Map<number, number[]>): void {
  const bySession = out instanceof Map ? out : out.bySession;
  for (const [sessionId, answerIds] of bySession) {
    if (answerIds.length > 0) broadcastGradingChanged(sessionId, { kind: 'ai', answerIds });
  }
  if (!(out instanceof Map) && out.queued.length > 0) aiWorker.kick();
}

/** After "Finish and submit" (after the reference check). */
export function aiAfterSubmit(participantId: number): void {
  afterQueue(queueParticipant(db, participantId));
}

/** After a question's model answer, accepted answers, notes or points changed. */
export function aiAfterQuestionChange(questionId: number): void {
  afterQueue(requeueQuestionForAi(db, questionId));
}

/** After the quiz's AI switch changed: off empties its queue at once. */
export function aiAfterQuizSwitch(quizId: number, enabled: boolean): void {
  if (!enabled) afterQueue(unqueueQuiz(db, quizId));
}

/** The panel's "Run AI pre-check" (and Retry; admins only): queues what is eligible, failed ones included on request. */
export function aiRunSession(sessionId: number, opts: { questionId?: number; includeFailed?: boolean }): QueueOutcome {
  const out = queueSession(db, sessionId, opts);
  afterQueue(out);
  return out;
}

let registered = false;

/** The session-end trigger, registered once per process after the reference check's (createApp). */
export function registerAiGrading(): void {
  if (registered) return;
  registered = true;
  onSessionEnded((sessionId) => afterQueue(queueSession(db, sessionId)));
}

const TICK_MS = 3_000;
const RETENTION_MS = 24 * 60 * 60 * 1000;

/** Boot (index.ts, after initSocket): recover, one log line, the 3 s tick and the daily purge. */
export function startAiGrading(): void {
  const recovered = recoverRunning(db);
  console.log(aiBootLine(db) + (recovered > 0 ? ` · ${recovered} interrupted answers queued again` : ''));
  const purge = () => {
    try {
      const n = purgeAiData(db);
      if (n.runs + n.answers > 0) {
        console.log(`AI grading: retention: ${n.runs} runs deleted, AI texts cleared on ${n.answers} answers (older than 180 days)`);
      }
    } catch (err) {
      console.error('AI grading: purge failed:', err instanceof Error ? err.message : err);
    }
  };
  purge();
  setInterval(purge, RETENTION_MS).unref();
  setInterval(() => aiWorker.tick(), TICK_MS).unref();
  aiWorker.kick();
}
