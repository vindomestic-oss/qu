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
    raw[offset++] = 0; // filter type: none
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
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idatData), chunk('IEND', Buffer.alloc(0))]);
}

// --- Simple flag patterns (stylized, not pixel-accurate) ---

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

const FRANCE = encodePNG(W, H, (x) => vStripes([[0, 35, 149], [255, 255, 255], [237, 41, 57]])(x));
const GERMANY = encodePNG(W, H, (x, y) => hStripes([[0, 0, 0], [222, 0, 0], [255, 206, 0]])(y));
const ITALY = encodePNG(W, H, (x) => vStripes([[0, 146, 70], [255, 255, 255], [206, 43, 55]])(x));
const NETHERLANDS = encodePNG(W, H, (x, y) => hStripes([[174, 28, 40], [255, 255, 255], [33, 70, 139]])(y));
const NIGERIA = encodePNG(W, H, (x) => vStripes([[0, 135, 81], [255, 255, 255], [0, 135, 81]])(x));

fs.mkdirSync('C:/qu/seed-assets', { recursive: true });
fs.writeFileSync('C:/qu/seed-assets/france.png', FRANCE);
fs.writeFileSync('C:/qu/seed-assets/germany.png', GERMANY);
fs.writeFileSync('C:/qu/seed-assets/italy.png', ITALY);
fs.writeFileSync('C:/qu/seed-assets/netherlands.png', NETHERLANDS);
fs.writeFileSync('C:/qu/seed-assets/nigeria.png', NIGERIA);

console.log('Generated 5 flag images in C:/qu/seed-assets');

// --- Seed the quiz via the running API ---

const BASE = process.env.SEED_BASE_URL || 'http://localhost:5173';

async function api(path, options = {}) {
  const res = await fetch(`${BASE}/api${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${path} -> ${res.status}: ${data.error}`);
  return data;
}

async function main() {
  const { token } = await api('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username: 'admin', password: 'changeme123' }),
  });
  const auth = { Authorization: `Bearer ${token}` };

  const { quiz } = await api('/quizzes', {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({
      title: 'World Geography: Flags & Capitals',
      description: 'Test your knowledge of flags, capitals, and countries.',
      time_limit_seconds: 600,
    }),
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
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="${filename}"\r\nContent-Type: image/png\r\n\r\n`,
      ),
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
    {
      text: 'Which country does this flag belong to?',
      image: 'C:/qu/seed-assets/france.png',
      choices: ['France', 'Spain', 'Italy', 'Germany'],
      correct: 'France',
    },
    {
      text: 'Which country does this flag belong to?',
      image: 'C:/qu/seed-assets/germany.png',
      choices: ['Germany', 'Belgium', 'Austria', 'Poland'],
      correct: 'Germany',
    },
    {
      text: 'Which country does this flag belong to?',
      image: 'C:/qu/seed-assets/italy.png',
      choices: ['Italy', 'Mexico', 'Ireland', 'Hungary'],
      correct: 'Italy',
    },
    {
      text: 'Which country does this flag belong to?',
      image: 'C:/qu/seed-assets/netherlands.png',
      choices: ['Netherlands', 'Luxembourg', 'Russia', 'France'],
      correct: 'Netherlands',
    },
    {
      text: 'Which country does this flag belong to?',
      image: 'C:/qu/seed-assets/nigeria.png',
      choices: ['Nigeria', 'Ireland', 'Italy', 'Mali'],
      correct: 'Nigeria',
    },
  ];

  for (const fq of flagQuestions) {
    const q = await addQuestion({
      type: 'single',
      text: fq.text,
      points: 1,
      choices: fq.choices.map((c) => ({ text: c, is_correct: c === fq.correct })),
    });
    await attachImage(q.id, fq.image);
    console.log(`Added flag question "${fq.text}" (${fq.correct}) with image`);
  }

  await addQuestion({
    type: 'single',
    text: 'What is the capital of France?',
    points: 1,
    choices: [
      { text: 'Paris', is_correct: true },
      { text: 'Lyon', is_correct: false },
      { text: 'Marseille', is_correct: false },
      { text: 'Nice', is_correct: false },
    ],
  });
  console.log('Added capital question: France');

  await addQuestion({
    type: 'single',
    text: 'What is the capital of Japan?',
    points: 1,
    choices: [
      { text: 'Tokyo', is_correct: true },
      { text: 'Osaka', is_correct: false },
      { text: 'Kyoto', is_correct: false },
      { text: 'Nagoya', is_correct: false },
    ],
  });
  console.log('Added capital question: Japan');

  await addQuestion({
    type: 'multiple',
    text: 'Which of these countries are located in Europe?',
    points: 2,
    choices: [
      { text: 'France', is_correct: true },
      { text: 'Germany', is_correct: true },
      { text: 'Italy', is_correct: true },
      { text: 'Nigeria', is_correct: false },
      { text: 'Japan', is_correct: false },
    ],
  });
  console.log('Added multiple-choice question: European countries');

  await addQuestion({
    type: 'text',
    text: 'Name a country located entirely in the Southern Hemisphere.',
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
