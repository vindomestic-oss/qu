import { chromium } from 'playwright';
import fs from 'fs';

const BASE = 'http://localhost:5173';
const SHOT_DIR = 'C:/qu/screens';
fs.mkdirSync(SHOT_DIR, { recursive: true });

const VIEWPORTS = {
  ipadPortrait: { width: 768, height: 1024 },
  ipadLandscape: { width: 1024, height: 768 },
  laptop: { width: 1440, height: 900 },
};

function log(label, msg) {
  console.log(`[${label}] ${msg}`);
}

async function checkOverflow(page, name) {
  const info = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  const overflow = info.scrollWidth > info.clientWidth + 2; // small tolerance
  log('overflow-check', `${name}: scrollWidth=${info.scrollWidth} clientWidth=${info.clientWidth} ${overflow ? '*** HORIZONTAL OVERFLOW ***' : 'OK'}`);
  return overflow;
}

async function shot(page, viewportName, pageName) {
  const path = `${SHOT_DIR}/${viewportName}-${pageName}.png`;
  await page.screenshot({ path, fullPage: true });
}

async function main() {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });

  // Set up real data once (admin login, quiz with a question + image, session)
  const setupCtx = await browser.newContext();
  const setup = await setupCtx.newPage();
  await setup.goto(`${BASE}/admin/login`);
  await setup.getByLabel('Username').fill('admin');
  await setup.getByLabel('Password').fill('changeme123');
  await setup.getByRole('button', { name: /log in/i }).click();
  await setup.waitForURL(/\/admin$/);

  await setup.getByLabel('Title').fill('Responsive Check Quiz');
  await setup.getByLabel('Description').fill('for layout testing');
  await setup.getByLabel(/Time limit/).fill('5');
  await setup.getByRole('button', { name: /create quiz/i }).click();
  await setup.waitForURL(/\/admin\/quizzes\/\d+$/);
  const quizUrl = setup.url();
  const quizId = quizUrl.match(/quizzes\/(\d+)/)[1];

  const qForm = setup.locator('form').filter({ has: setup.locator('select') });
  await setup.getByRole('button', { name: /add question/i }).click();
  await qForm.locator('select').selectOption('single');
  await qForm.locator('textarea').fill('Which of these is a fruit, given a fairly long question text to test wrapping behavior on narrow screens?');
  const choiceInputs = qForm.locator('input[placeholder^="Choice"]');
  await choiceInputs.nth(0).fill('Carrot');
  await choiceInputs.nth(1).fill('Apple');
  await qForm.locator('input[type="radio"]').nth(1).check();
  await qForm.getByRole('button', { name: /save question/i }).click();
  await setup.waitForTimeout(300);

  await setup.getByRole('button', { name: /create session/i }).click();
  await setup.waitForTimeout(300);
  const joinCodeText = await setup.locator('strong').filter({ hasText: /^[A-Z0-9]{6}$/ }).first().innerText();
  log('setup', `quiz ${quizId} ready, join code ${joinCodeText}`);

  await setupCtx.close();

  const pagesToCheck = [
    { name: 'home', path: '/', auth: null },
    { name: 'admin-login', path: '/admin/login', auth: null },
    { name: 'join', path: '/join', auth: null },
  ];

  for (const [viewportName, viewport] of Object.entries(VIEWPORTS)) {
    log('viewport', `=== ${viewportName} (${viewport.width}x${viewport.height}) ===`);
    const ctx = await browser.newContext({ viewport });
    const page = await ctx.newPage();

    for (const p of pagesToCheck) {
      await page.goto(`${BASE}${p.path}`);
      await page.waitForTimeout(200);
      await checkOverflow(page, `${p.name}`);
      await shot(page, viewportName, p.name);
    }

    // Admin dashboard + quiz editor (needs login)
    await page.goto(`${BASE}/admin/login`);
    await page.getByLabel('Username').fill('admin');
    await page.getByLabel('Password').fill('changeme123');
    await page.getByRole('button', { name: /log in/i }).click();
    await page.waitForURL(/\/admin$/);
    await page.waitForTimeout(200);
    await checkOverflow(page, 'admin-dashboard');
    await shot(page, viewportName, 'admin-dashboard');

    await page.goto(`${BASE}/admin/quizzes/${quizId}`);
    await page.waitForTimeout(300);
    await checkOverflow(page, 'quiz-editor');
    await shot(page, viewportName, 'quiz-editor');

    // Start the session fresh per viewport so we can check the participant play page too
    // (only do this on first viewport to avoid double-starting; check session status first)
    const sessionStatusText = await page.locator('body').innerText();
    if (sessionStatusText.includes('Start now')) {
      await page.getByRole('button', { name: /start now/i }).click();
      await page.waitForTimeout(300);
    }
    await checkOverflow(page, 'quiz-editor-active-session');
    await shot(page, viewportName, 'quiz-editor-active-session');

    await ctx.close();
  }

  // Participant play + results page, checked at iPad portrait specifically (most likely device)
  const partCtx = await browser.newContext({ viewport: VIEWPORTS.ipadPortrait });
  const part = await partCtx.newPage();
  await part.goto(`${BASE}/join`);
  await part.getByLabel(/join code/i).fill(joinCodeText);
  await part.getByLabel(/your name/i).fill('ResponsiveTestUser');
  await part.getByRole('button', { name: /^join$/i }).click();
  await part.waitForURL(/\/play$/);
  await part.waitForTimeout(500);
  await checkOverflow(part, 'play-ipad-portrait');
  await shot(part, 'ipadPortrait', 'play');

  // Check touch target sizes for radio inputs
  const radioBox = await part.locator('input[type="radio"]').first().boundingBox();
  log('touch-target', `radio input size: ${JSON.stringify(radioBox)}`);
  const buttonBox = await part.getByRole('button', { name: /^next$/i }).boundingBox();
  log('touch-target', `Next button size: ${JSON.stringify(buttonBox)}`);

  await browser.close();
  log('done', 'Responsive check completed. Screenshots in C:/qu/screens');
}

main().catch((err) => {
  console.error('RESPONSIVE CHECK FAILED:', err);
  process.exit(1);
});
