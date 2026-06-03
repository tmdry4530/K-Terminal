import test from 'node:test';
import assert from 'node:assert/strict';
import { placeOrder, brokerCapabilities } from '../src/brokers.js';

const order = { symbol: 'AAPL', side: 'buy', quantity: 1, type: 'market' };

test('live orders are rejected without the explicit acknowledgement', async () => {
  const result = await placeOrder({ userId: 'u1', order, mode: 'live', userSettings: { liveTradingEnabled: true } });
  assert.equal(result.accepted, false);
  assert.equal(result.mode, 'live');
});

test('live orders are rejected when REAL_TRADING_ENABLED is off (default)', async () => {
  const result = await placeOrder({ userId: 'u1', order, mode: 'live', userSettings: { liveTradingEnabled: true }, });
  assert.equal(result.accepted, false); // config.realTradingEnabled defaults to false
});

test('invalid orders are rejected before any broker call', async () => {
  await assert.rejects(placeOrder({ userId: 'u1', order: { symbol: '', side: 'buy', quantity: 1 }, mode: 'live' }), /심볼/);
  await assert.rejects(placeOrder({ userId: 'u1', order: { symbol: 'AAPL', side: 'hold', quantity: 1 }, mode: 'live' }), /side/);
  await assert.rejects(placeOrder({ userId: 'u1', order: { symbol: 'AAPL', side: 'buy', quantity: 0 }, mode: 'live' }), /수량/);
});

test('brokerCapabilities always advertises local paper trading', () => {
  const capabilities = brokerCapabilities();
  const local = capabilities.find((c) => c.id === 'local-paper');
  assert.ok(local);
  assert.equal(local.canPlaceOrder, true);
});
