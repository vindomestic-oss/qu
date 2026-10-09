# Quiz App

Web-based quiz tool for a host (admin) running live quizzes for participants on the same local network, from laptops or iPads in a browser. Single/multiple-choice and free-text questions, optional images per question, synced countdown timer, live monitoring, and grading/export.

## Prerequisites

- Node.js (LTS). Check with `node -v` — if missing, install via [nodejs.org](https://nodejs.org) or `choco install nodejs-lts`.

## First-time setup

From the `qu` folder:

```sh
npm run install-all   # installs both server and client dependencies
npm run seed          # creates the admin account
```

The seed creates the admin from `ADMIN_USERNAME` (default `admin`) and `ADMIN_PASSWORD`. Locally, put both in `server/.env` (the seed loads that file); without `ADMIN_PASSWORD` it falls back to a local-development-only default and prints a warning.

In production (on Render, or with `NODE_ENV=production`) the seed refuses to start unless `ADMIN_PASSWORD` is strong: 12+ characters and not the development default. Set it in the Render dashboard (service → Environment).

To change the password, set a new `ADMIN_PASSWORD` and re-run `npm run seed` (on Render: redeploy). The seed updates the stored hash and signs out every admin login made before the change. The password is never written to the log.

## Tests

```sh
npm test --prefix server   # node:test: token checks on every admin route, socket rooms, seed password guard
```

The tests use an in-memory database and never read `server/.env`. The browser test `e2e-test.mjs` runs against a local dev server (`E2E_BASE_URL`, `E2E_ADMIN_PASSWORD`; `PW_CHANNEL` picks the browser, default `msedge`, empty for Playwright's bundled Chromium).

## Running it

**Development** (hot-reload, two processes on different ports, proxied together):

```sh
npm run dev
```

Open `http://localhost:5173`.

**Production** (one process, one port, serves both the API and the built frontend):

```sh
npm run build
npm start
```

Open `http://localhost:4000`.

## Letting participants join from other devices (iPads, laptops) on the same Wi-Fi/LAN

1. Find this machine's local IP address (Windows: `ipconfig`, look for "IPv4 Address" under your active Wi-Fi/Ethernet adapter — typically `192.168.x.x`).
2. Make sure the app is running in **production** mode (`npm run build && npm start`) so it's reachable on one fixed port (4000).
3. **Windows Firewall will likely block other devices from reaching this by default.** Add an inbound rule once, in an **elevated (Administrator)** PowerShell:

   ```powershell
   New-NetFirewallRule -DisplayName "Quiz App (port 4000)" -Direction Inbound -Protocol TCP -LocalPort 4000 -Action Allow -Profile Private
   ```

   (This wasn't done automatically — it needs admin rights the setup session didn't have. If this is a corporate-managed laptop, IT policy may also block this even with local admin rights.)
4. On each participant device, connect to the same Wi-Fi network and open `http://<this-machine's-IP>:4000/join` (e.g. `http://192.168.1.174:4000/join`).
5. Admins use the same address without `/join`, e.g. `http://192.168.1.174:4000/admin/login`.

## Data & backups

- All data lives in one SQLite file, `server/quiz.db` by default, and uploaded question images in `server/uploads/`. Three environment variables move them, for example onto a persistent disk:
  - `QUIZ_DB_PATH` (e.g. `/var/data/quiz.db`)
  - `UPLOAD_DIR` (e.g. `/var/data/uploads`)
  - `BACKUP_DIR` (default: a `backups` folder next to the database)
- The server writes a daily copy of the database (`quiz-YYYY-MM-DD.db`, UTC date) 60 seconds after it starts and then every 24 hours, and keeps the 14 newest. On Render's free plan these copies vanish with every restart, like the database itself; they only last on a persistent disk.
- Admins can download a fresh copy from the dashboard ("Download database backup"). It contains participants' names and answers: keep it only on EJKA's OneDrive.
- Restore without touching the live file: copy a backup next to it (e.g. `/var/data/restore-2026-10-20.db`), point `QUIZ_DB_PATH` at the copy and restart.
- `server/.env` holds the signing secret for login tokens (`JWT_SECRET`) and, locally, the seed admin credentials. It's gitignored — don't delete/regenerate it while a quiz is actively running, or existing logins will be invalidated (harmless, just re-login).

## Grading answers

- Open answers are graded in the grading panel at `/grade/<sessionId>` ("Grading panel" in the quiz editor's Live Session block, on the results page and in the session history). Answers become gradable once the participant has pressed "Finish and submit", or when the session ends.
- "Grader access" creates a code, link and QR for one session (valid 1, 7 or 30 days after the quiz ends, revocable at any time). Graders open `/g/<code>` or type the code on `/grade`, enter their name and can only read and grade that session. They see participants' names in the participant list and on the participant page; the whole-quiz review shows anonymous "Answer 1, 2…" rows. Never show this QR on the projector: the code reveals the correct answers.
- A participant who pressed "Finish" too early can get the questions back while the session runs: "Reopen" in the live monitor (Live Session → "Details (host only)", or the projector screen's details). Their page returns to the questions at once and they should press Finish again (the end of the session submits them anyway). Grades stay unless that answer changes; graders can grade the participant again after the next Finish. Each reopen is recorded in `grade_events` (action `reopen_submission`).
- The seeded Chidon quizzes carry model answers for all their open questions (`server/src/db/chidonAnswerKey.ts`; existing databases are filled on the next start).
- Reference check (wish 7, no AI, nothing leaves the server): a submitted text answer that equals the model answer or one of the question's "Accepted answers / spellings" (editor), ignoring case, accents, niqqud, punctuation, hyphens, spaces and one leading the/a/an/der/die/das, gets full points at once, marked "Auto: matches the model answer". Graders can change such a grade; a grade given by a person is never changed by the check. Editing the model answer or the accepted answers re-checks only automatic grades, in every run of the quiz. Identical answers appear as one row "Same answer ×N" that is graded with one click (or opened and graded one by one); "Same answer graded before" shows how people graded the same answer in earlier runs. Admins can add an answer a person credited to the accepted answers from the panel.
- Environment: `PUBLIC_BASE_URL` (the address grader links point to; set in `render.yaml`, unset locally, where the request's host is used) and `TRUST_PROXY_HOPS` (default `0`; proxy hops in front of the app, used for the rate limits on grader codes and joins, see below).
- `seed-chidon-quiz.mjs` in the repository root is legacy (it seeds through the API, without model answers); the server's own seed (`npm run seed`) creates the Chidon quizzes.

## Notes on scale/behavior

- Built for casual/classroom-scale use (~100 participants), one quiz session active per quiz at a time.
- Join rate limit: 100 unknown join codes per address within 10 minutes, then every join from that address waits for the rest of the window ("Too many attempts", translated). Successful joins, rejoins and other errors never count, so a class behind one school address is not stopped. It runs only when `TRUST_PROXY_HOPS` is 1 or more, because with `0` every visitor on Render shares the proxy's address; the server log says at start whether it is on. To choose the value: sign in as admin on the live site, run `fetch('/api/debug/ip', { headers: { Authorization: 'Bearer ' + localStorage.getItem('quiz_admin_token') } }).then((r) => r.json()).then(console.log)` in the browser console, and if your public address is the n-th entry of `xff` counted from the right, set `TRUST_PROXY_HOPS=n` in the Render dashboard; afterwards `ip` shows your own address.
- Session timing is server-enforced and synced across all participants via Socket.IO; ending the quiz (by admin, or automatically when time runs out) is authoritative even if a participant's own clock drifts.
- Text-answer questions are graded in the grading panel (see above; answers matching the model answer or an accepted answer are credited automatically); single/multiple-choice are auto-graded on submission and can be overridden there.
