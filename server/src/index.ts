import './loadEnv';

import http from 'http';
import { createApp } from './app';
import { initSocket } from './socket';
import { scheduleBackups } from './lib/backup';

const app = createApp();
const httpServer = http.createServer(app);
initSocket(httpServer);

const PORT = process.env.PORT ? Number(process.env.PORT) : 4000;
httpServer.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
  scheduleBackups();
});
