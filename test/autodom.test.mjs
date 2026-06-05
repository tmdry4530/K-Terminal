import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { assessNewsTrade, normalizeExecutionRecord, parseInboxLine, recentExecutions, recentSignals } from '../src/autodom.js';

test('parseInboxLine flattens the inbox envelope payload', () => {
  const published = new Date().toUTCString();
  const line = JSON.stringify({
    received_at: new Date().toISOString(),
    signal_id: 'sig_1',
    event_id: 'evt_1',
    payload: { symbol: 'BTCUSDT', direction: 'SHORT', event_type: 'protocol_critical_exploit', verification_state: 'VERIFIED', confidence_score: 0.95, urgency_score: 0.94, ttl_sec: 90, rumor: false, trade_allowed: true, evidence_summary: [{ source_type: 'official', source_label: 'Binance', summary: `incident confirmed | published=${published}` }] }
  });
  const parsed = parseInboxLine(line);
  assert.equal(parsed.signalId, 'sig_1');
  assert.equal(parsed.symbol, 'BTCUSDT');
  assert.equal(parsed.direction, 'SHORT');
  assert.equal(parsed.verificationState, 'VERIFIED');
  assert.equal(parsed.confidenceScore, 0.95);
  assert.equal(parsed.signal.event_type, 'protocol_critical_exploit');
  assert.equal(parsed.newsTrade.status, 'PREVIEW_READY');
});

test('assessNewsTrade only allows real-time serious news for preview/review', () => {
  const published = new Date().toUTCString();
  const evidence = [{ summary: `official severe incident | published=${published}` }];
  assert.equal(assessNewsTrade({ symbol: 'BTCUSDT', direction: 'SHORT', event_type: 'protocol_critical_exploit', verification_state: 'VERIFIED', confidence_score: 0.91, urgency_score: 0.86, trade_allowed: true, evidence_summary: evidence }).status, 'PREVIEW_READY');
  assert.equal(assessNewsTrade({ symbol: 'ETHUSDT', direction: 'LONG', event_type: 'bridge_exploit', verification_state: 'PROBABLE', confidence_score: 0.78, urgency_score: 0.82, trade_allowed: false, evidence_summary: evidence }).status, 'GATE_REVIEW');
  assert.equal(assessNewsTrade({ symbol: 'SOLUSDT', direction: 'LONG', event_type: 'major_regulatory_action', verification_state: 'PROBABLE', confidence_score: 0.9, urgency_score: 0.9, evidence_summary: evidence }).status, 'NO_TRADE');
  assert.equal(assessNewsTrade({ symbol: 'ZECUSDT', direction: 'SHORT', event_type: 'protocol_critical_exploit', verification_state: 'VERIFIED', confidence_score: 0.95, urgency_score: 0.95, trade_allowed: true, evidence_summary: [{ summary: 'old incident | published=Thu, 04 Jun 2026 04:49:44 -0400' }] }).status, 'NO_TRADE');
  assert.equal(assessNewsTrade({ symbol: 'DOGEUSDT', rumor: true }).status, 'NO_TRADE');
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

test('normalizeExecutionRecord parses a live_audit record', () => {
  const r = normalizeExecutionRecord({ time: '2026-06-04T01:00:00Z', signal_id: 'sig_1', symbol: 'BTCUSDT', decision: 'sent', reason: [], order_preview: { side: 'SELL', quantity: '0.001' } }, 'live');
  assert.equal(r.source, 'live');
  assert.equal(r.symbol, 'BTCUSDT');
  assert.equal(r.decision, 'sent');
  assert.equal(r.signalId, 'sig_1');
});

test('normalizeExecutionRecord parses a runtime submit_decision carrying the signal evidence', () => {
  const r = normalizeExecutionRecord({ time: '2026-06-04T01:00:00Z', mode: 'paper', signal: { signal_id: 's2', symbol: 'ETHUSDT', direction: 'LONG', evidence_summary: [{ source_type: 'official', source_label: 'X', summary: 'y' }] }, outcome: 'ingested', response: { data: { risk_decision: 'approved', reasons: [] } } }, 'runtime');
  assert.equal(r.source, 'paper');
  assert.equal(r.direction, 'LONG');
  assert.equal(r.decision, 'approved');
  assert.equal(r.signal.evidence_summary.length, 1);
});

test('recentExecutions reads the live_audit JSONL tail newest-first', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'kt-exec-'));
  const file = path.join(dir, 'live_audit.jsonl');
  await fs.writeFile(file, `${[
    JSON.stringify({ time: '2026-06-04T01:00:00Z', signal_id: 'a', symbol: 'BTCUSDT', decision: 'sent', reason: [] }),
    JSON.stringify({ time: '2026-06-04T01:05:00Z', signal_id: 'b', symbol: 'ETHUSDT', decision: 'rejected', reason: ['SLIPPAGE_TOO_HIGH'] })
  ].join('\n')}\n`);
  const result = await recentExecutions(10, { liveAuditPath: file, auditRoot: '' });
  assert.equal(result.configured, true);
  assert.equal(result.executions.length, 2);
  assert.equal(result.executions[0].signalId, 'b'); // newest first
  assert.equal(result.executions[0].decision, 'rejected');
});
