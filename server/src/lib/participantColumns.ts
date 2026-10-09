import { translationColumns } from './sqlTranslations';

/** Question columns a participant may receive. Never: reference_answer, accepted_answers,
 *  grader_notes, ai_*, grade_*. */
export const PARTICIPANT_QUESTION_COLUMNS: readonly string[] = [
  'id',
  'quiz_id',
  'sort_order',
  'type',
  'text',
  ...translationColumns('text'),
  'image_path',
  'points',
];
/** Choice columns during the quiz: no is_correct. */
export const PARTICIPANT_CHOICE_COLUMNS: readonly string[] = ['id', 'question_id', 'text', ...translationColumns('text'), 'sort_order'];
/** Choice columns on /my/results, which answers only after the session has ended. */
export const RESULTS_CHOICE_COLUMNS: readonly string[] = [...PARTICIPANT_CHOICE_COLUMNS, 'is_correct'];
