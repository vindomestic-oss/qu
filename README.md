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

The seed script creates an admin with username `admin` and password `changeme123` (unless overridden — see below). **This only runs once**: if an admin already exists it does nothing, so to set a specific username/password up front, set env vars before seeding:

```sh
ADMIN_USERNAME=myname ADMIN_PASSWORD=mypassword npm run seed
```

There is currently no "change password" screen in the admin UI. To change it later, either delete the `admins` row from `server/quiz.db` and re-run `npm run seed`, or edit it directly with a short script (ask if you want one).

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

- All data lives in `server/quiz.db` (a single SQLite file) and uploaded question images in `server/uploads/`. Back up both together; they're not tied to any external service.
- `server/.env` holds the signing secret for login tokens (`JWT_SECRET`) and the seed admin credentials. It's already generated and gitignored — don't delete/regenerate it while a quiz is actively running, or existing logins will be invalidated (harmless, just re-login).

## Notes on scale/behavior

- Built for casual/classroom-scale use (~100 participants), one quiz session active per quiz at a time.
- Session timing is server-enforced and synced across all participants via Socket.IO; ending the quiz (by admin, or automatically when time runs out) is authoritative even if a participant's own clock drifts.
- Text-answer questions require manual grading by the admin after the session ends (session results page); single/multiple-choice are auto-graded on submission.
