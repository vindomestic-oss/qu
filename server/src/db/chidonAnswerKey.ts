// Model answers of the open questions of the seeded Chidon quizzes (wish 8), for graders only.
// No imports on purpose: migrate.ts and the seeds both use this file (no import cycle).
//
// Each entry is keyed by the EXACT question text in its seed file (seedChidonQuiz.ts,
// seedChidon5787Anfaenger.ts, seedChidon5787Fortgeschrittene.ts); a text that does not match
// fills nothing, which the seed test catches. `accepted` = `reference` split on ' / ' (S13 adds
// hand-written short forms to it). Sources:
// - 5786: the "(…)" after each question in quiz_docs_extracted/EN.txt, Open Questions and Picture
//   Questions blocks (curly apostrophes written straight, as in the seed texts);
// - 5787: the "Antwort: …" lines under "Teil B" in quiz_docs_extracted/chidon_5787_*_muenchen.txt;
//   the verse reference after the answer goes to `notes`.

export interface AnswerKeyEntry {
  /** The question text exactly as the seed stores it in questions.text. */
  text: string;
  reference: string;
  accepted: string[];
  notes?: string;
}

function entry(text: string, reference: string, notes?: string): AnswerKeyEntry {
  return { text, reference, accepted: reference.split(' / '), ...(notes ? { notes } : {}) };
}

/** European Chidon Tanach 5786: 10 open and 20 picture questions. */
export const CHIDON_5786_KEY: AnswerKeyEntry[] = [
  // --- Open Questions ---
  entry("What was Kayin's profession?", 'Farmer / worker of the soil'),
  entry('Who was the first child Avraham circumcised?', 'Yishmael'),
  entry('What job did Yosef tell his brothers to say they did when speaking to Pharaoh?', 'Shepherds'),
  entry('What was the plague that happened directly before the plague of the firstborn?', 'Darkness'),
  entry('To whom was it said: "Be strong and courageous"?', 'Yehoshua'),
  entry('What was the name of the people who deceived Yehoshua?', "The Giv'onites"),
  entry('Who said: "Let my soul die with the Philistines"?', 'Shimshon'),
  entry('Who said to whom "Am I a dog that you come to me with sticks"?', 'Golyat to David'),
  entry('Who said to whom: "You shall be king over Israel and I shall be second to you"?', 'Yonatan to David'),
  entry('Why did Naomi and Elimelech leave Bethlehem?', 'Because of the famine'),

  // --- Picture Questions ---
  entry(
    'Scene: Avraham arrives in the Land of Israel following the command "Lech Lecha." Who began the journey from Ur Kasdim toward the land of Canaan?',
    "Terach / Avraham's father",
  ),
  entry(
    'Scene: Avraham arrives in the Land of Israel following the command "Lech Lecha." Who were the people, mentioned by name, who joined Avraham on the journey?',
    'Sarah and Lot',
  ),
  entry(
    'Scene: The Philistines quarreled with Yitzhak over the wells of water. Whose wells did the Philistines block at first?',
    'Avraham',
  ),
  entry(
    "Scene: The Philistines quarreled with Yitzhak over the wells of water. Following Yitzhak's success, someone asked to make a covenant with him. Who was it?",
    'Avimelech / king of the Philistines',
  ),
  entry(
    'Scene: Before Yaakov crossed the stream to meet Esav, he wrestled with a man. What name did Yaakov receive from the man as a result of the struggle?',
    'Yisrael',
  ),
  entry(
    'Scene: Before Yaakov crossed the stream to meet Esav, he wrestled with a man. What name did Yaakov give to the place where he wrestled with the man?',
    'Peniel',
  ),
  entry(
    'Scene: Amalek attacking the rear of the people of Israel in the desert, the first nation to attack Israel in the wilderness after the splitting of the Red Sea. In the battle with Amalek, Moshe prayed for success — who actually led the fighting?',
    'Yehoshua',
  ),
  entry(
    'Scene: Amalek attacking the rear of the people of Israel in the desert. Shaul was commanded by Shmuel to destroy Amalek but did not complete the task. What was the name of the king of Amalek whom Shaul left alive?',
    'Agag',
  ),
  entry(
    'Scene: Moshe did not merit entering the Land of Israel, only looking upon it from Mount Nevo. He commanded the people to gather in the Sabbatical year on Sukkot — what must the people do at this event?',
    'Read the Torah',
  ),
  entry(
    "Scene: Moshe did not merit entering the Land of Israel. Aharon, Moshe's brother, also did not merit entering the land. Where was he buried?",
    'Hor HaHar / Mount Hor',
  ),
  entry(
    'Scene: Kalev ben Yefuneh demanded from Yehoshua the fulfillment of the promise Moshe had given him, when the time came for dividing the inheritances. Which city did Kalev claim as his inheritance?',
    'Chevron',
  ),
  entry(
    'Scene: Kalev ben Yefuneh and the division of inheritances. At the beginning of the Judges period, Kalev promised his daughter Achsah to whoever conquered Kiryat Sefer. Who succeeded?',
    'Otniel ben Kenaz',
  ),
  entry(
    'Scene: Two women were involved in different roles in the war against Yavin, king of Canaan, and Sisera, his general. What were the names of the two women?',
    'Devorah and Yael',
  ),
  entry(
    'Scene: The war against Yavin and Sisera. What did one of the two women give Sisera to drink to make him fall asleep?',
    'Milk',
  ),
  entry(
    'Scene: Before the battle with the Philistines, there was a severe shortage of weapons, mainly because there were no craftsmen. Who were the two people in the Israelite camp who were the only ones with weapons?',
    'Shaul and Yonatan',
  ),
  entry(
    'Scene: The shortage of weapons before the battle with the Philistines. What did Shaul forbid the people to eat until the end of the battle?',
    'Bread',
  ),
  entry(
    "Scene: Shaul's kingship ends with the fierce battle on Mount Gilboa in which Shaul and his sons were killed. Before the battle, Shaul went to the medium at Ein Dor — with whom did he want to communicate?",
    'Shmuel',
  ),
  entry(
    "Scene: The battle on Mount Gilboa. What are the names of Shaul's three sons who died there?",
    'Yonatan, Avinadav, Malkishua',
  ),
  // Question 49: the source also lists "the king's guards", which is doubtful as an answer on its own.
  entry(
    "Scene: Esther invited Achashverosh and Haman to a banquet in order to tell Achashverosh about Haman's plot. On the night before the second banquet, King Achashverosh wished to reward Mordechai — what was the reason for this reward?",
    'Mordechai saved King Achashverosh from an assassination plot / Bigtan and Teresh',
    "The source also lists \"the king's guards\" as an answer (doubtful on its own).",
  ),
  entry(
    'Scene: Esther\'s banquet. Who said to whom: "Will you even assault the queen with me in the house?!"',
    'Achashverosh to Haman',
  ),
];

/** Chidon HaTanach 5787 – Anfänger (München): Teil B, 10 open questions. */
export const CHIDON_5787_ANFAENGER_KEY: AnswerKeyEntry[] = [
  entry('Was nahm G-tt von Adam, um daraus die Frau zu bauen?', 'Eine Rippe (Seite)', 'Bereschit 2,21-22'),
  entry('Welcher Sohn von Adam und Chawa erschlug seinen Bruder?', 'Kain', 'Bereschit 4,8'),
  entry('Was verneigte sich in Josefs zweitem Traum vor ihm?', 'Die Sonne, der Mond und elf Sterne', 'Bereschit 37,9'),
  entry('Wie hieß Riwkas Bruder?', 'Lavan', 'Bereschit 24,29'),
  entry('Für welches Gericht verkaufte Essaw sein Erstgeburtsrecht?', 'Für ein (rotes) Linsengericht mit Brot', 'Bereschit 25,34'),
  entry('Wie hieß Josefs Mutter?', 'Rachel', 'Bereschit 30,22-24'),
  entry('Welcher Bruder schlug vor, Josef zu verkaufen, statt ihn zu töten?', 'Jehuda', 'Bereschit 37,26-27'),
  entry('In welches Land wurde Josef verkauft?', 'Nach Ägypten', 'Bereschit 37,36'),
  entry('Wie hieß Josefs jüngerer Bruder, der dieselbe Mutter hatte?', 'Binjamin', 'Bereschit 35,18; 43,29'),
  entry('In welcher Gegend Ägyptens ließ sich Jaakows Familie nieder?', 'Im Land Goschen', 'Bereschit 46,34; 47,6'),
];

/** Chidon HaTanach 5787 – Fortgeschrittene (München): Teil B, 10 open questions. */
export const CHIDON_5787_FORTGESCHRITTENE_KEY: AnswerKeyEntry[] = [
  entry('Wie hieß Awrahams Hausverwalter aus Damaskus?', 'Elieser', 'Bereschit 15,2'),
  entry(
    'Was schickte Jaakow seinem Bruder Essaw als Geschenk voraus?',
    'Herden von Vieh (Ziegen, Schafe, Kamele, Rinder, Esel)',
    'Bereschit 32,14-16',
  ),
  entry('Wie hieß Mosches Frau?', 'Zippora', 'Schmot 2,21'),
  // The seed closes the German quote with a straight " where the source has “.
  entry('Wer sagte: „Wer ist HaSchem, dass ich auf Seine Stimme hören soll?"', 'Der Pharao', 'Schmot 5,2'),
  entry('Wer hielt im Kampf gegen Amalek Mosches Hände hoch?', 'Aharon und Chur', 'Schmot 17,12'),
  entry('Womit wurde Mirjam bestraft, nachdem sie über Mosche gesprochen hatte?', 'Mit Aussatz (Zaraat)', 'Bamidbar 12,10'),
  entry('Welche zwei Kundschafter brachten einen guten Bericht über das Land?', 'Jehoschua und Kalev', 'Bamidbar 14,6-9'),
  entry('Womit verglichen sich die Kundschafter im Vergleich zu den Riesen im Land?', 'Mit Heuschrecken', 'Bamidbar 13,33'),
  entry(
    'Welche Vögel schickte G-tt, als das Volk in der Wüste nach Fleisch verlangte (Bamidbar 11)?',
    'Wachteln (Slaw)',
    'Bamidbar 11,31',
  ),
  entry(
    'Mosche war mit der Führung des Volkes überfordert. Wie viele Älteste sollte er sich als Helfer auswählen?',
    '70',
    'Bamidbar 11,16-17',
  ),
];

export const CHIDON_ANSWER_KEYS: { name: string; entries: AnswerKeyEntry[] }[] = [
  { name: '5786', entries: CHIDON_5786_KEY },
  { name: '5787 Anfänger', entries: CHIDON_5787_ANFAENGER_KEY },
  { name: '5787 Fortgeschrittene', entries: CHIDON_5787_FORTGESCHRITTENE_KEY },
];

/** The key entry for a seed question text, or undefined. */
export function answerKeyFor(entries: AnswerKeyEntry[], text: string): AnswerKeyEntry | undefined {
  return entries.find((e) => e.text === text);
}
