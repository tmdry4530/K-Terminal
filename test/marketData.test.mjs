import test from 'node:test';
import assert from 'node:assert/strict';
import { finiteOrNull } from '../src/marketData.js';

test('finiteOrNull parses numbers and strips thousands separators', () => {
  assert.equal(finiteOrNull(42), 42);
  assert.equal(finiteOrNull('1,234.5'), 1234.5);
  assert.equal(finiteOrNull('0'), 0);
});

test('finiteOrNull returns null for non-finite / non-numeric input', () => {
  assert.equal(finiteOrNull(null), null);
  assert.equal(finiteOrNull(undefined), null);
  assert.equal(finiteOrNull('n/a'), null);
  assert.equal(finiteOrNull(Number.NaN), null);
  assert.equal(finiteOrNull(Infinity), null);
});
