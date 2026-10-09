import { api } from './client';
import type { QuizSession, SessionResultsResponse, LiveStatusResponse, SessionQuizMeta } from '../types';

export function createOrGetSession(quizId: number) {
  return api<{ session: QuizSession }>(`/quizzes/${quizId}/sessions`, { method: 'POST' });
}

export function listSessions(quizId: number) {
  return api<{ sessions: QuizSession[] }>(`/quizzes/${quizId}/sessions`);
}

export function getSession(sessionId: number, { background = false }: { background?: boolean } = {}) {
  return api<{ session: QuizSession; quiz: SessionQuizMeta }>(`/sessions/${sessionId}`, { background });
}

export function setJoiningLocked(sessionId: number, locked: boolean) {
  return api<{ session: QuizSession }>(`/sessions/${sessionId}/joining`, { method: 'PUT', body: JSON.stringify({ locked }) });
}

export function startSession(sessionId: number) {
  return api<{ session: QuizSession }>(`/sessions/${sessionId}/start`, { method: 'PUT' });
}

export function endSession(sessionId: number) {
  return api<{ session: QuizSession }>(`/sessions/${sessionId}/end`, { method: 'PUT' });
}

export function getSessionResults(sessionId: number) {
  return api<SessionResultsResponse>(`/sessions/${sessionId}/results`);
}

export function getLiveStatus(sessionId: number) {
  return api<LiveStatusResponse>(`/sessions/${sessionId}/live`, { background: true });
}

/** S15: a participant who pressed Finish can answer again while the session runs. */
export function reopenSubmission(sessionId: number, participantId: number) {
  return api<{ participant: { id: number; submitted_at: null; submit_source: null }; reopened: boolean }>(
    `/sessions/${sessionId}/participants/${participantId}/reopen`,
    { method: 'POST' },
  );
}

export function allowRejoin(sessionId: number, participantId: number) {
  return api<{ ok: true }>(`/sessions/${sessionId}/participants/${participantId}/allow-rejoin`, { method: 'PUT' });
}
