import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { config, providerFlags } from './config.js';
import { store } from './store.js';
import { brokerCapabilities, placeOrder } from './brokers.js';
import { getChart, getOptions, getSnapshot, MARKET_UNIVERSE } from './marketData.js';
import { CRYPTO_UNIVERSE } from './cryptoMarket.js';
import { getNewsWithOptionalTranslation } from './news.js';
import { answerQuestion } from './ai.js';
import { getDartFilings, getSecFilings } from './filings.js';
import { getEarningsCalendar, getEconomicCalendar } from './calendar.js';
import { enrichPortfolio } from './portfolio.js';
import { applySecurityHeaders, clientIp, createLimiter, sameOriginOk } from './security.js';
import { createQuoteStream } from './stream.js';
import { agentAction, bridgeDashboard, bridgeStatus, getWatchTarget, previewSignal, recentExecutions, recentSignals, setWatchTarget } from './autodom.js';

// ~120 req/min sustained for general API; tight ~6/min on auth to blunt brute force.
const apiLimiter = createLimiter({ capacity: 120, refillPerSec: 2 });
const authLimiter = createLimiter({ capacity: 6, refillPerSec: 6 / 60 });
// Poll a generous inbox tail so a burst of signals between 5s ticks isn't dropped from the feed.
const quoteStream = createQuoteStream({ fetchSignals: () => recentSignals(200) });

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8'
};

function parseCookies(header = '') {
  return Object.fromEntries(header.split(';').map((part) => {
    const idx = part.indexOf('=');
    if (idx < 0) return null;
    return [decodeURIComponent(part.slice(0, idx).trim()), decodeURIComponent(part.slice(idx + 1).trim())];
  }).filter(Boolean));
}

function setSessionCookie(res, token, expiresAt) {
  const maxAge = Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000));
  const attrs = [`kt_session=${encodeURIComponent(token)}`, 'HttpOnly', 'Path=/', 'SameSite=Lax', `Max-Age=${maxAge}`];
  if (config.cookieSecure) attrs.push('Secure');
  res.setHeader('Set-Cookie', attrs.join('; '));
}

function clearSessionCookie(res) {
  const attrs = ['kt_session=', 'HttpOnly', 'Path=/', 'SameSite=Lax', 'Max-Age=0'];
  if (config.cookieSecure) attrs.push('Secure');
  res.setHeader('Set-Cookie', attrs.join('; '));
}

function sendJson(res, status, payload, extraHeaders = {}) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extraHeaders });
  res.end(JSON.stringify(payload, null, 2));
}

function sendError(res, status, message, details = undefined) {
  sendJson(res, status, { error: message, details });
}

async function readBody(req) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > 1024 * 1024) throw new Error('요청 본문이 너무 큽니다.');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error('JSON 본문 파싱 실패');
  }
}

async function getCurrentUser(req) {
  const cookies = parseCookies(req.headers.cookie || '');
  return await store.getUserBySessionToken(cookies.kt_session);
}

async function requireUser(req, res) {
  const user = await getCurrentUser(req);
  if (!user) {
    sendError(res, 401, '로그인이 필요합니다.');
    return null;
  }
  return user;
}

function getUserApiKeys(user) {
  if (!user) return {};
  const providers = ['finnhub', 'twelvedata', 'gemini', 'dart'];
  const result = {};
  for (const provider of providers) {
    try {
      const key = store.getApiKey(user.id, provider);
      if (key) result[provider] = key;
    } catch {
      // A rotated SECRET_KEY makes old encrypted values unreadable. Ignore here and expose false in settings.
    }
  }
  return result;
}

async function serveStatic(req, res, pathname) {
  let filePath = pathname === '/' ? '/index.html' : pathname;
  try {
    filePath = decodeURIComponent(filePath);
  } catch {
    sendError(res, 400, '잘못된 경로입니다.');
    return;
  }
  const absolute = path.normalize(path.join(config.publicDir, filePath));
  const relative = path.relative(config.publicDir, absolute);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    sendError(res, 403, '접근할 수 없는 경로입니다.');
    return;
  }
  try {
    const stat = await fs.stat(absolute);
    const finalPath = stat.isDirectory() ? path.join(absolute, 'index.html') : absolute;
    const data = await fs.readFile(finalPath);
    const ext = path.extname(finalPath).toLowerCase();
    // HTML never cached; JS/CSS revalidate (build-less app has no content hashing, so this
    // avoids stale assets after a deploy); images/fonts may be cached.
    const cacheControl = ext === '.html' ? 'no-store' : ext === '.js' || ext === '.css' ? 'no-cache' : 'public, max-age=3600';
    res.writeHead(200, { 'content-type': MIME[ext] || 'application/octet-stream', 'cache-control': cacheControl });
    res.end(data);
  } catch (error) {
    if (error.code === 'ENOENT') {
      const index = await fs.readFile(path.join(config.publicDir, 'index.html'));
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.end(index);
    } else {
      sendError(res, 500, '정적 파일 처리 실패', error.message);
    }
  }
}

async function routeApi(req, res, url) {
  const pathname = url.pathname;
  const method = req.method || 'GET';

  // CSRF defense-in-depth: reject cross-origin state-changing requests.
  if (!sameOriginOk(req)) {
    sendError(res, 403, '허용되지 않은 Origin의 요청입니다.');
    return;
  }

  // Rate limit early (before any DB work). Auth endpoints get a much tighter bucket.
  const ip = clientIp(req, { trustProxy: config.trustProxy });
  const isAuthEndpoint = pathname === '/api/auth/login' || pathname === '/api/auth/register';
  const limit = isAuthEndpoint ? authLimiter(`auth:${ip}`) : apiLimiter(`api:${ip}`);
  if (!limit.ok) {
    sendJson(res, 429, { error: '요청이 너무 많습니다. 잠시 후 다시 시도하세요.', retryAfter: limit.retryAfter }, { 'Retry-After': String(limit.retryAfter) });
    return;
  }

  // SSE quote stream: writes its own headers and stays open, so handle before JSON routing.
  if (method === 'GET' && pathname === '/api/stream') {
    const symbols = (url.searchParams.get('symbols') || '').split(',').map((s) => s.trim()).filter(Boolean);
    quoteStream.addClient(req, res, symbols, ip);
    return;
  }

  const user = await getCurrentUser(req);
  const userApiKeys = getUserApiKeys(user);

  if (method === 'GET' && pathname === '/api/health') {
    sendJson(res, 200, { ok: true, service: 'k-terminal-finance', time: new Date().toISOString(), version: '1.0.0' });
    return;
  }

  if (method === 'GET' && pathname === '/api/meta') {
    sendJson(res, 200, {
      app: 'K Terminal Finance',
      time: new Date().toISOString(),
      authenticated: Boolean(user),
      user: user ? store.safeUser(user) : null,
      providers: providerFlags(),
      marketUniverse: MARKET_UNIVERSE,
      cryptoUniverse: CRYPTO_UNIVERSE,
      brokerCapabilities: brokerCapabilities(),
      dataPolicy: {
        noFakeNumbers: true,
        statuses: ['실시간', '근실시간', '지연 데이터', 'API 필요', '데이터 없음', '오류'],
        publicMarketData: 'Yahoo Finance 공개 엔드포인트 fallback. 운영용 실시간 데이터는 Finnhub/Twelve Data/Polygon 등 API 키 권장.'
      }
    });
    return;
  }

  if (method === 'POST' && pathname === '/api/auth/register') {
    const body = await readBody(req);
    const safe = await store.createUser(body.email, body.password);
    const fullUser = store.getUserById(safe.id);
    const session = await store.createSession(fullUser.id);
    setSessionCookie(res, session.token, session.expiresAt);
    sendJson(res, 201, { user: safe });
    return;
  }

  if (method === 'POST' && pathname === '/api/auth/login') {
    const body = await readBody(req);
    const fullUser = await store.verifyUser(body.email, body.password);
    if (!fullUser) {
      sendError(res, 401, '이메일 또는 비밀번호가 올바르지 않습니다.');
      return;
    }
    const session = await store.createSession(fullUser.id);
    setSessionCookie(res, session.token, session.expiresAt);
    sendJson(res, 200, { user: store.safeUser(fullUser) });
    return;
  }

  if (method === 'POST' && pathname === '/api/auth/logout') {
    const cookies = parseCookies(req.headers.cookie || '');
    await store.deleteSession(cookies.kt_session);
    clearSessionCookie(res);
    sendJson(res, 200, { ok: true });
    return;
  }

  if (method === 'GET' && pathname === '/api/auth/me') {
    sendJson(res, 200, { user: user ? store.safeUser(user) : null });
    return;
  }

  if (method === 'GET' && pathname === '/api/market/snapshot') {
    const rawSymbols = url.searchParams.get('symbols') || MARKET_UNIVERSE.map((item) => item.symbol).join(',');
    const symbols = rawSymbols.split(',').map((s) => s.trim()).filter(Boolean);
    const snapshot = await getSnapshot(symbols, userApiKeys);
    sendJson(res, 200, snapshot);
    return;
  }

  if (method === 'GET' && pathname === '/api/market/chart') {
    const symbol = url.searchParams.get('symbol') || user?.settings?.defaultSymbol || 'BTC-USD';
    const range = url.searchParams.get('range') || '1Y';
    const interval = url.searchParams.get('interval') || '1D';
    const chart = await getChart(symbol, range, interval, userApiKeys);
    sendJson(res, 200, chart);
    return;
  }

  if (method === 'GET' && pathname === '/api/news') {
    const symbol = url.searchParams.get('symbol') || user?.settings?.defaultSymbol || 'BTC-USD';
    const news = await getNewsWithOptionalTranslation(symbol, userApiKeys);
    sendJson(res, 200, news);
    return;
  }

  if (method === 'GET' && pathname === '/api/filings/sec') {
    const symbol = url.searchParams.get('symbol') || user?.settings?.defaultSymbol || 'BTC-USD';
    const result = await getSecFilings(symbol);
    sendJson(res, 200, result);
    return;
  }

  if (method === 'GET' && pathname === '/api/filings/dart') {
    const input = url.searchParams.get('corpCode') || url.searchParams.get('symbol') || '005930';
    const result = await getDartFilings(input, userApiKeys.dart || config.dartApiKey);
    sendJson(res, 200, result);
    return;
  }

  if (method === 'GET' && pathname === '/api/options') {
    const symbol = url.searchParams.get('symbol') || user?.settings?.defaultSymbol || 'BTC-USD';
    const result = await getOptions(symbol);
    sendJson(res, 200, result);
    return;
  }

  if (method === 'GET' && pathname === '/api/calendar/earnings') {
    const result = await getEarningsCalendar(url.searchParams.get('from'), url.searchParams.get('to'), userApiKeys);
    sendJson(res, 200, result);
    return;
  }

  if (method === 'GET' && pathname === '/api/calendar/economic') {
    const result = await getEconomicCalendar(userApiKeys);
    sendJson(res, 200, result);
    return;
  }

  // --- auto-dom trading bridge (observer/cockpit; no order initiation from the terminal) ---
  if (method === 'GET' && pathname === '/api/autodom/status') {
    sendJson(res, 200, await bridgeStatus());
    return;
  }

  if (method === 'GET' && pathname === '/api/autodom/dashboard') {
    sendJson(res, 200, await bridgeDashboard());
    return;
  }

  if (method === 'GET' && pathname === '/api/signals/recent') {
    const limit = Math.min(Math.max(1, Number(url.searchParams.get('limit')) || 50), 200);
    sendJson(res, 200, await recentSignals(limit));
    return;
  }

  if (method === 'GET' && pathname === '/api/signals/executions') {
    const limit = Math.min(Math.max(1, Number(url.searchParams.get('limit')) || 40), 200);
    sendJson(res, 200, await recentExecutions(limit));
    return;
  }

  if (method === 'GET' && pathname === '/api/autodom/watch-target') {
    sendJson(res, 200, await getWatchTarget());
    return;
  }

  if (method === 'POST' && pathname === '/api/signals/preview') {
    const authUser = await requireUser(req, res);
    if (!authUser) return;
    const body = await readBody(req);
    sendJson(res, 200, await previewSignal(body.signal || body));
    return;
  }

  if (method === 'POST' && pathname === '/api/autodom/watch-target') {
    const authUser = await requireUser(req, res);
    if (!authUser) return;
    const body = await readBody(req);
    sendJson(res, 200, await setWatchTarget(body));
    return;
  }

  if (method === 'POST' && pathname === '/api/autodom/agent/actions') {
    const authUser = await requireUser(req, res);
    if (!authUser) return;
    const body = await readBody(req);
    sendJson(res, 200, await agentAction(body));
    return;
  }

  if (method === 'GET' && pathname === '/api/settings') {
    const authUser = await requireUser(req, res);
    if (!authUser) return;
    sendJson(res, 200, { user: store.safeUser(authUser) });
    return;
  }

  if (method === 'PUT' && pathname === '/api/settings') {
    const authUser = await requireUser(req, res);
    if (!authUser) return;
    const body = await readBody(req);
    const updated = await store.updateSettings(authUser.id, body);
    sendJson(res, 200, { user: updated });
    return;
  }

  if (method === 'PUT' && pathname === '/api/settings/api-key') {
    const authUser = await requireUser(req, res);
    if (!authUser) return;
    const body = await readBody(req);
    const updated = await store.setApiKey(authUser.id, body.provider, body.value);
    sendJson(res, 200, { user: updated });
    return;
  }

  if (method === 'DELETE' && pathname === '/api/settings/api-key') {
    const authUser = await requireUser(req, res);
    if (!authUser) return;
    const provider = url.searchParams.get('provider');
    const updated = await store.deleteApiKey(authUser.id, provider);
    sendJson(res, 200, { user: updated });
    return;
  }

  if (method === 'GET' && pathname === '/api/portfolio') {
    const authUser = await requireUser(req, res);
    if (!authUser) return;
    const portfolio = store.getPortfolio(authUser.id);
    const enriched = await enrichPortfolio(portfolio, userApiKeys);
    sendJson(res, 200, enriched);
    return;
  }

  if (method === 'PUT' && pathname === '/api/portfolio') {
    const authUser = await requireUser(req, res);
    if (!authUser) return;
    const body = await readBody(req);
    const portfolio = await store.updatePortfolio(authUser.id, body);
    const enriched = await enrichPortfolio(portfolio, userApiKeys);
    sendJson(res, 200, enriched);
    return;
  }

  if (['POST', 'PUT'].includes(method) && pathname === '/api/portfolio/holding') {
    const authUser = await requireUser(req, res);
    if (!authUser) return;
    const body = await readBody(req);
    const portfolio = await store.upsertHolding(authUser.id, body);
    const enriched = await enrichPortfolio(portfolio, userApiKeys);
    sendJson(res, 200, enriched);
    return;
  }

  if (method === 'DELETE' && pathname === '/api/portfolio/holding') {
    const authUser = await requireUser(req, res);
    if (!authUser) return;
    const id = url.searchParams.get('id');
    const portfolio = await store.deleteHolding(authUser.id, id);
    const enriched = await enrichPortfolio(portfolio, userApiKeys);
    sendJson(res, 200, enriched);
    return;
  }

  if (method === 'POST' && pathname === '/api/ai/chat') {
    const body = await readBody(req);
    const answer = await answerQuestion({ question: body.question, context: body.context || {}, userApiKeys, provider: body.provider || user?.settings?.aiProvider });
    sendJson(res, 200, answer);
    return;
  }

  if (method === 'POST' && pathname === '/api/trading/order') {
    const authUser = await requireUser(req, res);
    if (!authUser) return;
    const body = await readBody(req);
    const result = await placeOrder({ userId: authUser.id, order: body.order || body, mode: body.mode || authUser.settings?.orderMode || 'paper', userSettings: authUser.settings || {} });
    sendJson(res, result.accepted ? 200 : 400, result);
    return;
  }

  if (method === 'GET' && pathname === '/api/trading/orders') {
    const authUser = await requireUser(req, res);
    if (!authUser) return;
    sendJson(res, 200, { orders: store.listPaperOrders(authUser.id), brokerCapabilities: brokerCapabilities() });
    return;
  }

  sendError(res, 404, 'API 경로를 찾을 수 없습니다.');
}

async function handler(req, res) {
  try {
    applySecurityHeaders(res, { secure: config.cookieSecure });
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    if (url.pathname.startsWith('/api/')) {
      await routeApi(req, res, url);
    } else {
      await serveStatic(req, res, url.pathname);
    }
  } catch (error) {
    const status = error.message?.includes('JSON') || error.message?.includes('본문') ? 400 : 500;
    sendError(res, status, error.message || '서버 오류');
  }
}

await store.init();
const server = http.createServer(handler);

// Track open sockets so graceful shutdown can close idle keep-alive connections —
// server.close() waits for active requests but never ends idle sockets on its own.
const sockets = new Set();
server.on('connection', (socket) => {
  sockets.add(socket);
  socket.on('close', () => sockets.delete(socket));
});

// Tasks other modules register to run during graceful shutdown (e.g. closing SSE streams).
export const shutdownTasks = new Set();
shutdownTasks.add(() => quoteStream.closeAll());

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received — draining connections...`);
  const forced = setTimeout(() => {
    console.error('Drain timed out; forcing exit.');
    process.exit(1);
  }, 10000);
  forced.unref();
  server.close(async () => {
    try {
      for (const task of shutdownTasks) await task();
      await store.flush();
    } catch (error) {
      console.error('Error during shutdown:', error.message);
    }
    clearTimeout(forced);
    console.log('Shutdown complete.');
    process.exit(0);
  });
  // End idle keep-alive sockets so server.close() can complete; in-flight requests finish.
  for (const socket of sockets) {
    if (!socket._httpMessage) socket.end();
  }
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

server.listen(config.port, () => {
  console.log(`K Terminal Finance listening on http://localhost:${config.port}`);
});

export { server };
