import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { assessNewsTrade, buildPaperPositionSummary, isOperatorSuppressedSignal, normalizeExecutionRecord, parseInboxLine, recentExecutions, recentSignals } from '../src/autodom.js';
import { formatImpactNewsMessage, pickImpactNewsNotifications } from '../src/notifications.js';

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

test('impact-news notifications pick only preview/review candidates and format Telegram message', () => {
  const published = new Date().toUTCString();
  const preview = parseInboxLine(JSON.stringify({
    received_at: new Date().toISOString(),
    signal_id: 'notify-1',
    payload: { symbol: 'ZECUSDT', direction: 'SHORT', event_type: 'protocol_critical_exploit', verification_state: 'VERIFIED', confidence_score: 0.96, urgency_score: 0.95, ttl_sec: 300, rumor: false, trade_allowed: true, evidence_summary: [{ source_type: 'official_project', source_label: 'Zcash', summary: `critical vuln confirmed | published=${published}`, url: 'https://example.com/zec' }] }
  }));
  const weak = parseInboxLine(JSON.stringify({ signal_id: 'weak', payload: { symbol: 'BTCUSDT', direction: 'LONG', event_type: 'major_regulatory_action' } }));
  const picks = pickImpactNewsNotifications([weak, preview]);
  assert.equal(picks.length, 1);
  assert.equal(picks[0].signalId, 'notify-1');
  const message = formatImpactNewsMessage(preview);
  assert.match(message, /임팩트뉴스 \+ 코인픽/);
  assert.match(message, /ZEC SHORT/);
  assert.match(message, /critical vuln confirmed/);
  assert.match(message, /https:\/\/example\.com\/zec/);
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

test('recentSignals suppresses Whale Alert transfer-noise from the cockpit feed', async () => {
  const whale = parseInboxLine(JSON.stringify({
    received_at: '2026-04-22T09:02:00Z',
    signal_id: 'whale',
    payload: { symbol: 'ETHUSDT', direction: 'SHORT', evidence_summary: [{ source_label: 'X Browser CDP', summary: 'Whale Alert 인증된 계정 @whale_alert 500,000,000 USDT transferred from Binance to Tether Treasury' }] }
  }));
  assert.equal(isOperatorSuppressedSignal(whale), true);

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'kt-inbox-'));
  const file = path.join(dir, 'inbox.jsonl');
  await fs.writeFile(file, `${[
    JSON.stringify({ received_at: '2026-04-22T09:00:00Z', signal_id: 'good', payload: { symbol: 'BTCUSDT', direction: 'LONG', evidence_summary: [{ source_label: 'WuBlockchain', summary: 'Syscoin bridge incident confirmed' }] } }),
    JSON.stringify({ received_at: '2026-04-22T09:02:00Z', signal_id: 'whale', payload: whale.signal })
  ].join('\n')}\n`);
  const result = await recentSignals(10, file);
  assert.equal(result.signals.length, 1);
  assert.equal(result.signals[0].signalId, 'good');
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
  const r = normalizeExecutionRecord({ time: '2026-06-04T01:00:00Z', mode: 'paper', signal: { signal_id: 's2', symbol: 'ETHUSDT', direction: 'LONG', evidence_summary: [{ source_type: 'official', source_label: 'X', summary: 'y' }] }, outcome: 'ingested', response: { data: { risk_decision: 'approved', reasons: [], paper_order: { symbol: 'ETHUSDT', side: 'BUY', quantity: '1', fill_price: '100', filled: true, filled_notional: '100' } } } }, 'runtime');
  assert.equal(r.source, 'paper');
  assert.equal(r.direction, 'LONG');
  assert.equal(r.decision, 'approved');
  assert.equal(r.orderPreview.fill_price, '100');
  assert.equal(r.signal.evidence_summary.length, 1);
});

test('buildPaperPositionSummary calculates per-position and total paper PnL', () => {
  const executions = [
    normalizeExecutionRecord({ time: '2026-06-04T01:00:00Z', mode: 'paper', signal: { signal_id: 'long', symbol: 'BTCUSDT', direction: 'LONG' }, response: { data: { risk_decision: 'approved', paper_order: { execution_id: 'long-exec', symbol: 'BTCUSDT', side: 'BUY', quantity: '0.1', fill_price: '10000', filled: true, filled_notional: '1000' } } } }, 'runtime'),
    normalizeExecutionRecord({ time: '2026-06-04T01:01:00Z', mode: 'paper', signal: { signal_id: 'short', symbol: 'ETHUSDT', direction: 'SHORT' }, response: { data: { risk_decision: 'approved', paper_order: { execution_id: 'short-exec', symbol: 'ETHUSDT', side: 'SELL', quantity: '2', fill_price: '2000', filled: true, filled_notional: '4000' } } } }, 'runtime')
  ];
  const paper = buildPaperPositionSummary(executions, { BTCUSDT: 11000, ETHUSDT: 1900 });
  assert.equal(paper.summary.positionCount, 2);
  assert.equal(paper.positions[0].unrealizedPnl, 100);
  assert.equal(paper.positions[0].returnPct, 10);
  assert.equal(paper.positions[1].unrealizedPnl, 200);
  assert.equal(paper.summary.totalUnrealizedPnl, 300);
  assert.equal(paper.summary.totalReturnPct, 6);
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
