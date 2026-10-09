import './env';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Request, Response } from 'express';
import { clientKey, createFailureLimiter } from '../middleware/rateLimit';

// The in-memory failure limiter behind the grader code exchange and the join limiter (S12, S15).

const req = (ip: string) => ({ ip, socket: {} }) as unknown as Request;
function res() {
  const headers: Record<string, string> = {};
  return { headers, setHeader: (k: string, v: string) => void (headers[k.toLowerCase()] = v) } as unknown as Response & {
    headers: Record<string, string>;
  };
}

test('client keys: IPv4 and IPv4-mapped by address, IPv6 by its /64 prefix', () => {
  assert.equal(clientKey('203.0.113.7'), '203.0.113.7');
  assert.equal(clientKey('::ffff:203.0.113.7'), '203.0.113.7');
  assert.equal(clientKey('::FFFF:cb00:7107'), '203.0.113.7');
  assert.equal(clientKey('2001:db8:1:2:aaaa:bbbb:cccc:dddd'), '2001:db8:1:2::/64');
  assert.equal(clientKey('2001:0db8:0001:0002::1'), '2001:db8:1:2::/64');
  assert.equal(clientKey('2001:db8:1:2::1%en0'), '2001:db8:1:2::/64');
  assert.equal(clientKey('2001:db8::1'), '2001:db8:0:0::/64');
  assert.notEqual(clientKey('2001:db8:1:3::1'), clientKey('2001:db8:1:2::1'));
  assert.equal(clientKey('64:ff9b::192.0.2.33'), '64:ff9b:0:0::/64');
  assert.equal(clientKey('not an address'), 'not an address');
  assert.equal(clientKey('1:2:3'), '1:2:3', 'unreadable IPv6 is used verbatim');
  assert.equal(clientKey(undefined), 'unknown');
});

test('addresses in one IPv6 /64 share a counter; IPv4-mapped and plain IPv4 too', () => {
  const l = createFailureLimiter({ windowMs: 60_000, limit: 3 });
  l.fail(req('2001:db8:5:6::1'));
  l.fail(req('2001:db8:5:6::2'));
  l.fail(req('2001:db8:5:6:ffff::9'));
  assert.equal(l.blocked(req('2001:db8:5:6::abcd')), true);
  assert.equal(l.blocked(req('2001:db8:5:7::1')), false, 'the next /64 is someone else');
  l.fail(req('198.51.100.4'));
  l.fail(req('::ffff:198.51.100.4'));
  l.fail(req('198.51.100.4'));
  assert.equal(l.blocked(req('198.51.100.4')), true);
  assert.equal(l.blocked(req('198.51.100.5')), false);
});

test('only a failure creates an entry; headers and checks of a new client leave the map alone', () => {
  const l = createFailureLimiter({ windowMs: 600_000, limit: 100 });
  for (let i = 0; i < 50; i++) {
    const r = res();
    l.headers(req(`192.0.2.${i}`), r);
    assert.equal(l.blocked(req(`192.0.2.${i}`)), false);
    assert.equal(r.headers['ratelimit'], '"default";r=100;t=600');
    assert.equal(r.headers['retry-after'], undefined);
  }
  assert.equal(l.size(), 0);
  l.fail(req('192.0.2.1'));
  assert.equal(l.size(), 1);
  const r = res();
  l.headers(req('192.0.2.1'), r);
  assert.match(r.headers['ratelimit'], /r=99;/);
});

test('the map is capped: the oldest client goes first', () => {
  const l = createFailureLimiter({ windowMs: 60_000, limit: 2, maxClients: 3 });
  for (const ip of ['10.0.0.1', '10.0.0.2', '10.0.0.3']) {
    l.fail(req(ip));
    l.fail(req(ip));
  }
  assert.equal(l.blocked(req('10.0.0.1')), true);
  l.fail(req('10.0.0.4'));
  assert.equal(l.size(), 3);
  assert.equal(l.blocked(req('10.0.0.1')), false, 'evicted');
  assert.equal(l.blocked(req('10.0.0.2')), true);
  assert.equal(l.blocked(req('10.0.0.3')), true);
  // 100,000 distinct IPv6 networks keep the map at the cap.
  const big = createFailureLimiter({ windowMs: 60_000, limit: 5 });
  for (let i = 0; i < 100_000; i++) big.fail(req(`2001:db8:${(i >> 16).toString(16)}:${(i & 0xffff).toString(16)}::1`));
  assert.equal(big.size(), 10_000);
});

test('a window ends: the client starts again from zero', async () => {
  const l = createFailureLimiter({ windowMs: 50, limit: 1 });
  l.fail(req('203.0.113.9'));
  assert.equal(l.blocked(req('203.0.113.9')), true);
  await new Promise((r) => setTimeout(r, 70));
  assert.equal(l.blocked(req('203.0.113.9')), false);
  const r = res();
  l.headers(req('203.0.113.9'), r);
  assert.match(r.headers['ratelimit'], /r=1;/);
});
