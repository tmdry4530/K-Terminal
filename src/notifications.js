import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { config } from './config.js';

const execFileAsync = promisify(execFile);
const NOTIFY_STATUSES = new Set(['PREVIEW_READY', 'GATE_REVIEW']);
const MAJOR_PROXY_SYMBOLS = new Set(['BTCUSDT', 'ETHUSDT']);
const SYMBOL_SPECIFIC_EVENTS = new Set(['protocol_critical_exploit', 'bridge_exploit', 'chain_halt_or_network_outage', 'exchange_listing_or_major_integration']);
const UNSUPPORTED_PROTOCOL_PATTERNS = [/humanity protocol/i, /\$H/i];

function evidenceText(signalLike) {
  const signal = signalLike?.signal && typeof signalLike.signal === 'object' ? signalLike.signal : signalLike;
  const evidence = Array.isArray(signal?.evidence_summary) ? signal.evidence_summary : [];
  return evidence.map((item) => `${item?.summary || ''} ${item?.source_label || ''} ${item?.url || ''}`).join(' ');
}

function isMajorProxyMisdirection(signalLike) {
  const signal = signalLike?.signal && typeof signalLike.signal === 'object' ? signalLike.signal : signalLike;
  const symbol = String(signalLike?.symbol || signal?.symbol || '').toUpperCase();
  const eventType = String(signalLike?.eventType || signal?.event_type || '');
  if (!MAJOR_PROXY_SYMBOLS.has(symbol) || !SYMBOL_SPECIFIC_EVENTS.has(eventType)) return false;
  const text = evidenceText(signalLike);
  if (UNSUPPORTED_PROTOCOL_PATTERNS.some((pattern) => pattern.test(text))) return true;
  const directContext = symbol === 'ETHUSDT'
    ? /ethereum (network|mainnet|protocol|chain)|eth mainnet/i
    : /bitcoin (network|core|protocol|chain)|btc network/i;
  return !directContext.test(text);
}


function resolvePath(p) {
  return path.isAbsolute(p) ? p : path.resolve(config.rootDir, p);
}

function firstEvidence(signalLike) {
  const signal = signalLike?.signal && typeof signalLike.signal === 'object' ? signalLike.signal : signalLike;
  const evidence = Array.isArray(signal?.evidence_summary) ? signal.evidence_summary : [];
  return evidence.find((item) => item?.summary || item?.source_label || item?.url) || null;
}

function cleanSummary(summary = '') {
  return String(summary)
    .replace(/\s*\|\s*published=[^|]+$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function coinLabel(signalLike) {
  const signal = signalLike?.signal && typeof signalLike.signal === 'object' ? signalLike.signal : signalLike;
  const symbol = String(signalLike?.symbol || signal?.symbol || '').replace(/USDT$|USD$|PERP$/i, '');
  const direction = signalLike?.direction || signal?.direction || 'WATCH';
  return `${symbol || 'COIN'} ${direction}`;
}

function notificationKey(signalLike) {
  const signal = signalLike?.signal && typeof signalLike.signal === 'object' ? signalLike.signal : signalLike;
  return signalLike?.signalId || signal?.signal_id || signalLike?.eventId || signal?.event_id || `${signalLike?.symbol || signal?.symbol || 'unknown'}:${signalLike?.receivedAt || signal?.generated_at || ''}`;
}

export function pickImpactNewsNotifications(signals, limit = 3) {
  return (signals || [])
    .filter((item) => NOTIFY_STATUSES.has(item?.newsTrade?.status))
    .filter((item) => !isMajorProxyMisdirection(item))
    .sort((a, b) => {
      const statusA = a.newsTrade.status === 'PREVIEW_READY' ? 1 : 0;
      const statusB = b.newsTrade.status === 'PREVIEW_READY' ? 1 : 0;
      return statusB - statusA || Number(b.urgencyScore || 0) - Number(a.urgencyScore || 0) || String(b.receivedAt || '').localeCompare(String(a.receivedAt || ''));
    })
    .slice(0, limit);
}

export function formatImpactNewsMessage(signalLike) {
  const evidence = firstEvidence(signalLike) || {};
  const trade = signalLike.newsTrade || {};
  const title = cleanSummary(evidence.summary) || `${signalLike.eventType || 'impact_news'} ${signalLike.symbol || ''}`.trim();
  const source = evidence.source_label || evidence.source_type || 'source';
  const reasons = Array.isArray(trade.reasons) ? trade.reasons.slice(0, 3).join(', ') : '';
  const url = evidence.url ? `\n출처: ${evidence.url}` : '';
  return [
    '🚨 임팩트뉴스 + 코인픽',
    `${coinLabel(signalLike)} · ${trade.label || trade.status || '후보'}`,
    title,
    `이벤트: ${String(signalLike.eventType || '').replace(/_/g, ' ') || '-'}`,
    `점수: conf ${signalLike.confidenceScore ?? '-'} / urg ${signalLike.urgencyScore ?? '-'}`,
    `출처: ${source}`,
    reasons ? `게이트: ${reasons}` : null,
    url.trim() || null
  ].filter(Boolean).join('\n');
}

async function readNotified(pathname) {
  try {
    const data = JSON.parse(await fs.readFile(pathname, 'utf8'));
    return new Set(Array.isArray(data?.keys) ? data.keys : []);
  } catch {
    return new Set();
  }
}

async function writeNotified(pathname, keys) {
  await fs.mkdir(path.dirname(pathname), { recursive: true });
  const recent = [...keys].slice(-500);
  await fs.writeFile(pathname, JSON.stringify({ keys: recent, updated_at: new Date().toISOString() }, null, 2));
}

export async function notifyImpactNewsPicks(signals, options = {}) {
  const enabled = options.enabled ?? config.telegramImpactNewsNotify;
  const target = options.target ?? config.telegramImpactNewsTarget;
  const hermesBin = options.hermesBin ?? config.hermesBin;
  const hermesProfile = options.hermesProfile ?? config.hermesProfile;
  const statePath = resolvePath(options.statePath ?? config.telegramImpactNewsStatePath);
  if (!enabled || !target) return { enabled: false, sent: 0 };

  const notified = await readNotified(statePath);
  const picks = pickImpactNewsNotifications(signals).filter((item) => !notified.has(notificationKey(item)));
  let sent = 0;
  for (const pick of picks) {
    const key = notificationKey(pick);
    const message = formatImpactNewsMessage(pick);
    const args = hermesProfile ? ['--profile', hermesProfile, 'send'] : ['send'];
    await execFileAsync(hermesBin, [...args, '--quiet', '--to', target, message], { timeout: 15000, maxBuffer: 1024 * 64 });
    notified.add(key);
    sent += 1;
  }
  if (sent) await writeNotified(statePath, notified);
  return { enabled: true, sent };
}
