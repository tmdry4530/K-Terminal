import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';
import { decryptSecret, encryptSecret, hashPassword, randomId, sha256Hex, verifyPassword } from './crypto.js';

const DEFAULT_DB = {
  users: {},
  sessions: {},
  paperOrders: [],
  createdAt: new Date().toISOString(),
  schemaVersion: 1
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function safeUser(user) {
  if (!user) return null;
  const apiKeyProviders = Object.fromEntries(Object.entries(user.apiKeys || {}).map(([provider, value]) => [provider, Boolean(value?.data)]));
  return {
    id: user.id,
    email: user.email,
    createdAt: user.createdAt,
    settings: user.settings || {},
    watchlist: user.watchlist || [],
    apiKeyProviders
  };
}

function defaultSettings() {
  return {
    defaultSymbol: 'BTC-USD',
    language: 'ko',
    aiProvider: config.geminiApiKey ? 'gemini' : 'local',
    orderMode: 'paper',
    liveTradingEnabled: false,
    layout: null,
    alerts: [],
    theme: 'terminal'
  };
}

function defaultPortfolio() {
  return {
    baseCurrency: 'USD',
    cash: 0,
    holdings: []
  };
}

export class JsonStore {
  constructor(filePath = path.join(config.dataDir, 'db.json')) {
    this.filePath = filePath;
    this.db = clone(DEFAULT_DB);
    this.writePromise = Promise.resolve();
  }

  async init() {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw);
      this.db = { ...clone(DEFAULT_DB), ...parsed };
      this.db.users ||= {};
      this.db.sessions ||= {};
      this.db.paperOrders ||= [];
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      await this.persist();
    }
    this.cleanupSessions();
  }

  async persist() {
    const payload = JSON.stringify(this.db, null, 2);
    // .catch first so one failed write never poisons the chain and silently drops later saves.
    this.writePromise = this.writePromise.catch(() => {}).then(async () => {
      const tmp = `${this.filePath}.tmp`;
      await fs.writeFile(tmp, payload, 'utf8');
      await fs.rename(tmp, this.filePath);
    });
    return this.writePromise;
  }

  // Resolves once any in-flight persist() has finished writing. Used by graceful shutdown.
  async flush() {
    return this.writePromise;
  }

  cleanupSessions() {
    const now = Date.now();
    for (const [sessionHash, session] of Object.entries(this.db.sessions)) {
      if (!session?.expiresAt || new Date(session.expiresAt).getTime() < now) delete this.db.sessions[sessionHash];
    }
  }

  async createUser(email, password) {
    const normalizedEmail = String(email || '').trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalizedEmail)) {
      throw new Error('올바른 이메일 형식이 아닙니다.');
    }
    if (this.findUserByEmail(normalizedEmail)) throw new Error('이미 가입된 이메일입니다.');
    const id = randomId('usr_');
    const user = {
      id,
      email: normalizedEmail,
      password: hashPassword(password),
      createdAt: new Date().toISOString(),
      settings: defaultSettings(),
      watchlist: ['BTC-USD', 'ETH-USD', 'SOL-USD', 'XRP-USD', 'BTC-KRW'],
      apiKeys: {},
      portfolio: defaultPortfolio()
    };
    this.db.users[id] = user;
    await this.persist();
    return safeUser(user);
  }

  findUserByEmail(email) {
    const normalizedEmail = String(email || '').trim().toLowerCase();
    return Object.values(this.db.users).find((user) => user.email === normalizedEmail) || null;
  }

  getUserById(id) {
    return this.db.users[id] || null;
  }

  async verifyUser(email, password) {
    const user = this.findUserByEmail(email);
    if (!user || !verifyPassword(password, user.password)) return null;
    return user;
  }

  // Single-user mode: the one local operator account, created on first use with a random
  // (never-used-for-login) password. Idempotent.
  async ensureSingleUser() {
    const email = 'local@k-terminal.local';
    let user = this.findUserByEmail(email);
    if (!user) {
      await this.createUser(email, randomId('pw_'));
      user = this.findUserByEmail(email);
    }
    return user;
  }

  async createSession(userId) {
    const token = randomId('sess_');
    const tokenHash = sha256Hex(token);
    const expiresAt = new Date(Date.now() + config.sessionDays * 24 * 60 * 60 * 1000).toISOString();
    this.db.sessions[tokenHash] = { userId, createdAt: new Date().toISOString(), expiresAt };
    await this.persist();
    return { token, expiresAt };
  }

  async getUserBySessionToken(token) {
    if (!token) return null;
    this.cleanupSessions();
    const session = this.db.sessions[sha256Hex(token)];
    if (!session) return null;
    return this.getUserById(session.userId);
  }

  async deleteSession(token) {
    if (!token) return;
    delete this.db.sessions[sha256Hex(token)];
    await this.persist();
  }

  async updateSettings(userId, patch) {
    const user = this.getUserById(userId);
    if (!user) throw new Error('사용자를 찾을 수 없습니다.');
    user.settings = { ...defaultSettings(), ...(user.settings || {}), ...(patch || {}) };
    if (Array.isArray(patch?.watchlist)) user.watchlist = patch.watchlist.map((s) => String(s).trim().toUpperCase()).filter(Boolean).slice(0, 100);
    // Bound client-supplied alerts server-side (do not trust the browser's own cap).
    if (patch?.alerts !== undefined) user.settings.alerts = Array.isArray(patch.alerts) ? patch.alerts.slice(0, 100) : [];
    await this.persist();
    return safeUser(user);
  }

  async setApiKey(userId, provider, secret) {
    const user = this.getUserById(userId);
    if (!user) throw new Error('사용자를 찾을 수 없습니다.');
    const normalizedProvider = String(provider || '').trim().toLowerCase();
    if (!/^[a-z0-9_-]{2,40}$/.test(normalizedProvider)) throw new Error('지원하지 않는 API 공급자 이름입니다.');
    user.apiKeys ||= {};
    user.apiKeys[normalizedProvider] = encryptSecret(secret);
    await this.persist();
    return safeUser(user);
  }

  async deleteApiKey(userId, provider) {
    const user = this.getUserById(userId);
    if (!user) throw new Error('사용자를 찾을 수 없습니다.');
    delete user.apiKeys?.[String(provider || '').toLowerCase()];
    await this.persist();
    return safeUser(user);
  }

  getApiKey(userId, provider) {
    const user = this.getUserById(userId);
    const record = user?.apiKeys?.[String(provider || '').toLowerCase()];
    return decryptSecret(record);
  }

  getPortfolio(userId) {
    const user = this.getUserById(userId);
    if (!user) throw new Error('사용자를 찾을 수 없습니다.');
    user.portfolio ||= defaultPortfolio();
    user.portfolio.holdings ||= [];
    return clone(user.portfolio);
  }

  async updatePortfolio(userId, patch) {
    const user = this.getUserById(userId);
    if (!user) throw new Error('사용자를 찾을 수 없습니다.');
    user.portfolio = { ...defaultPortfolio(), ...(user.portfolio || {}), ...(patch || {}) };
    // Coerce base currency to a 3-letter code; anything else falls back to USD.
    user.portfolio.baseCurrency = /^[A-Za-z]{3}$/.test(String(user.portfolio.baseCurrency || '')) ? String(user.portfolio.baseCurrency).toUpperCase() : 'USD';
    if (Array.isArray(patch?.holdings)) user.portfolio.holdings = patch.holdings.map(normalizeHolding).filter(Boolean);
    await this.persist();
    return clone(user.portfolio);
  }

  async upsertHolding(userId, holding) {
    const user = this.getUserById(userId);
    if (!user) throw new Error('사용자를 찾을 수 없습니다.');
    user.portfolio ||= defaultPortfolio();
    user.portfolio.holdings ||= [];
    const normalized = normalizeHolding(holding);
    if (!normalized) throw new Error('보유 종목 입력값이 유효하지 않습니다.');
    if (!normalized.id) normalized.id = randomId('hld_');
    const idx = user.portfolio.holdings.findIndex((h) => h.id === normalized.id);
    if (idx >= 0) user.portfolio.holdings[idx] = { ...user.portfolio.holdings[idx], ...normalized };
    else user.portfolio.holdings.push(normalized);
    await this.persist();
    return clone(user.portfolio);
  }

  async deleteHolding(userId, holdingId) {
    const user = this.getUserById(userId);
    if (!user) throw new Error('사용자를 찾을 수 없습니다.');
    user.portfolio ||= defaultPortfolio();
    user.portfolio.holdings = (user.portfolio.holdings || []).filter((h) => h.id !== holdingId);
    await this.persist();
    return clone(user.portfolio);
  }

  async addPaperOrder(order) {
    const record = {
      id: randomId('ord_'),
      status: 'accepted-paper-local',
      mode: 'paper',
      createdAt: new Date().toISOString(),
      ...order
    };
    this.db.paperOrders.unshift(record);
    this.db.paperOrders = this.db.paperOrders.slice(0, 500);
    await this.persist();
    return clone(record);
  }

  listPaperOrders(userId) {
    return clone(this.db.paperOrders.filter((order) => order.userId === userId).slice(0, 100));
  }

  safeUser(user) {
    return safeUser(user);
  }
}

function normalizeHolding(raw) {
  if (!raw) return null;
  const symbol = String(raw.symbol || '').trim().toUpperCase();
  const quantity = Number(raw.quantity);
  if (!symbol || !Number.isFinite(quantity) || quantity <= 0) return null;
  const averagePrice = raw.averagePrice === '' || raw.averagePrice === undefined ? null : Number(raw.averagePrice);
  const targetWeight = raw.targetWeight === '' || raw.targetWeight === undefined ? null : Number(raw.targetWeight);
  const purchaseFxRate = raw.purchaseFxRate === '' || raw.purchaseFxRate === undefined ? null : Number(raw.purchaseFxRate);
  return {
    id: raw.id || '',
    symbol,
    name: String(raw.name || symbol).trim(),
    quantity,
    averagePrice: Number.isFinite(averagePrice) ? averagePrice : null,
    purchaseFxRate: Number.isFinite(purchaseFxRate) && purchaseFxRate > 0 ? purchaseFxRate : null,
    currency: String(raw.currency || (symbol.endsWith('.KS') || symbol.endsWith('.KQ') ? 'KRW' : 'USD')).toUpperCase(),
    sector: String(raw.sector || '').trim() || null,
    country: String(raw.country || (symbol.endsWith('.KS') || symbol.endsWith('.KQ') ? 'KR' : 'US')).toUpperCase(),
    targetWeight: Number.isFinite(targetWeight) ? targetWeight : null,
    notes: String(raw.notes || '').slice(0, 500),
    updatedAt: new Date().toISOString()
  };
}

export const store = new JsonStore();
