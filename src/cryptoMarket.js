import { DATA_STATUS, finiteOrNull } from './marketData.js';

// Free, no-key crypto market data. Binance (data-api mirror) is primary for USD/USDT pairs;
// CoinGecko covers KRW/EUR and acts as a fallback; Coinbase is a last-resort spot source.
// Symbols use the dash form BASE-QUOTE, e.g. BTC-USD, ETH-USD, BTC-KRW.
export const CRYPTO_BASES = Object.freeze({
  BTC: { name: 'Bitcoin', coingeckoId: 'bitcoin' },
  ETH: { name: 'Ethereum', coingeckoId: 'ethereum' },
  SOL: { name: 'Solana', coingeckoId: 'solana' },
  XRP: { name: 'XRP', coingeckoId: 'ripple' },
  ADA: { name: 'Cardano', coingeckoId: 'cardano' },
  DOGE: { name: 'Dogecoin', coingeckoId: 'dogecoin' },
  BNB: { name: 'BNB', coingeckoId: 'binancecoin' },
  AVAX: { name: 'Avalanche', coingeckoId: 'avalanche-2' }
});

const QUOTE_CCYS = new Set(['USD', 'USDT', 'KRW', 'EUR']);

export const CRYPTO_UNIVERSE = [
  { symbol: 'BTC-USD', label: 'BTC', kind: 'crypto' },
  { symbol: 'ETH-USD', label: 'ETH', kind: 'crypto' },
  { symbol: 'SOL-USD', label: 'SOL', kind: 'crypto' },
  { symbol: 'XRP-USD', label: 'XRP', kind: 'crypto' },
  { symbol: 'BNB-USD', label: 'BNB', kind: 'crypto' },
  { symbol: 'ADA-USD', label: 'ADA', kind: 'crypto' },
  { symbol: 'DOGE-USD', label: 'DOGE', kind: 'crypto' },
  { symbol: 'AVAX-USD', label: 'AVAX', kind: 'crypto' },
  { symbol: 'BTC-KRW', label: 'BTC/KRW', kind: 'crypto' },
  { symbol: 'ETH-KRW', label: 'ETH/KRW', kind: 'crypto' }
];

const CRYPTO_HEADERS = Object.freeze({
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  Accept: 'application/json'
});

const nowIso = () => new Date().toISOString();

export function parseCryptoSymbol(raw) {
  const symbol = String(raw || '').trim().toUpperCase();
  const match = symbol.match(/^([A-Z0-9]{2,10})-([A-Z]{3,4})$/u);
  if (!match) return null;
  const [, base, quote] = match;
  if (!CRYPTO_BASES[base] || !QUOTE_CCYS.has(quote)) return null;
  return { base, quote };
}

export function isCryptoSymbol(raw) {
  return parseCryptoSymbol(raw) !== null;
}

async function fetchJson(url, timeoutMs = 6500) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { headers: CRYPTO_HEADERS, signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function emptyCryptoQuote(symbol, base, quote, status, message) {
  return {
    symbol, name: CRYPTO_BASES[base]?.name || base, price: null, previousClose: null,
    change: null, changePercent: null, volume: null, currency: quote === 'USDT' ? 'USD' : quote,
    exchange: null, marketState: null, updatedAt: nowIso(), source: null, status, statusMessage: message, delayMinutes: null
  };
}

function quote(symbol, base, displayCcy, fields, source, status, message) {
  return {
    symbol, name: CRYPTO_BASES[base]?.name || base, currency: displayCcy, exchange: source,
    marketState: '24H', updatedAt: nowIso(), source, status, statusMessage: message, delayMinutes: null, ...fields
  };
}

async function binanceQuote(symbol, base) {
  const data = await fetchJson(`https://data-api.binance.vision/api/v3/ticker/24hr?symbol=${base}USDT`);
  const price = finiteOrNull(data?.lastPrice);
  if (price === null) throw new Error('Binance 24hr 응답에 가격이 없습니다.');
  return quote(symbol, base, 'USD', {
    price,
    previousClose: finiteOrNull(data.prevClosePrice),
    change: finiteOrNull(data.priceChange),
    changePercent: finiteOrNull(data.priceChangePercent),
    volume: finiteOrNull(data.quoteVolume)
  }, 'Binance', DATA_STATUS.REALTIME, '실시간 (Binance, USDT≈USD)');
}

async function coingeckoQuote(symbol, base, vsCurrency) {
  const id = CRYPTO_BASES[base]?.coingeckoId;
  if (!id) throw new Error('지원하지 않는 코인입니다.');
  const vs = vsCurrency.toLowerCase();
  const data = await fetchJson(`https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=${vs}&include_24hr_change=true&include_24hr_vol=true`);
  const price = finiteOrNull(data?.[id]?.[vs]);
  if (price === null) throw new Error('CoinGecko 응답에 가격이 없습니다.');
  const changePercent = finiteOrNull(data[id][`${vs}_24h_change`]);
  const previousClose = changePercent !== null ? price / (1 + changePercent / 100) : null;
  return quote(symbol, base, vsCurrency, {
    price,
    previousClose,
    change: previousClose !== null ? price - previousClose : null,
    changePercent,
    volume: finiteOrNull(data[id][`${vs}_24h_vol`])
  }, 'CoinGecko', DATA_STATUS.DELAYED, '지연 데이터 (CoinGecko, 무료 티어 캐시)');
}

async function coinbaseSpot(symbol, base, quoteCcy) {
  const data = await fetchJson(`https://api.coinbase.com/v2/prices/${base}-${quoteCcy}/spot`);
  const price = finiteOrNull(data?.data?.amount);
  if (price === null) throw new Error('Coinbase spot 응답에 가격이 없습니다.');
  return quote(symbol, base, quoteCcy, { price, previousClose: null, change: null, changePercent: null, volume: null },
    'Coinbase', DATA_STATUS.NEAR_REALTIME, '근실시간 (Coinbase spot, 변동률 없음)');
}

export async function getCryptoQuote(rawSymbol) {
  const parsed = parseCryptoSymbol(rawSymbol);
  const symbol = String(rawSymbol).trim().toUpperCase();
  if (!parsed) return emptyCryptoQuote(symbol, '', '', DATA_STATUS.NO_DATA, '지원하지 않는 암호화폐 심볼입니다.');
  const { base, quote: quoteCcy } = parsed;
  const usdLike = quoteCcy === 'USD' || quoteCcy === 'USDT';
  const providers = usdLike
    ? [() => binanceQuote(symbol, base), () => coingeckoQuote(symbol, base, 'USD'), () => coinbaseSpot(symbol, base, 'USD')]
    : [() => coingeckoQuote(symbol, base, quoteCcy), () => coinbaseSpot(symbol, base, quoteCcy)];
  const errors = [];
  for (const provider of providers) {
    try { return await provider(); } catch (error) { errors.push(error.message); }
  }
  return emptyCryptoQuote(symbol, base, quoteCcy, DATA_STATUS.ERROR, errors.join(' | ') || '암호화폐 데이터 없음');
}

const BINANCE_INTERVAL = { '1D': '1d', '1W': '1w', '1M': '1M' };
const RANGE_LIMIT = { '1M': 30, '3M': 90, '6M': 180, '1Y': 365, '2Y': 730, '5Y': 1000, '10Y': 1000 };
const COINGECKO_DAYS = { '1M': 30, '3M': 90, '6M': 180, '1Y': 365, '2Y': 365, '5Y': 365, '10Y': 365 };

function emptyCryptoChart(symbol, range, interval, status, message) {
  return { symbol, range, interval, candles: [], source: null, status, statusMessage: message, updatedAt: nowIso() };
}

async function binanceChart(symbol, base, range, interval) {
  const limit = Math.min(1000, RANGE_LIMIT[range] || 365);
  const data = await fetchJson(`https://data-api.binance.vision/api/v3/klines?symbol=${base}USDT&interval=${BINANCE_INTERVAL[interval] || '1d'}&limit=${limit}`);
  if (!Array.isArray(data) || !data.length) throw new Error('Binance klines 응답이 비어 있습니다.');
  const candles = data.map((k) => ({
    time: new Date(k[0]).toISOString(),
    open: finiteOrNull(k[1]), high: finiteOrNull(k[2]), low: finiteOrNull(k[3]), close: finiteOrNull(k[4]), volume: finiteOrNull(k[5])
  })).filter((bar) => bar.close !== null);
  return { symbol, range, interval, candles, currency: 'USD', source: 'Binance klines', status: DATA_STATUS.REALTIME, statusMessage: '실시간 (Binance, USDT≈USD)', updatedAt: nowIso() };
}

async function coingeckoChart(symbol, base, quoteCcy, range, interval) {
  const id = CRYPTO_BASES[base]?.coingeckoId;
  if (!id) throw new Error('지원하지 않는 코인입니다.');
  const days = COINGECKO_DAYS[range] || 365;
  const data = await fetchJson(`https://api.coingecko.com/api/v3/coins/${id}/ohlc?vs_currency=${quoteCcy.toLowerCase()}&days=${days}`);
  if (!Array.isArray(data) || !data.length) throw new Error('CoinGecko OHLC 응답이 비어 있습니다.');
  const candles = data.map((row) => ({
    time: new Date(row[0]).toISOString(),
    open: finiteOrNull(row[1]), high: finiteOrNull(row[2]), low: finiteOrNull(row[3]), close: finiteOrNull(row[4]), volume: null
  })).filter((bar) => bar.close !== null);
  return { symbol, range, interval, candles, currency: quoteCcy, source: 'CoinGecko OHLC', status: DATA_STATUS.DELAYED, statusMessage: '지연 데이터 (CoinGecko 무료 티어, 거래량 없음)', updatedAt: nowIso() };
}

export async function getCryptoChart(rawSymbol, range = '1Y', interval = '1D') {
  const parsed = parseCryptoSymbol(rawSymbol);
  const symbol = String(rawSymbol).trim().toUpperCase();
  if (!parsed) return emptyCryptoChart(symbol, range, interval, DATA_STATUS.NO_DATA, '지원하지 않는 암호화폐 심볼입니다.');
  const { base, quote: quoteCcy } = parsed;
  const usdLike = quoteCcy === 'USD' || quoteCcy === 'USDT';
  const providers = usdLike
    ? [() => binanceChart(symbol, base, range, interval), () => coingeckoChart(symbol, base, 'USD', range, interval)]
    : [() => coingeckoChart(symbol, base, quoteCcy, range, interval)];
  const errors = [];
  for (const provider of providers) {
    try { return await provider(); } catch (error) { errors.push(error.message); }
  }
  return emptyCryptoChart(symbol, range, interval, DATA_STATUS.ERROR, errors.join(' | ') || '암호화폐 차트 데이터 없음');
}
