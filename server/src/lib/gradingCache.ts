// A short-lived, per-session cache for the grading panel's session-wide reads (wish 8, load test of
// 2026-10-10): every open GradingDashboard (and WholeQuizReview) of a session refetches the same data
// on the same staff-room event, so one computation serves all of them for up to TTL_MS.
//
// - Keyed by session id (plus a part name such as 'summary' or 'quiz:needs_review'): an entry can only
//   ever be returned for the session it was computed for.
// - Only session-wide data is cached; viewer-specific fields are added per request by the routes.
// - Every write that changes grading data invalidates the session's entries at once: socket.ts calls
//   invalidateSessionCache() from broadcastGradingChanged (grade, bulk grade, AI, rule and key checks,
//   regrade, submit, reopen, session end) and broadcastSessionUpdate (start, end, joining). Answer
//   saves and joins (session:live) are not invalidated: they may show up to TTL_MS late.
// - At most MAX_ENTRIES entries (oldest dropped first); expired entries are dropped when read.
// No imports, so socket.ts can use it without an import cycle.

const TTL_MS = 1000;
const MAX_ENTRIES = 64;

interface Entry {
  sessionId: number;
  at: number;
  value: unknown;
}

const entries = new Map<string, Entry>();
const counters = { hits: 0, misses: 0 };

/** The cached value for this session and part, or a fresh one from compute() (then cached). */
export function cachedForSession<T>(sessionId: number, part: string, compute: () => T): T {
  const key = `${sessionId}|${part}`;
  const now = Date.now();
  const hit = entries.get(key);
  if (hit && hit.sessionId === sessionId && now - hit.at < TTL_MS) {
    counters.hits += 1;
    return hit.value as T;
  }
  counters.misses += 1;
  const value = compute();
  entries.delete(key);
  entries.set(key, { sessionId, at: now, value });
  while (entries.size > MAX_ENTRIES) {
    const oldest = entries.keys().next().value;
    if (oldest === undefined) break;
    entries.delete(oldest);
  }
  return value;
}

/** Drops every cached part of a session (called right after each grading-relevant write). */
export function invalidateSessionCache(sessionId: number): void {
  for (const [key, entry] of entries) if (entry.sessionId === sessionId) entries.delete(key);
}

/** For tests. */
export function gradingCacheStats(): { hits: number; misses: number; size: number } {
  return { ...counters, size: entries.size };
}

/** For tests. */
export function clearGradingCache(): void {
  entries.clear();
  counters.hits = 0;
  counters.misses = 0;
}

export const GRADING_CACHE_TTL_MS = TTL_MS;
export const GRADING_CACHE_MAX_ENTRIES = MAX_ENTRIES;
