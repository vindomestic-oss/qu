// Layout stability of the active /play page (wish 11). Run against a local server with a seeded DB:
//   E2E_BASE_URL=http://localhost:4000 E2E_ADMIN_PASSWORD=... PW_CHANNEL= node layout-stability-check.mjs
// Checks on Chidon 5786 that header, Next and the card's top edge never move between questions, between
// content languages, while a picture loads, while the timer ticks and when a save fails.
import { chromium } from 'playwright';

const BASE = process.env.E2E_BASE_URL || 'http://localhost:5173';
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'changeme123';
const CHANNEL = process.env.PW_CHANNEL ?? 'msedge';
const TOL = 0.5;
let failures = 0;

function log(label, msg) {
  console.log(`[${label}] ${msg}`);
}
function fail(msg) {
  failures += 1;
  console.log(`FAIL ${msg}`);
}
const near = (a, b) => Math.abs(a - b) <= TOL;

async function api(path, { method = 'GET', body, token } = {}) {
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

const { token } = await api('/auth/login', { method: 'POST', body: { username: 'admin', password: ADMIN_PASSWORD } });
const { quizzes } = await api('/quizzes', { token });
const chidon = quizzes.find((q) => q.title.startsWith('European Chidon Tanach 5786'));
const geography = quizzes.find((q) => q.title.startsWith('World Geography'));
async function openRun(quizId) {
  const { session } = await api(`/quizzes/${quizId}/sessions`, { method: 'POST', token });
  if (session.status === 'pending') await api(`/sessions/${session.id}/start`, { method: 'PUT', token });
  return session;
}
const chidonRun = await openRun(chidon.id);
const geoRun = await openRun(geography.id);

const browser = await chromium.launch({ ...(CHANNEL ? { channel: CHANNEL } : {}), headless: true });
let joinCounter = 0;

async function participant({ viewport, colorScheme = 'light', run = chidonRun, uiLang } = {}) {
  const ctx = await browser.newContext({ viewport, colorScheme, reducedMotion: 'reduce' });
  await ctx.addInitScript((lang) => {
    window.__shifts = [];
    try {
      // Shifts right after a tap (hadRecentInput) are the expected change to the next question: a
      // longer question makes the card taller. Only shifts nobody caused are counted, as in CLS.
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          if (e.hadRecentInput) continue;
          window.__shifts.push(
            (e.sources || []).map((s) => {
              const el = s.node && s.node.nodeType === 1 ? s.node : s.node && s.node.parentElement;
              return el && el.closest ? el.closest('.qcard, .qnav, .play-actionbar') !== null : false;
            }),
          );
        }
      }).observe({ type: 'layout-shift', buffered: true });
    } catch {}
    if (lang) sessionStorage.setItem('quiz_ui_language', lang);
  }, uiLang ?? null);
  const page = await ctx.newPage();
  joinCounter += 1;
  await page.goto(`${BASE}/join`);
  await page.locator('input').nth(0).fill(run.join_code);
  await page.locator('input').nth(1).fill(`Layout ${Date.now()}-${joinCounter}`);
  await page.locator('button[type=submit]').click();
  await page.waitForURL(/\/play$/);
  await page.waitForSelector('[data-testid=question-card]');
  return page;
}

async function boxes(page) {
  await page.evaluate(() => window.scrollTo(0, 0));
  const box = async (sel) => {
    const el = page.locator(sel).first();
    return (await el.count()) ? el.boundingBox() : null;
  };
  return {
    card: await box('[data-testid=question-card]'),
    nav: await box('[data-testid=question-nav]'),
    next: await box('[data-testid=nav-next]'),
    header: await box('header.play-header'),
  };
}

// First answer element of the question on screen: an option row, or the text field. No waiting:
// a locator with no match would otherwise sit through Playwright's 30 s timeout.
async function answerBox(page) {
  for (const sel of ['.choice', '.text-answer textarea']) {
    const el = page.locator(sel).first();
    if (await el.count()) return el.boundingBox();
  }
  return null;
}

async function clickNext(page) {
  await page.getByTestId('nav-next').click();
  await page.waitForTimeout(30);
}

// 1. Every question, every viewport, both themes
for (const viewport of [
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1280, height: 800 },
  { width: 390, height: 844 },
]) {
  for (const colorScheme of ['light', 'dark']) {
    const page = await participant({ viewport, colorScheme });
    const total = Number((await page.locator('.qcard-head__count').innerText()).match(/(\d+)\D*$/)[1]);
    let first = null;
    for (let i = 0; i < total; i++) {
      const b = await boxes(page);
      if (!first) first = b;
      const tag = `${viewport.width}x${viewport.height} ${colorScheme} Q${i + 1}`;
      if (!near(b.next.x, first.next.x) || !near(b.next.y, first.next.y)) fail(`${tag}: Next moved (${b.next.x},${b.next.y})`);
      if (['x', 'y', 'width', 'height'].some((k) => !near(b.header[k], first.header[k]))) fail(`${tag}: header moved`);
      if (b.nav && first.nav && (!near(b.nav.y, first.nav.y) || !near(b.nav.height, first.nav.height))) fail(`${tag}: navigator moved`);
      if (!near(b.card.y, first.card.y) || !near(b.card.x, first.card.x) || !near(b.card.width, first.card.width)) fail(`${tag}: card top/x/width moved`);
      // The card reaches down to the action bar (only main's 12 px padding in between).
      const bar = await page.locator('.play-actionbar').boundingBox();
      if (b.card.y + b.card.height + 12 + TOL < bar.y) fail(`${tag}: card ends above the action bar`);
      if (viewport.width === 768 && !near(b.card.height, first.card.height)) fail(`${tag}: card height ${b.card.height} vs ${first.card.height}`);
      if (i < total - 1) await clickNext(page);
    }
    const shifted = await page.evaluate(() => window.__shifts.flat().some(Boolean));
    if (shifted) fail(`${viewport.width}x${viewport.height} ${colorScheme}: layout shift inside card/navigator/action bar`);
    log('questions', `${viewport.width}x${viewport.height} ${colorScheme}: ${total} questions checked`);
    await page.context().close();
  }
}

// 2. Content languages do not move anything (768x1024)
async function languageSweep(run, label, checkHebrew) {
  const page = await participant({ viewport: { width: 768, height: 1024 }, run });
  const total = Number((await page.locator('.qcard-head__count').innerText()).match(/(\d+)\D*$/)[1]);
  const limit = Number(process.env.LAYOUT_LANG_QUESTIONS ?? total);
  for (let i = 0; i < Math.min(total, limit); i++) {
    const trigger = page.locator('.qcard-head .lang-menu__trigger');
    const chips = page.locator('.qcard-head .toggle-chip');
    const options = (await trigger.count())
      ? await (async () => {
          await trigger.click();
          const names = await page.locator('.qcard-head .lang-menu__option').allInnerTexts();
          await page.keyboard.press('Escape');
          return names.map((n) => n.replace(/^✓/, '').trim().split('\n')[0]);
        })()
      : await chips.allInnerTexts();
    const ref = await boxes(page);
    const h2Ref = await page.locator('.qcard-body h2').boundingBox();
    const optRef = await answerBox(page);
    for (const name of options) {
      if (await trigger.count()) {
        await trigger.click();
        await page.locator('.qcard-head .lang-menu__option', { hasText: name }).first().click();
      } else {
        await chips.filter({ hasText: name }).first().click();
      }
      const b = await boxes(page);
      const h2 = await page.locator('.qcard-body h2').boundingBox();
      const opt = await answerBox(page);
      const tag = `${label} Q${i + 1} ${name}`;
      if (!near(b.card.y, ref.card.y) || !near(b.next.y, ref.next.y)) fail(`${tag}: card or Next moved`);
      if (!near(h2.y, h2Ref.y) || !near(h2.height, h2Ref.height)) fail(`${tag}: question text box moved`);
      if (opt && optRef && !near(opt.y, optRef.y)) fail(`${tag}: first answer element moved`);
      if (checkHebrew && name === 'עברית') {
        const visible = await page.locator('.qcard-body h2 .lang-stack > span:not(.lang-stack__hidden)').first();
        const attrs = [await visible.getAttribute('lang'), await visible.getAttribute('dir')];
        if (attrs[0] !== 'he' || attrs[1] !== 'rtl') fail(`${tag}: Hebrew span has lang/dir ${attrs}`);
      }
    }
    if (i < total - 1) await clickNext(page);
  }
  log('languages', `${label}: ${Math.min(total, limit)} questions checked`);
  await page.context().close();
}
await languageSweep(chidonRun, 'Chidon', false);
await languageSweep(geoRun, 'Geography', true);

// Hebrew interface on Chidon Q21: content stays English, marked as such
{
  const page = await participant({ viewport: { width: 768, height: 1024 }, uiLang: 'he' });
  for (let i = 0; i < 20; i++) await clickNext(page);
  const visible = page.locator('.qcard-body h2 .lang-stack > span:not(.lang-stack__hidden)').first();
  const attrs = [await visible.getAttribute('lang'), await visible.getAttribute('dir')];
  if (attrs[0] !== 'en' || attrs[1] !== 'ltr') fail(`Hebrew UI Chidon Q21: visible span lang/dir ${attrs}`);
  log('hebrew-ui', `Q21 visible span lang=${attrs[0]} dir=${attrs[1]}`);
  await page.context().close();
}

// 3. Slow picture: answers are there at once and do not move when the image arrives
{
  const page = await participant({ viewport: { width: 1024, height: 768 } });
  await page.route('**/uploads/**', (r) => setTimeout(() => r.continue().catch(() => {}), 3000));
  let idx = 0;
  while (!(await page.locator('.qcard-media').count()) && idx < 60) {
    await clickNext(page);
    idx += 1;
  }
  // Move one further to a picture question whose image is not cached yet
  await clickNext(page);
  const target = (await page.locator('textarea').count()) ? 'textarea' : '.choice';
  const before = await page.locator(target).first().boundingBox();
  if (!before) fail('slow picture: answer area not visible immediately');
  await page.waitForTimeout(3500);
  const after = await page.locator(target).first().boundingBox();
  if (before && after && !near(before.y, after.y)) fail(`slow picture: answer area moved ${before.y} -> ${after.y}`);
  log('slow-picture', `answer area y ${before?.y} -> ${after?.y}`);
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await page.context().close();
}

// 4. Timer: width and title box stay constant for 5 s
{
  const page = await participant({ viewport: { width: 390, height: 844 } });
  const samples = [];
  for (let s = 0; s < 6; s++) {
    samples.push([(await page.locator('.countdown').boundingBox()).width, (await page.locator('.play-title').boundingBox()).width]);
    await page.waitForTimeout(1000);
  }
  if (samples.some(([w, t]) => !near(w, samples[0][0]) || !near(t, samples[0][1]))) fail(`timer: widths changed ${JSON.stringify(samples)}`);
  log('timer', `countdown width ${samples[0][0]}, title width ${samples[0][1]}`);
  await page.context().close();
}

// 5. A failed save shows in the status slot without moving anything; the next good save clears it
{
  const page = await participant({ viewport: { width: 768, height: 1024 } });
  const card = await page.locator('[data-testid=question-card]').boundingBox();
  const opt = await page.locator('.choice').first().boundingBox();
  await page.route('**/api/my/answers/*', (r) => r.fulfill({ status: 500, body: '{"error":"boom"}' }));
  await page.locator('.choice').first().click();
  await page.waitForTimeout(400);
  const statusText = await page.locator('.qcard-status').innerText();
  if (!statusText.trim()) fail('error slot: no message after a failed save');
  const slotHeight = (await page.locator('.qcard-status').boundingBox()).height;
  if (!near(slotHeight, 44)) fail(`error slot: height ${slotHeight}, expected the fixed 44 px`);
  const card2 = await page.locator('[data-testid=question-card]').boundingBox();
  const opt2 = await page.locator('.choice').first().boundingBox();
  if (!near(card.y, card2.y) || !near(card.height, card2.height) || !near(opt.y, opt2.y)) fail('error slot: card or option moved');
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await page.locator('.choice').nth(1).click();
  await page.waitForTimeout(400);
  if ((await page.locator('.qcard-status').innerText()).trim()) fail('error slot: message not cleared after a good save');
  log('error-slot', `message "${statusText.trim()}"`);
  await page.context().close();
}

// 6. A save that fails while the child moves on stays visible on other questions, survives Previous,
//    and "Try again" saves it (Chidon Q21 is a text question, saved on blur when Next is pressed).
{
  const page = await participant({ viewport: { width: 390, height: 844 } });
  for (let i = 0; i < 20; i++) await clickNext(page);
  const answer = `Layout check answer ${Date.now()}`;
  await page.locator('.text-answer textarea').fill(answer);
  await page.route('**/api/my/answers/*', (r) => r.abort('failed'));
  await clickNext(page);
  await page.waitForTimeout(400);
  const onNext = (await page.locator('.qcard-status').innerText()).trim();
  if (!/21/.test(onNext)) fail(`moved-on save: next question does not name question 21 ("${onNext}")`);
  await page.getByRole('button', { name: /previous/i }).click();
  await page.waitForTimeout(400);
  const onBack = (await page.locator('.qcard-status').innerText()).trim();
  if (!onBack) fail('moved-on save: no error when coming back to question 21');
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await page.locator('.qcard-status__retry').click();
  await page.waitForTimeout(400);
  if ((await page.locator('.qcard-status').innerText()).trim()) fail('moved-on save: error not cleared by Try again');
  await page.reload();
  await page.waitForSelector('[data-testid=question-card]');
  // A reload stays on the question in ?q=; walk there otherwise.
  const at = Number((await page.locator('.qcard-head__count').innerText()).match(/\d+/)[0]);
  for (let i = at; i < 21; i++) await clickNext(page);
  const saved = await page.locator('.text-answer textarea').inputValue();
  if (saved !== answer) fail(`moved-on save: after reload question 21 has "${saved}"`);
  log('moved-on-save', `next: "${onNext}", back: "${onBack}", after retry + reload: saved`);
  await page.context().close();
}

await browser.close();
if (failures) {
  console.error(`layout-stability-check: ${failures} failure(s)`);
  process.exit(1);
}
log('done', 'Layout stability check passed');
