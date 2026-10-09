import type { NextFunction, Request, Response } from 'express';

// A small in-memory fixed-window limiter with the semantics of express-rate-limit's
// { windowMs, limit, skipSuccessfulRequests: true, standardHeaders: 'draft-8', legacyHeaders: false }.
// That package is not installed here; this covers the one route that needs it (POST /api/grader/exchange).
// One process, one counter per client IP. req.ip follows app's 'trust proxy' (TRUST_PROXY_HOPS,
// default 0), so with 0 a forged X-Forwarded-For header cannot pick a fresh counter.

interface Options {
  windowMs: number;
  limit: number;
  /** Responses below 400 do not count. */
  skipSuccessfulRequests?: boolean;
  /** The JSON body of a 429. */
  message?: object;
}

interface Hit {
  count: number;
  resetAt: number;
}

export function createRateLimiter({ windowMs, limit, skipSuccessfulRequests = false, message }: Options) {
  const hits = new Map<string, Hit>();
  const policy = `"default";q=${limit};w=${Math.round(windowMs / 1000)}`;

  // Expired windows are dropped now and then, so the map cannot grow without bound.
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [key, hit] of hits) if (hit.resetAt <= now) hits.delete(key);
  }, windowMs);
  sweep.unref();

  return function rateLimit(req: Request, res: Response, next: NextFunction) {
    const key = req.ip ?? req.socket.remoteAddress ?? 'unknown';
    const now = Date.now();
    let hit = hits.get(key);
    if (!hit || hit.resetAt <= now) {
      hit = { count: 0, resetAt: now + windowMs };
      hits.set(key, hit);
    }
    const resetSeconds = Math.max(0, Math.ceil((hit.resetAt - now) / 1000));
    res.setHeader('RateLimit-Policy', policy);

    if (hit.count >= limit) {
      res.setHeader('RateLimit', `"default";r=0;t=${resetSeconds}`);
      res.setHeader('Retry-After', String(resetSeconds));
      return res.status(429).json(message ?? { error: 'Too many requests', code: 'RATE_LIMITED' });
    }

    hit.count += 1;
    const counted = hit;
    res.setHeader('RateLimit', `"default";r=${Math.max(0, limit - counted.count)};t=${resetSeconds}`);
    if (skipSuccessfulRequests) {
      res.on('finish', () => {
        // Only the window this request was counted in; a new window has its own count.
        if (res.statusCode < 400 && hits.get(key) === counted && counted.count > 0) counted.count -= 1;
      });
    }
    next();
  };
}
