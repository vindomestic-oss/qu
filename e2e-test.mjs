import { chromium } from 'playwright';

const BASE = process.env.E2E_BASE_URL || 'http://localhost:5173';
// Local runs only: use the same value as ADMIN_PASSWORD in server/.env if you set one there.
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'changeme123';
// Browser channel: msedge by default; PW_CHANNEL= (empty) uses Playwright's bundled Chromium.
const CHANNEL = process.env.PW_CHANNEL ?? 'msedge';

function log(label, msg) {
  console.log(`[${label}] ${msg}`);
}

async function main() {
  const browser = await chromium.launch({ ...(CHANNEL ? { channel: CHANNEL } : {}), headless: true });

  const adminCtx = await browser.newContext();
  const admin = await adminCtx.newPage();
  admin.on('console', (m) => { if (m.type() === 'error') log('admin-console-error', m.text()); });
  admin.on('pageerror', (e) => log('admin-page-error', e.message));

  log('admin', 'logging in');
  await admin.goto(`${BASE}/admin/login`);
  await admin.getByLabel('Username').fill('admin');
  await admin.getByLabel('Password').fill(ADMIN_PASSWORD);
  await admin.getByRole('button', { name: /log in/i }).click();
  await admin.waitForURL(/\/admin$/);
  log('admin', 'logged in, on dashboard');

  log('admin', 'creating quiz');
  await admin.getByLabel('Title').fill('Browser E2E Quiz');
  await admin.getByLabel('Description').fill('created by playwright');
  await admin.getByLabel(/Time limit/).fill('2');
  await admin.getByRole('button', { name: /create quiz/i }).click();
  await admin.waitForURL(/\/admin\/quizzes\/\d+$/);
  log('admin', `on quiz editor: ${admin.url()}`);

  // Scope question-form interactions to the QuestionForm: the quiz-meta form above it also has a
  // textarea (description) and a select (main language).
  const qForm = admin.getByTestId('question-form');

  // Add single-choice question
  await admin.getByRole('button', { name: /add question/i }).click();
  await qForm.getByLabel('Type').selectOption('single');
  await qForm.getByLabel('Question text').fill('2 + 2 = ?');
  const choiceInputs = qForm.locator('input[placeholder^="Choice"]');
  await choiceInputs.nth(0).fill('3');
  await choiceInputs.nth(1).fill('4');
  await qForm.locator('input[type="radio"]').nth(1).check();
  await qForm.getByRole('button', { name: /save question/i }).click();
  log('admin', 'added single-choice question');
  await admin.waitForTimeout(300);

  // Add multiple-choice question
  await admin.getByRole('button', { name: /add question/i }).click();
  await qForm.getByLabel('Type').selectOption('multiple');
  await qForm.getByLabel('Question text').fill('Pick the primes');
  const choiceInputs2 = qForm.locator('input[placeholder^="Choice"]');
  await choiceInputs2.nth(0).fill('2');
  await choiceInputs2.nth(1).fill('4');
  await qForm.getByRole('button', { name: /add choice/i }).click();
  await choiceInputs2.nth(2).fill('3');
  await qForm.locator('input[type="checkbox"]').nth(0).check();
  await qForm.locator('input[type="checkbox"]').nth(2).check();
  await qForm.getByRole('button', { name: /save question/i }).click();
  log('admin', 'added multiple-choice question');
  await admin.waitForTimeout(300);

  // Add text question
  await admin.getByRole('button', { name: /add question/i }).click();
  await qForm.getByLabel('Type').selectOption('text');
  await qForm.getByLabel('Question text').fill('Explain gravity briefly.');
  await qForm.getByRole('button', { name: /save question/i }).click();
  log('admin', 'added text question');
  await admin.waitForTimeout(300);

  // Create + start session
  await admin.getByRole('button', { name: /start quiz \(open lobby\)/i }).click();
  await admin.waitForTimeout(300);
  const joinCodeText = await admin.getByTestId('join-code').getAttribute('data-code');
  log('admin', `join code: ${joinCodeText}`);
  await admin.getByRole('button', { name: /start now/i }).click();
  await admin.waitForTimeout(300);
  log('admin', 'session started');

  // --- Participant flow ---
  const partCtx = await browser.newContext();
  const part = await partCtx.newPage();
  part.on('console', (m) => { if (m.type() === 'error') log('participant-console-error', m.text()); });
  part.on('pageerror', (e) => log('participant-page-error', e.message));

  await part.goto(`${BASE}/join`);
  // Interface language always defaults to English now (no browser-locale detection), so this
  // script's selectors can rely on English labels without forcing the language explicitly.
  await part.getByLabel(/join code/i).fill(joinCodeText);
  await part.getByLabel(/your name/i).fill('PlaywrightBot');
  await part.getByRole('button', { name: /^join$/i }).click();
  await part.waitForURL(/\/play$/);
  log('participant', 'joined, on play page');
  await part.waitForTimeout(500);

  const bodyText1 = await part.locator('body').innerText();
  log('participant', `play page text snapshot: ${bodyText1.slice(0, 200).replace(/\n/g, ' | ')}`);

  // Admin's live monitor should already reflect the join via socket push, with no manual refresh.
  await admin.waitForTimeout(500);
  let monitorText = await admin.locator('body').innerText();
  log('admin', `live monitor after join: ${monitorText.replace(/\n/g, ' | ')}`);

  // Answer single-choice (radio) - question 1
  await part.locator('input[type="radio"]').nth(1).check();
  log('participant', 'answered Q1 (single choice)');
  await part.waitForTimeout(500);

  monitorText = await admin.locator('body').innerText();
  log('admin', `live monitor after Q1: ${monitorText.replace(/\n/g, ' | ')}`);

  await part.getByRole('button', { name: /^next$/i }).click();
  await part.waitForTimeout(200);

  // Answer multiple-choice - question 2
  const checkboxes = part.locator('input[type="checkbox"]');
  await checkboxes.nth(0).check();
  await checkboxes.nth(2).check();
  log('participant', 'answered Q2 (multiple choice)');
  await part.waitForTimeout(500);

  monitorText = await admin.locator('body').innerText();
  log('admin', `live monitor after Q2: ${monitorText.replace(/\n/g, ' | ')}`);

  await part.getByRole('button', { name: /^next$/i }).click();
  await part.waitForTimeout(200);

  // Answer text question - question 3
  await part.locator('textarea').fill('Mass attracts mass, curving spacetime.');
  await part.locator('textarea').blur();
  log('participant', 'answered Q3 (text)');
  await part.waitForTimeout(500);

  monitorText = await admin.locator('body').innerText();
  log('admin', `live monitor after Q3: ${monitorText.replace(/\n/g, ' | ')}`);

  // Admin ends session early
  admin.once('dialog', (d) => d.accept());
  await admin.getByRole('button', { name: /end early/i }).click();
  await admin.waitForTimeout(300);
  log('admin', 'ended session early');

  // Participant should auto-redirect to results via socket broadcast
  await part.waitForURL(/\/results$/, { timeout: 8000 });
  log('participant', 'auto-redirected to results page');
  await part.waitForTimeout(500);

  const resultsText = await part.locator('body').innerText();
  log('participant', `results page text: ${resultsText.replace(/\n/g, ' | ')}`);

  // --- Admin: grading (grading panel, wish 8) + scoreboard + CSV export ---
  // The panel's link (the session history below has one per run too).
  await admin.getByRole('link', { name: /^view results$/i }).first().click();
  await admin.waitForURL(/\/admin\/sessions\/\d+\/results$/);
  log('admin', `on results page: ${admin.url()}`);
  await admin.getByTestId('scoreboard').waitFor();

  const scoreboardBefore = await admin.locator('body').innerText();
  log('admin', `scoreboard before grading: ${scoreboardBefore.replace(/\n/g, ' | ').slice(0, 400)}`);

  // Grade the text answer in the whole-quiz review: anonymous "Answer 1", "Correct" = full points.
  await admin.getByRole('link', { name: /grade answers/i }).click();
  await admin.waitForURL(/\/grade\/\d+\/quiz\?filter=needs_review$/);
  await admin.getByText('Answer 1', { exact: true }).waitFor();
  if (!(await admin.getByText('Mass attracts mass, curving spacetime.').isVisible())) {
    throw new Error('the text answer is not shown in the grading panel');
  }
  await admin.getByRole('button', { name: /^correct$/i }).first().click();
  await admin.getByText('Saved', { exact: true }).waitFor({ timeout: 5000 });
  log('admin', 'graded the text answer as correct in the grading panel');

  await admin.goBack();
  await admin.waitForURL(/\/admin\/sessions\/\d+\/results$/);
  await admin.getByTestId('scoreboard').getByText('3 / 3').waitFor({ timeout: 5000 });
  const scoreboardAfter = await admin.locator('body').innerText();
  log('admin', `scoreboard after grading: ${scoreboardAfter.replace(/\n/g, ' | ').slice(0, 400)}`);

  // CSV export
  const [download] = await Promise.all([
    admin.waitForEvent('download'),
    admin.getByRole('button', { name: /export csv/i }).click(),
  ]);
  const csvPath = await download.path();
  const csvContent = csvPath ? await import('node:fs').then((fs) => fs.readFileSync(csvPath, 'utf-8')) : null;
  log('admin', `CSV downloaded as "${download.suggestedFilename()}", content: ${csvContent?.replace(/\n/g, ' \\n ')}`);

  await browser.close();
  log('done', 'E2E test completed successfully');
}

main().catch((err) => {
  console.error('E2E TEST FAILED:', err);
  process.exit(1);
});
