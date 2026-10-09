import { db } from '../db';
import { finalizeSession, SessionRow } from './sessions';
import { revalidateRooms } from '../socket';

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

/** Ends active sessions whose time is up (compared as numbers, so odd ISO forms cannot confuse it). */
export function sweepDueSessions(now = Date.now()): void {
  const active = db.prepare("SELECT id, ends_at FROM sessions WHERE status = 'active' AND ends_at IS NOT NULL").all() as {
    id: number;
    ends_at: string;
  }[];
  for (const s of active) {
    if (Date.parse(s.ends_at) <= now) finalizeSession(s.id, s.ends_at);
  }
}

/** Safety net every 30 s: end sessions whose timer was missed, and drop sockets whose token went bad. */
export function startSessionSweep(): void {
  setInterval(() => {
    sweepDueSessions();
    revalidateRooms();
  }, SWEEP_MS).unref();
}
