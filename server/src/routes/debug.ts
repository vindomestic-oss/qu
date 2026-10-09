import { Router } from 'express';
import { requireAdmin } from '../middleware/jwt';

/**
 * One-time check for TRUST_PROXY_HOPS (wish 5, S15), admin only. Open it as an admin on the live
 * site: with the right number of hops, `ip` is your own public address. Express takes the client
 * address from X-Forwarded-For counted from the right, so if your address is the n-th entry of `xff`
 * from the right, TRUST_PROXY_HOPS = n. The spec calls it temporary: remove it once the value is set.
 */
export const debugRouter = Router();
debugRouter.use(requireAdmin);

debugRouter.get('/ip', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({ ip: req.ip, xff: req.get('x-forwarded-for') ?? null });
});
