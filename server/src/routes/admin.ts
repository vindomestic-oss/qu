import { Router } from 'express';
import path from 'path';
import { requireAdmin } from '../middleware/jwt';
import { listBackups, runBackupOnce } from '../lib/backup';

export const adminRouter = Router();
adminRouter.use(requireAdmin);

adminRouter.get('/backups', (_req, res) => {
  res.json({ backups: listBackups() });
});

// Off-site copy for EJKA's OneDrive, made right after an event, so it refreshes today's file from
// the current state first. The file holds children's names and answers.
adminRouter.get('/backups/latest', async (_req, res, next) => {
  try {
    const filePath = await runBackupOnce(new Date(), { refresh: true });
    res.setHeader('Cache-Control', 'no-store');
    res.download(filePath, path.basename(filePath));
  } catch (err) {
    next(err);
  }
});
