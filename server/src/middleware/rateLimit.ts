import type { Request, Response } from 'express';

// Counts FAILED attempts per client in a fixed window (in memory, one process). Also used by the join
// limiter (routes/join.ts, S15), which refuses every join of a client over the limit. The grader
// code exchange looks a valid code up first and always lets it pass, so wrong codes from someone else
// behind the same address (Render's proxy with TRUST_PROXY_HOPS=0, a venue's NAT) can never lock out a
// grader who has the right code; only failed lookups are counted and, over the limit, answered with 429.
// Guessing stays infeasible anyway: codes carry 80 bits. Headers follow express-rate-limit's
// standardHeaders 'draft-8' (RateLimit-Policy, RateLimit) with Retry-After on a 429. req.ip follows
// app's 'trust proxy' (TRUST_PROXY_HOPS, default 0), so a forged X-Forwarded-For cannot pick a fresh counter.
//
// A client is its IPv4 address, or the /64 prefix of its IPv6 address (one home or phone network has
// a whole /64, so counting single IPv6 addresses would let it change address for every attempt).
// Only a failure creates an entry, and at most MAX_CLIENTS entries are kept (the oldest goes first),
// so a flood of addresses cannot grow memory without bound.

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
  /** Number of clients currently tracked (tests). */
  size(): number;
}

const MAX_CLIENTS = 10_000;

/** Eight 16-bit groups of an IPv6 address (also with an embedded IPv4 tail), or null. */
function ipv6Groups(address: string): number[] | null {
  let s = address.split('%')[0].toLowerCase();
  const v4 = /(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
  if (v4) {
    const [a, b, c, d] = v4.slice(1).map(Number);
    if ([a, b, c, d].some((n) => n > 255)) return null;
    s = `${s.slice(0, v4.index)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill('0'), ...tail];
  if (!groups.every((g) => /^[0-9a-f]{1,4}$/.test(g))) return null;
  return groups.map((g) => parseInt(g, 16));
}

/**
 * The counter key of a client address: IPv4 (also IPv4-mapped IPv6, "::ffff:1.2.3.4") as is, IPv6 as
 * its /64 prefix ("2001:db8:1:2::/64"). Anything unreadable is used verbatim.
 */
export function clientKey(ip: string | undefined): string {
  if (!ip) return 'unknown';
  if (!ip.includes(':')) return ip;
  const g = ipv6Groups(ip);
  if (!g) return ip;
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) {
    return [g[6] >> 8, g[6] & 255, g[7] >> 8, g[7] & 255].join('.');
  }
  return `${g
    .slice(0, 4)
    .map((x) => x.toString(16))
    .join(':')}::/64`;
}

export function createFailureLimiter({
  windowMs,
  limit,
  maxClients = MAX_CLIENTS,
}: {
  windowMs: number;
  limit: number;
  maxClients?: number;
}): FailureLimiter {
  const windows = new Map<string, Window>();
  const policy = `"default";q=${limit};w=${Math.round(windowMs / 1000)}`;
  const keyOf = (req: Request) => clientKey(req.ip ?? req.socket?.remoteAddress);

  // Expired windows are dropped now and then; the size cap below bounds the map in between.
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [key, w] of windows) if (w.resetAt <= now) windows.delete(key);
  }, windowMs);
  sweep.unref();

  /** The live window of this client, without creating one. */
  function find(req: Request): Window | null {
    const w = windows.get(keyOf(req));
    return w && w.resetAt > Date.now() ? w : null;
  }

  return {
    blocked: (req) => (find(req)?.count ?? 0) >= limit,
    fail: (req) => {
      const key = keyOf(req);
      const now = Date.now();
      let w = windows.get(key);
      if (!w || w.resetAt <= now) {
        windows.delete(key); // re-inserted last: the map's order is the age order for eviction
        if (windows.size >= maxClients) windows.delete(windows.keys().next().value as string);
        w = { count: 0, resetAt: now + windowMs };
        windows.set(key, w);
      }
      w.count += 1;
    },
    headers: (req, res) => {
      const w = find(req);
      const count = w?.count ?? 0;
      const reset = w ? Math.max(0, Math.ceil((w.resetAt - Date.now()) / 1000)) : Math.round(windowMs / 1000);
      res.setHeader('RateLimit-Policy', policy);
      res.setHeader('RateLimit', `"default";r=${Math.max(0, limit - count)};t=${reset}`);
      if (count >= limit) res.setHeader('Retry-After', String(reset));
    },
    size: () => windows.size,
  };
}
