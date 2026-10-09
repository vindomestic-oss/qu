import { db } from '../db';
import { broadcastGradingChanged, broadcastLiveUpdate } from '../socket';
import { onSessionEnded } from './sessions';
import { enqueueParticipant, enqueueSession } from './aiGrading/process';

// The triggers of the reference check (wish 7, S13): "Finish and submit" and the end of a session
// (which submits everyone). A question edit re-checks inside its own transaction (questionWrite.ts).

/** Rule grades reach the staff screens like any other grade (never the participants' room). */
export function notifyRuleGrades(sessionId: number, answerIds: number[]): void {
  if (answerIds.length === 0) return;
  broadcastLiveUpdate(sessionId);
  broadcastGradingChanged(sessionId, { kind: 'rule', answerIds });
}

/** After a participant's submit has been committed. */
export function autoCheckParticipant(sessionId: number, participantId: number): void {
  notifyRuleGrades(sessionId, enqueueParticipant(db, participantId));
}

let registered = false;

/** Registers the session-end trigger once per process (createApp may run more than once in tests). */
export function registerAutoCheck(): void {
  if (registered) return;
  registered = true;
  onSessionEnded((sessionId) => notifyRuleGrades(sessionId, enqueueSession(db, sessionId)));
}
