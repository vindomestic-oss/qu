import { api } from './client';
import type { Quiz, QuestionInput } from '../types';
import type { WithTranslationInputs } from '../i18n/contentLanguages';

export interface QuizMetaInput extends Partial<WithTranslationInputs<'title'>>, Partial<WithTranslationInputs<'description'>> {
  title: string;
  description: string;
  time_limit_seconds: number;
}

export function listQuizzes() {
  return api<{ quizzes: Quiz[] }>('/quizzes');
}

export function getQuiz(id: number) {
  return api<{ quiz: Quiz }>(`/quizzes/${id}`);
}

export function createQuiz(input: QuizMetaInput) {
  return api<{ quiz: Quiz }>('/quizzes', { method: 'POST', body: JSON.stringify(input) });
}

export function updateQuiz(id: number, input: QuizMetaInput) {
  return api<{ quiz: Quiz }>(`/quizzes/${id}`, { method: 'PUT', body: JSON.stringify(input) });
}

export function deleteQuiz(id: number) {
  return api<void>(`/quizzes/${id}`, { method: 'DELETE' });
}

export function createQuestion(quizId: number, input: QuestionInput) {
  return api<{ quiz: Quiz }>(`/quizzes/${quizId}/questions`, { method: 'POST', body: JSON.stringify(input) });
}

export function updateQuestion(questionId: number, input: QuestionInput) {
  return api<{ quiz: Quiz }>(`/questions/${questionId}`, { method: 'PUT', body: JSON.stringify(input) });
}

export function deleteQuestion(questionId: number) {
  return api<{ quiz: Quiz }>(`/questions/${questionId}`, { method: 'DELETE' });
}

export function reorderQuestions(quizId: number, orderedIds: number[]) {
  return api<{ quiz: Quiz }>(`/quizzes/${quizId}/questions/reorder`, {
    method: 'PUT',
    body: JSON.stringify({ orderedIds }),
  });
}

export function uploadQuestionImage(questionId: number, file: File) {
  const formData = new FormData();
  formData.append('image', file);
  return api<{ quiz: Quiz }>(`/questions/${questionId}/image`, { method: 'POST', body: formData });
}

export function deleteQuestionImage(questionId: number) {
  return api<{ quiz: Quiz }>(`/questions/${questionId}/image`, { method: 'DELETE' });
}
