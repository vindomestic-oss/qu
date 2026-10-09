import type { Request, Response } from 'express';

// Counts FAILED attempts per client in a fixed window (in memory, one process). Also used by the join
// limiter (routes/join.ts, S15), which refuses every join of a client over the limit. The grader
// code exchange looks a valid code up first and always lets it pass, so wrong codes from someone else
// behind the same address (Render's proxy with TRUST_PROXY_HOPS=0, a venue's NAT) can never lock out a
// grader who has the right code; only failed lookups are counted and, over the limit, answered with 429.
// Guessing stays infeasible anyway: codes carry 80 bits. Headers follow express-rate-limit's
// standardHeaders 'draft-8' (RateLimit-Policy, RateLimit) with Retry-After on a 429. req.ip follows
// app's 'trust proxy' (TRUST_PROXY_HOPS, default 0), so a forged X-Forwarded-For cannot pick a fresh counter.

interface Window {
  count: number;
  resetAt: number;
}

export interface FailureLimiter {
  /** True when this client is over the limit: answer its failed attempt with 429. */
  blocked(req: Request): boolean;
  /** Counts one failed attempt. */
  fail(req: Request): void;
  /** Sets the RateLimit headers (and Retry-After when blocked). */
  headers(req: Request, res: Response): void;
}

export function createFailureLimiter({ windowMs, limit }: { windowMs: number; limit: number }): FailureLimiter {
  const windows = new Map<string, Window>();
  const policy = `"default";q=${limit};w=${Math.round(windowMs / 1000)}`;
  const keyOf = (req: Request) => req.ip ?? req.socket.remoteAddress ?? 'unknown';

  // Expired windows are dropped now and then, so the map cannot grow without bound.
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [key, w] of windows) if (w.resetAt <= now) windows.delete(key);
  }, windowMs);
  sweep.unref();

  function current(req: Request): Window {
    const key = keyOf(req);
    const now = Date.now();
    let w = windows.get(key);
    if (!w || w.resetAt <= now) {
      w = { count: 0, resetAt: now + windowMs };
      windows.set(key, w);
    }
    return w;
  }

  return {
    blocked: (req) => current(req).count >= limit,
    fail: (req) => {
      current(req).count += 1;
    },
    headers: (req, res) => {
      const w = current(req);
      const reset = Math.max(0, Math.ceil((w.resetAt - Date.now()) / 1000));
      res.setHeader('RateLimit-Policy', policy);
      res.setHeader('RateLimit', `"default";r=${Math.max(0, limit - w.count)};t=${reset}`);
      if (w.count >= limit) res.setHeader('Retry-After', String(reset));
    },
  };
}
