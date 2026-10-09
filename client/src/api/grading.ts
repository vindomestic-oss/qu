import { api, ApiError } from './client';
import { staffApi } from './graderClient';
import type {
  AiSuggestionFields,
  AnswerGrade,
  GraderLink,
  GradingSummary,
  ParticipantReviewResponse,
  WholeQuizResponse,
} from '../types';

// Grading panel API (wish 8). Grading calls go through staffApi (admin or grader token for the
// session); grader links are admin-only.

export async function exchangeGraderCode(code: string, name: string) {
  const res = await fetch('/api/grader/exchange', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, name }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error || 'Request failed', data.code);
  return data as { token: string; session_id: number; quiz_title: string; expires_at: string };
}

export function getGradingSummary(sessionId: number) {
  return staffApi<GradingSummary>(sessionId, '/summary');
}

export function getParticipantReview(sessionId: number, participantId: number) {
  return staffApi<ParticipantReviewResponse>(sessionId, `/participants/${participantId}`);
}

export function getWholeQuiz(sessionId: number, filter: 'needs_review' | 'all') {
  return staffApi<WholeQuizResponse>(sessionId, `/quiz?filter=${filter}`);
}

/** The current grade (and AI suggestion, wish 7) of a few answers (after grading:changed). */
export function getAnswerGrades(sessionId: number, ids: number[]) {
  return staffApi<{ answers: (AnswerGrade & Partial<AiSuggestionFields>)[] }>(sessionId, `/answers?ids=${ids.join(',')}`);
}

export interface GradeInput {
  is_correct: boolean;
  points_awarded: number;
  /** The grade_version the grader saw; a newer grade answers 409 'conflict' with `current`. */
  expected_version: number;
  /** Wish 7 (S14): 'ai' = accepting the AI suggestion (stored as 'ai_confirmed' when it is confident-correct). */
  source?: 'ai' | 'human';
}

export function gradeAnswer(sessionId: number, answerId: number, input: GradeInput) {
  return staffApi<{ answer: AnswerGrade }>(sessionId, `/answers/${answerId}`, {
    method: 'PUT',
    body: JSON.stringify(input),
  });
}

export function bulkGrade(
  sessionId: number,
  input: { items: { answer_id: number; expected_version: number }[]; is_correct: boolean; points_awarded: number; source?: 'ai' | 'human' },
) {
  return staffApi<{ results: { id: number; ok: boolean; error?: string; current?: AnswerGrade; answer?: AnswerGrade }[] }>(
    sessionId,
    '/answers/bulk-grade',
    { method: 'POST', body: JSON.stringify(input) },
  );
}

// --- Grader links (admin) ---

export function createGraderLink(sessionId: number, input: { label?: string; expires_in_days: 1 | 7 | 30 }) {
  return api<{ link: GraderLink; code: string; url: string }>(`/sessions/${sessionId}/grader-links`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function listGraderLinks(sessionId: number) {
  return api<{ links: GraderLink[] }>(`/sessions/${sessionId}/grader-links`);
}

export function revokeGraderLink(sessionId: number, linkId: number) {
  return api<{ link: GraderLink }>(`/sessions/${sessionId}/grader-links/${linkId}`, { method: 'DELETE' });
}
