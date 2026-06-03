# K Terminal Finance — Top-Tier Product Initiative

## Mission
Elevate K Terminal Finance (a dependency-free Node.js + vanilla-JS Korean financial
terminal) to a best-in-class product. Priority is **balanced**: fix correctness/security
bugs first, then real-time/UX, then expand features, then lock it down with tests + CI.
Environment variables / API keys will be configured later by the user — therefore every
change must work on the public/free fallback data path (no paid keys required) and must
honor the existing "no fake numbers" data policy (실시간 / 근실시간 / 지연 데이터 /
API 필요 / 데이터 없음 / 오류).

## Hard constraints
- ZERO runtime dependencies. Vanilla `node:http` + vanilla JS + SVG only. No build step.
- Node >= 20.10, ES modules.
- Never display fabricated numbers. Missing/unavailable data must use the status labels.
- `npm run check`, `npm test`, `npm run smoke` must stay green after every story.
- Paper-trading safety must remain intact; live trading stays blocked by default.

## Known bugs found during code review (fix these)
1. `.env` is never loaded — `npm start` = `node src/server.js` with no `--env-file`, and
   nothing parses `.env`. All `.env` settings are silently ignored except under docker-compose.
2. Portfolio sums multi-currency holdings RAW — `totalMarketValue += marketValue` adds KRW
   and USD values directly with no FX conversion (portfolio.js). Totals/weights are wrong.
3. Options CALL/PUT type is guessed via `contractSymbol.includes('C')` — misclassifies
   (most tickers contain C/P). Use the calls/puts arrays directly (marketData.getOptions).
4. Yahoo chart/quote/options fetches send no User-Agent → elevated 401/429 risk; the public
   endpoint is the product's backbone fallback.
5. No graceful shutdown — SIGTERM can interrupt in-flight JSON writes (store.persist).

## Research-backed implementation notes
- **SSE** (live quotes): one multiplexed `text/event-stream` connection; headers
  `Cache-Control: no-cache, no-transform` + `X-Accel-Buffering: no`; 15s heartbeat comment;
  cleanup on `req.close`; never `res.end()` until shutdown; client uses EventSource
  (auto-reconnect + Last-Event-ID). SSE > WebSocket for one-way quote feed.
- **Security headers** (no helmet): strict `script-src 'self'`, relax only
  `style-src 'unsafe-inline'` (SVG inline styles + style attrs), `img-src 'self' data:`,
  `connect-src 'self'`, `frame-ancestors 'none'`; HSTS only when serving HTTPS.
- **Rate limiting**: token-bucket, lazy refill, `.unref()` sweep; auth keyed on IP+email;
  trust `X-Forwarded-For` only behind a known proxy (config flag).
- **Cache**: TTL + stale-while-revalidate + single-flight `inflight` map; quotes 1-2s,
  charts 30-60s; always clear inflight in `finally` and `.catch()` background refresh.
- **CSRF**: keep SameSite=Lax + no GET mutations + exact Origin/Referer check on
  POST/PUT/PATCH/DELETE; block when both headers absent.
- **Crypto data (free, no key)**: Binance `data-api.binance.vision` (klines/ticker) primary,
  CoinGecko Demo + Coinbase `/v2/prices/BTC-KRW/spot` (KRW) + Crypto.com fallback.
- **FX (free, no key)**: Yahoo `KRW=X` (v8 chart, no crumb) live-ish 지연, fallback
  open.er-api.com / frankfurter.dev (EOD). Treat all FX as 지연.
- **Earnings calendar**: Finnhub `/calendar/earnings` (free tier, needs key → API 필요 when
  absent). **Economic calendar**: FRED release dates (US, free key); be honest that free
  global econ-calendar coverage is poor → 데이터 없음 / API 필요.
- **Yahoo**: `/v8/finance/chart` needs NO crumb (only a browser UA); v7/v10/options DO need
  crumb+cookie. Cache cookie/crumb ~24h, throttle <10 req/min/IP, query1→query2 fallback.

## Top-tier UX targets (table stakes first)
- Bloomberg-style command box w/ autocomplete + history; global keyboard shortcuts + help.
- Flash-on-update live cells, directional color + arrow, connection/live badge, sparklines.
- Multi-symbol comparison overlay + crosshair readout on the SVG chart.
- Accessibility: never color-alone (arrows + signs), ARIA on grids, focus states,
  prefers-reduced-motion, >=4.5:1 contrast.

## Definition of done (final gate, mandatory)
ai-slop-cleaner clean + full verification (check/test/smoke green) + /code-review APPROVE,
all evidence captured before the aggregate /goal is cleared.
