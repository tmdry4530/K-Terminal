import test from 'node:test';
import assert from 'node:assert/strict';
import { bollinger, ema, macd, rsi, sma, technicalSnapshot } from '../src/indicators.js';

test('sma computes only after period', () => {
  const result = sma([1, 2, 3, 4, 5], 3);
  assert.deepEqual(result.slice(0, 2), [null, null]);
  assert.equal(result[2], 2);
  assert.equal(result[4], 4);
});

test('ema handles leading NaN/null gaps and then produces values', () => {
  const result = ema([Number.NaN, 1, 2, 3, 4, 5, 6], 3);
  assert.equal(result[0], null);
  assert.equal(result[1], null);
  assert.equal(result[2], null);
  assert.equal(result[3], 2);
  assert.ok(Number.isFinite(result.at(-1)));
});

test('rsi, macd, bollinger return aligned series', () => {
  const values = Array.from({ length: 80 }, (_, i) => 100 + Math.sin(i / 5) * 4 + i * 0.2);
  assert.equal(rsi(values).length, values.length);
  assert.equal(bollinger(values).length, values.length);
  const m = macd(values);
  assert.equal(m.macd.length, values.length);
  assert.equal(m.signal.length, values.length);
  assert.equal(m.histogram.length, values.length);
  assert.ok(m.signal.some(Number.isFinite));
});

test('technicalSnapshot classifies with enough candle data', () => {
  const candles = Array.from({ length: 80 }, (_, i) => ({ close: 100 + i, open: 99 + i, high: 101 + i, low: 98 + i, volume: 1000 }));
  const snapshot = technicalSnapshot(candles);
  assert.equal(snapshot.trend, '상방');
  assert.ok(Number.isFinite(snapshot.rsi14));
});
