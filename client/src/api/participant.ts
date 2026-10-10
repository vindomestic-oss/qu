import { participantApi } from './participantClient';
import type { Participant, ParticipantQuestion, QuizLanguageInfo, QuizSection, QuizSession, ResultsResponse } from '../types';
import type { WithTranslations } from '../i18n/contentLanguages';

export interface QuizMeta extends WithTranslations<'title'>, WithTranslations<'description'>, QuizLanguageInfo {
  id: number;
  title: string;
  description: string | null;
  time_limit_seconds: number;
  /** Wish 7 (S14): free-text answers may be pre-checked by an AI: show the notice, limit to 300 characters. */
  ai_grading_enabled?: boolean;
}

export function joinSession(joinCode: string, displayName: string, rejoinSecret?: string) {
  return participantApi<{ token: string; session: QuizSession; participant: Participant; rejoinSecret: string }>('/join', {
    method: 'POST',
    body: JSON.stringify({ joinCode, displayName, rejoinSecret }),
  });
}

export function getMySession() {
  return participantApi<{
    session: QuizSession;
    participant: { participantId: number; sessionId: number; displayName: string; submitted_at: string | null };
    quiz: ({ id: number; ai_grading_enabled?: boolean } & QuizLanguageInfo) | null;
  }>('/my/session');
}

export async function getMyQuiz() {
  const data = await participantApi<{
    session: QuizSession;
    quiz: QuizMeta;
    sections?: QuizSection[];
    questions: ParticipantQuestion[];
    participant: { submitted_at: string | null };
  }>('/my/quiz');
  // Rubrics arrive with S11; older servers send none.
  return { ...data, sections: data.sections ?? [] };
}

export function submitQuiz() {
  return participantApi<{ submitted_at: string }>('/my/submit', { method: 'POST' });
}

// keepalive lets a save started on pagehide (tab closed, iPad locked) still reach the server.
// lang (wish 8, S15): the language the question is shown in, for the graders' language tag.
export function submitChoiceAnswer(questionId: number, selectedChoiceIds: number[], { keepalive = false, lang }: { keepalive?: boolean; lang?: string } = {}) {
  return participantApi<{ ok: true }>(`/my/answers/${questionId}`, {
    method: 'POST',
    body: JSON.stringify({ selected_choice_ids: selectedChoiceIds, lang }),
    keepalive,
  });
}

export function submitTextAnswer(questionId: number, textAnswer: string, { keepalive = false, lang }: { keepalive?: boolean; lang?: string } = {}) {
  return participantApi<{ ok: true }>(`/my/answers/${questionId}`, {
    method: 'POST',
    body: JSON.stringify({ text_answer: textAnswer, lang }),
    keepalive,
  });
}

export function getMyResults() {
  return participantApi<ResultsResponse>('/my/results');
}
