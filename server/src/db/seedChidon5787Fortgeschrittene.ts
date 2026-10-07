import { db } from './index';

const QUIZ_TITLE = 'Chidon HaTanach 5787 – Fortgeschrittene (München)';

type ChoiceSpec = { text: string; isCorrect: boolean };
type QuestionSpec = { type: 'single' | 'text'; text: string; points: number; choices: ChoiceSpec[] };

function mc(text: string, options: string[], correctIndex: number): QuestionSpec {
  return {
    type: 'single',
    text,
    points: 1,
    choices: options.map((o, i) => ({ text: o, isCorrect: i === correctIndex })),
  };
}

function open(text: string): QuestionSpec {
  return { type: 'text', text, points: 1, choices: [] };
}

const QUESTIONS: QuestionSpec[] = [
  // --- Teil A: Single-Choice-Fragen (Bereschit, Schmot 1-20, Bamidbar 11-16 & 20-25) ---
  mc('In der ganzen Schöpfungsgeschichte sagt G-tt immer wieder „es war gut". Was bezeichnet G-tt zum ersten Mal als „nicht gut"?', ['Die Finsternis über der Tiefe', 'Dass der Mensch allein ist', 'Dass die Schlange listig ist', 'Dass die Erde wüst und leer war'], 1),
  mc('Wem gab Jehuda seinen Siegelring, seine Schnur und seinen Stab als Pfand?', ['Tamar', 'Schua', 'Dina', 'Bilha'], 0),
  mc('Was verlangte Josef von seinen Brüdern als Beweis, dass sie keine Spione seien?', ['Dass sie den doppelten Preis für das Getreide zahlen', 'Dass sie ihren jüngsten Bruder Binjamin nach Ägypten bringen', 'Dass sie ihren Vater Jaakow nach Ägypten bringen', 'Dass alle Brüder als Geiseln in Ägypten bleiben'], 1),
  mc('Bei welchem Brunnen sagte Jizchak: „Jetzt hat HaSchem uns Raum geschaffen"?', ['Essek', 'Sitna', 'Schiwa', 'Rechowot'], 3),
  mc('Was legte Jaakow in die Tränkrinnen, damit Lavans Herde gestreifte und gesprenkelte Junge bekam?', ['Geschälte Stäbe', 'Steine aus dem Fluss', 'Lavans Terafim', 'Duftende Kräuter'], 0),
  mc('Für wie viel Silber wurde Josef verkauft?', ['Für 30 Silberstücke', 'Für 400 Schekel', 'Für 20 Silberstücke', 'Für 100 Kessita'], 2),
  mc('Wie hieß Mosches Vater?', ['Kehat', 'Amram', 'Jizhar', 'Nachschon'], 1),
  mc('Was befahl G-tt Mosche am brennenden Dornbusch als Erstes?', ['Seine Schuhe auszuziehen', 'Seinen Stab auf den Boden zu werfen', 'Seine Hand in sein Gewand zu stecken', 'Sein Gesicht zu verhüllen'], 0),
  mc('Bei welcher Plage sagten die ägyptischen Zauberer zum Pharao: „Das ist der Finger G-ttes"?', ['Bei der Plage des Blutes', 'Bei der Plage der Frösche', 'Bei der Plage der Geschwüre', 'Bei der Plage der Läuse'], 3),
  mc('Wie hieß der Ort, an dem Mosche das bittere Wasser durch ein Holz süß machte?', ['Elim', 'Refidim', 'Mara', 'Massa uMeriwa'], 2),
  mc('Wen stellte die Tochter des Pharaos als Amme für den kleinen Mosche an?', ['Seine Schwester Mirjam', 'Seine eigene Mutter Jochewed', 'Die Hebamme', 'Eine ägyptische Dienerin'], 1),
  mc('Für welches der Zehn Gebote wird als Lohn ein langes Leben im Land versprochen?', ['Den Schabbat halten', 'Nicht stehlen', 'Nicht begehren', 'Vater und Mutter ehren'], 3),
  mc('In welchem Monat nach dem Auszug aus Ägypten ist das Volk am Berg Sinai angekommen?', ['Im ersten Monat', 'Im dritten Monat', 'Im siebten Monat', 'Im zwölften Monat'], 1),
  mc('Welche Speisen aus Ägypten vermisste das Volk in der Wüste (Bamidbar 11)?', ['Brot, Wein und Öl', 'Fleisch, Milch und Honig', 'Fisch, Gurken, Melonen, Lauch, Zwiebeln und Knoblauch', 'Datteln, Feigen und Granatäpfel'], 2),
  mc('Was trugen zwei der Kundschafter auf einer Stange aus dem Tal Eschkol?', ['Eine Weintraube', 'Einen Bienenstock', 'Eine Bundeslade', 'Einen Granatapfelbaum'], 0),
  mc('Wer gehörte zu den Anführern des Aufstands gegen Mosche und Aharon?', ['Eldad und Medad', 'Korach, Datan und Awiram', 'Nadaw und Awihu', 'Kalev und Jehoschua'], 1),
  mc('Warum durfte Mosche das Land Israel nicht betreten?', ['Weil er den Ägypter erschlagen hatte', 'Weil er die ersten Tafeln zerbrochen hatte', 'Weil er zu alt war', 'Weil er auf den Felsen schlug, statt zu ihm zu sprechen'], 3),
  mc('Was fertigte Mosche gegen die Schlangenplage an?', ['Einen goldenen Altar', 'Eine kupferne Schlange an einer Stange', 'Ein Räucherwerk aus Myrrhe', 'Einen Schutzwall aus Steinen'], 1),
  mc('Was sah Bilams Eselin auf dem Weg?', ['Eine Feuersäule', 'Eine Schlange', 'Einen Engel G-ttes mit gezücktem Schwert', 'Das Heer Israels'], 2),
  mc('Wer tötete Simri und Kosbi und beendete damit die Plage?', ['Pinchas, der Sohn Elasars', 'Jehoschua bin Nun', 'Elasar, der Sohn Aharons', 'Kalev ben Jefune'], 0),

  // --- Teil B: Offene Fragen mit kurzer Antwort ---
  open('Wie hieß Awrahams Hausverwalter aus Damaskus?'),
  open('Was schickte Jaakow seinem Bruder Essaw als Geschenk voraus?'),
  open('Wie hieß Mosches Frau?'),
  open('Wer sagte: „Wer ist HaSchem, dass ich auf Seine Stimme hören soll?"'),
  open('Wer hielt im Kampf gegen Amalek Mosches Hände hoch?'),
  open('Womit wurde Mirjam bestraft, nachdem sie über Mosche gesprochen hatte?'),
  open('Welche zwei Kundschafter brachten einen guten Bericht über das Land?'),
  open('Womit verglichen sich die Kundschafter im Vergleich zu den Riesen im Land?'),
  open('Welche Vögel schickte G-tt, als das Volk in der Wüste nach Fleisch verlangte (Bamidbar 11)?'),
  open('Mosche war mit der Führung des Volkes überfordert. Wie viele Älteste sollte er sich als Helfer auswählen?'),
];

export function seedChidon5787Fortgeschrittene() {
  const existing = db.prepare('SELECT id FROM quizzes WHERE title = ?').get(QUIZ_TITLE);
  if (existing) {
    console.log(`"${QUIZ_TITLE}" already exists, skipping.`);
    return;
  }

  const admin = db.prepare('SELECT id FROM admins ORDER BY id LIMIT 1').get() as { id: number } | undefined;
  if (!admin) {
    console.log('No admin account found yet; skipping Chidon 5787 Fortgeschrittene quiz seed.');
    return;
  }

  const seed = db.transaction(() => {
    const quizResult = db
      .prepare('INSERT INTO quizzes (title, description, time_limit_seconds, created_by) VALUES (?, ?, ?, ?)')
      .run(
        QUIZ_TITLE,
        '20 Single-Choice-Fragen und 10 offene Fragen zu Sefer Bereschit, Sefer Schmot (Kap. 1-20) und Sefer Bamidbar (Kap. 11-16, 20-25).',
        45 * 60,
        admin.id,
      );
    const quizId = Number(quizResult.lastInsertRowid);

    const insertQuestion = db.prepare(
      'INSERT INTO questions (quiz_id, sort_order, type, text, points) VALUES (?, ?, ?, ?, ?)',
    );
    const insertChoice = db.prepare(
      'INSERT INTO choices (question_id, text, is_correct, sort_order) VALUES (?, ?, ?, ?)',
    );

    QUESTIONS.forEach((q, qi) => {
      const qResult = insertQuestion.run(quizId, qi, q.type, q.text, q.points);
      const questionId = Number(qResult.lastInsertRowid);
      q.choices.forEach((c, ci) => {
        insertChoice.run(questionId, c.text, c.isCorrect ? 1 : 0, ci);
      });
    });

    return quizId;
  });

  const quizId = seed();
  console.log(`Chidon 5787 Fortgeschrittene quiz seeded (id ${quizId}): "${QUIZ_TITLE}" with ${QUESTIONS.length} questions.`);
}
