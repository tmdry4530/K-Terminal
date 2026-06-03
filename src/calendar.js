import { config } from './config.js';
import { DATA_STATUS, finiteOrNull } from './marketData.js';
import { createCache } from './cache.js';

// Earnings: Finnhub free tier (date range) when a key is present, Nasdaq's unofficial
// no-key endpoint (today only) as a labeled fallback. Economic: FRED US release dates
// (free key). Free global economic-calendar coverage is poor, so we are honest about it.
const calendarCache = createCache({ ttlMs: (r) => (r && r.status !== DATA_STATUS.ERROR ? 600000 : 15000), staleMs: 600000 });

const HEADERS = Object.freeze({
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  Accept: 'application/json'
});

const nowIso = () => new Date().toISOString();
const ymd = (date) => date.toISOString().slice(0, 10);

async function fetchJson(url, headers = HEADERS, timeoutMs = 8000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { headers, signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function finnhubEarnings(from, to, token) {
  const data = await fetchJson(`https://finnhub.io/api/v1/calendar/earnings?from=${from}&to=${to}&token=${encodeURIComponent(token)}`);
  if (!Array.isArray(data?.earningsCalendar)) throw new Error('Finnhub earnings 응답 형식 오류');
  return data.earningsCalendar.slice(0, 250).map((row) => ({
    symbol: row.symbol,
    date: row.date,
    hour: row.hour || null,
    epsEstimate: finiteOrNull(row.epsEstimate),
    epsActual: finiteOrNull(row.epsActual),
    revenueEstimate: finiteOrNull(row.revenueEstimate),
    revenueActual: finiteOrNull(row.revenueActual)
  }));
}

async function nasdaqEarnings(dateStr) {
  const data = await fetchJson(`https://api.nasdaq.com/api/calendar/earnings?date=${dateStr}`, { ...HEADERS, Origin: 'https://www.nasdaq.com', Referer: 'https://www.nasdaq.com/' });
  const rows = data?.data?.rows;
  if (!Array.isArray(rows)) throw new Error('Nasdaq earnings 응답 형식 오류');
  return rows.slice(0, 100).map((row) => ({
    symbol: row.symbol,
    name: row.name || null,
    date: dateStr,
    hour: row.time || null,
    epsEstimate: finiteOrNull(String(row.epsForecast || '').replace(/[$,]/g, '')),
    epsActual: null,
    revenueEstimate: null,
    revenueActual: null
  }));
}

export async function getEarningsCalendar(from, to, userApiKeys = {}) {
  const today = new Date();
  const fromDate = from || ymd(today);
  const toDate = to || ymd(new Date(today.getTime() + 14 * 24 * 60 * 60 * 1000));
  const token = userApiKeys.finnhub || config.finnhubApiKey;
  return calendarCache.get(`earn:${fromDate}:${toDate}:${token ? 'f' : 'n'}`, async () => {
    const errors = [];
    if (token) {
      try {
        const events = await finnhubEarnings(fromDate, toDate, token);
        return { from: fromDate, to: toDate, events, status: events.length ? DATA_STATUS.DELAYED : DATA_STATUS.NO_DATA, statusMessage: events.length ? 'Finnhub 실적 캘린더' : '해당 기간 실적 일정 없음', source: 'Finnhub', updatedAt: nowIso() };
      } catch (error) { errors.push(`Finnhub: ${error.message}`); }
    }
    try {
      const events = await nasdaqEarnings(fromDate);
      return { from: fromDate, to: fromDate, events, status: events.length ? DATA_STATUS.DELAYED : DATA_STATUS.NO_DATA, statusMessage: events.length ? 'Nasdaq 비공식 실적 캘린더(당일). 기간 조회는 FINNHUB_API_KEY 권장.' : '당일 실적 일정 없음', source: 'Nasdaq (비공식)', updatedAt: nowIso() };
    } catch (error) { errors.push(`Nasdaq: ${error.message}`); }
    return { from: fromDate, to: toDate, events: [], status: token ? DATA_STATUS.ERROR : DATA_STATUS.API_REQUIRED, statusMessage: `${token ? '' : 'FINNHUB_API_KEY가 있으면 기간 실적 캘린더를 제공합니다. '}${errors.join(' | ')}`, source: null, updatedAt: nowIso() };
  });
}

async function fredReleaseDates(token) {
  const today = new Date();
  const start = ymd(today);
  const end = ymd(new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000));
  const data = await fetchJson(`https://api.stlouisfed.org/fred/releases/dates?api_key=${encodeURIComponent(token)}&file_type=json&include_release_dates_with_no_data=false&realtime_start=${start}&realtime_end=${end}&sort_order=asc&limit=80`);
  if (!Array.isArray(data?.release_dates)) throw new Error('FRED 응답 형식 오류');
  return data.release_dates.map((row) => ({ date: row.date, name: row.release_name || `release ${row.release_id}`, country: 'US' }));
}

export async function getEconomicCalendar(userApiKeys = {}) {
  const token = userApiKeys.fred || config.fredApiKey;
  return calendarCache.get(`econ:${token ? 'k' : 'n'}`, async () => {
    if (!token) {
      return { events: [], status: DATA_STATUS.API_REQUIRED, statusMessage: 'FRED_API_KEY가 필요합니다. 무료 글로벌 경제 캘린더는 공개 소스가 제한적이며, 미국 지표 릴리즈 일정은 FRED 키로 제공됩니다.', source: 'FRED', updatedAt: nowIso() };
    }
    try {
      const events = await fredReleaseDates(token);
      return { events: events.slice(0, 80), status: events.length ? DATA_STATUS.DELAYED : DATA_STATUS.NO_DATA, statusMessage: events.length ? 'FRED 미국 경제지표 릴리즈 일정(예정)' : '예정된 릴리즈 없음', source: 'FRED', updatedAt: nowIso() };
    } catch (error) {
      return { events: [], status: DATA_STATUS.ERROR, statusMessage: `FRED 요청 실패: ${error.message}`, source: 'FRED', updatedAt: nowIso() };
    }
  });
}
