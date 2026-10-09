import type { ParticipantQuestion } from '../types';

/**
 * "Answered" = saved on the server: same rule as the server's ANSWERED fragment (lib/grading.ts).
 * myAnswer.text_answer holds only the saved text, never the draft being typed.
 */
export function isAnswered(q: ParticipantQuestion): boolean {
  if (q.type === 'text') return (q.myAnswer?.text_answer ?? '').trim() !== '';
  return (q.myAnswer?.selected_choice_ids.length ?? 0) > 0;
}
