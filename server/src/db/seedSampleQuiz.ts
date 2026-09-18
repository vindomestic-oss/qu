import zlib from 'zlib';
import fs from 'fs';
import path from 'path';
import { db } from './index';
import { UPLOAD_DIR } from '../middleware/upload';
import { translationColumns, translationValues } from '../lib/sqlTranslations';
import type { Translations } from '../lib/questionInput';

const QUIZ_TITLE = 'World Geography: Flags & Capitals';

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

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePNG(width: number, height: number, pixelFn: (x: number, y: number) => [number, number, number]): Buffer {
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
type RGB = [number, number, number];
function vStripes(colors: RGB[]) {
  const n = colors.length;
  return (x: number) => colors[Math.min(n - 1, Math.floor((x / W) * n))];
}
function hStripes(colors: RGB[]) {
  const n = colors.length;
  return (y: number) => colors[Math.min(n - 1, Math.floor((y / H) * n))];
}

function makeFlag(name: string, pixelFn: (x: number, y: number) => RGB): string {
  const buf = encodePNG(W, H, pixelFn);
  const filename = `seed-flag-${name}.png`;
  fs.writeFileSync(path.join(UPLOAD_DIR, filename), buf);
  return `/uploads/${filename}`;
}

// --- Translations ---

const QUIZ_META = {
  title: QUIZ_TITLE,
  description: 'Test your knowledge of flags, capitals, and countries.',
  titleTranslations: {
    de: 'Weltgeographie: Flaggen & Hauptstädte',
    ru: 'География мира: флаги и столицы',
    fr: 'Géographie mondiale : drapeaux et capitales',
    pl: 'Geografia świata: flagi i stolice',
    lt: 'Pasaulio geografija: vėliavos ir sostinės',
    he: 'גאוגרפיה עולמית: דגלים ובירות',
  } as Translations,
  descriptionTranslations: {
    de: 'Teste dein Wissen über Flaggen, Hauptstädte und Länder.',
    ru: 'Проверьте свои знания флагов, столиц и стран.',
    fr: 'Testez vos connaissances sur les drapeaux, les capitales et les pays.',
    pl: 'Sprawdź swoją wiedzę o flagach, stolicach i krajach.',
    lt: 'Patikrinkite savo žinias apie vėliavas, sostines ir šalis.',
    he: 'בחנו את הידע שלכם על דגלים, בירות ומדינות.',
  } as Translations,
};

const FLAG_QUESTION_TRANSLATIONS: Translations = {
  de: 'Zu welchem Land gehört diese Flagge?',
  ru: 'Какой стране принадлежит этот флаг?',
  fr: 'À quel pays appartient ce drapeau ?',
  pl: 'Do jakiego kraju należy ta flaga?',
  lt: 'Kuriai šaliai priklauso šis vėliava?',
  he: 'לאיזו מדינה שייך הדגל הזה?',
};

const COUNTRY_NAMES: Record<string, Translations> = {
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

interface ChoiceSpec {
  text: string;
  isCorrect: boolean;
}
interface QuestionSpec {
  type: 'single' | 'multiple' | 'text';
  text: string;
  translations: Translations;
  points: number;
  imagePath?: string;
  choices: ChoiceSpec[];
}

function choicesFor(names: string[], correct: string[]): ChoiceSpec[] {
  return names.map((name) => ({ text: name, isCorrect: correct.includes(name) }));
}

export function seedSampleQuiz() {
  const existing = db.prepare('SELECT id FROM quizzes WHERE title = ?').get(QUIZ_TITLE);
  if (existing) {
    console.log(`Sample quiz "${QUIZ_TITLE}" already exists, skipping.`);
    return;
  }

  const admin = db.prepare('SELECT id FROM admins ORDER BY id LIMIT 1').get() as { id: number } | undefined;
  if (!admin) {
    console.log('No admin account found yet; skipping sample quiz seed.');
    return;
  }

  const flags: Record<string, string> = {
    france: makeFlag('france', (x) => vStripes([[0, 35, 149], [255, 255, 255], [237, 41, 57]])(x)),
    germany: makeFlag('germany', (x, y) => hStripes([[0, 0, 0], [222, 0, 0], [255, 206, 0]])(y)),
    italy: makeFlag('italy', (x) => vStripes([[0, 146, 70], [255, 255, 255], [206, 43, 55]])(x)),
    netherlands: makeFlag('netherlands', (x, y) => hStripes([[174, 28, 40], [255, 255, 255], [33, 70, 139]])(y)),
    nigeria: makeFlag('nigeria', (x) => vStripes([[0, 135, 81], [255, 255, 255], [0, 135, 81]])(x)),
  };

  const questions: QuestionSpec[] = [
    { type: 'single', text: 'Which country does this flag belong to?', translations: FLAG_QUESTION_TRANSLATIONS, points: 1, imagePath: flags.france, choices: choicesFor(['France', 'Spain', 'Italy', 'Germany'], ['France']) },
    { type: 'single', text: 'Which country does this flag belong to?', translations: FLAG_QUESTION_TRANSLATIONS, points: 1, imagePath: flags.germany, choices: choicesFor(['Germany', 'Belgium', 'Austria', 'Poland'], ['Germany']) },
    { type: 'single', text: 'Which country does this flag belong to?', translations: FLAG_QUESTION_TRANSLATIONS, points: 1, imagePath: flags.italy, choices: choicesFor(['Italy', 'Mexico', 'Ireland', 'Hungary'], ['Italy']) },
    { type: 'single', text: 'Which country does this flag belong to?', translations: FLAG_QUESTION_TRANSLATIONS, points: 1, imagePath: flags.netherlands, choices: choicesFor(['Netherlands', 'Luxembourg', 'Russia', 'France'], ['Netherlands']) },
    { type: 'single', text: 'Which country does this flag belong to?', translations: FLAG_QUESTION_TRANSLATIONS, points: 1, imagePath: flags.nigeria, choices: choicesFor(['Nigeria', 'Ireland', 'Italy', 'Mali'], ['Nigeria']) },
    {
      type: 'single', text: 'What is the capital of France?', points: 1,
      translations: { de: 'Was ist die Hauptstadt von Frankreich?', ru: 'Какая столица Франции?', fr: 'Quelle est la capitale de la France ?', pl: 'Jaka jest stolica Francji?', lt: 'Kokia yra Prancūzijos sostinė?', he: 'מה בירת צרפת?' },
      choices: choicesFor(['Paris', 'Lyon', 'Marseille', 'Nice'], ['Paris']),
    },
    {
      type: 'single', text: 'What is the capital of Japan?', points: 1,
      translations: { de: 'Was ist die Hauptstadt von Japan?', ru: 'Какая столица Японии?', fr: 'Quelle est la capitale du Japon ?', pl: 'Jaka jest stolica Japonii?', lt: 'Kokia yra Japonijos sostinė?', he: 'מה בירת יפן?' },
      choices: choicesFor(['Tokyo', 'Osaka', 'Kyoto', 'Nagoya'], ['Tokyo']),
    },
    {
      type: 'multiple', text: 'Which of these countries are located in Europe?', points: 2,
      translations: { de: 'Welche dieser Länder liegen in Europa?', ru: 'Какие из этих стран расположены в Европе?', fr: 'Lesquels de ces pays se trouvent en Europe ?', pl: 'Które z tych krajów znajdują się w Europie?', lt: 'Kurios iš šių šalių yra Europoje?', he: 'אילו מהמדינות הבאות נמצאות באירופה?' },
      choices: choicesFor(['France', 'Germany', 'Italy', 'Nigeria', 'Japan'], ['France', 'Germany', 'Italy']),
    },
    {
      type: 'text', text: 'Name a country located entirely in the Southern Hemisphere.', points: 1,
      translations: { de: 'Nenne ein Land, das vollständig in der südlichen Hemisphäre liegt.', ru: 'Назовите страну, полностью расположенную в Южном полушарии.', fr: "Nommez un pays situé entièrement dans l'hémisphère sud.", pl: 'Podaj kraj położony całkowicie na półkuli południowej.', lt: 'Įvardykite šalį, esančią visiškai pietiniame pusrutulyje.', he: 'ציינו מדינה הנמצאת כולה בחצי הכדור הדרומי.' },
      choices: [],
    },
  ];

  const seed = db.transaction(() => {
    const quizColumns = ['title', 'description', ...translationColumns('title'), ...translationColumns('description'), 'time_limit_seconds', 'created_by'];
    const quizResult = db
      .prepare(`INSERT INTO quizzes (${quizColumns.join(', ')}) VALUES (${quizColumns.map(() => '?').join(', ')})`)
      .run(
        QUIZ_META.title,
        QUIZ_META.description,
        ...translationValues(QUIZ_META.titleTranslations),
        ...translationValues(QUIZ_META.descriptionTranslations),
        600,
        admin.id,
      );
    const quizId = Number(quizResult.lastInsertRowid);

    const questionColumns = ['quiz_id', 'sort_order', 'type', 'text', ...translationColumns('text'), 'image_path', 'points'];
    const insertQuestion = db.prepare(`INSERT INTO questions (${questionColumns.join(', ')}) VALUES (${questionColumns.map(() => '?').join(', ')})`);
    const choiceColumns = ['question_id', 'text', ...translationColumns('text'), 'is_correct', 'sort_order'];
    const insertChoice = db.prepare(`INSERT INTO choices (${choiceColumns.join(', ')}) VALUES (${choiceColumns.map(() => '?').join(', ')})`);

    questions.forEach((q, qi) => {
      const qResult = insertQuestion.run(
        quizId,
        qi,
        q.type,
        q.text,
        ...translationValues(q.translations),
        q.imagePath ?? null,
        q.points,
      );
      const questionId = Number(qResult.lastInsertRowid);
      q.choices.forEach((c, ci) => {
        insertChoice.run(
          questionId,
          c.text,
          ...translationValues(COUNTRY_NAMES[c.text] ?? {}),
          c.isCorrect ? 1 : 0,
          ci,
        );
      });
    });

    return quizId;
  });

  const quizId = seed();
  console.log(`Sample quiz seeded (id ${quizId}): "${QUIZ_TITLE}" with ${questions.length} questions.`);
}
