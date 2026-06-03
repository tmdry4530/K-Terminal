import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeSentiment, importance } from '../src/news.js';

test('analyzeSentiment classifies positive, negative and neutral text', () => {
  assert.equal(analyzeSentiment('Company beats estimates, stock surges to record').label, '긍정');
  assert.equal(analyzeSentiment('Shares plunge after lawsuit and downgrade').label, '부정');
  assert.equal(analyzeSentiment('Company announced a new office location').label, '중립');
});

test('importance rises with the number of market-moving keywords', () => {
  assert.equal(importance('quarterly earnings and guidance update'), '높음'); // 2 hits
  assert.equal(importance('dividend declared'), '중간'); // 1 hit
  assert.equal(importance('new product color announced'), '낮음'); // 0 hits
});
