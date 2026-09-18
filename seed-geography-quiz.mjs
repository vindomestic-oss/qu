import zlib from 'zlib';
import fs from 'fs';

// --- Minimal self-contained PNG encoder (no dependencies) ---

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePNG(width, height, pixelFn) {
  const rowBytes = width * 3;
  const raw = Buffer.alloc((rowBytes + 1) * height);
  let offset = 0;
  for (let y = 0; y < height; y++) {
    raw[offset++] = 0;
    for (let x = 0; x < width; x++) {
      const [r, g, b] = pixelFn(x, y);
      raw[offset++] = r;
      raw[offset++] = g;
      raw[offset++] = b;
    }
  }
  const idatData = zlib.deflateSync(raw);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idatData), chunk('IEND', Buffer.alloc(0))]);
}

const W = 300;
const H = 200;
function vStripes(colors) {
  const n = colors.length;
  return (x) => colors[Math.min(n - 1, Math.floor((x / W) * n))];
}
function hStripes(colors) {
  const n = colors.length;
  return (y) => colors[Math.min(n - 1, Math.floor((y / H) * n))];
}

const FLAGS = {
  france: encodePNG(W, H, (x) => vStripes([[0, 35, 149], [255, 255, 255], [237, 41, 57]])(x)),
  germany: encodePNG(W, H, (x, y) => hStripes([[0, 0, 0], [222, 0, 0], [255, 206, 0]])(y)),
  italy: encodePNG(W, H, (x) => vStripes([[0, 146, 70], [255, 255, 255], [206, 43, 55]])(x)),
  netherlands: encodePNG(W, H, (x, y) => hStripes([[174, 28, 40], [255, 255, 255], [33, 70, 139]])(y)),
  nigeria: encodePNG(W, H, (x) => vStripes([[0, 135, 81], [255, 255, 255], [0, 135, 81]])(x)),
};

fs.mkdirSync('./seed-assets', { recursive: true });
for (const [name, buf] of Object.entries(FLAGS)) fs.writeFileSync(`./seed-assets/${name}.png`, buf);
console.log('Generated 5 flag images.');

// --- Translations ---

const QUIZ_META = {
  title: 'World Geography: Flags & Capitals',
  description: 'Test your knowledge of flags, capitals, and countries.',
  title_de: 'Weltgeographie: Flaggen & Hauptstädte',
  title_ru: 'География мира: флаги и столицы',
  title_fr: 'Géographie mondiale : drapeaux et capitales',
  title_pl: 'Geografia świata: flagi i stolice',
  title_lt: 'Pasaulio geografija: vėliavos ir sostinės',
  title_he: 'גאוגרפיה עולמית: דגלים ובירות',
  description_de: 'Teste dein Wissen über Flaggen, Hauptstädte und Länder.',
  description_ru: 'Проверьте свои знания флагов, столиц и стран.',
  description_fr: 'Testez vos connaissances sur les drapeaux, les capitales et les pays.',
  description_pl: 'Sprawdź swoją wiedzę o flagach, stolicach i krajach.',
  description_lt: 'Patikrinkite savo žinias apie vėliavas, sostines ir šalis.',
  description_he: 'בחנו את הידע שלכם על דגלים, בירות ומדינות.',
};

const FLAG_QUESTION_TEXT = {
  de: 'Zu welchem Land gehört diese Flagge?',
  ru: 'Какой стране принадлежит этот флаг?',
  fr: 'À quel pays appartient ce drapeau ?',
  pl: 'Do jakiego kraju należy ta flaga?',
  lt: 'Kuriai šaliai priklauso šis vėliava?',
  he: 'לאיזו מדינה שייך הדגל הזה?',
};

const COUNTRY_NAMES = {
  France: { de: 'Frankreich', ru: 'Франция', fr: 'France', pl: 'Francja', lt: 'Prancūzija', he: 'צרפת' },
  Spain: { de: 'Spanien', ru: 'Испания', fr: 'Espagne', pl: 'Hiszpania', lt: 'Ispanija', he: 'ספרד' },
  Italy: { de: 'Italien', ru: 'Италия', fr: 'Italie', pl: 'Włochy', lt: 'Italija', he: 'איטליה' },
  Germany: { de: 'Deutschland', ru: 'Германия', fr: 'Allemagne', pl: 'Niemcy', lt: 'Vokietija', he: 'גרמניה' },
  Belgium: { de: 'Belgien', ru: 'Бельгия', fr: 'Belgique', pl: 'Belgia', lt: 'Belgija', he: 'בלגיה' },
  Austria: { de: 'Österreich', ru: 'Австрия', fr: 'Autriche', pl: 'Austria', lt: 'Austrija', he: 'אוסטריה' },
  Poland: { de: 'Polen', ru: 'Польша', fr: 'Pologne', pl: 'Polska', lt: 'Lenkija', he: 'פולין' },
  Mexico: { de: 'Mexiko', ru: 'Мексика', fr: 'Mexique', pl: 'Meksyk', lt: 'Meksika', he: 'מקסיקו' },
  Ireland: { de: 'Irland', ru: 'Ирландия', fr: 'Irlande', pl: 'Irlandia', lt: 'Airija', he: 'אירלנד' },
  Hungary: { de: 'Ungarn', ru: 'Венгрия', fr: 'Hongrie', pl: 'Węgry', lt: 'Vengrija', he: 'הונגריה' },
  Netherlands: { de: 'Niederlande', ru: 'Нидерланды', fr: 'Pays-Bas', pl: 'Holandia', lt: 'Nyderlandai', he: 'הולנד' },
  Luxembourg: { de: 'Luxemburg', ru: 'Люксембург', fr: 'Luxembourg', pl: 'Luksemburg', lt: 'Liuksemburgas', he: 'לוקסמבורג' },
  Russia: { de: 'Russland', ru: 'Россия', fr: 'Russie', pl: 'Rosja', lt: 'Rusija', he: 'רוסיה' },
  Nigeria: { de: 'Nigeria', ru: 'Нигерия', fr: 'Nigeria', pl: 'Nigeria', lt: 'Nigerija', he: 'ניגריה' },
  Mali: { de: 'Mali', ru: 'Мали', fr: 'Mali', pl: 'Mali', lt: 'Malis', he: 'מאלי' },
  Paris: { de: 'Paris', ru: 'Париж', fr: 'Paris', pl: 'Paryż', lt: 'Paryžius', he: 'פריז' },
  Lyon: { de: 'Lyon', ru: 'Лион', fr: 'Lyon', pl: 'Lyon', lt: 'Lionas', he: 'ליון' },
  Marseille: { de: 'Marseille', ru: 'Марсель', fr: 'Marseille', pl: 'Marsylia', lt: 'Marselis', he: 'מארסיי' },
  Nice: { de: 'Nizza', ru: 'Ницца', fr: 'Nice', pl: 'Nicea', lt: 'Nica', he: 'ניס' },
  Tokyo: { de: 'Tokio', ru: 'Токио', fr: 'Tokyo', pl: 'Tokio', lt: 'Tokijas', he: 'טוקיו' },
  Osaka: { de: 'Osaka', ru: 'Осака', fr: 'Osaka', pl: 'Osaka', lt: 'Osaka', he: 'אוסקה' },
  Kyoto: { de: 'Kyoto', ru: 'Киото', fr: 'Kyoto', pl: 'Kioto', lt: 'Kiotas', he: 'קיוטו' },
  Nagoya: { de: 'Nagoya', ru: 'Нагоя', fr: 'Nagoya', pl: 'Nagoja', lt: 'Nagoja', he: 'נגויה' },
  Japan: { de: 'Japan', ru: 'Япония', fr: 'Japon', pl: 'Japonia', lt: 'Japonija', he: 'יפן' },
};

function countryTranslations(name) {
  const t = COUNTRY_NAMES[name] || {};
  return { text_de: t.de || '', text_ru: t.ru || '', text_fr: t.fr || '', text_pl: t.pl || '', text_lt: t.lt || '', text_he: t.he || '' };
}
function flagQuestionTranslations() {
  return {
    text_de: FLAG_QUESTION_TEXT.de,
    text_ru: FLAG_QUESTION_TEXT.ru,
    text_fr: FLAG_QUESTION_TEXT.fr,
    text_pl: FLAG_QUESTION_TEXT.pl,
    text_lt: FLAG_QUESTION_TEXT.lt,
    text_he: FLAG_QUESTION_TEXT.he,
  };
}

// --- Seed via the API ---

const BASE = process.env.SEED_BASE_URL || 'http://localhost:5173';
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'changeme123';

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

  const { quiz } = await api('/quizzes', {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ ...QUIZ_META, time_limit_seconds: 600 }),
  });
  console.log(`Created quiz #${quiz.id}: ${quiz.title}`);

  async function addQuestion(input) {
    const { quiz: updated } = await api(`/quizzes/${quiz.id}/questions`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify(input),
    });
    return updated.questions[updated.questions.length - 1];
  }

  async function attachImage(questionId, filePath) {
    const buf = fs.readFileSync(filePath);
    const boundary = '----seedBoundary' + Math.random().toString(16).slice(2);
    const filename = filePath.split(/[\\/]/).pop();
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="${filename}"\r\nContent-Type: image/png\r\n\r\n`),
      buf,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const res = await fetch(`${BASE}/api/questions/${questionId}/image`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': `multipart/form-data; boundary=${boundary}` },
      body,
    });
    if (!res.ok) throw new Error(`image upload failed: ${res.status} ${await res.text()}`);
  }

  const flagQuestions = [
    { image: './seed-assets/france.png', choices: ['France', 'Spain', 'Italy', 'Germany'], correct: 'France' },
    { image: './seed-assets/germany.png', choices: ['Germany', 'Belgium', 'Austria', 'Poland'], correct: 'Germany' },
    { image: './seed-assets/italy.png', choices: ['Italy', 'Mexico', 'Ireland', 'Hungary'], correct: 'Italy' },
    { image: './seed-assets/netherlands.png', choices: ['Netherlands', 'Luxembourg', 'Russia', 'France'], correct: 'Netherlands' },
    { image: './seed-assets/nigeria.png', choices: ['Nigeria', 'Ireland', 'Italy', 'Mali'], correct: 'Nigeria' },
  ];

  for (const fq of flagQuestions) {
    const q = await addQuestion({
      type: 'single',
      text: 'Which country does this flag belong to?',
      ...flagQuestionTranslations(),
      points: 1,
      choices: fq.choices.map((c) => ({ text: c, ...countryTranslations(c), is_correct: c === fq.correct })),
    });
    await attachImage(q.id, fq.image);
    console.log(`Added flag question (${fq.correct}) with image + translations`);
  }

  await addQuestion({
    type: 'single',
    text: 'What is the capital of France?',
    text_de: 'Was ist die Hauptstadt von Frankreich?',
    text_ru: 'Какая столица Франции?',
    text_fr: 'Quelle est la capitale de la France ?',
    text_pl: 'Jaka jest stolica Francji?',
    text_lt: 'Kokia yra Prancūzijos sostinė?',
    text_he: 'מה בירת צרפת?',
    points: 1,
    choices: ['Paris', 'Lyon', 'Marseille', 'Nice'].map((c) => ({ text: c, ...countryTranslations(c), is_correct: c === 'Paris' })),
  });
  console.log('Added capital question: France');

  await addQuestion({
    type: 'single',
    text: 'What is the capital of Japan?',
    text_de: 'Was ist die Hauptstadt von Japan?',
    text_ru: 'Какая столица Японии?',
    text_fr: 'Quelle est la capitale du Japon ?',
    text_pl: 'Jaka jest stolica Japonii?',
    text_lt: 'Kokia yra Japonijos sostinė?',
    text_he: 'מה בירת יפן?',
    points: 1,
    choices: ['Tokyo', 'Osaka', 'Kyoto', 'Nagoya'].map((c) => ({ text: c, ...countryTranslations(c), is_correct: c === 'Tokyo' })),
  });
  console.log('Added capital question: Japan');

  await addQuestion({
    type: 'multiple',
    text: 'Which of these countries are located in Europe?',
    text_de: 'Welche dieser Länder liegen in Europa?',
    text_ru: 'Какие из этих стран расположены в Европе?',
    text_fr: 'Lesquels de ces pays se trouvent en Europe ?',
    text_pl: 'Które z tych krajów znajdują się w Europie?',
    text_lt: 'Kurios iš šių šalių yra Europoje?',
    text_he: 'אילו מהמדינות הבאות נמצאות באירופה?',
    points: 2,
    choices: ['France', 'Germany', 'Italy', 'Nigeria', 'Japan'].map((c) => ({
      text: c,
      ...countryTranslations(c),
      is_correct: ['France', 'Germany', 'Italy'].includes(c),
    })),
  });
  console.log('Added multiple-choice question: European countries');

  await addQuestion({
    type: 'text',
    text: 'Name a country located entirely in the Southern Hemisphere.',
    text_de: 'Nenne ein Land, das vollständig in der südlichen Hemisphäre liegt.',
    text_ru: 'Назовите страну, полностью расположенную в Южном полушарии.',
    text_fr: "Nommez un pays situé entièrement dans l'hémisphère sud.",
    text_pl: 'Podaj kraj położony całkowicie na półkuli południowej.',
    text_lt: 'Įvardykite šalį, esančią visiškai pietiniame pusrutulyje.',
    text_he: 'ציינו מדינה הנמצאת כולה בחצי הכדור הדרומי.',
    points: 1,
    choices: [],
  });
  console.log('Added text question: Southern Hemisphere country');

  console.log(`\nDone. Quiz ready at ${BASE}/admin/quizzes/${quiz.id}`);
}

main().catch((err) => {
  console.error('SEED FAILED:', err);
  process.exit(1);
});
