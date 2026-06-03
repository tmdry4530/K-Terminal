import { config } from './config.js';
import { createCache } from './cache.js';
import { getCryptoChart, getCryptoQuote, isCryptoSymbol } from './cryptoMarket.js';

export const DATA_STATUS = Object.freeze({
  REALTIME: '실시간',
  NEAR_REALTIME: '근실시간',
  DELAYED: '지연 데이터',
  API_REQUIRED: 'API 필요',
  NO_DATA: '데이터 없음',
  ERROR: '오류'
});

const DEFAULT_TIMEOUT = 6500;
// Yahoo's public endpoints throttle/deny requests without a realistic browser User-Agent.
// The /v8/finance/chart path (our quote+chart backbone) needs no crumb — only these headers.
const YAHOO_HEADERS = Object.freeze({
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  Accept: 'application/json,text/plain,*/*'
});
const RANGE_MAP = {
  '1M': '1mo',
  '3M': '3mo',
  '6M': '6mo',
  '1Y': '1y',
  '2Y': '2y',
  '5Y': '5y',
  '10Y': '10y'
};
const INTERVAL_MAP_YAHOO = { '1D': '1d', '1W': '1wk', '1M': '1mo' };
const INTERVAL_MAP_FINNHUB = { '1D': 'D', '1W': 'W', '1M': 'M' };
const INTERVAL_MAP_TWELVE = { '1D': '1day', '1W': '1week', '1M': '1month' };

export const MARKET_UNIVERSE = [
  { symbol: '^GSPC', label: 'S&P 500', kind: 'index' },
  { symbol: '^IXIC', label: 'NASDAQ', kind: 'index' },
  { symbol: '^DJI', label: 'DOW', kind: 'index' },
  { symbol: '^VIX', label: 'VIX', kind: 'volatility' },
  { symbol: '^TNX', label: 'US 10Y', kind: 'rate' },
  { symbol: 'GC=F', label: 'Gold', kind: 'commodity' },
  { symbol: 'CL=F', label: 'WTI', kind: 'commodity' },
  { symbol: 'KRW=X', label: 'USD/KRW', kind: 'fx' },
  { symbol: 'SPY', label: 'SPY', kind: 'etf' },
  { symbol: 'QQQ', label: 'QQQ', kind: 'etf' },
  { symbol: '005930.KS', label: 'Samsung Elec.', kind: 'kr-stock' }
];

export const SYMBOL_PROFILE = {
  AAPL: { name: 'Apple', sector: 'Technology', country: 'US', currency: 'USD' },
  MSFT: { name: 'Microsoft', sector: 'Technology', country: 'US', currency: 'USD' },
  NVDA: { name: 'NVIDIA', sector: 'Technology', country: 'US', currency: 'USD' },
  AMZN: { name: 'Amazon', sector: 'Consumer Discretionary', country: 'US', currency: 'USD' },
  GOOGL: { name: 'Alphabet', sector: 'Communication Services', country: 'US', currency: 'USD' },
  GOOG: { name: 'Alphabet', sector: 'Communication Services', country: 'US', currency: 'USD' },
  META: { name: 'Meta Platforms', sector: 'Communication Services', country: 'US', currency: 'USD' },
  TSLA: { name: 'Tesla', sector: 'Consumer Discretionary', country: 'US', currency: 'USD' },
  SPY: { name: 'SPDR S&P 500 ETF', sector: 'ETF', country: 'US', currency: 'USD' },
  QQQ: { name: 'Invesco QQQ Trust', sector: 'ETF', country: 'US', currency: 'USD' },
  VTI: { name: 'Vanguard Total Stock Market ETF', sector: 'ETF', country: 'US', currency: 'USD' },
  '005930.KS': { name: 'Samsung Electronics', sector: 'Technology', country: 'KR', currency: 'KRW' },
  '000660.KS': { name: 'SK hynix', sector: 'Technology', country: 'KR', currency: 'KRW' },
  '035420.KS': { name: 'NAVER', sector: 'Communication Services', country: 'KR', currency: 'KRW' }
};

function nowIso() {
  return new Date().toISOString();
}

function normalizeSymbol(raw) {
  const symbol = String(raw || '').trim().toUpperCase();
  if (/^\d{6}$/.test(symbol)) return `${symbol}.KS`;
  return symbol;
}

function emptyQuote(symbol, status = DATA_STATUS.NO_DATA, message = '공급자에서 데이터를 반환하지 않았습니다.') {
  return {
    symbol: normalizeSymbol(symbol),
    name: SYMBOL_PROFILE[normalizeSymbol(symbol)]?.name || normalizeSymbol(symbol),
    price: null,
    previousClose: null,
    change: null,
    changePercent: null,
    volume: null,
    currency: SYMBOL_PROFILE[normalizeSymbol(symbol)]?.currency || null,
    exchange: null,
    marketState: null,
    updatedAt: nowIso(),
    source: null,
    status,
    statusMessage: message,
    delayMinutes: null
  };
}

function emptyChart(symbol, range, interval, status = DATA_STATUS.NO_DATA, message = '차트 데이터를 가져오지 못했습니다.') {
  return {
    symbol: normalizeSymbol(symbol),
    range,
    interval,
    candles: [],
    source: null,
    status,
    statusMessage: message,
    updatedAt: nowIso()
  };
}

async function fetchWithTimeout(url, options = {}, timeoutMs = DEFAULT_TIMEOUT) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) return await response.json();
    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

function classifyError(error, provider) {
  const message = error?.name === 'AbortError' ? '요청 시간 초과' : (error?.message || '알 수 없는 오류');
  return `${provider}: ${message}`;
}

function yahooUrl(symbol, params) {
  const safe = encodeURIComponent(symbol);
  const query = new URLSearchParams(params);
  return `https://query1.finance.yahoo.com/v8/finance/chart/${safe}?${query.toString()}`;
}

function parseYahooChartResponse(symbol, json, range, interval) {
  const result = json?.chart?.result?.[0];
  const error = json?.chart?.error;
  if (!result || error) {
    return emptyChart(symbol, range, interval, DATA_STATUS.NO_DATA, error?.description || 'Yahoo 응답에 차트 결과가 없습니다.');
  }
  const timestamps = result.timestamp || [];
  const quote = result.indicators?.quote?.[0] || {};
  const meta = result.meta || {};
  const candles = timestamps.map((time, idx) => ({
    time: new Date(time * 1000).toISOString(),
    open: finiteOrNull(quote.open?.[idx]),
    high: finiteOrNull(quote.high?.[idx]),
    low: finiteOrNull(quote.low?.[idx]),
    close: finiteOrNull(quote.close?.[idx]),
    volume: finiteOrNull(quote.volume?.[idx])
  })).filter((bar) => bar.close !== null && bar.open !== null && bar.high !== null && bar.low !== null);
  return {
    symbol: normalizeSymbol(symbol),
    range,
    interval,
    candles,
    currency: meta.currency || SYMBOL_PROFILE[normalizeSymbol(symbol)]?.currency || null,
    exchange: meta.exchangeName || meta.fullExchangeName || null,
    source: 'Yahoo Finance public chart endpoint',
    status: candles.length ? DATA_STATUS.DELAYED : DATA_STATUS.NO_DATA,
    statusMessage: candles.length ? '공개 엔드포인트 기반 지연/비보증 데이터입니다. 운영용 실시간 시세는 유료 API를 연결해야 합니다.' : '캔들 데이터가 비어 있습니다.',
    updatedAt: nowIso()
  };
}

function parseYahooQuote(symbol, json) {
  const result = json?.chart?.result?.[0];
  const meta = result?.meta;
  if (!meta) return emptyQuote(symbol, DATA_STATUS.NO_DATA, 'Yahoo 응답에 quote meta가 없습니다.');
  const price = finiteOrNull(meta.regularMarketPrice ?? meta.previousClose);
  const previousClose = finiteOrNull(meta.chartPreviousClose ?? meta.previousClose);
  const change = price !== null && previousClose !== null ? price - previousClose : null;
  const changePercent = change !== null && previousClose ? (change / previousClose) * 100 : null;
  const normalizedSymbol = normalizeSymbol(symbol);
  return {
    symbol: normalizedSymbol,
    name: SYMBOL_PROFILE[normalizedSymbol]?.name || meta.longName || meta.shortName || normalizedSymbol,
    price,
    previousClose,
    change,
    changePercent,
    volume: finiteOrNull(meta.regularMarketVolume),
    currency: meta.currency || SYMBOL_PROFILE[normalizedSymbol]?.currency || null,
    exchange: meta.exchangeName || meta.fullExchangeName || null,
    marketState: meta.marketState || null,
    updatedAt: meta.regularMarketTime ? new Date(meta.regularMarketTime * 1000).toISOString() : nowIso(),
    source: 'Yahoo Finance public chart endpoint',
    status: price !== null ? DATA_STATUS.DELAYED : DATA_STATUS.NO_DATA,
    statusMessage: price !== null ? '공개 엔드포인트 기반 지연/비보증 데이터입니다.' : '가격 필드가 비어 있습니다.',
    delayMinutes: null
  };
}

async function yahooQuote(symbol) {
  try {
    const normalized = normalizeSymbol(symbol);
    const json = await fetchWithTimeout(yahooUrl(normalized, { range: '1d', interval: '5m', includePrePost: 'false' }), { headers: YAHOO_HEADERS });
    return parseYahooQuote(normalized, json);
  } catch (error) {
    return emptyQuote(symbol, DATA_STATUS.ERROR, classifyError(error, 'Yahoo'));
  }
}

async function yahooChart(symbol, range = '1Y', interval = '1D') {
  try {
    const normalized = normalizeSymbol(symbol);
    const json = await fetchWithTimeout(yahooUrl(normalized, {
      range: RANGE_MAP[range] || '1y',
      interval: INTERVAL_MAP_YAHOO[interval] || '1d',
      includePrePost: 'false',
      events: 'div,splits'
    }), { headers: YAHOO_HEADERS });
    return parseYahooChartResponse(normalized, json, range, interval);
  } catch (error) {
    return emptyChart(symbol, range, interval, DATA_STATUS.ERROR, classifyError(error, 'Yahoo'));
  }
}

async function finnhubQuote(symbol, token = config.finnhubApiKey) {
  if (!token) return emptyQuote(symbol, DATA_STATUS.API_REQUIRED, 'FINNHUB_API_KEY가 필요합니다.');
  const normalized = normalizeSymbol(symbol).replace(/\.(KS|KQ)$/u, '');
  try {
    const data = await fetchWithTimeout(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(normalized)}&token=${encodeURIComponent(token)}`);
    const price = finiteOrNull(data?.c);
    if (price === null || price === 0) return emptyQuote(symbol, DATA_STATUS.NO_DATA, 'Finnhub quote가 비어 있습니다.');
    const previousClose = finiteOrNull(data?.pc);
    return {
      symbol: normalizeSymbol(symbol),
      name: SYMBOL_PROFILE[normalizeSymbol(symbol)]?.name || normalizeSymbol(symbol),
      price,
      previousClose,
      change: finiteOrNull(data?.d),
      changePercent: finiteOrNull(data?.dp),
      high: finiteOrNull(data?.h),
      low: finiteOrNull(data?.l),
      open: finiteOrNull(data?.o),
      volume: null,
      currency: SYMBOL_PROFILE[normalizeSymbol(symbol)]?.currency || 'USD',
      exchange: 'Finnhub',
      marketState: null,
      updatedAt: data?.t ? new Date(data.t * 1000).toISOString() : nowIso(),
      source: 'Finnhub quote API',
      status: DATA_STATUS.NEAR_REALTIME,
      statusMessage: 'Finnhub 계정/거래소 권한에 따라 실시간 또는 지연 시세일 수 있습니다.',
      delayMinutes: null
    };
  } catch (error) {
    return emptyQuote(symbol, DATA_STATUS.ERROR, classifyError(error, 'Finnhub'));
  }
}

function rangeToUnixStart(range) {
  const now = new Date();
  const date = new Date(now);
  const months = { '1M': 1, '3M': 3, '6M': 6, '1Y': 12, '2Y': 24, '5Y': 60, '10Y': 120 }[range] || 12;
  date.setMonth(date.getMonth() - months);
  return Math.floor(date.getTime() / 1000);
}

async function finnhubChart(symbol, range = '1Y', interval = '1D', token = config.finnhubApiKey) {
  if (!token) return emptyChart(symbol, range, interval, DATA_STATUS.API_REQUIRED, 'FINNHUB_API_KEY가 필요합니다.');
  const normalized = normalizeSymbol(symbol).replace(/\.(KS|KQ)$/u, '');
  const resolution = INTERVAL_MAP_FINNHUB[interval] || 'D';
  const from = rangeToUnixStart(range);
  const to = Math.floor(Date.now() / 1000);
  try {
    const data = await fetchWithTimeout(`https://finnhub.io/api/v1/stock/candle?symbol=${encodeURIComponent(normalized)}&resolution=${resolution}&from=${from}&to=${to}&token=${encodeURIComponent(token)}`);
    if (data?.s !== 'ok') return emptyChart(symbol, range, interval, DATA_STATUS.NO_DATA, `Finnhub candle status: ${data?.s || 'empty'}`);
    const candles = (data.t || []).map((time, idx) => ({
      time: new Date(time * 1000).toISOString(),
      open: finiteOrNull(data.o?.[idx]),
      high: finiteOrNull(data.h?.[idx]),
      low: finiteOrNull(data.l?.[idx]),
      close: finiteOrNull(data.c?.[idx]),
      volume: finiteOrNull(data.v?.[idx])
    })).filter((bar) => bar.close !== null);
    return {
      symbol: normalizeSymbol(symbol),
      range,
      interval,
      candles,
      source: 'Finnhub stock candle API',
      status: candles.length ? DATA_STATUS.NEAR_REALTIME : DATA_STATUS.NO_DATA,
      statusMessage: candles.length ? 'Finnhub 계정/거래소 권한에 따라 실시간 또는 지연 차트입니다.' : '캔들 데이터가 비어 있습니다.',
      updatedAt: nowIso()
    };
  } catch (error) {
    return emptyChart(symbol, range, interval, DATA_STATUS.ERROR, classifyError(error, 'Finnhub'));
  }
}

async function twelveQuote(symbol, token = config.twelveDataApiKey) {
  if (!token) return emptyQuote(symbol, DATA_STATUS.API_REQUIRED, 'TWELVE_DATA_API_KEY가 필요합니다.');
  const normalized = normalizeSymbol(symbol);
  try {
    const url = `https://api.twelvedata.com/quote?symbol=${encodeURIComponent(normalized)}&apikey=${encodeURIComponent(token)}`;
    const data = await fetchWithTimeout(url);
    if (data?.status === 'error') return emptyQuote(symbol, DATA_STATUS.NO_DATA, data?.message || 'Twelve Data quote 오류');
    const price = finiteOrNull(data?.close || data?.price);
    const previousClose = finiteOrNull(data?.previous_close);
    const change = finiteOrNull(data?.change ?? (price !== null && previousClose !== null ? price - previousClose : null));
    const changePercent = finiteOrNull(data?.percent_change);
    return {
      symbol: normalized,
      name: SYMBOL_PROFILE[normalized]?.name || data?.name || normalized,
      price,
      previousClose,
      change,
      changePercent,
      volume: finiteOrNull(data?.volume),
      currency: data?.currency || SYMBOL_PROFILE[normalized]?.currency || null,
      exchange: data?.exchange || 'Twelve Data',
      marketState: data?.is_market_open ? 'REGULAR' : null,
      updatedAt: data?.timestamp ? new Date(Number(data.timestamp) * 1000).toISOString() : nowIso(),
      source: 'Twelve Data quote API',
      status: price !== null ? DATA_STATUS.NEAR_REALTIME : DATA_STATUS.NO_DATA,
      statusMessage: price !== null ? 'Twelve Data 계정/플랜 권한에 따라 실시간 또는 지연 시세입니다.' : '가격 필드가 비어 있습니다.',
      delayMinutes: null
    };
  } catch (error) {
    return emptyQuote(symbol, DATA_STATUS.ERROR, classifyError(error, 'Twelve Data'));
  }
}

async function twelveChart(symbol, range = '1Y', interval = '1D', token = config.twelveDataApiKey) {
  if (!token) return emptyChart(symbol, range, interval, DATA_STATUS.API_REQUIRED, 'TWELVE_DATA_API_KEY가 필요합니다.');
  const normalized = normalizeSymbol(symbol);
  const outputSize = { '1M': 40, '3M': 90, '6M': 160, '1Y': 260, '2Y': 520, '5Y': 1300, '10Y': 2600 }[range] || 260;
  try {
    const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(normalized)}&interval=${encodeURIComponent(INTERVAL_MAP_TWELVE[interval] || '1day')}&outputsize=${outputSize}&apikey=${encodeURIComponent(token)}`;
    const data = await fetchWithTimeout(url);
    if (data?.status === 'error') return emptyChart(symbol, range, interval, DATA_STATUS.NO_DATA, data?.message || 'Twelve Data time_series 오류');
    const candles = (data.values || []).map((bar) => ({
      time: new Date(bar.datetime).toISOString(),
      open: finiteOrNull(bar.open),
      high: finiteOrNull(bar.high),
      low: finiteOrNull(bar.low),
      close: finiteOrNull(bar.close),
      volume: finiteOrNull(bar.volume)
    })).filter((bar) => bar.close !== null).reverse();
    return {
      symbol: normalized,
      range,
      interval,
      candles,
      source: 'Twelve Data time_series API',
      status: candles.length ? DATA_STATUS.NEAR_REALTIME : DATA_STATUS.NO_DATA,
      statusMessage: candles.length ? 'Twelve Data 계정/플랜 권한에 따라 실시간 또는 지연 차트입니다.' : '캔들 데이터가 비어 있습니다.',
      updatedAt: nowIso()
    };
  } catch (error) {
    return emptyChart(symbol, range, interval, DATA_STATUS.ERROR, classifyError(error, 'Twelve Data'));
  }
}

export function finiteOrNull(value) {
  const numeric = typeof value === 'string' ? Number(value.replace(/,/g, '')) : Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function providerOrder() {
  const provider = config.marketDataProvider.toLowerCase();
  if (provider === 'finnhub') return ['finnhub'];
  if (provider === 'twelvedata') return ['twelve'];
  if (provider === 'yahoo') return ['yahoo'];
  return [config.finnhubApiKey ? 'finnhub' : null, config.twelveDataApiKey ? 'twelve' : null, 'yahoo'].filter(Boolean);
}

// Cache buckets keyed by provider availability so a key-holder's better data is never
// served to anonymous callers. Error/empty results get a short TTL so recovery is quick.
function keyTag(userApiKeys = {}) {
  const finnhub = (userApiKeys.finnhub || config.finnhubApiKey) ? 'f' : '';
  const twelve = (userApiKeys.twelvedata || config.twelveDataApiKey) ? 't' : '';
  return `${config.marketDataProvider}:${finnhub}${twelve}`;
}

const quoteCache = createCache({ ttlMs: (q) => (q && q.price !== null ? 4000 : 1000), staleMs: 4000 });
const chartCache = createCache({ ttlMs: (c) => (c && c.candles?.length ? 45000 : 5000), staleMs: 30000 });
const optionsCache = createCache({ ttlMs: (o) => (o && o.options?.length ? 60000 : 5000), staleMs: 30000 });

export async function getQuote(symbol, userApiKeys = {}) {
  const normalized = normalizeSymbol(symbol);
  return quoteCache.get(`quote:${normalized}:${keyTag(userApiKeys)}`, () => fetchQuote(symbol, userApiKeys));
}

async function fetchQuote(symbol, userApiKeys = {}) {
  const normalized = normalizeSymbol(symbol);
  if (isCryptoSymbol(normalized)) return getCryptoQuote(normalized);
  const order = providerOrder();
  const errors = [];
  const statuses = [];
  for (const provider of order) {
    const result = provider === 'finnhub'
      ? await finnhubQuote(normalized, userApiKeys.finnhub || config.finnhubApiKey)
      : provider === 'twelve'
        ? await twelveQuote(normalized, userApiKeys.twelvedata || config.twelveDataApiKey)
        : await yahooQuote(normalized);
    if (result.price !== null) return result;
    statuses.push(result.status);
    errors.push(`${provider}: ${result.statusMessage}`);
  }
  const status = statuses.includes(DATA_STATUS.ERROR)
    ? DATA_STATUS.ERROR
    : statuses.length && statuses.every((value) => value === DATA_STATUS.API_REQUIRED)
      ? DATA_STATUS.API_REQUIRED
      : DATA_STATUS.NO_DATA;
  return emptyQuote(normalized, status, errors.join(' | ') || '사용 가능한 데이터 공급자가 없습니다.');
}

export async function getChart(symbol, range = '1Y', interval = '1D', userApiKeys = {}) {
  const normalized = normalizeSymbol(symbol);
  const safeRange = RANGE_MAP[range] ? range : '1Y';
  const safeInterval = INTERVAL_MAP_YAHOO[interval] ? interval : '1D';
  return chartCache.get(`chart:${normalized}:${safeRange}:${safeInterval}:${keyTag(userApiKeys)}`, () => fetchChart(symbol, range, interval, userApiKeys));
}

async function fetchChart(symbol, range = '1Y', interval = '1D', userApiKeys = {}) {
  const normalized = normalizeSymbol(symbol);
  const safeRange = RANGE_MAP[range] ? range : '1Y';
  const safeInterval = INTERVAL_MAP_YAHOO[interval] ? interval : '1D';
  if (isCryptoSymbol(normalized)) return getCryptoChart(normalized, safeRange, safeInterval);
  const order = providerOrder();
  const errors = [];
  const statuses = [];
  for (const provider of order) {
    const result = provider === 'finnhub'
      ? await finnhubChart(normalized, safeRange, safeInterval, userApiKeys.finnhub || config.finnhubApiKey)
      : provider === 'twelve'
        ? await twelveChart(normalized, safeRange, safeInterval, userApiKeys.twelvedata || config.twelveDataApiKey)
        : await yahooChart(normalized, safeRange, safeInterval);
    if (result.candles?.length) return result;
    statuses.push(result.status);
    errors.push(`${provider}: ${result.statusMessage}`);
  }
  const status = statuses.includes(DATA_STATUS.ERROR)
    ? DATA_STATUS.ERROR
    : statuses.length && statuses.every((value) => value === DATA_STATUS.API_REQUIRED)
      ? DATA_STATUS.API_REQUIRED
      : DATA_STATUS.NO_DATA;
  return emptyChart(normalized, safeRange, safeInterval, status, errors.join(' | ') || '사용 가능한 데이터 공급자가 없습니다.');
}

export async function getSnapshot(symbols, userApiKeys = {}) {
  const unique = [...new Set((symbols || []).map(normalizeSymbol).filter(Boolean))].slice(0, 80);
  const quotes = await Promise.all(unique.map((symbol) => getQuote(symbol, userApiKeys)));
  return {
    updatedAt: nowIso(),
    provider: config.marketDataProvider,
    quotes
  };
}

export async function getOptions(symbol) {
  const normalized = normalizeSymbol(symbol).replace(/\.(KS|KQ)$/u, '');
  return optionsCache.get(`options:${normalized}`, () => fetchOptions(symbol));
}

async function fetchOptions(symbol) {
  const normalized = normalizeSymbol(symbol).replace(/\.(KS|KQ)$/u, '');
  if (isCryptoSymbol(normalizeSymbol(symbol)) || !normalized || normalized.startsWith('^')) {
    return { symbol: normalizeSymbol(symbol), options: [], status: DATA_STATUS.NO_DATA, statusMessage: '옵션 체인을 지원하지 않는 심볼입니다.', source: null };
  }
  try {
    const data = await fetchWithTimeout(`https://query2.finance.yahoo.com/v7/finance/options/${encodeURIComponent(normalized)}`, { headers: YAHOO_HEADERS });
    const result = data?.optionChain?.result?.[0];
    const options = result?.options?.[0];
    if (!options) {
      return { symbol: normalized, options: [], status: DATA_STATUS.NO_DATA, statusMessage: '옵션 체인 응답이 비어 있습니다.', source: 'Yahoo Finance public options endpoint' };
    }
    // Type comes from which array the contract is in. The old heuristic
    // (contractSymbol.includes('C')) misclassified, since most tickers contain a C or P.
    const mapContract = (item, type) => ({
      contractSymbol: item.contractSymbol,
      expiration: item.expiration ? new Date(item.expiration * 1000).toISOString().slice(0, 10) : null,
      strike: finiteOrNull(item.strike),
      type,
      lastPrice: finiteOrNull(item.lastPrice),
      bid: finiteOrNull(item.bid),
      ask: finiteOrNull(item.ask),
      volume: finiteOrNull(item.volume),
      openInterest: finiteOrNull(item.openInterest),
      impliedVolatility: finiteOrNull(item.impliedVolatility)
    });
    const rows = [
      ...(options.calls || []).map((item) => mapContract(item, 'CALL')),
      ...(options.puts || []).map((item) => mapContract(item, 'PUT'))
    ].slice(0, 120);
    return {
      symbol: normalized,
      options: rows,
      expirations: (result.expirationDates || []).map((time) => new Date(time * 1000).toISOString().slice(0, 10)),
      underlyingPrice: finiteOrNull(result.quote?.regularMarketPrice),
      status: rows.length ? DATA_STATUS.DELAYED : DATA_STATUS.NO_DATA,
      statusMessage: rows.length ? '공개 엔드포인트 기반 지연/비보증 옵션 데이터입니다. 운영용 옵션 데이터는 Polygon 등 유료 API 연결을 권장합니다.' : '옵션 행이 없습니다.',
      source: 'Yahoo Finance public options endpoint',
      updatedAt: nowIso()
    };
  } catch (error) {
    return { symbol: normalized, options: [], status: DATA_STATUS.ERROR, statusMessage: classifyError(error, 'Options'), source: null, updatedAt: nowIso() };
  }
}
