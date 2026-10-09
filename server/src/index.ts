import './loadEnv';

import http from 'http';
import { createApp } from './app';
import { initSocket } from './socket';
import { scheduleBackups } from './lib/backup';
import { recoverActiveSessions, startSessionSweep } from './lib/sessionTimers';
import { joinLimiterActive } from './routes/join';

const app = createApp();
// One line for the Render log: is the join limiter on, and with how many trusted proxy hops?
const hopsSetting = process.env.TRUST_PROXY_HOPS;
console.log(
  joinLimiterActive(app)
    ? `Join rate limit: on (TRUST_PROXY_HOPS=${app.get('trust proxy')})`
    : `Join rate limit: off (TRUST_PROXY_HOPS=${hopsSetting?.trim() ? JSON.stringify(hopsSetting) : 'unset'}; set it after the /api/debug/ip check)`,
);
const httpServer = http.createServer(app);
initSocket(httpServer);
// After initSocket, so sessions that end right away still reach open screens.
recoverActiveSessions();
startSessionSweep();

const PORT = process.env.PORT ? Number(process.env.PORT) : 4000;
httpServer.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
  scheduleBackups();
});
