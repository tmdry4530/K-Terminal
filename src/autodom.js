import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';

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

export async function getWatchTarget() {
  try {
    const result = await bridgeFetch('/v1/dashboard/watch-target');
    return { online: result.ok, data: result.data?.data || result.data };
  } catch (error) {
    return { online: false, statusMessage: error.message };
  }
}

export async function setWatchTarget(target) {
  try {
    const result = await bridgeFetch('/v1/dashboard/watch-target', { method: 'POST', body: target });
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

// Each inbox line is { received_at, signal_id, event_id, payload: <signal>, source }.
// Flatten to the signal fields the UI renders, newest first.
export function parseInboxLine(line) {
  let record;
  try { record = JSON.parse(line); } catch { return null; }
  const signal = record?.payload && typeof record.payload === 'object' ? record.payload : record;
  if (!signal || typeof signal !== 'object') return null;
  return {
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
    tradeAllowed: Boolean(signal.trade_allowed),
    executionPreference: signal.execution_preference || null,
    generatedAt: signal.generated_at || null,
    signal
  };
}

export async function recentSignals(limit = 50, inboxPath = config.autoDomInboxPath) {
  if (!inboxPath) {
    return { configured: false, signals: [], statusMessage: 'AUTO_DOM_INBOX_PATH 미설정' };
  }
  const absolute = path.isAbsolute(inboxPath) ? inboxPath : path.resolve(config.rootDir, inboxPath);
  try {
    const raw = await fs.readFile(absolute, 'utf8');
    const lines = raw.split(/\r?\n/).filter(Boolean);
    const signals = lines.slice(-limit).map(parseInboxLine).filter(Boolean).reverse();
    return { configured: true, signals, source: absolute };
  } catch (error) {
    if (error.code === 'ENOENT') return { configured: true, signals: [], statusMessage: 'inbox 파일 없음 (아직 수신된 시그널 없음)', source: absolute };
    return { configured: true, signals: [], statusMessage: error.message, source: absolute };
  }
}
