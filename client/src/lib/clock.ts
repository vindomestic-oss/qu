/**
 * The server's clock as seen from this device (S15). A tablet whose clock is 90 s fast would show
 * 90 s too little time left; countdowns use serverNow() = Date.now() + offset instead. Display only:
 * the server still ends the session and decides what counts.
 *
 * An HTTP reading is an interval: the server's time lies within ±uncertainty of the estimate, centred
 * on the request's round trip (uncertainty = half the round trip, plus half a second for the Date
 * header's 1 s resolution). It moves the offset only when it is more precise than the current one, or
 * contradicts it (the device clock was changed), and then only as far as needed to lie inside the new
 * interval, so the countdown never jumps by more than the measurement requires.
 *
 * A pushed reading (a socket event) can only arrive late, never early: it proves the offset is AT
 * LEAST server_now − arrival, so it can raise the offset but never lower it. An event held back while
 * an iPad slept therefore cannot add time to the countdown. Lowering needs an HTTP reading: pages
 * re-sync when they become visible again and when the device clock jumps (onClockJump).
 */

/** Uncertainty an old reading gains per millisecond of age (drifting device clocks, ~100 ppm). */
const DRIFT = 1e-4;
/** Uncertainty given to a pushed reading that raised the offset (its delay is unknown). */
const PUSH_UNCERTAINTY_MS = 1000;

let current: { offset: number; uncertainty: number; at: number } | null = null;

/**
 * Records one reading of the server clock. For an HTTP response, `sentAt`/`receivedAt` are
 * Date.now() before the request and when the response arrived; `resolutionMs` is the reading's
 * resolution (1000 for the HTTP Date header, 0 for server_now). `sentAt` null = a pushed reading
 * (socket event) received at `receivedAt`: a lower bound only.
 */
export function recordServerTime(serverMs: number, sentAt: number | null, receivedAt: number = Date.now(), resolutionMs = 0): void {
  if (!Number.isFinite(serverMs) || !Number.isFinite(receivedAt)) return;
  if (sentAt === null) {
    const atLeast = serverMs - receivedAt;
    if (!current || atLeast > current.offset) current = { offset: atLeast, uncertainty: PUSH_UNCERTAINTY_MS, at: receivedAt };
    return;
  }
  const rtt = Math.max(0, receivedAt - sentAt);
  const offset = serverMs + resolutionMs / 2 - (receivedAt - rtt / 2);
  const uncertainty = rtt / 2 + resolutionMs / 2;
  if (!current) {
    current = { offset, uncertainty, at: receivedAt };
    return;
  }
  const aged = current.uncertainty + Math.abs(receivedAt - current.at) * DRIFT;
  const agrees = Math.abs(offset - current.offset) <= uncertainty + aged;
  if (agrees && uncertainty >= aged) return;
  // Closest value to the current offset that the new reading allows.
  const next = Math.min(offset + uncertainty, Math.max(offset - uncertainty, current.offset));
  current = { offset: next, uncertainty, at: receivedAt };
}

/** Records an ISO `server_now` from a response or event (ignored when missing or unreadable). */
export function recordServerNow(serverNow: unknown, sentAt: number | null = null, receivedAt: number = Date.now()): void {
  if (typeof serverNow !== 'string') return;
  recordServerTime(Date.parse(serverNow), sentAt, receivedAt);
}

/** Milliseconds to add to Date.now() to get the server's time (0 until the first reading). */
export function clockOffset(): number {
  return current ? Math.round(current.offset) : 0;
}

/** The server's current time in ms, for countdowns. */
export function serverNow(): number {
  return Date.now() + clockOffset();
}

/** How far the device clock may move against the monotonic clock between two checks before it counts as changed. */
const JUMP_MS = 2000;

/**
 * Calls `listener` when the device clock is changed (or the device woke from sleep): the wall clock
 * moved more than 2 s more or less than the monotonic clock between two checks. Returns the
 * unsubscribe function. The listener should take a fresh HTTP reading.
 */
export function onClockJump(listener: () => void): () => void {
  let wall = Date.now();
  let mono = performance.now();
  const timer = setInterval(() => {
    const w = Date.now();
    const m = performance.now();
    const drift = w - wall - (m - mono);
    wall = w;
    mono = m;
    if (Math.abs(drift) > JUMP_MS) listener();
  }, 1000);
  return () => clearInterval(timer);
}
