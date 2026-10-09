/**
 * The server's clock as seen from this device (S15). A tablet whose clock is 90 s fast would show
 * 90 s too little time left; countdowns use serverNow() = Date.now() + offset instead. Display only:
 * the server still ends the session and decides what counts.
 *
 * Every sample is an interval: the server time lies within ±uncertainty of the estimate. A sample
 * from an HTTP response is centred on the request's round trip (uncertainty = half the round trip);
 * a socket event has no round trip and gets ONE_WAY_MS; the HTTP Date header (1 s resolution) adds
 * half a second. The offset changes only for a more precise sample, or for one that contradicts the
 * current offset (the device clock was changed), and then only as far as needed to lie inside the
 * new interval, so the countdown never jumps back by more than the measurement requires.
 */

/** Assumed bound of a socket event's one-way delay. */
const ONE_WAY_MS = 1000;
/** Uncertainty an old sample gains per millisecond of age (drifting device clocks, ~100 ppm). */
const DRIFT = 1e-4;

let current: { offset: number; uncertainty: number; at: number } | null = null;

/**
 * Records one reading of the server clock. `sentAt`/`receivedAt` are Date.now() before the request
 * and when its response arrived (sentAt null for a socket event); `resolutionMs` is the reading's
 * resolution (1000 for the HTTP Date header, 0 for server_now).
 */
export function recordServerTime(serverMs: number, sentAt: number | null, receivedAt: number = Date.now(), resolutionMs = 0): void {
  if (!Number.isFinite(serverMs) || !Number.isFinite(receivedAt)) return;
  const rtt = sentAt === null ? null : Math.max(0, receivedAt - sentAt);
  const localMid = rtt === null ? receivedAt : receivedAt - rtt / 2;
  const offset = serverMs + resolutionMs / 2 - localMid;
  const uncertainty = (rtt === null ? ONE_WAY_MS : rtt / 2) + resolutionMs / 2;
  if (!current) {
    current = { offset, uncertainty, at: receivedAt };
    return;
  }
  const aged = current.uncertainty + Math.abs(receivedAt - current.at) * DRIFT;
  const agrees = Math.abs(offset - current.offset) <= uncertainty + aged;
  if (agrees && uncertainty >= aged) return;
  // Closest value to the current offset that the new sample allows.
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
