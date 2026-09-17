import { participantApi } from './participantClient';
import type { Participant, ParticipantQuestion, QuizSession, ResultsResponse } from '../types';
import type { WithTranslations } from '../i18n/contentLanguages';

interface QuizMeta extends WithTranslations<'title'>, WithTranslations<'description'> {
  id: number;
  title: string;
  description: string | null;
  time_limit_seconds: number;
}

export function joinSession(joinCode: string, displayName: string) {
  return participantApi<{ token: string; session: QuizSession; participant: Participant }>('/join', {
    method: 'POST',
    body: JSON.stringify({ joinCode, displayName }),
  });
}

export function getMySession() {
  return participantApi<{ session: QuizSession; participant: unknown }>('/my/session');
}

export function getMyQuiz() {
  return participantApi<{ session: QuizSession; quiz: QuizMeta; questions: ParticipantQuestion[] }>('/my/quiz');
}

export function submitChoiceAnswer(questionId: number, selectedChoiceIds: number[]) {
  return participantApi<{ ok: true; isCorrect: boolean; pointsAwarded: number }>(`/my/answers/${questionId}`, {
    method: 'POST',
    body: JSON.stringify({ selected_choice_ids: selectedChoiceIds }),
  });
}

export function submitTextAnswer(questionId: number, textAnswer: string) {
  return participantApi<{ ok: true }>(`/my/answers/${questionId}`, {
    method: 'POST',
    body: JSON.stringify({ text_answer: textAnswer }),
  });
}

export function getMyResults() {
  return participantApi<ResultsResponse>('/my/results');
}
