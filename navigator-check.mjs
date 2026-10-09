// Question navigator, autosave and finish flow on /play (wish 10). Run against a local server:
//   E2E_BASE_URL=http://localhost:4000 E2E_ADMIN_PASSWORD=... PW_CHANNEL= node navigator-check.mjs
// Uses Chidon 5786 (50 questions: 20 choice, 10 open, 20 picture). Its 4 rubrics (S11) are required:
// labels, group sizes, colour bands and the card's rubric badge are checked against them.
import { chromium } from 'playwright';

const BASE = process.env.E2E_BASE_URL || 'http://localhost:5173';
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'changeme123';
const CHANNEL = process.env.PW_CHANNEL ?? 'msedge';
let failures = 0;
const log = (label, msg) => console.log(`[${label}] ${msg}`);
const fail = (msg) => {
  failures += 1;
  console.log(`FAIL ${msg}`);
};
const check = (cond, msg) => (cond ? log('ok', msg) : fail(msg));

async function api(path, { method = 'GET', body, token } = {}) {
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

const { body: auth } = await api('/auth/login', { method: 'POST', body: { username: 'admin', password: ADMIN_PASSWORD } });
const token = auth.token;
const { body: list } = await api('/quizzes', { token });
const chidon = list.quizzes.find((q) => q.title.startsWith('European Chidon Tanach 5786'));
const { body: run } = await api(`/quizzes/${chidon.id}/sessions`, { method: 'POST', token });
if (run.session.status === 'pending') await api(`/sessions/${run.session.id}/start`, { method: 'PUT', token });
const code = run.session.join_code;

// Expected strip groups: runs of consecutive questions with the same rubric (S11).
const { body: full } = await api(`/quizzes/${chidon.id}`, { token });
const sections = full.quiz.sections ?? [];
const sectionName = new Map(sections.map((s) => [s.id, s.name]));
const runs = [];
for (const q of [...full.quiz.questions].sort((a, b) => a.sort_order - b.sort_order)) {
  const name = q.section_id != null ? (sectionName.get(q.section_id) ?? null) : null;
  if (!runs.length || runs[runs.length - 1].name !== name) runs.push({ name, count: 0 });
  runs[runs.length - 1].count += 1;
}

const browser = await chromium.launch({ ...(CHANNEL ? { channel: CHANNEL } : {}), headless: true });
let counter = 0;
async function participant({ uiLang, viewport = { width: 1024, height: 768 } } = {}) {
  const ctx = await browser.newContext({ viewport, reducedMotion: 'reduce' });
  if (uiLang) await ctx.addInitScript((l) => sessionStorage.setItem('quiz_ui_language', l), uiLang);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => fail(`page error: ${e.message}`));
  counter += 1;
  await page.goto(`${BASE}/join`);
  await page.locator('input').nth(0).fill(code);
  await page.locator('input').nth(1).fill(`Nav ${Date.now()}-${counter}`);
  await page.locator('button[type=submit]').click();
  await page.waitForURL(/\/play$/);
  await page.waitForSelector('[data-testid=question-nav]');
  return page;
}
const visibleQuestionNumber = async (page) => Number((await page.locator('.qcard-head__count').innerText()).match(/\d+/)[0]);

// 1. Strip structure, jumping, URL, answered state, autosave on leave
{
  const page = await participant();
  const groups = await page.locator('.qnav-group').count();
  const labels = await page.locator('.qnav-group-label').count();
  log('strip', `${groups} group(s), ${labels} label(s)`);
  // Chidon 5786 always has its 4 seeded rubrics (S11): never fall back to "no rubrics" here.
  check(
    sections.map((s) => s.name).join(' | ') === 'True / False | Multiple choice | Open questions | Picture questions',
    `Chidon 5786 has its 4 rubrics (${sections.map((s) => s.name).join(' | ')})`,
  );
  check(groups === 4 && labels === 4, `4 labelled groups in the strip (${groups} groups, ${labels} labels)`);
  {
    check(groups === runs.length, `${runs.length} rubric groups in the strip (got ${groups})`);
    const texts = await page.locator('.qnav-group-label').allInnerTexts();
    const expected = runs.filter((r) => r.name).map((r) => r.name);
    check(JSON.stringify(texts) === JSON.stringify(expected), `rubric labels: ${texts.join(' | ')}`);
    const sizes = [];
    for (let g = 0; g < groups; g++) sizes.push(await page.locator('.qnav-group').nth(g).locator('.qnav-item').count());
    check(JSON.stringify(sizes) === JSON.stringify(runs.map((r) => r.count)), `group sizes ${sizes.join('/')}`);
    const bands = await page.locator('.qnav-group .qnav-band').count();
    check(bands === expected.length, `one colour band per labelled group (${bands})`);
    const colours = await page.locator('.qnav-band').evaluateAll((els) => els.map((e) => getComputedStyle(e).backgroundColor));
    check(new Set(colours).size === Math.min(new Set(expected).size, 6), `distinct band colours: ${colours.join(', ')}`);
    const firstLabel = (await page.getByTestId('nav-item-1').getAttribute('aria-label')) ?? '';
    check(runs[0].name === null || firstLabel.includes(runs[0].name), `item 1 is read with its rubric: "${firstLabel}"`);
    const badge = page.getByTestId('rubric-badge');
    check(runs[0].name === null || ((await badge.count()) === 1 && (await badge.innerText()).includes(runs[0].name)), 'Q1 card shows its rubric badge');
  }
  check((await page.locator('[data-testid=question-nav] [aria-current=step]').count()) === 1, 'exactly one current item');
  await page.getByTestId('nav-item-31').click();
  check((await visibleQuestionNumber(page)) === 31 && page.url().endsWith('?q=31'), 'nav-item-31 shows Q31 and ?q=31');
  await page.getByTestId('nav-item-1').click();
  await page.locator('.choice').first().click();
  await page.waitForTimeout(500);
  check((await page.getByTestId('nav-item-1').getAttribute('data-state')) === 'answered', 'answering Q1 marks it answered');

  await page.getByTestId('nav-item-21').click();
  const posted = page.waitForRequest((r) => r.method() === 'POST' && r.url().includes('/api/my/answers/'), { timeout: 5000 });
  await page.locator('textarea').fill('Shepherd');
  await page.getByTestId('nav-item-22').click();
  await posted.then(() => log('ok', 'leaving Q21 sends its draft')).catch(() => fail('no POST when leaving Q21'));
  await page.waitForTimeout(500);
  check((await page.getByTestId('nav-item-21').getAttribute('data-state')) === 'answered', 'Q21 answered after leaving');

  await page.getByTestId('nav-item-21').click();
  await page.locator('textarea').fill('');
  await page.getByTestId('nav-item-22').click();
  await page.waitForTimeout(600);
  check((await page.getByTestId('nav-item-21').getAttribute('data-state')) === 'unanswered', 'clearing Q21 marks it unanswered');

  await page.reload();
  await page.waitForSelector('[data-testid=question-nav]');
  check(page.url().endsWith('?q=22') && (await visibleQuestionNumber(page)) === 22, 'reload stays on ?q=22');
  check((await page.getByTestId('nav-item-1').getAttribute('data-state')) === 'answered', 'states survive the reload');

  // Next all the way: the current item stays inside the scroller
  await page.getByTestId('nav-item-1').click();
  for (let i = 0; i < 49; i++) {
    await page.getByTestId('nav-next').click();
    const item = await page.locator('[aria-current=step]').boundingBox();
    const scroller = await page.getByTestId('question-nav').boundingBox();
    if (item.x < scroller.x - 1 || item.x + item.width > scroller.x + scroller.width + 1) {
      fail(`Q${i + 2}: current item outside the strip`);
      break;
    }
  }
  check((await visibleQuestionNumber(page)) === 50, 'Next reaches Q50');

  // Keyboard: roving tabindex
  await page.getByTestId('nav-item-50').focus();
  await page.keyboard.press('ArrowLeft');
  const focused = await page.evaluate(() => document.activeElement?.getAttribute('data-testid'));
  check(focused === 'nav-item-49', 'ArrowLeft moves focus to 49');
  const tabStops = await page.locator('[data-testid=question-nav] .qnav-item[tabindex="0"]').count();
  check(tabStops === 1, 'one Tab stop in the strip');

  // Bad ?q values
  await page.goto(`${BASE}/play?q=abc`);
  await page.waitForSelector('[data-testid=question-nav]');
  check((await visibleQuestionNumber(page)) === 1, '?q=abc shows Q1');
  await page.goto(`${BASE}/play?q=999`);
  await page.waitForSelector('[data-testid=question-nav]');
  check((await visibleQuestionNumber(page)) === 50, '?q=999 shows Q50');
  await page.context().close();
}

// 2. RTL: the strip runs right to left
{
  const page = await participant({ uiLang: 'he' });
  const a = await page.getByTestId('nav-item-1').boundingBox();
  const b = await page.getByTestId('nav-item-2').boundingBox();
  check(a.x > b.x, 'Hebrew UI: item 1 is right of item 2');
  await page.context().close();
}

// 3. Race: no characters lost while a save is slow
{
  const page = await participant();
  await page.route('**/api/my/answers/*', (r) => setTimeout(() => r.continue().catch(() => {}), 1000));
  await page.getByTestId('nav-item-21').click();
  await page.locator('textarea').pressSequentially('abc');
  await page.waitForTimeout(1700);
  await page.locator('textarea').pressSequentially(' def');
  await page.getByTestId('nav-item-22').click();
  await page.waitForTimeout(3000);
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await page.reload();
  await page.waitForSelector('[data-testid=question-nav]');
  await page.getByTestId('nav-item-21').click();
  check((await page.locator('textarea').inputValue()) === 'abc def', 'slow save: "abc def" kept');
  await page.context().close();
}

// 4. Finish: warning, draft saved first, a failed save blocks the submit, then submit works
{
  const page = await participant();
  await page.getByTestId('nav-item-1').click();
  await page.locator('.choice').first().click();
  await page.getByTestId('nav-item-2').click();
  await page.locator('.choice').first().click();
  await page.getByTestId('nav-item-3').click();
  await page.locator('.choice').first().click();
  await page.getByTestId('nav-item-50').click();
  await page.locator('textarea').fill('draft before finish');
  // A failing save stops the submit
  await page.route('**/api/my/answers/*', (r) => r.fulfill({ status: 500, body: '{"error":"x"}' }));
  await page.getByTestId('nav-next').click();
  await page.waitForSelector('dialog.qoverview[open]');
  const warn = await page.locator('.qoverview .warn').innerText();
  check(/\b4\b/.test(warn) && !/\b1,/.test(warn), 'overview lists the unanswered numbers');
  let submitCalls = 0;
  page.on('request', (r) => {
    if (r.url().endsWith('/api/my/submit')) submitCalls += 1;
  });
  await page.locator('.qoverview .btn-finish').click();
  await page.waitForTimeout(800);
  check(submitCalls === 0 && (await page.locator('.qoverview [role=alert]').count()) === 1, 'failed save: no submit, error shown');
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  const order = [];
  page.on('request', (r) => {
    if (r.url().includes('/api/my/answers/') || r.url().endsWith('/api/my/submit')) order.push(r.url().endsWith('/submit') ? 'submit' : 'save');
  });
  await page.locator('.qoverview .btn-finish').click();
  await page.waitForTimeout(1500);
  check(order[0] === 'save' && order.includes('submit'), `draft saved before submit (${order.join(' → ')})`);
  check((await page.locator('[data-testid=question-nav]').count()) === 0, 'submitted screen: strip gone');
  const token = await page.evaluate(() => sessionStorage.getItem('quiz_participant_token'));
  const late = await fetch(`${BASE}/api/my/answers/1`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ selected_choice_ids: [] }),
  });
  check(late.status === 409, 'a save after submit gets 409');
  await page.reload();
  await page.waitForTimeout(1000);
  check((await page.locator('[data-testid=question-nav]').count()) === 0, 'reload lands on the submitted screen');
  await page.context().close();
}

await browser.close();
if (failures) {
  console.error(`navigator-check: ${failures} failure(s)`);
  process.exit(1);
}
log('done', 'Navigator check passed');
