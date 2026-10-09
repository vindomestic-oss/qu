import { Router } from 'express';
import { db } from '../db';
import { requireAdmin, type AuthedRequest } from '../middleware/jwt';
import { aiConfig, setKillSwitch } from '../lib/aiGrading/config';
import { aiWorker } from '../lib/aiGradingService';

/**
 * AI suggestions, admin only (wish 7, layer B, S14), mounted on /api/ai-grading before the /api
 * catch-all. The configuration as the editor shows it (never the key), and the kill switch: while
 * engaged no answer is sent to the provider, whatever the environment and the quizzes say; it is
 * stored in the database, so it survives restarts and deploys.
 */
export const aiGradingRouter = Router();
aiGradingRouter.use(requireAdmin);

function configOut() {
  const c = aiConfig(db);
  const { n } = db
    .prepare('SELECT COUNT(*) AS n FROM ai_grading_runs WHERE created_at > ?')
    .get(new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()) as { n: number };
  return {
    enabled: c.enabled,
    configured: c.configured,
    modelCallsEnabled: c.modelCallsEnabled,
    disabledReason: c.disabledReason,
    provider: c.provider,
    model: c.model,
    promptVersion: c.promptVersion,
    concurrency: c.concurrency,
    maxCallsPerDay: c.maxCallsPerDay,
    callsLast24h: n,
    killSwitch: c.killSwitch,
  };
}

aiGradingRouter.get('/config', (_req, res) => {
  res.json(configOut());
});

/** Body {engaged: boolean}. Releasing it lets the worker continue with what is still queued. */
aiGradingRouter.put('/kill-switch', (req: AuthedRequest, res) => {
  if (typeof req.body?.engaged !== 'boolean') return res.status(400).json({ error: 'engaged must be true or false' });
  setKillSwitch(db, req.body.engaged, `admin:${req.admin!.username}`);
  console.log(`AI grading: kill switch ${req.body.engaged ? 'engaged' : 'released'} by admin:${req.admin!.username}`);
  // Engaged: requests on their way are aborted at once; released: what is queued continues.
  if (req.body.engaged) aiWorker.abortInFlight();
  else aiWorker.kick();
  res.json(configOut());
});
