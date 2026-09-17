import { api } from './client';
import type { QuizSession, SessionResultsResponse, SessionAnswer, LiveStatusResponse } from '../types';

export function createOrGetSession(quizId: number) {
  return api<{ session: QuizSession }>(`/quizzes/${quizId}/sessions`, { method: 'POST' });
}

export function listSessions(quizId: number) {
  return api<{ sessions: QuizSession[] }>(`/quizzes/${quizId}/sessions`);
}

export function getSession(sessionId: number) {
  return api<{ session: QuizSession }>(`/sessions/${sessionId}`);
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
  return api<LiveStatusResponse>(`/sessions/${sessionId}/live`);
}

export function gradeAnswer(sessionId: number, answerId: number, pointsAwarded: number) {
  return api<{ answer: SessionAnswer }>(`/sessions/${sessionId}/answers/${answerId}/grade`, {
    method: 'PUT',
    body: JSON.stringify({ points_awarded: pointsAwarded }),
  });
}
