import test from 'node:test';
import assert from 'node:assert/strict';
import { lookupDartCorp, CIK_MAP } from '../src/filings.js';

test('lookupDartCorp maps known stock codes and 8-digit corp codes', () => {
  assert.deepEqual(lookupDartCorp('005930'), { corpCode: '00126380', name: '삼성전자' });
  assert.deepEqual(lookupDartCorp('005930.KS'), { corpCode: '00126380', name: '삼성전자' });
  assert.deepEqual(lookupDartCorp('00126380'), { corpCode: '00126380', name: null });
  assert.equal(lookupDartCorp('NOPE'), null);
});

test('CIK_MAP holds zero-padded 10-digit CIK strings', () => {
  assert.equal(CIK_MAP.AAPL, '0000320193');
  assert.equal(CIK_MAP.AAPL.length, 10);
});
