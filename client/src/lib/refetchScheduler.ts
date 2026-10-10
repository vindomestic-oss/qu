// When a staff screen refetches after staff-room events (useStaffLive). No React and no DOM, so the
// server's test suite can run it with fake timers (server/src/test/refetchScheduler.test.ts).
//
// - Each event asks for a refetch no sooner than `gapMs` after the previous one started: 1 s for
//   grading:changed / session:update, longer (e.g. 5 s) for the frequent session:live.
// - An earlier request wins over a later one; requests in between are folded into it.
// - No overlapping requests: when `run` returns a promise, a refetch that falls due while one is in
//   flight is skipped and runs once after it, at least `gapMs` after the previous start.
// - A request that has not settled after FLIGHT_TIMEOUT_MS (a hung connection) counts as finished, so
//   the screen keeps refreshing; its late result, if any, no longer affects the schedule.

export interface SchedulerClock {
  now(): number;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(timer: unknown): void;
}

const realClock: SchedulerClock = {
  now: () => Date.now(),
  setTimer: (fn, ms) => setTimeout(fn, ms),
  clearTimer: (t) => clearTimeout(t as ReturnType<typeof setTimeout>),
};

export interface RefetchScheduler {
  /** Asks for a refetch at least `gapMs` after the last one started. */
  request(gapMs: number): void;
  stop(): void;
}

export const FLIGHT_TIMEOUT_MS = 15_000;

export function createRefetchScheduler(
  run: () => unknown,
  { clock = realClock, afterFlightGapMs = 1000, flightTimeoutMs = FLIGHT_TIMEOUT_MS } = {},
): RefetchScheduler {
  let last = Number.NEGATIVE_INFINITY;
  let timer: unknown = null;
  let due = Number.POSITIVE_INFINITY;
  let inFlight = false;
  let flight = 0;
  let again = false;
  let stopped = false;

  function start() {
    last = clock.now();
    let result: unknown;
    try {
      result = run();
    } catch {
      result = undefined;
    }
    if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
      inFlight = true;
      const mine = ++flight;
      const done = () => {
        if (mine !== flight) return; // abandoned after FLIGHT_TIMEOUT_MS; a newer request owns the state
        inFlight = false;
        if (again && !stopped) {
          again = false;
          request(afterFlightGapMs);
        }
      };
      (result as PromiseLike<unknown>).then(done, done);
    }
  }

  /** A request older than the flight timeout no longer blocks the next one. */
  function settleHungFlight() {
    if (inFlight && clock.now() - last >= flightTimeoutMs) {
      inFlight = false;
      flight += 1;
    }
  }

  function fire() {
    timer = null;
    due = Number.POSITIVE_INFINITY;
    if (stopped) return;
    settleHungFlight();
    if (inFlight) {
      // Runs once when the flight settles; and at the flight timeout, in case it never does.
      request(Math.max(afterFlightGapMs, flightTimeoutMs));
      again = true;
      return;
    }
    again = false;
    start();
  }

  function request(gapMs: number) {
    if (stopped) return;
    const now = clock.now();
    const at = Math.max(now, last + gapMs);
    if (timer !== null && due <= at) return;
    if (timer !== null) clock.clearTimer(timer);
    due = at;
    timer = clock.setTimer(fire, at - now);
  }

  return {
    request,
    stop() {
      stopped = true;
      if (timer !== null) clock.clearTimer(timer);
      timer = null;
    },
  };
}
