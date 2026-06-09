import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';
import { notifyImpactNewsPicks } from './notifications.js';

// Thin proxy to the co-located auto-dom local trading bridge. The terminal is an
// observer/cockpit: it reads status, runs side-effect-free previews, and can trip the
// emergency kill-switch — it never holds Binance keys and never enables live mode (that is
// gated by auto-dom's own bridge env double-lock).

async function bridgeFetch(endpoint, { method = 'GET', body, timeoutMs = 6000 } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = {};
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (config.autoDomBridgeToken) headers.Authorization = `Bearer ${config.autoDomBridgeToken}`;
    const response = await fetch(`${config.autoDomUrl}${endpoint}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal
    });
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
    return { ok: response.ok, status: response.status, data };
  } finally {
    clearTimeout(timeout);
  }
}

// Combined liveness + runtime status. Never throws — an offline bridge is a normal state.
export async function bridgeStatus() {
  try {
    const [health, status] = await Promise.all([bridgeFetch('/health'), bridgeFetch('/v1/status')]);
    if (!health.ok && !status.ok) {
      return { online: false, statusMessage: `브릿지 응답 없음 (${config.autoDomUrl})` };
    }
    return { online: true, health: health.data?.data || health.data, status: status.data?.data || status.data };
  } catch (error) {
    return { online: false, statusMessage: `브릿지 오프라인: ${error.message}` };
  }
}

export async function bridgeDashboard() {
  try {
    const result = await bridgeFetch('/v1/dashboard/snapshot');
    if (!result.ok) return { online: false, statusMessage: `대시보드 응답 없음 (${result.status})` };
    return { online: true, snapshot: result.data?.data || result.data };
  } catch (error) {
    return { online: false, statusMessage: error.message };
  }
}

// Side-effect-free risk/execution gate verdict for a raw signal. No inbox/order writes.
export async function previewSignal(signal) {
  try {
    const result = await bridgeFetch('/v1/signals/preview', { method: 'POST', body: signal });
    return { online: true, ok: result.ok, status: result.status, data: result.data };
  } catch (error) {
    return { online: false, statusMessage: error.message };
  }
}

// pause_trading / resume_trading only — the bridge rejects anything that could place an order.
export async function agentAction(action) {
  try {
    const result = await bridgeFetch('/v1/agent/actions', { method: 'POST', body: action });
    return { online: true, ok: result.ok, status: result.status, data: result.data };
  } catch (error) {
    return { online: false, statusMessage: error.message };
  }
}

const BINANCE_FUTURES_TICKER_URL = 'https://fapi.binance.com/fapi/v1/ticker/price';
const SERIOUS_NEWS_EVENTS = new Set(['protocol_critical_exploit', 'bridge_exploit', 'exchange_delisting_or_systemic_exchange_failure', 'war_level_global_macro_shock']);
const REALTIME_NEWS_MAX_AGE_MS = 30 * 60 * 1000;
const MAJOR_PROXY_SYMBOLS = new Set(['BTCUSDT', 'ETHUSDT']);
const SYMBOL_SPECIFIC_NEWS_EVENTS = new Set(['protocol_critical_exploit', 'bridge_exploit', 'chain_halt_or_network_outage', 'exchange_listing_or_major_integration']);

function numberOrNull(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function orderFillFromExecution(execution) {
  const order = execution?.orderPreview && typeof execution.orderPreview === 'object' ? execution.orderPreview : null;
  if (!order || order.filled !== true) return null;
  const quantity = numberOrNull(order.quantity ?? order.origQty ?? order.executedQty);
  const entryPrice = numberOrNull(order.fill_price ?? order.avgPrice ?? order.price ?? order.limit_price);
  const symbol = String(order.symbol || execution.symbol || '').toUpperCase();
  const side = String(order.side || '').toUpperCase();
  if (!symbol || !quantity || !entryPrice || !['BUY', 'SELL'].includes(side)) return null;
  return {
    id: String(order.execution_id || execution.signalId || `${symbol}:${execution.time || ''}`),
    time: execution.time || null,
    signalId: execution.signalId || null,
    symbol,
    side,
    direction: side === 'BUY' ? 'LONG' : 'SHORT',
    quantity,
    entryPrice,
    entryNotional: numberOrNull(order.filled_notional) ?? quantity * entryPrice,
    source: execution.source || 'paper',
    orderType: order.order_type || null,
    signal: execution.signal || null
  };
}

async function fetchBinanceFuturesPrices(symbols) {
  const unique = [...new Set(symbols.filter(Boolean).map((s) => String(s).toUpperCase()))];
  if (!unique.length) return {};
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(BINANCE_FUTURES_TICKER_URL, { signal: controller.signal, headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`Binance futures ticker HTTP ${response.status}`);
    const rows = await response.json();
    const prices = {};
    for (const row of Array.isArray(rows) ? rows : []) {
      const symbol = String(row?.symbol || '').toUpperCase();
      if (!unique.includes(symbol)) continue;
      const price = numberOrNull(row?.price);
      if (price !== null) prices[symbol] = price;
    }
    return prices;
  } catch {
    return {};
  } finally {
    clearTimeout(timeout);
  }
}

export function buildPaperPositionSummary(executions, prices = {}) {
  const fills = (executions || []).map(orderFillFromExecution).filter(Boolean);
  const positions = fills.map((fill) => {
    const currentPrice = numberOrNull(prices[fill.symbol]);
    const signed = fill.side === 'BUY' ? 1 : -1;
    const unrealizedPnl = currentPrice !== null ? (currentPrice - fill.entryPrice) * fill.quantity * signed : null;
    const returnPct = unrealizedPnl !== null && fill.entryNotional ? (unrealizedPnl / fill.entryNotional) * 100 : null;
    return { ...fill, currentPrice, unrealizedPnl, returnPct };
  });
  const totalEntryNotional = positions.reduce((sum, p) => sum + (p.entryNotional || 0), 0);
  const priced = positions.filter((p) => p.currentPrice !== null);
  const totalUnrealizedPnl = priced.reduce((sum, p) => sum + (p.unrealizedPnl || 0), 0);
  return {
    mode: 'paper',
    positions,
    summary: {
      positionCount: positions.length,
      pricedCount: priced.length,
      totalEntryNotional,
      totalUnrealizedPnl: priced.length ? totalUnrealizedPnl : null,
      totalReturnPct: priced.length && totalEntryNotional ? (totalUnrealizedPnl / totalEntryNotional) * 100 : null,
      priceSource: priced.length ? 'Binance USDⓈ-M futures public ticker' : null,
      updatedAt: new Date().toISOString()
    }
  };
}

function evidencePublishedAtMs(signal) {
  const evidence = Array.isArray(signal?.evidence_summary) ? signal.evidence_summary : [];
  const summary = evidence.find((item) => item?.summary)?.summary || '';
  const match = String(summary).match(/published=([^|]+)$/i);
  if (!match) return null;
  const time = Date.parse(match[1].trim());
  return Number.isFinite(time) ? time : null;
}

export function isOperatorSuppressedSignal(signalLike) {
  const signal = signalLike?.signal && typeof signalLike.signal === 'object' ? signalLike.signal : signalLike;
  const evidence = Array.isArray(signal?.evidence_summary) ? signal.evidence_summary : [];
  const text = [
    signalLike?.source,
    signalLike?.monitored_account,
    signal?.source,
    signal?.signal_id,
    ...evidence.flatMap((item) => [item?.source_label, item?.source_type, item?.summary, item?.url])
  ].filter(Boolean).join(' ').toLowerCase();
  return /\bwhale[_\s-]?alert\b/.test(text) || /@whale_alert\b/.test(text);
}

function signalFreshEnough(signalLike, signal) {
  const candidates = [evidencePublishedAtMs(signal), Date.parse(signalLike?.receivedAt || ''), Date.parse(signal?.generated_at || ''), Date.parse(signal?.first_detected_at || '')];
  const time = candidates.find((value) => Number.isFinite(value));
  if (!Number.isFinite(time)) return false;
  return Date.now() - time <= REALTIME_NEWS_MAX_AGE_MS;
}

function signalEvidenceText(signal) {
  const evidence = Array.isArray(signal?.evidence_summary) ? signal.evidence_summary : [];
  return evidence.map((item) => `${item?.summary || ''} ${item?.source_label || ''} ${item?.url || ''}`).join(' ');
}

function isMajorProxyMisdirection(signalLike, signal) {
  const symbol = String(signalLike?.symbol || signal?.symbol || '').toUpperCase();
  const eventType = String(signalLike?.eventType || signal?.event_type || '');
  if (!MAJOR_PROXY_SYMBOLS.has(symbol) || !SYMBOL_SPECIFIC_NEWS_EVENTS.has(eventType)) return false;
  const text = signalEvidenceText(signal);
  if (/humanity protocol|\$H\b/i.test(text)) return true;
  const directContext = symbol === 'ETHUSDT'
    ? /ethereum (network|mainnet|protocol|chain)|eth mainnet/i
    : /bitcoin (network|core|protocol|chain)|btc network/i;
  return !directContext.test(text);
}

export function assessNewsTrade(signalLike) {
  const signal = signalLike?.signal && typeof signalLike.signal === 'object' ? signalLike.signal : signalLike;
  if (!signal || typeof signal !== 'object') {
    return { status: 'NO_TRADE', label: '거래금지', className: 'err', reasons: ['시그널 없음'] };
  }
  const verification = signalLike.verificationState || signal.verification_state || null;
  const confidence = typeof signalLike.confidenceScore === 'number' ? signalLike.confidenceScore : signal.confidence_score;
  const urgency = typeof signalLike.urgencyScore === 'number' ? signalLike.urgencyScore : signal.urgency_score;
  const ttl = typeof signalLike.ttlSec === 'number' ? signalLike.ttlSec : signal.ttl_sec;
  const evidence = Array.isArray(signal.evidence_summary) ? signal.evidence_summary : [];
  const tradeAllowed = signalLike.tradeAllowed ?? signal.trade_allowed;
  const seriousNews = SERIOUS_NEWS_EVENTS.has(signal.event_type || signalLike.eventType);
  const fresh = signalFreshEnough(signalLike, signal);
  const reasons = [];

  if (!signal.symbol) reasons.push('심볼 없음');
  if (!signal.direction) reasons.push('방향 없음');
  if (signal.rumor) reasons.push('루머 플래그');
  if (ttl != null && ttl <= 0) reasons.push('TTL 만료');
  if (!['VERIFIED', 'PROBABLE'].includes(verification)) reasons.push('검증 부족');
  if (typeof confidence !== 'number' || confidence < 0.75) reasons.push('신뢰도 부족');
  if (typeof urgency !== 'number' || urgency < 0.80) reasons.push('긴급도 낮음');
  if (!evidence.length) reasons.push('근거 없음');
  if (!seriousNews) reasons.push('심각뉴스 기준 미달');
  if (!fresh) reasons.push('실시간성 부족');
  if (tradeAllowed === false) reasons.push('trade_allowed=false');
  if (isMajorProxyMisdirection(signalLike, signal)) reasons.push('BTC/ETH 프록시 오판 차단');

  const coreReady = signal.symbol && signal.direction && !signal.rumor && (ttl == null || ttl > 0) && evidence.length > 0 && seriousNews && fresh && !isMajorProxyMisdirection(signalLike, signal);
  const previewReady = coreReady && verification === 'VERIFIED' && confidence >= 0.90 && urgency >= 0.85 && tradeAllowed === true;
  if (previewReady) return { status: 'PREVIEW_READY', label: '프리뷰대상', className: 'ok', reasons: ['실시간 심각뉴스·검증·신뢰·긴급도 통과'] };

  const gateReview = coreReady && ['VERIFIED', 'PROBABLE'].includes(verification) && confidence >= 0.75 && urgency >= 0.80;
  if (gateReview) return { status: 'GATE_REVIEW', label: '게이트검토', className: 'warn', reasons: reasons.length ? reasons : ['auto-dom 게이트 확인 필요'] };

  return { status: 'NO_TRADE', label: '거래금지', className: 'err', reasons: reasons.length ? reasons : ['실시간 심각뉴스 기준 미달'] };
}

// Each inbox line is { received_at, signal_id, event_id, payload: <signal>, source }.
// Flatten to the signal fields the UI renders, newest first.
export function parseInboxLine(line) {
  let record;
  try { record = JSON.parse(line); } catch { return null; }
  const signal = record?.payload && typeof record.payload === 'object' ? record.payload : record;
  if (!signal || typeof signal !== 'object') return null;
  const flattened = {
    receivedAt: record.received_at || signal.generated_at || null,
    signalId: record.signal_id || signal.signal_id || null,
    eventId: record.event_id || signal.event_id || null,
    symbol: signal.symbol || null,
    direction: signal.direction || null,
    eventType: signal.event_type || null,
    verificationState: signal.verification_state || null,
    rumor: Boolean(signal.rumor),
    confidenceScore: typeof signal.confidence_score === 'number' ? signal.confidence_score : null,
    urgencyScore: typeof signal.urgency_score === 'number' ? signal.urgency_score : null,
    noveltyScore: typeof signal.novelty_score === 'number' ? signal.novelty_score : null,
    ttlSec: typeof signal.ttl_sec === 'number' ? signal.ttl_sec : null,
    tradeAllowed: signal.trade_allowed === true ? true : signal.trade_allowed === false ? false : null,
    executionPreference: signal.execution_preference || null,
    generatedAt: signal.generated_at || null,
    signal
  };
  flattened.newsTrade = assessNewsTrade(flattened);
  return flattened;
}

export async function recentSignals(limit = 50, inboxPath = config.autoDomInboxPath) {
  if (!inboxPath) {
    return { configured: false, signals: [], statusMessage: 'AUTO_DOM_INBOX_PATH 미설정' };
  }
  const absolute = path.isAbsolute(inboxPath) ? inboxPath : path.resolve(config.rootDir, inboxPath);
  try {
    const raw = await fs.readFile(absolute, 'utf8');
    const lines = raw.split(/\r?\n/).filter(Boolean);
    const signals = lines.slice(-limit * 3).map(parseInboxLine).filter(Boolean).filter((signal) => !isOperatorSuppressedSignal(signal)).reverse().slice(0, limit);
    notifyImpactNewsPicks(signals).catch((error) => console.error(`[impact-news-notify] ${error.message}`));
    return { configured: true, signals, source: absolute };
  } catch (error) {
    if (error.code === 'ENOENT') return { configured: true, signals: [], statusMessage: 'inbox 파일 없음 (아직 수신된 시그널 없음)', source: absolute };
    return { configured: true, signals: [], statusMessage: error.message, source: absolute };
  }
}

function resolvePath(p) {
  return path.isAbsolute(p) ? p : path.resolve(config.rootDir, p);
}

// live_audit.jsonl line: { time, signal_id, symbol, decision, reason, order_preview, exchange_response_redacted }
export function normalizeExecutionRecord(record, source = 'live') {
  if (!record || typeof record !== 'object') return null;
  if (source === 'live') {
    return {
      time: record.time || null,
      source: 'live',
      signalId: record.signal_id || null,
      symbol: record.symbol || null,
      direction: null,
      decision: record.decision || null, // 'sent' | 'rejected'
      reasons: Array.isArray(record.reason) ? record.reason : (record.reason ? [record.reason] : []),
      orderPreview: record.order_preview || null,
      signal: null
    };
  }
  // runtime audit submit_decision: { time, mode, signal, outcome, response }
  const signal = record.signal && typeof record.signal === 'object' ? record.signal : null;
  const response = record.response && typeof record.response === 'object' ? record.response : {};
  const data = response.data || response;
  return {
    time: record.time || null,
    source: record.mode || 'audit',
    signalId: signal?.signal_id || null,
    symbol: signal?.symbol || null,
    direction: signal?.direction || null,
    decision: data.risk_decision || data.decision || record.outcome || null,
    reasons: data.reasons || data.rejection_reasons || [],
    orderPreview: data.paper_order || record.paper_order || data.execution_result || data.order || null,
    signal
  };
}

async function readLiveAudit(limit, liveAuditPath) {
  if (!liveAuditPath) return [];
  try {
    const raw = await fs.readFile(resolvePath(liveAuditPath), 'utf8');
    return raw.split(/\r?\n/).filter(Boolean).slice(-limit)
      .map((line) => { try { return normalizeExecutionRecord(JSON.parse(line), 'live'); } catch { return null; } })
      .filter(Boolean);
  } catch { return []; }
}

async function readRuntimeAudit(limit, auditRoot) {
  if (!auditRoot) return [];
  const root = resolvePath(auditRoot);
  let dirents;
  try { dirents = await fs.readdir(root, { withFileTypes: true }); } catch { return []; }
  const stats = await Promise.all(dirents.filter((d) => d.isDirectory()).map(async (d) => {
    try { return { name: d.name, mtime: (await fs.stat(path.join(root, d.name))).mtimeMs }; } catch { return null; }
  }));
  // Scan more dirs than `limit` so approved decisions aren't crowded out of the window by
  // a recent burst of rejections (rejections live in submit_rejection.json, not submit_decision).
  const recent = stats.filter(Boolean).sort((a, b) => b.mtime - a.mtime).slice(0, limit * 3);
  const records = await Promise.all(recent.map(async (d) => {
    for (const file of ['submit_decision.json', 'submit_rejection.json']) {
      try { return normalizeExecutionRecord(JSON.parse(await fs.readFile(path.join(root, d.name, file), 'utf8')), 'runtime'); } catch { /* try next record type */ }
    }
    return null;
  }));
  return records.filter(Boolean);
}

// Entered positions / execution decisions with their originating signal (for rationale).
export async function recentExecutions(limit = 40, { liveAuditPath = config.autoDomLiveAuditPath, auditRoot = config.autoDomAuditRoot } = {}) {
  const [live, runtime] = await Promise.all([readLiveAudit(limit, liveAuditPath), readRuntimeAudit(limit, auditRoot)]);
  const seen = new Set();
  const executions = [...live, ...runtime]
    .sort((a, b) => String(b.time || '').localeCompare(String(a.time || '')))
    .filter((item) => {
      const key = `${item.signalId || ''}:${item.time || ''}:${item.source}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit);
  const fills = executions.map(orderFillFromExecution).filter(Boolean);
  const prices = await fetchBinanceFuturesPrices(fills.map((fill) => fill.symbol));
  return { configured: Boolean(liveAuditPath || auditRoot), executions, paper: buildPaperPositionSummary(executions, prices) };
}
