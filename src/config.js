import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from './env.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

// Load .env before any process.env value is read below. Real environment variables
// always win; a missing .env is not an error.
loadEnv(path.join(rootDir, process.env.ENV_FILE || '.env'));

function bool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function int(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const config = Object.freeze({
  rootDir,
  publicDir: path.join(rootDir, 'public'),
  dataDir: path.resolve(rootDir, process.env.DATA_DIR || './data'),
  port: int(process.env.PORT, 8080),
  nodeEnv: process.env.NODE_ENV || 'development',
  appBaseUrl: process.env.APP_BASE_URL || `http://localhost:${process.env.PORT || 8080}`,
  secretKey: process.env.SECRET_KEY || 'development-only-secret-change-before-production-64-chars-minimum',
  sessionDays: int(process.env.SESSION_DAYS, 7),
  cookieSecure: bool(process.env.COOKIE_SECURE, false),
  trustProxy: bool(process.env.TRUST_PROXY, false),
  marketDataProvider: process.env.MARKET_DATA_PROVIDER || 'auto',
  finnhubApiKey: process.env.FINNHUB_API_KEY || '',
  twelveDataApiKey: process.env.TWELVE_DATA_API_KEY || '',
  polygonApiKey: process.env.POLYGON_API_KEY || '',
  secUserAgent: process.env.SEC_USER_AGENT || 'k-terminal-finance/1.0 contact@example.com',
  dartApiKey: process.env.DART_API_KEY || '',
  fredApiKey: process.env.FRED_API_KEY || '',
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  geminiModel: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
  aiProvider: process.env.AI_PROVIDER || 'local',
  tradingDefaultMode: process.env.TRADING_DEFAULT_MODE || 'paper',
  realTradingEnabled: bool(process.env.REAL_TRADING_ENABLED, false),
  alpacaKeyId: process.env.ALPACA_KEY_ID || '',
  alpacaSecretKey: process.env.ALPACA_SECRET_KEY || '',
  alpacaPaper: bool(process.env.ALPACA_PAPER, true),
  alpacaPaperBaseUrl: process.env.ALPACA_PAPER_BASE_URL || 'https://paper-api.alpaca.markets',
  alpacaLiveBaseUrl: process.env.ALPACA_LIVE_BASE_URL || 'https://api.alpaca.markets',
  ibkrBaseUrl: process.env.IBKR_BASE_URL || 'https://localhost:5000/v1/api',
  kisAppKey: process.env.KIS_APP_KEY || '',
  kisAppSecret: process.env.KIS_APP_SECRET || '',
  kisAccountNo: process.env.KIS_ACCOUNT_NO || '',
  kisProductCode: process.env.KIS_PRODUCT_CODE || '',
  kisPaper: bool(process.env.KIS_PAPER, true)
});

// In production, refuse to boot with a weak/known SECRET_KEY — it encrypts every stored API
// key, so a known value makes them trivially decryptable. Rejects the hardcoded dev default,
// the .env.example placeholder, and anything too short. (Session tokens are SHA-256 hashed
// and don't depend on this.)
const weakSecret = !process.env.SECRET_KEY
  || config.secretKey.startsWith('development-only-secret')
  || config.secretKey.startsWith('replace-with')
  || config.secretKey.length < 32;
if (config.nodeEnv === 'production' && weakSecret) {
  throw new Error('SECRET_KEY must be a strong (32+ char) random value when NODE_ENV=production.');
}

export function providerFlags() {
  return {
    marketDataProvider: config.marketDataProvider,
    finnhub: Boolean(config.finnhubApiKey),
    twelveData: Boolean(config.twelveDataApiKey),
    polygon: Boolean(config.polygonApiKey),
    sec: true,
    dart: Boolean(config.dartApiKey),
    fred: Boolean(config.fredApiKey),
    gemini: Boolean(config.geminiApiKey),
    alpacaPaper: Boolean(config.alpacaKeyId && config.alpacaSecretKey && config.alpacaPaper),
    alpacaLiveConfigured: Boolean(config.alpacaKeyId && config.alpacaSecretKey && !config.alpacaPaper),
    realTradingEnabled: config.realTradingEnabled,
    ibkrConfigured: Boolean(config.ibkrBaseUrl),
    kisConfigured: Boolean(config.kisAppKey && config.kisAppSecret)
  };
}
