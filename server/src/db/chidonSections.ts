import type Database from 'better-sqlite3';
import type { Translations } from '../lib/questionInput';
import { CONTENT_LANGS } from '../lib/languages';
import { nowIso } from '../lib/time';
import { CHIDON_5786_TITLE, CHIDON_5787_ANFAENGER_TITLE, CHIDON_5787_FORTGESCHRITTENE_TITLE } from './quizTitles';

// Takes `db` as a parameter and never imports './index' (migrate.ts runs this while that module is
// still opening the database).

/** "True" / "False" choice labels of the Chidon 5786 true/false questions (the seed uses them too). */
export const TRUE_LABEL_TRANSLATIONS: Translations = {"de":"Wahr","ru":"Верно","lt":"Teisinga","bg":"Вярно","cs":"Pravda","es":"Verdadero","fi":"Totta","hu":"Igaz","it":"Vero","lv":"Patiess","uk":"Правда"};
export const FALSE_LABEL_TRANSLATIONS: Translations = {"de":"Falsch","ru":"Неверно","lt":"Neteisinga","bg":"Невярно","cs":"Nepravda","es":"Falso","fi":"Väärin","hu":"Hamis","it":"Falso","lv":"Aplams","uk":"Неправда"};

interface SectionPlan {
  name: string;
  translations: Translations;
  /** SQL condition on `questions` (constants only, never user input). */
  where: string;
}

interface QuizPlan {
  title: string;
  sections: SectionPlan[];
}

// The true/false rubric reads like the choice buttons the children press.
const TRUE_FALSE_BUILT: Translations = Object.fromEntries(
  (['lt', 'bg', 'cs', 'es', 'fi', 'hu', 'it', 'lv', 'uk'] as const).map((l) => [
    l,
    `${TRUE_LABEL_TRANSLATIONS[l]} / ${FALSE_LABEL_TRANSLATIONS[l]}`,
  ]),
);

const CHOICE_COUNT = '(SELECT COUNT(*) FROM choices c WHERE c.question_id = questions.id)';

/**
 * Rubrics of the seeded quizzes, matched by question structure (not by position). Chidon 5786:
 * en/de/ru/he names as specified for wish 10; the other languages use the section headings of the
 * official exam papers (quiz_docs/*.docx), so a Lithuanian participant never sees English labels.
 * The 5787 quizzes are German-only: their names live in the base column.
 */
const PLANS: QuizPlan[] = [
  {
    title: CHIDON_5786_TITLE,
    sections: [
      {
        name: 'True / False',
        translations: { de: 'Richtig / Falsch', ru: 'Верно / Неверно', he: 'נכון / לא נכון', ...TRUE_FALSE_BUILT },
        where: `type IN ('single', 'multiple') AND ${CHOICE_COUNT} = 2`,
      },
      {
        name: 'Multiple choice',
        translations: {
          de: 'Multiple Choice',
          ru: 'Выбор ответа',
          he: 'בחירה מרובה',
          bg: 'Въпроси с избираем отговор',
          cs: 'Otázky s výběrem z více možností',
          es: 'Preguntas de Selección Múltiple',
          fi: 'Monivalintakysymykset',
          hu: 'Feleletválasztós kérdések',
          it: 'Domande a Scelta Multipla',
          lt: 'Klausimai su pasirenkamais atsakymais',
          lv: 'Jautājumi ar izvēles variantiem',
          uk: 'Запитання з множинним вибором',
        },
        where: `type IN ('single', 'multiple') AND ${CHOICE_COUNT} >= 3`,
      },
      {
        name: 'Open questions',
        translations: {
          de: 'Offene Fragen',
          ru: 'Открытые вопросы',
          he: 'שאלות פתוחות',
          bg: 'Отворени въпроси',
          cs: 'Otevřené otázky',
          es: 'Preguntas Abiertas',
          fi: 'Avoimet kysymykset',
          hu: 'Nyílt kérdések',
          it: 'Domande Aperte',
          lt: 'Atviri klausimai',
          lv: 'Atvērtie jautājumi',
          uk: 'Відкриті запитання',
        },
        where: `type = 'text' AND image_path IS NULL`,
      },
      {
        name: 'Picture questions',
        translations: {
          de: 'Bildfragen',
          ru: 'Вопросы по картинке',
          he: 'שאלות על תמונה',
          bg: 'Въпроси с илюстрации',
          cs: 'Otázky s ilustracemi',
          es: 'Preguntas con Imágenes',
          fi: 'Kuvakysymykset',
          hu: 'Képes kérdések',
          it: 'Domande con Illustrazioni',
          lt: 'Klausimai su iliustracijomis',
          lv: 'Jautājumi ar ilustrācijām',
          uk: 'Запитання з ілюстраціями',
        },
        where: `type = 'text' AND image_path IS NOT NULL`,
      },
    ],
  },
  ...[CHIDON_5787_ANFAENGER_TITLE, CHIDON_5787_FORTGESCHRITTENE_TITLE].map((title) => ({
    title,
    sections: [
      { name: 'Teil A: Single-Choice-Fragen', translations: {}, where: `type IN ('single', 'multiple')` },
      { name: 'Teil B: Offene Fragen', translations: {}, where: `type = 'text'` },
    ],
  })),
];

/**
 * Gives the seeded Chidon quizzes their rubrics: Chidon 5786 four (5 / 15 / 10 / 20 questions), each
 * 5787 quiz two (20 / 10). The seeded quiz is the oldest one with the exact title (a later copy or
 * re-import under the same title is the author's own and gets nothing). It is skipped when it
 * already has any rubric, so every later boot is a no-op and rubrics an author edited are never
 * touched; an author who deletes all of them gets them back on the next boot (documented, and the
 * editor says so before the last one is deleted). Runs at the end of runMigrations() and of the
 * seed: on a fresh database the quizzes exist only after the seed.
 */
export function backfillSeededSections(db: Database.Database): void {
  const nameColumns = CONTENT_LANGS.map((l) => `name_${l}`);
  const insertSection = db.prepare(
    `INSERT INTO quiz_sections (quiz_id, name, ${nameColumns.join(', ')}, sort_order, created_at)
     VALUES (${['?', '?', ...nameColumns.map(() => '?'), '?', '?'].join(', ')})`,
  );
  const hasSections = db.prepare('SELECT 1 FROM quiz_sections WHERE quiz_id = ? LIMIT 1');

  for (const plan of PLANS) {
    const quizId = seededQuizId(db, plan.title);
    if (quizId !== null && !hasSections.get(quizId)) {
      const counts = db.transaction(() => {
        const createdAt = nowIso();
        return plan.sections.map((s, i) => {
          const sectionId = Number(
            insertSection.run(quizId, s.name, ...CONTENT_LANGS.map((l) => s.translations[l] ?? null), i, createdAt)
              .lastInsertRowid,
          );
          return db
            .prepare(`UPDATE questions SET section_id = ? WHERE quiz_id = ? AND section_id IS NULL AND (${s.where})`)
            .run(sectionId, quizId).changes;
        });
      })();
      console.log(`Rubrics added to "${plan.title}" (id ${quizId}): ${counts.join(' / ')} questions.`);
    }
  }
}

/** The seeded quiz with this title: the oldest one (MIN(id)), or null. */
function seededQuizId(db: Database.Database, title: string): number | null {
  const row = db.prepare('SELECT MIN(id) AS id FROM quizzes WHERE title = ?').get(title) as { id: number | null };
  return row.id;
}

/** True for the seeded Chidon quizzes whose rubrics come back on the next boot once all are deleted. */
export function hasSeededRubrics(db: Database.Database, quiz: { id: number; title?: unknown }): boolean {
  const title = quiz.title;
  return typeof title === 'string' && PLANS.some((p) => p.title === title) && seededQuizId(db, title) === quiz.id;
}
