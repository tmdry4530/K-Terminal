import test from 'node:test';
import assert from 'node:assert/strict';
import { getRate, getRates } from '../src/fx.js';

test('identity rate is 1 for the same currency (no network call)', async () => {
  const r = await getRate('USD', 'USD');
  assert.equal(r.rate, 1);
  assert.equal(r.status, '실시간');
});

test('empty currency yields a null rate instead of a fabricated 1:1', async () => {
  const r = await getRate('', 'USD');
  assert.equal(r.rate, null);
  assert.equal(r.status, '데이터 없음');
});

test('getRates includes an identity entry for the base currency', async () => {
  const map = await getRates(['USD', 'usd'], 'USD');
  assert.equal(map.get('USD').rate, 1);
  assert.equal(map.size, 1);
});
