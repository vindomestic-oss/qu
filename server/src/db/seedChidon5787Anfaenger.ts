import { db } from './index';
import { computeUsedLanguages } from '../lib/quizLanguages';
import { answerKeyFor, CHIDON_5787_ANFAENGER_KEY, type AnswerKeyEntry } from './chidonAnswerKey';
import { CHIDON_5787_ANFAENGER_TITLE } from './quizTitles';

const QUIZ_TITLE = CHIDON_5787_ANFAENGER_TITLE;

type ChoiceSpec = { text: string; isCorrect: boolean };
type GraderKey = Pick<AnswerKeyEntry, 'reference' | 'accepted' | 'notes'>;
type QuestionSpec = { type: 'single' | 'text'; text: string; points: number; choices: ChoiceSpec[]; key?: GraderKey };

function mc(text: string, options: string[], correctIndex: number): QuestionSpec {
  return {
    type: 'single',
    text,
    points: 1,
    choices: options.map((o, i) => ({ text: o, isCorrect: i === correctIndex })),
  };
}

// The 2nd parameter is the graders' model answer; by default it comes from chidonAnswerKey.ts (same text).
function open(text: string, key: GraderKey | undefined = answerKeyFor(CHIDON_5787_ANFAENGER_KEY, text)): QuestionSpec {
  return { type: 'text', text, points: 1, choices: [], key };
}

const QUESTIONS: QuestionSpec[] = [
  // --- Teil A: Single-Choice-Fragen (Sefer Bereschit) ---
  mc('Wer lebte als Erstes im Garten Eden?', ['Noach und seine Frau', 'Adam und Chawa', 'Awraham und Sara', 'Jaakow und Rachel'], 1),
  mc('Was taten Adam und Chawa, obwohl G-tt es verboten hatte?', ['Sie verließen den Garten Eden', 'Sie fällten einen Baum', 'Sie aßen von der Frucht des verbotenen Baumes', 'Sie töteten die Schlange'], 2),
  mc('Welche Strafe erhielt die Schlange?', ['Sie sollte auf dem Bauch kriechen und Staub fressen', 'Sie verlor ihre Stimme', 'Sie wurde aus dem Garten in das Meer verbannt', 'Sie musste für immer in einer Höhle leben'], 0),
  mc('Welche Tiere nahm Noach mit in die Arche?', ['Nur Vögel', 'Nur Haustiere', 'Nur die Fische', 'Von allen Tierarten'], 3),
  mc('Wie hießen die drei Söhne Noachs?', ['Kain, Hewel und Schet', 'Schem, Cham und Jefet', 'Awram, Nachor und Haran', 'Reuwen, Schimon und Lewi'], 1),
  mc('Wo ließ sich die Arche nach der Sintflut nieder?', ['Auf dem Berg Sinai', 'Auf dem Berg Morija', 'Auf den Bergen von Ararat', 'Am Ufer des Euphrat'], 2),
  mc('Was tat Awraham, als drei Gäste zu seinem Zelt kamen?', ['Er schickte sie weiter', 'Er bat sie, später wiederzukommen', 'Er lief ihnen entgegen und bewirtete sie', 'Er fragte sie nach ihren Namen'], 2),
  mc('In wie vielen Tagen erschuf G-tt die Welt, bevor Er am Schabbat ruhte?', ['In 3 Tagen', 'In 10 Tagen', 'In 6 Tagen', 'In 40 Tagen'], 2),
  mc('Was geschah mit Lots Frau, als sie sich nach Sodom umsah?', ['Sie erblindete', 'Sie wurde zu einer Salzsäule', 'Sie wurde vom Feuer verbrannt', 'Sie verirrte sich in der Wüste'], 1),
  mc('Welchen neuen Namen gab G-tt Saraj?', ['Sara', 'Riwka', 'Milka', 'Jiska'], 0),
  mc('Was waren Essaw und Jaakow?', ['Cousins', 'Vater und Sohn', 'Zwillingsbrüder', 'Freunde aus Charan'], 2),
  mc('Was war Essaws Beruf?', ['Er war Jäger', 'Er war Schmied', 'Er war Fischer', 'Er war Töpfer'], 0),
  mc('Wie viele Brüder hatte Josef?', ['7', '11', '12', '3'], 1),
  mc('Warum floh Jaakow aus seinem Elternhaus zu Lavan?', ['Weil es eine Hungersnot gab', 'Weil Lavan ihn eingeladen hatte', 'Weil er ein Geschäft machen wollte', 'Weil Essaw ihn töten wollte'], 3),
  mc('Womit verkleidete Riwka Jaakow, damit Jizchak ihn für Essaw hielt?', ['Mit Essaws Kleidern und Ziegenfellen an Händen und Hals', 'Mit einer Maske aus Leder', 'Mit Lavans Mantel', 'Mit einem Jagdbogen und Pfeilen'], 0),
  mc('Wie viele Jahre diente Jaakow insgesamt bei Lavan?', ['7 Jahre', '14 Jahre', '20 Jahre', '40 Jahre'], 2),
  mc('Wer wurde Jaakows erste Frau?', ['Rachel', 'Lea', 'Bilha', 'Dina'], 1),
  mc('An wen wurde Josef von seinen Brüdern verkauft?', ['An ägyptische Soldaten', 'An Philister aus Gerar', 'An die Söhne Essaws', 'An eine Karawane von Jischmaelitern'], 3),
  mc('Was taten die Brüder mit Josefs Kleidung?', ['Sie verbrannten es', 'Sie vergruben es in der Grube', 'Sie tauchten es in das Blut eines Ziegenbocks', 'Sie verkauften es auf dem Markt'], 2),
  mc('Was ließ Josef in Binjamins Sack verstecken?', ['Seinen silbernen Becher', 'Seinen Siegelring', 'Ein goldenes Halsband', 'Einen Brief an Jaakow'], 0),

  // --- Teil B: Offene Fragen mit kurzer Antwort ---
  open('Was nahm G-tt von Adam, um daraus die Frau zu bauen?'),
  open('Welcher Sohn von Adam und Chawa erschlug seinen Bruder?'),
  open('Was verneigte sich in Josefs zweitem Traum vor ihm?'),
  open('Wie hieß Riwkas Bruder?'),
  open('Für welches Gericht verkaufte Essaw sein Erstgeburtsrecht?'),
  open('Wie hieß Josefs Mutter?'),
  open('Welcher Bruder schlug vor, Josef zu verkaufen, statt ihn zu töten?'),
  open('In welches Land wurde Josef verkauft?'),
  open('Wie hieß Josefs jüngerer Bruder, der dieselbe Mutter hatte?'),
  open('In welcher Gegend Ägyptens ließ sich Jaakows Familie nieder?'),
];

export function seedChidon5787Anfaenger() {
  const existing = db.prepare('SELECT id FROM quizzes WHERE title = ?').get(QUIZ_TITLE);
  if (existing) {
    console.log(`"${QUIZ_TITLE}" already exists, skipping.`);
    return;
  }

  const admin = db.prepare('SELECT id FROM admins ORDER BY id LIMIT 1').get() as { id: number } | undefined;
  if (!admin) {
    console.log('No admin account found yet; skipping Chidon 5787 Anfänger quiz seed.');
    return;
  }

  const seed = db.transaction(() => {
    const quizResult = db
      .prepare("INSERT INTO quizzes (title, description, time_limit_seconds, created_by, base_language) VALUES (?, ?, ?, ?, 'de')")
      .run(
        QUIZ_TITLE,
        '20 Single-Choice-Fragen und 10 offene Fragen zum Sefer Bereschit.',
        45 * 60,
        admin.id,
      );
    const quizId = Number(quizResult.lastInsertRowid);

    const insertQuestion = db.prepare(
      `INSERT INTO questions (quiz_id, sort_order, type, text, points, reference_answer, accepted_answers, grader_notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const insertChoice = db.prepare(
      'INSERT INTO choices (question_id, text, is_correct, sort_order) VALUES (?, ?, ?, ?)',
    );

    QUESTIONS.forEach((q, qi) => {
      const qResult = insertQuestion.run(
        quizId,
        qi,
        q.type,
        q.text,
        q.points,
        q.key?.reference ?? null,
        q.key ? JSON.stringify(q.key.accepted) : null,
        q.key?.notes ?? null,
      );
      const questionId = Number(qResult.lastInsertRowid);
      q.choices.forEach((c, ci) => {
        insertChoice.run(questionId, c.text, c.isCorrect ? 1 : 0, ci);
      });
    });

    // Declared languages = the languages this seed actually filled in (no hard-coded list).
    db.prepare('UPDATE quizzes SET content_languages = ? WHERE id = ?').run(
      JSON.stringify(computeUsedLanguages(db, quizId, 'de')),
      quizId,
    );

    return quizId;
  });

  const quizId = seed();
  console.log(`Chidon 5787 Anfänger quiz seeded (id ${quizId}): "${QUIZ_TITLE}" with ${QUESTIONS.length} questions.`);
}
