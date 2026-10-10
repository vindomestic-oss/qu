import { test } from 'node:test';
import assert from 'node:assert/strict';
// The client's refetch rule for staff screens (useStaffLive); no React or DOM inside, so it runs here.
import { createRefetchScheduler, type SchedulerClock } from '../../../client/src/lib/refetchScheduler';

/** A manual clock: timers fire only when advance() passes their time. */
function fakeClock() {
  let now = 0;
  let nextId = 1;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const clock: SchedulerClock = {
    now: () => now,
    setTimer: (fn, ms) => {
      const id = nextId++;
      timers.set(id, { at: now + ms, fn });
      return id;
    },
    clearTimer: (id) => void timers.delete(id as number),
  };
  async function advance(ms: number) {
    const end = now + ms;
    for (;;) {
      const next = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      timers.delete(next[0]);
      now = next[1].at;
      next[1].fn();
      await Promise.resolve();
      await Promise.resolve();
    }
    now = end;
    await Promise.resolve();
  }
  return { clock, advance, get now() {
    return now;
  } };
}

test('session:live refetches at most every 5 s, grade events within 1 s', async () => {
  const c = fakeClock();
  const runs: number[] = [];
  const s = createRefetchScheduler(() => void runs.push(c.now), { clock: c.clock });
  s.request(1000); // mount / connect
  await c.advance(0);
  assert.deepEqual(runs, [0]);
  // session:live every 500 ms for 12 s
  for (let t = 0; t < 12_000; t += 500) {
    s.request(5000);
    await c.advance(500);
  }
  assert.deepEqual(runs, [0, 5000, 10_000]);
  // a grade arrives: within a second of the previous run, not 5 s later
  s.request(5000);
  s.request(1000);
  await c.advance(1500);
  assert.deepEqual(runs.slice(3), [12_000]);
  s.stop();
});

test('requests never overlap: one that falls due in flight runs once afterwards', async () => {
  const c = fakeClock();
  let started = 0;
  const pending: (() => void)[] = [];
  const s = createRefetchScheduler(
    () => {
      started += 1;
      return new Promise<void>((resolve) => pending.push(resolve));
    },
    { clock: c.clock, afterFlightGapMs: 1000 },
  );
  s.request(1000);
  await c.advance(0);
  assert.equal(started, 1);
  // Events keep coming while the slow request (3 s) is in flight.
  for (let i = 0; i < 6; i++) {
    s.request(1000);
    await c.advance(500);
  }
  assert.equal(started, 1, 'no second request while the first is in flight');
  pending.shift()!();
  await c.advance(0);
  await c.advance(1000);
  assert.equal(started, 2, 'exactly one request after it');
  pending.shift()!();
  await c.advance(5000);
  assert.equal(started, 2, 'nothing more without new events');
  s.stop();
});

test('stop cancels a pending refetch', async () => {
  const c = fakeClock();
  let runs = 0;
  const s = createRefetchScheduler(() => void (runs += 1), { clock: c.clock });
  s.request(1000);
  await c.advance(0);
  s.request(5000);
  s.stop();
  await c.advance(10_000);
  assert.equal(runs, 1);
});

test('a request that never settles stops blocking after the flight timeout', async () => {
  const c = fakeClock();
  const starts: number[] = [];
  const s = createRefetchScheduler(
    () => {
      starts.push(c.now);
      return new Promise<void>(() => {}); // a hung connection
    },
    { clock: c.clock, afterFlightGapMs: 1000, flightTimeoutMs: 15_000 },
  );
  s.request(1000);
  await c.advance(0);
  // Events keep arriving (live every 5 s, a grade now and then) for 40 s.
  for (let i = 0; i < 40; i++) {
    s.request(i % 7 === 0 ? 1000 : 5000);
    await c.advance(1000);
  }
  assert.deepEqual(starts, [0, 15_000, 30_000], 'one new request per flight timeout, never more');
  s.stop();
});

test('a late result of an abandoned request does not disturb the newer one', async () => {
  const c = fakeClock();
  const pending: (() => void)[] = [];
  const starts: number[] = [];
  const s = createRefetchScheduler(
    () => {
      starts.push(c.now);
      return new Promise<void>((resolve) => pending.push(resolve));
    },
    { clock: c.clock, afterFlightGapMs: 1000, flightTimeoutMs: 15_000 },
  );
  s.request(1000);
  await c.advance(0);
  s.request(1000);
  await c.advance(15_000); // the first one times out, the second starts
  assert.deepEqual(starts, [0, 15_000]);
  s.request(1000); // falls due while the second is in flight
  pending[0](); // the abandoned first one settles late
  await c.advance(2000);
  assert.deepEqual(starts, [0, 15_000], 'still waiting for the second one');
  pending[1]();
  await c.advance(0);
  await c.advance(1000);
  assert.deepEqual(starts, [0, 15_000, 17_000], 'then exactly one more');
  s.stop();
});
