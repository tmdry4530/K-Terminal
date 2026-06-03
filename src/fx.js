import { DATA_STATUS, finiteOrNull } from './marketData.js';
import { createCache } from './cache.js';

// FX rates change slowly and all free sources are delayed/EOD, so cache aggressively.
const fxCache = createCache({ ttlMs: (r) => (r && r.rate !== null ? 600000 : 15000), staleMs: 3600000 });

const YAHOO_HEADERS = Object.freeze({
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  Accept: 'application/json,text/plain,*/*'
});

const nowIso = () => new Date().toISOString();

async function fetchWithTimeout(url, options = {}, timeoutMs = 6500) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

// Yahoo FX pair, e.g. USDKRW=X = how many KRW per 1 USD. Uses the crumb-free v8 chart path.
async function yahooRate(from, to) {
  const symbol = `${from}${to}=X`;
  const json = await fetchWithTimeout(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1d`, { headers: YAHOO_HEADERS });
  const meta = json?.chart?.result?.[0]?.meta;
  const rate = finiteOrNull(meta?.regularMarketPrice ?? meta?.previousClose ?? meta?.chartPreviousClose);
  if (rate === null || rate <= 0) throw new Error('Yahoo FX 응답에 유효한 환율이 없습니다.');
  return { rate, source: 'Yahoo Finance FX (지연)', status: DATA_STATUS.DELAYED };
}

async function erApiRate(from, to) {
  const json = await fetchWithTimeout(`https://open.er-api.com/v6/latest/${encodeURIComponent(from)}`);
  const rate = finiteOrNull(json?.rates?.[to]);
  if (rate === null || rate <= 0) throw new Error('open.er-api 응답에 대상 통화가 없습니다.');
  return { rate, source: 'open.er-api.com (일 1회 갱신)', status: DATA_STATUS.DELAYED };
}

async function frankfurterRate(from, to) {
  const json = await fetchWithTimeout(`https://api.frankfurter.dev/v1/latest?base=${encodeURIComponent(from)}&symbols=${encodeURIComponent(to)}`);
  const rate = finiteOrNull(json?.rates?.[to]);
  if (rate === null || rate <= 0) throw new Error('frankfurter 응답에 대상 통화가 없습니다.');
  return { rate, source: 'frankfurter.dev (ECB EOD)', status: DATA_STATUS.DELAYED };
}

async function fetchRate(from, to) {
  const providers = [yahooRate, erApiRate, frankfurterRate];
  const errors = [];
  for (const provider of providers) {
    try {
      const result = await provider(from, to);
      return { from, to, ...result, updatedAt: nowIso() };
    } catch (error) {
      errors.push(`${provider.name}: ${error.message}`);
    }
  }
  // No fake numbers: an unavailable rate is null, never silently 1:1.
  return { from, to, rate: null, source: null, status: DATA_STATUS.NO_DATA, statusMessage: errors.join(' | ') || '환율 데이터 없음', updatedAt: nowIso() };
}

// Convert 1 unit of `from` currency into `to` currency.
export async function getRate(from, to) {
  const f = String(from || '').trim().toUpperCase();
  const t = String(to || '').trim().toUpperCase();
  if (!f || !t) {
    return { from: f, to: t, rate: null, source: null, status: DATA_STATUS.NO_DATA, statusMessage: '통화 코드가 비어 있습니다.', updatedAt: nowIso() };
  }
  if (f === t) {
    return { from: f, to: t, rate: 1, source: 'identity', status: DATA_STATUS.REALTIME, updatedAt: nowIso() };
  }
  return fxCache.get(`fx:${f}:${t}`, () => fetchRate(f, t));
}

// Resolve every distinct currency -> base rate. Returns Map(currency -> rate record).
export async function getRates(currencies, base) {
  const b = String(base || 'USD').trim().toUpperCase();
  const unique = [...new Set((currencies || []).map((c) => String(c || '').trim().toUpperCase()).filter(Boolean))];
  const entries = await Promise.all(unique.map(async (currency) => [currency, await getRate(currency, b)]));
  return new Map(entries);
}
