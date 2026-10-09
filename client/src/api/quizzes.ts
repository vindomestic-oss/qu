import { api } from './client';
import type { Quiz, QuestionInput, SectionInput } from '../types';
import type { QuizLang, WithTranslationInputs } from '../i18n/contentLanguages';

export interface QuizMetaInput extends Partial<WithTranslationInputs<'title'>>, Partial<WithTranslationInputs<'description'>> {
  title: string;
  description: string;
  time_limit_seconds: number;
  base_language?: QuizLang;
  /** Points a new question starts with; omitted = keep. */
  default_points?: number;
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

/** Declares the quiz's languages ("+ Add language" / "×"). Never changes any text. */
export function setQuizLanguages(quizId: number, content_languages: QuizLang[]) {
  return api<{ quiz: Quiz }>(`/quizzes/${quizId}/languages`, { method: 'PUT', body: JSON.stringify({ content_languages }) });
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

// Rubrics (wish 10). Every call answers with the whole quiz, like the question calls.
export function createSection(quizId: number, input: SectionInput) {
  return api<{ quiz: Quiz }>(`/quizzes/${quizId}/sections`, { method: 'POST', body: JSON.stringify(input) });
}

export function updateSection(sectionId: number, input: SectionInput) {
  return api<{ quiz: Quiz }>(`/sections/${sectionId}`, { method: 'PUT', body: JSON.stringify(input) });
}

export function deleteSection(sectionId: number) {
  return api<{ quiz: Quiz }>(`/sections/${sectionId}`, { method: 'DELETE' });
}

export function reorderSections(quizId: number, orderedIds: number[]) {
  return api<{ quiz: Quiz }>(`/quizzes/${quizId}/sections/reorder`, { method: 'PUT', body: JSON.stringify({ orderedIds }) });
}
