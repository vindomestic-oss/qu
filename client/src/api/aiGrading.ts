import { api } from './client';

// Wish 7. Layer A (S13): the reference check needs no client call besides this admin action;
// S14 adds the AI configuration here.

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
