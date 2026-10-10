// When a staff screen refetches after staff-room events (useStaffLive). No React and no DOM, so the
// server's test suite can run it with fake timers (server/src/test/refetchScheduler.test.ts).
//
// - Each event asks for a refetch no sooner than `gapMs` after the previous one started: 1 s for
//   grading:changed / session:update, longer (e.g. 5 s) for the frequent session:live.
// - An earlier request wins over a later one; requests in between are folded into it.
// - No overlapping requests: when `run` returns a promise, a refetch that falls due while one is in
//   flight is skipped and runs once after it, at least `gapMs` after the previous start.

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

export function createRefetchScheduler(run: () => unknown, { clock = realClock, afterFlightGapMs = 1000 } = {}): RefetchScheduler {
  let last = Number.NEGATIVE_INFINITY;
  let timer: unknown = null;
  let due = Number.POSITIVE_INFINITY;
  let inFlight = false;
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
      const done = () => {
        inFlight = false;
        if (again && !stopped) {
          again = false;
          request(afterFlightGapMs);
        }
      };
      (result as PromiseLike<unknown>).then(done, done);
    }
  }

  function fire() {
    timer = null;
    due = Number.POSITIVE_INFINITY;
    if (stopped) return;
    if (inFlight) {
      again = true;
      return;
    }
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
