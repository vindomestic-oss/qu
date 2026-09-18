// Seeds the "European Chidon Tanach 5786" exam quiz via the API.
// Usage: SEED_BASE_URL=... ADMIN_USERNAME=... ADMIN_PASSWORD=... node seed-chidon-quiz.mjs

const BASE = process.env.SEED_BASE_URL || 'http://localhost:5173';
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'changeme123';

const QUIZ = {
  title: 'European Chidon Tanach 5786 (January 2026)',
  description:
    '40 questions across four types: True/False, Multiple Choice, Open Questions, and Picture Questions.',
  time_limit_seconds: 3600,
};

function tf(text, answer) {
  return {
    type: 'single',
    text,
    points: 1,
    choices: [
      { text: 'True', is_correct: answer === true },
      { text: 'False', is_correct: answer === false },
    ],
  };
}

function mc(text, options, correctIndex) {
  return {
    type: 'single',
    text,
    points: 1,
    choices: options.map((o, i) => ({ text: o, is_correct: i === correctIndex })),
  };
}

function open(text, points = 1) {
  return { type: 'text', text, points, choices: [] };
}

const QUESTIONS = [
  // --- True / False ---
  tf('On the second day, dry land was created.', false),
  tf('The two cities that the Israelites built for Pharaoh were Pithom and Raamses.', true),
  tf('The object of the Mishkan that the priests carried when crossing the Jordan into the land of Canaan was the altar.', false),
  tf('The prophet Shmuel was a judge.', true),
  tf('David hid from Shaul among the Philistines.', true),

  // --- Multiple Choice ---
  mc('What was the source of the waters in the Flood?', ['Tsunami', 'Rain', 'Underground waters', 'Rain and underground waters'], 3),
  mc('Which of the following is NOT correct regarding the city of Sodom?', [
    'It was located in the Jordan plain',
    'Avraham negotiated with G-d so that the city might be saved',
    'The king of the city brought out bread and wine and blessed Avraham as thanks',
    'The morals of its people were evil',
  ], 2),
  mc('Which of the following dreams did Yosef dream?', ['The ladder', 'The bundles of grain in the field', 'The grapes being squeezed into the cup', 'The fat and skinny cows'], 1),
  mc('Which of the following sons did Yaakov criticize in his blessing?', ['Reuven', 'Yissakhar', 'Dan', 'Binyamin'], 0),
  mc('In which of the following stories was NO shoe removed?', ['Moshe and the burning bush', "Yehoshua and the captain of the Lord's host", 'Yehuda and Tamar', 'Boaz and Ruth'], 2),
  mc('How is the people of Israel described before the giving of the Torah and the Ten Commandments?', ['As a people rising like a lion', 'A kingdom of priests and a holy nation', 'A numerous and mighty people', 'A stiff-necked people'], 1),
  mc('What was the taste of the manna?', ['Bread and meat', 'The seven species', 'Cucumbers and watermelons', 'Wafers with honey'], 3),
  mc('After entering the land in the days of Yehoshua, several events took place. Which of the following did NOT happen immediately, but only after the battles began?', [
    'The ceremony of the blessing and the curse',
    'The people underwent circumcision',
    'The people celebrated Passover',
    'The placing of the twelve memorial stones from the Jordan',
  ], 0),
  mc('Which of the following were kings of the Emorites?', ['The kings of Chatzor and Shimron', 'The kings of Yericho and Ai', 'The kings of Yerushalayim and Chevron', 'The kings of the Philistines'], 2),
  mc('What is correct regarding the strategy of Ehud ben Gera?', ['He used a double-edged sword', 'He used his left hand for the stabbing', 'He caused the king of Moav to remain alone with him', 'All of the above'], 3),
  mc('In the parable of Yotam, to which tree do the trees turn to ask it to reign over them?', ['Vine', 'Pomegranate', 'Date palm', 'Cedar'], 0),
  mc('The people asked Shmuel for a king and gave various reasons. Which of the following reasons did they mention?', [
    'That the people lost the war against the Philistines',
    'That Eli the priest died',
    'That the sons of Shmuel were not worthy',
    'That Shaul was very fit for kingship',
  ], 2),
  mc("Which of the following is NOT a description of David's qualities?", ['Skillful musician', 'Wise-hearted', 'Mighty warrior', 'Hashem is with him'], 1),
  mc("What was Yonah's prophecy to the city of Nineveh?", [
    "The people of the city will be exiled if they don't repent",
    'The people of the city are very evil before G-d',
    'In forty days the city will be overturned',
    'The city will be conquered by Assyria if there is no repentance',
  ], 2),
  mc('Who said to whom: "Your people shall be my people, and your G-d my G-d"?', ['Hagar to Sarah', 'Ruth to Naomi', 'Yael to Devorah', 'Shifrah to Miriam'], 1),

  // --- Open Questions ---
  open("What was Kayin's profession?"),
  open('Who was the first child Avraham circumcised?'),
  open('What job did Yosef tell his brothers to say they did when speaking to Pharaoh?'),
  open('What was the plague that happened directly before the plague of the firstborn?'),
  open('To whom was it said: "Be strong and courageous"?'),
  open('What was the name of the people who deceived Yehoshua?'),
  open('Who said: "Let my soul die with the Philistines"?'),
  open('Who said to whom "Am I a dog that you come to me with sticks"?'),
  open('Who said to whom: "You shall be king over Israel and I shall be second to you"?'),
  open('Why did Naomi and Elimelech leave Bethlehem?'),

  // --- Picture Questions (no embedded images in source; scene described in the question text) ---
  open('Scene: Avraham arrives in the Land of Israel following the command "Lech Lecha." Who began the journey from Ur Kasdim toward the land of Canaan?'),
  open('Scene: Avraham arrives in the Land of Israel following the command "Lech Lecha." Who were the people, mentioned by name, who joined Avraham on the journey?'),

  open('Scene: The Philistines quarreled with Yitzhak over the wells of water. Whose wells did the Philistines block at first?'),
  open("Scene: The Philistines quarreled with Yitzhak over the wells of water. Following Yitzhak's success, someone asked to make a covenant with him. Who was it?"),

  open('Scene: Before Yaakov crossed the stream to meet Esav, he wrestled with a man. What name did Yaakov receive from the man as a result of the struggle?'),
  open('Scene: Before Yaakov crossed the stream to meet Esav, he wrestled with a man. What name did Yaakov give to the place where he wrestled with the man?'),

  open('Scene: Amalek attacking the rear of the people of Israel in the desert, the first nation to attack Israel in the wilderness after the splitting of the Red Sea. In the battle with Amalek, Moshe prayed for success — who actually led the fighting?'),
  open('Scene: Amalek attacking the rear of the people of Israel in the desert. Shaul was commanded by Shmuel to destroy Amalek but did not complete the task. What was the name of the king of Amalek whom Shaul left alive?'),

  open('Scene: Moshe did not merit entering the Land of Israel, only looking upon it from Mount Nevo. He commanded the people to gather in the Sabbatical year on Sukkot — what must the people do at this event?'),
  open("Scene: Moshe did not merit entering the Land of Israel. Aharon, Moshe's brother, also did not merit entering the land. Where was he buried?"),

  open('Scene: Kalev ben Yefuneh demanded from Yehoshua the fulfillment of the promise Moshe had given him, when the time came for dividing the inheritances. Which city did Kalev claim as his inheritance?'),
  open('Scene: Kalev ben Yefuneh and the division of inheritances. At the beginning of the Judges period, Kalev promised his daughter Achsah to whoever conquered Kiryat Sefer. Who succeeded?'),

  open('Scene: Two women were involved in different roles in the war against Yavin, king of Canaan, and Sisera, his general. What were the names of the two women?'),
  open('Scene: The war against Yavin and Sisera. What did one of the two women give Sisera to drink to make him fall asleep?'),

  open('Scene: Before the battle with the Philistines, there was a severe shortage of weapons, mainly because there were no craftsmen. Who were the two people in the Israelite camp who were the only ones with weapons?'),
  open('Scene: The shortage of weapons before the battle with the Philistines. What did Shaul forbid the people to eat until the end of the battle?'),

  open("Scene: Shaul's kingship ends with the fierce battle on Mount Gilboa in which Shaul and his sons were killed. Before the battle, Shaul went to the medium at Ein Dor — with whom did he want to communicate?"),
  open("Scene: The battle on Mount Gilboa. What are the names of Shaul's three sons who died there?"),

  open("Scene: Esther invited Achashverosh and Haman to a banquet in order to tell Achashverosh about Haman's plot. On the night before the second banquet, King Achashverosh wished to reward Mordechai — what was the reason for this reward?"),
  open('Scene: Esther\'s banquet. Who said to whom: "Will you even assault the queen with me in the house?!"'),
];

async function api(path, options = {}) {
  const res = await fetch(`${BASE}/api${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${path} -> ${res.status}: ${JSON.stringify(data)}`);
  return data;
}

async function main() {
  const { token } = await api('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD }),
  });
  const auth = { Authorization: `Bearer ${token}` };

  const { quiz } = await api('/quizzes', { method: 'POST', headers: auth, body: JSON.stringify(QUIZ) });
  console.log(`Created quiz #${quiz.id}: ${quiz.title}`);

  let count = 0;
  for (const q of QUESTIONS) {
    await api(`/quizzes/${quiz.id}/questions`, { method: 'POST', headers: auth, body: JSON.stringify(q) });
    count++;
  }
  console.log(`Added ${count} questions.`);
  console.log(`\nDone. Quiz ready at ${BASE}/admin/quizzes/${quiz.id}`);
}

main().catch((err) => {
  console.error('SEED FAILED:', err);
  process.exit(1);
});
