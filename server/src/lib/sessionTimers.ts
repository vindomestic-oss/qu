import { db } from '../db';
import { finalizeSession, SessionRow } from './sessions';
import { nowIso } from './time';

// setTimeout cannot wait longer than 2^31-1 ms (about 24.8 days); longer waits re-check.
const MAX_DELAY_MS = 2 ** 31 - 1;
const SWEEP_MS = 30_000;
const timers = new Map<number, NodeJS.Timeout>();

/** Ends the session at endsAtIso, even when nobody is looking at it (participants get submitted). */
export function scheduleSessionEnd(sessionId: number, endsAtIso: string): void {
  clearSessionTimer(sessionId);
  const delay = Date.parse(endsAtIso) - Date.now();
  if (delay <= 0) {
    finalizeSession(sessionId, endsAtIso);
    return;
  }
  const timer = setTimeout(() => {
    timers.delete(sessionId);
    if (delay > MAX_DELAY_MS) scheduleSessionEnd(sessionId, endsAtIso);
    else finalizeSession(sessionId, endsAtIso);
  }, Math.min(delay, MAX_DELAY_MS));
  timer.unref();
  timers.set(sessionId, timer);
}

export function clearSessionTimer(sessionId: number): void {
  const timer = timers.get(sessionId);
  if (timer) clearTimeout(timer);
  timers.delete(sessionId);
}

/** On boot (after initSocket): re-arm timers of running sessions; already expired ones end now. */
export function recoverActiveSessions(): void {
  const active = db
    .prepare("SELECT * FROM sessions WHERE status = 'active' AND ends_at IS NOT NULL")
    .all() as SessionRow[];
  for (const s of active) scheduleSessionEnd(s.id, s.ends_at!);
}

/** Safety net for a missed timer: every 30 s, end active sessions whose time is up. */
export function startSessionSweep(): void {
  setInterval(() => {
    const due = db
      .prepare("SELECT id, ends_at FROM sessions WHERE status = 'active' AND ends_at IS NOT NULL AND ends_at <= ?")
      .all(nowIso()) as { id: number; ends_at: string }[];
    for (const s of due) finalizeSession(s.id, s.ends_at);
  }, SWEEP_MS).unref();
}
