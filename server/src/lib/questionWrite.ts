import type Database from 'better-sqlite3';
import type { QuestionInput } from './questionInput';
import { translationColumns, translationValues } from './sqlTranslations';
import { gradeChoiceAnswer, insertGradeEvent } from './grading';
import { SECTION_NOT_IN_QUIZ, sectionBelongsToQuiz } from './sections';

// Imports only better-sqlite3 types and lib modules, never '../db' (that module opens quiz.db on import).

/** A rejected write; the route answers `status` with `body`. Nothing was changed. */
export class QuestionWriteError extends Error {
  status: number;
  body: { error: string; code?: string };

  constructor(status: number, error: string, code?: string) {
    super(error);
    this.status = status;
    this.body = code ? { error, code } : { error };
  }
}

/** Shown as is by editors from before stable choice ids, which display the `error` string. */
export const STALE_EDITOR_MESSAGE = 'This editor is out of date. Reload the page and edit again.';

export interface QuestionWriteResult {
  quizId: number;
  /** Answers whose grade changed because points or the correct choices changed, grouped by session
   *  (for live and grading notifications after the commit). */
  regradedBySession: Map<number, number[]>;
}

interface AnswerGradeRow {
  id: number;
  session_id: number;
  selected_choice_ids: string | null;
  is_correct: number | null;
  points_awarded: number | null;
  grade_source: string | null;
}

const samePoints = (a: number | null, b: number | null) =>
  a === b || (a !== null && b !== null && Math.abs(a - b) < 1e-9);

function parseSelected(raw: string | null): number[] {
  try {
    const v = raw ? JSON.parse(raw) : [];
    return Array.isArray(v) ? v.filter((id): id is number => typeof id === 'number') : [];
  } catch {
    return [];
  }
}

/**
 * Saves an edited question in one transaction. Choices are matched by id, so answers saved during a
 * live session keep pointing at the right choices: a sent id updates that choice in place (text,
 * translations, correctness, position), a choice without id is inserted, and choices of the
 * question whose id was not sent are deleted. Never touches quizzes.content_languages.
 *
 * The rubric (section_id) changes only when the key was sent: null clears it, an id must be a rubric
 * of the same quiz.
 *
 * Throws QuestionWriteError: 404 when the question does not exist; 400 when a sent id belongs to
 * another question or a sent rubric to another quiz; 409 `has_answers` when the type changes between text and choice while answers
 * exist; 409 with code `stale_editor` when a choice question with answers gets choices none of which has an id
 * (an editor from before stable ids would otherwise replace every choice the answers point at).
 * When the points or the set of correct choices change, the question's answers are re-graded in the
 * same transaction (wish 8): automatic grades are recomputed, except answers that selected a choice
 * which no longer exists (kept as graded); human grades that had full points move to the new
 * maximum, other human grades are clamped to it, and a grade at the maximum counts as correct.
 * Every grade it changes gets a grade_events row ('regrade_points') in the same transaction.
 * Model-answer fields (wish 8) apply to text questions only and are cleared for choice types.
 */
export function updateQuestionWithChoices(
  db: Database.Database,
  questionId: number,
  parsed: QuestionInput,
  /** Who saved the question, for the grade_events rows of a regrade (e.g. 'admin:alex'). */
  actor: string | null = null,
): QuestionWriteResult {
  const run = db.transaction((): QuestionWriteResult => {
    const question = db.prepare('SELECT id, quiz_id, type, points FROM questions WHERE id = ?').get(questionId) as
      | { id: number; quiz_id: number; type: string; points: number }
      | undefined;
    if (!question) throw new QuestionWriteError(404, 'Question not found');

    const wasText = question.type === 'text';
    const isText = parsed.type === 'text';
    const hasAnswers = Boolean(db.prepare('SELECT 1 FROM answers WHERE question_id = ? LIMIT 1').get(questionId));
    if (wasText !== isText && hasAnswers) {
      throw new QuestionWriteError(409, 'has_answers');
    }
    if (!wasText && !isText && hasAnswers && parsed.choices.every((c) => c.id === null)) {
      throw new QuestionWriteError(409, STALE_EDITOR_MESSAGE, 'stale_editor');
    }

    if (parsed.section_id != null && !sectionBelongsToQuiz(db, parsed.section_id, question.quiz_id)) {
      throw new QuestionWriteError(400, SECTION_NOT_IN_QUIZ);
    }
    const sendsSection = parsed.section_id !== undefined;

    const correctIds = () =>
      (db.prepare('SELECT id FROM choices WHERE question_id = ? AND is_correct = 1 ORDER BY id').all(questionId) as { id: number }[])
        .map((c) => c.id)
        .join(',');
    const correctBefore = correctIds();

    const setClauses = [
      'type = ?',
      'text = ?',
      ...translationColumns('text').map((c) => `${c} = ?`),
      'points = ?',
      ...(sendsSection ? ['section_id = ?'] : []),
    ];
    const graderValues: (string | null)[] = [];
    if (isText) {
      // A grader field that was not sent keeps its stored value; a cleared one is stored as ''.
      for (const key of ['reference_answer', 'grader_notes'] as const) {
        if (parsed[key] === undefined) continue;
        setClauses.push(`${key} = ?`);
        graderValues.push(parsed[key]!);
      }
    } else {
      // Model answers belong to text questions only.
      setClauses.push('reference_answer = NULL', 'accepted_answers = NULL', 'grader_notes = NULL');
    }
    db.prepare(`UPDATE questions SET ${setClauses.join(', ')} WHERE id = ?`).run(
      parsed.type,
      parsed.text,
      ...translationValues(parsed.translations),
      parsed.points,
      ...(sendsSection ? [parsed.section_id ?? null] : []),
      ...graderValues,
      questionId,
    );

    const existing = new Set(
      (db.prepare('SELECT id FROM choices WHERE question_id = ?').all(questionId) as { id: number }[]).map((c) => c.id),
    );
    const updateChoice = db.prepare(
      `UPDATE choices SET text = ?, ${translationColumns('text').map((c) => `${c} = ?`).join(', ')}, is_correct = ?, sort_order = ?
       WHERE id = ? AND question_id = ?`,
    );
    const choiceColumns = ['question_id', 'text', ...translationColumns('text'), 'is_correct', 'sort_order'];
    const insertChoice = db.prepare(
      `INSERT INTO choices (${choiceColumns.join(', ')}) VALUES (${choiceColumns.map(() => '?').join(', ')})`,
    );
    const kept: number[] = [];
    parsed.choices.forEach((c, i) => {
      const values = [c.text, ...translationValues(c.translations), c.is_correct ? 1 : 0, i];
      if (c.id !== null) {
        if (!existing.has(c.id)) throw new QuestionWriteError(400, 'choice id does not belong to this question');
        updateChoice.run(...values, c.id, questionId);
        kept.push(c.id);
      } else {
        kept.push(Number(insertChoice.run(questionId, ...values).lastInsertRowid));
      }
    });
    if (kept.length === 0) {
      db.prepare('DELETE FROM choices WHERE question_id = ?').run(questionId);
    } else {
      db.prepare(`DELETE FROM choices WHERE question_id = ? AND id NOT IN (${kept.map(() => '?').join(', ')})`).run(
        questionId,
        ...kept,
      );
    }

    const result: QuestionWriteResult = { quizId: question.quiz_id, regradedBySession: new Map() };
    const pointsChanged = !samePoints(question.points, parsed.points);
    if (!pointsChanged && correctIds() === correctBefore) return result;

    const choices = isText
      ? []
      : (db.prepare('SELECT id, is_correct FROM choices WHERE question_id = ?').all(questionId) as { id: number; is_correct: number }[]);
    const choiceIds = new Set(choices.map((c) => c.id));
    const answers = db
      .prepare(
        'SELECT id, session_id, selected_choice_ids, is_correct, points_awarded, grade_source FROM answers WHERE question_id = ?',
      )
      .all(questionId) as AnswerGradeRow[];
    const setGrade = db.prepare(
      'UPDATE answers SET is_correct = ?, points_awarded = ?, grade_version = grade_version + 1 WHERE id = ?',
    );
    for (const a of answers) {
      let next: { isCorrect: number | null; points: number | null } | null = null;
      if (a.grade_source === 'auto_choice' || a.grade_source === 'rule') {
        if (!isText) {
          const selected = parseSelected(a.selected_choice_ids);
          // An answer whose choice was deleted cannot be graded against the new key: keep its grade.
          if (selected.some((id) => !choiceIds.has(id))) continue;
          const g = gradeChoiceAnswer(choices, selected, parsed.points);
          next = { isCorrect: g.isCorrect ? 1 : 0, points: g.pointsAwarded };
        } else if (a.points_awarded !== null) {
          next = { isCorrect: a.is_correct, points: a.is_correct === 1 ? parsed.points : 0 };
        }
      } else if (a.grade_source !== 'auto_blank' && a.points_awarded !== null) {
        // Human (or later AI-confirmed) grades: a full-points correct grade follows the new maximum,
        // any other grade is only clamped to it. A grade at the maximum is correct, as in the grade route.
        const wasFull = a.is_correct === 1 && samePoints(a.points_awarded, question.points);
        const points = wasFull ? parsed.points : Math.min(a.points_awarded, parsed.points);
        next = { isCorrect: points >= parsed.points - 1e-9 ? 1 : a.is_correct, points };
      }
      if (!next || (next.isCorrect === a.is_correct && samePoints(next.points, a.points_awarded))) continue;
      setGrade.run(next.isCorrect, next.points, a.id);
      insertGradeEvent(db, {
        answerId: a.id,
        sessionId: a.session_id,
        actor,
        action: 'regrade_points',
        oldPoints: a.points_awarded,
        newPoints: next.points,
        isCorrect: next.isCorrect,
        gradeSource: a.grade_source,
      });
      const ids = result.regradedBySession.get(a.session_id) ?? [];
      ids.push(a.id);
      result.regradedBySession.set(a.session_id, ids);
    }
    return result;
  });
  return run();
}
