import test from 'node:test';
import assert from 'node:assert/strict';
import { isCryptoSymbol, parseCryptoSymbol, CRYPTO_UNIVERSE } from '../src/cryptoMarket.js';

test('parses supported crypto pairs (case-insensitive)', () => {
  assert.deepEqual(parseCryptoSymbol('BTC-USD'), { base: 'BTC', quote: 'USD' });
  assert.deepEqual(parseCryptoSymbol('eth-krw'), { base: 'ETH', quote: 'KRW' });
  assert.equal(isCryptoSymbol('SOL-USDT'), true);
});

test('rejects equities, indices, and unsupported pairs', () => {
  assert.equal(parseCryptoSymbol('AAPL'), null);
  assert.equal(isCryptoSymbol('005930.KS'), false);
  assert.equal(isCryptoSymbol('^GSPC'), false);
  assert.equal(isCryptoSymbol('ZZZ-USD'), false); // unsupported base
  assert.equal(isCryptoSymbol('BTC-GBP'), false); // unsupported quote
});

test('every crypto universe symbol is itself a valid crypto symbol', () => {
  for (const item of CRYPTO_UNIVERSE) assert.equal(isCryptoSymbol(item.symbol), true);
});
