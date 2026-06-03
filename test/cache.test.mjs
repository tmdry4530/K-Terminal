import test from 'node:test';
import assert from 'node:assert/strict';
import { createCache } from '../src/cache.js';

const tick = () => new Promise((resolve) => setImmediate(resolve));

test('serves a fresh value without re-fetching within TTL', async () => {
  let clock = 0;
  let calls = 0;
  const cache = createCache({ ttlMs: 100, now: () => clock });
  const fetcher = async () => { calls += 1; return `v${calls}`; };
  assert.equal(await cache.get('k', fetcher), 'v1');
  clock = 50;
  assert.equal(await cache.get('k', fetcher), 'v1');
  assert.equal(calls, 1);
});

test('re-fetches after TTL expires (no stale window)', async () => {
  let clock = 0;
  let calls = 0;
  const cache = createCache({ ttlMs: 100, now: () => clock });
  const fetcher = async () => { calls += 1; return `v${calls}`; };
  assert.equal(await cache.get('k', fetcher), 'v1');
  clock = 150;
  assert.equal(await cache.get('k', fetcher), 'v2');
  assert.equal(calls, 2);
});

test('stale-while-revalidate returns stale immediately then refreshes in background', async () => {
  let clock = 0;
  let calls = 0;
  const cache = createCache({ ttlMs: 100, staleMs: 1000, now: () => clock });
  const fetcher = async () => { calls += 1; return `v${calls}`; };
  assert.equal(await cache.get('k', fetcher), 'v1');
  clock = 150; // past ttl(100), within stale(1100)
  assert.equal(await cache.get('k', fetcher), 'v1'); // stale returned synchronously
  await tick(); // let background refresh settle
  assert.equal(calls, 2);
  assert.equal(cache.peek('k'), 'v2');
});

test('single-flight collapses concurrent calls into one fetch', async () => {
  let calls = 0;
  let release;
  const cache = createCache({ ttlMs: 1000 });
  const fetcher = () => { calls += 1; return new Promise((resolve) => { release = resolve; }); };
  const pending = [cache.get('k', fetcher), cache.get('k', fetcher), cache.get('k', fetcher)];
  release('X');
  const results = await Promise.all(pending);
  assert.equal(calls, 1);
  assert.deepEqual(results, ['X', 'X', 'X']);
});

test('TTL can be a function of the value (cache errors briefly)', async () => {
  let clock = 0;
  let calls = 0;
  const cache = createCache({ ttlMs: (v) => (v.ok ? 1000 : 10), now: () => clock });
  const fetcher = async () => { calls += 1; return { ok: false }; };
  await cache.get('k', fetcher);
  clock = 20; // past the 10ms error TTL
  await cache.get('k', fetcher);
  assert.equal(calls, 2);
});

test('a miss whose fetch rejects propagates and does not poison the key', async () => {
  const cache = createCache({ ttlMs: 1000 });
  await assert.rejects(cache.get('k', async () => { throw new Error('boom'); }), /boom/);
  assert.equal(await cache.get('k', async () => 'recovered'), 'recovered');
});
