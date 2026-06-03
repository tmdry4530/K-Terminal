import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseInboxLine, recentSignals } from '../src/autodom.js';

test('parseInboxLine flattens the inbox envelope payload', () => {
  const line = JSON.stringify({
    received_at: '2026-04-22T09:59:15Z',
    signal_id: 'sig_1',
    event_id: 'evt_1',
    payload: { symbol: 'BTCUSDT', direction: 'SHORT', event_type: 'protocol_critical_exploit', verification_state: 'VERIFIED', confidence_score: 0.95, urgency_score: 0.94, ttl_sec: 90, rumor: false }
  });
  const parsed = parseInboxLine(line);
  assert.equal(parsed.signalId, 'sig_1');
  assert.equal(parsed.symbol, 'BTCUSDT');
  assert.equal(parsed.direction, 'SHORT');
  assert.equal(parsed.verificationState, 'VERIFIED');
  assert.equal(parsed.confidenceScore, 0.95);
  assert.equal(parsed.signal.event_type, 'protocol_critical_exploit');
});

test('parseInboxLine tolerates a bare signal and rejects bad json', () => {
  const bare = parseInboxLine(JSON.stringify({ symbol: 'ETHUSDT', direction: 'LONG', signal_id: 's2' }));
  assert.equal(bare.symbol, 'ETHUSDT');
  assert.equal(bare.direction, 'LONG');
  assert.equal(parseInboxLine('not json{'), null);
});

test('recentSignals reads the JSONL tail newest-first', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'kt-inbox-'));
  const file = path.join(dir, 'inbox.jsonl');
  await fs.writeFile(file, `${[
    JSON.stringify({ received_at: '2026-04-22T09:00:00Z', signal_id: 'a', payload: { symbol: 'BTCUSDT', direction: 'SHORT' } }),
    JSON.stringify({ received_at: '2026-04-22T09:01:00Z', signal_id: 'b', payload: { symbol: 'ETHUSDT', direction: 'LONG' } })
  ].join('\n')}\n`);
  const result = await recentSignals(10, file);
  assert.equal(result.configured, true);
  assert.equal(result.signals.length, 2);
  assert.equal(result.signals[0].signalId, 'b'); // newest first
  assert.equal(result.signals[1].symbol, 'BTCUSDT');
});

test('recentSignals reports not-configured when no inbox path is set', async () => {
  const result = await recentSignals(10, '');
  assert.equal(result.configured, false);
  assert.deepEqual(result.signals, []);
});
