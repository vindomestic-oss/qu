import fs from 'fs';

const LANGS = ['BG', 'CS', 'DE', 'ES', 'FI', 'HU', 'IT', 'LT', 'LV', 'RU', 'UK'];

function parseFile(code) {
  const raw = fs.readFileSync(`C:/qu/quiz_docs_extracted/${code}.txt`, 'utf-8');
  // Drop all blank lines up front - verified manually that every file has exactly
  // 3 non-blank lines (goodluck, committee name, "True/False" section header)
  // between the intro paragraph and the first True/False statement.
  const lines = raw.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);

  const introIdx = lines.findIndex((l, i) => i < 10 && /\b40\b/.test(l));
  if (introIdx === -1) throw new Error(`${code}: could not find intro anchor ("40")`);

  let cursor = introIdx + 1 + 3; // skip goodluck + committee + "True/False" header
  const strip = (l) => l.replace(/^\d+[.)]\s*/, '').replace(/^[A-D][.)]\s+/, '');

  const tf = lines.slice(cursor, cursor + 5).map(strip);
  cursor += 5;
  cursor += 1; // Multiple Choice header

  const mc = [];
  for (let i = 0; i < 15; i++) {
    const question = strip(lines[cursor]);
    const options = lines.slice(cursor + 1, cursor + 5).map(strip);
    mc.push({ question, options });
    cursor += 5;
  }
  cursor += 1; // Open Questions header

  const open = lines.slice(cursor, cursor + 10).map(strip);
  cursor += 10;
  cursor += 1; // Picture Questions header

  // Every language uses the same "caption line, then 2 question lines" x 10 structure
  // (whether or not the caption includes the "(chidonNN-MM.png)" filename reference).
  const pictureBlocks = [];
  for (let i = 0; i < 10; i++) {
    const captionRaw = lines[cursor];
    const captionMatch = captionRaw.match(/\(chidon\d+-\d+\.png\)\s*:?\s*(.*)/);
    const caption = strip(captionMatch ? captionMatch[1] : captionRaw).trim();
    let q1 = lines[cursor + 1] ?? '';
    let consumed = 3;
    // Some languages (observed in RU) split q1 across two lines instead of one
    // sentence; every properly-formed q1 ends in "?", so a q1 missing that
    // terminator means the next line is actually its continuation.
    if (!q1.trim().endsWith('?')) {
      q1 = `${q1} ${lines[cursor + 2] ?? ''}`.trim();
      consumed = 4;
    }
    const q2 = lines[cursor + consumed - 1] ?? '';
    pictureBlocks.push({ caption, q1, q2 });
    cursor += consumed;
  }

  const remainingLines = lines.length - cursor;
  return { code, tf, mc, open, pictureBlocks, remainingLines, totalLines: lines.length };
}

const result = {};
for (const code of LANGS) {
  const r = parseFile(code);
  const ok =
    r.tf.length === 5 &&
    r.mc.length === 15 &&
    r.mc.every((m) => m.options.length === 4 && m.options.every((o) => o.length > 0)) &&
    r.open.length === 10 &&
    r.open.every((o) => o.length > 0) &&
    r.pictureBlocks.length === 10 &&
    r.pictureBlocks.every((p) => p.q1.length > 0 && p.q2.length > 0);
  console.log(`${r.code}: tf=${r.tf.length} mc=${r.mc.length} open=${r.open.length} pics=${r.pictureBlocks.length} remaining=${r.remainingLines}/${r.totalLines} ${ok ? 'OK' : '*** MISMATCH ***'}`);
  result[code] = r;
}

fs.writeFileSync('C:/qu/parsed-translations.json', JSON.stringify(result, null, 1), 'utf-8');
console.log('\nWrote parsed-translations.json for inspection.');
