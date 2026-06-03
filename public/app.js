const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const state = {
  meta: null,
  user: null,
  activeTab: 'market',
  activeSymbol: localStorage.getItem('kt.activeSymbol') || 'AAPL',
  range: localStorage.getItem('kt.range') || '1Y',
  interval: localStorage.getItem('kt.interval') || '1D',
  snapshot: null,
  chart: null,
  news: null,
  sec: null,
  dart: null,
  options: null,
  portfolio: null,
  watchlistQuotes: null,
  chat: [],
  dragging: null,
  layout: loadLayout(),
  resizeObserver: null,
  priceMap: new Map(),
  stream: null,
  streamState: 'OFF'
};

const DEFAULT_VIEWS = {
  market: {
    left: ['market-pulse', 'watchlist', 'data-sources', 'alerts'],
    center: ['chart', 'rates-commodities', 'news'],
    right: ['ai-assistant', 'sec-filings', 'order-ticket']
  },
  monitor: {
    left: ['watchlist', 'market-pulse'],
    center: ['monitor-grid', 'chart'],
    right: ['news', 'calendar', 'data-sources']
  },
  chart: {
    left: ['watchlist', 'data-sources'],
    center: ['chart'],
    right: ['ai-assistant', 'options-chain']
  },
  news: {
    left: ['watchlist', 'market-pulse'],
    center: ['news', 'sec-filings', 'dart-filings'],
    right: ['ai-assistant', 'calendar', 'data-sources']
  },
  portfolio: {
    left: ['portfolio-summary', 'portfolio-risk'],
    center: ['portfolio-table', 'portfolio-graph'],
    right: ['order-ticket', 'ai-assistant', 'settings']
  },
  options: {
    left: ['watchlist', 'data-sources'],
    center: ['options-chain', 'chart'],
    right: ['order-ticket', 'ai-assistant']
  },
  crypto: {
    left: ['watchlist', 'data-sources'],
    center: ['crypto-monitor', 'chart'],
    right: ['ai-assistant', 'alerts']
  },
  order: {
    left: ['watchlist', 'portfolio-summary'],
    center: ['order-ticket', 'order-history'],
    right: ['alerts', 'data-sources', 'settings']
  },
  ai: {
    left: ['market-pulse', 'watchlist'],
    center: ['ai-assistant'],
    right: ['news', 'sec-filings', 'portfolio-summary']
  }
};

const WIDGETS = {
  'market-pulse': { title: 'MARKET PULSE', subtitle: '리스크/유동성', render: renderMarketPulse },
  watchlist: { title: 'WATCHLIST', subtitle: '관심종목', render: renderWatchlist },
  'data-sources': { title: 'DATA SOURCES', subtitle: '실제/지연/API', render: renderDataSources },
  chart: { title: 'CHART', subtitle: '캔들/기술지표', render: renderChartWidget, big: true },
  news: { title: 'NEWS & TRANSLATION', subtitle: '원문/번역/감성', render: renderNews, big: true },
  'sec-filings': { title: 'SEC FILINGS', subtitle: 'EDGAR', render: renderSecFilings },
  'dart-filings': { title: 'DART FILINGS', subtitle: 'OpenDART', render: renderDartFilings },
  'portfolio-summary': { title: 'PORTFOLIO', subtitle: '요약', render: renderPortfolioSummary },
  'portfolio-table': { title: 'HOLDINGS', subtitle: '수동 입력/평가', render: renderPortfolioTable, big: true },
  'portfolio-graph': { title: 'PORTFOLIO GRAPH', subtitle: '비중 크게 보기', render: renderPortfolioGraph, big: true },
  'portfolio-risk': { title: 'PORTFOLIO RISK', subtitle: '섹터/국가/통화', render: renderPortfolioRisk },
  'options-chain': { title: 'OPTIONS', subtitle: '옵션 체인', render: renderOptionsChain, big: true },
  'order-ticket': { title: 'ORDER & EXECUTION', subtitle: 'Paper 기본', render: renderOrderTicket },
  'order-history': { title: 'ORDER HISTORY', subtitle: '모의 주문', render: renderOrderHistory },
  alerts: { title: 'ALERTS', subtitle: '가격/지표 알림', render: renderAlerts },
  'ai-assistant': { title: 'AI ASSISTANT', subtitle: 'Gemini/로컬', render: renderAiAssistant, big: true },
  settings: { title: 'SETTINGS', subtitle: '사용자/API/레이아웃', render: renderSettings },
  'rates-commodities': { title: 'RATES / FX / COMMODITIES', subtitle: '금리/환율/원자재', render: renderRatesCommodities },
  'monitor-grid': { title: 'MARKET MONITOR', subtitle: '주식/ETF/한국', render: renderMonitorGrid },
  'crypto-monitor': { title: 'CRYPTO MONITOR', subtitle: 'BTC/ETH/SOL', render: renderCryptoMonitor },
  calendar: { title: 'CALENDAR', subtitle: '실적/경제', render: renderCalendar }
};

function loadLayout() {
  try {
    return JSON.parse(localStorage.getItem('kt.layout') || '{}');
  } catch {
    return {};
  }
}

function saveLayout() {
  localStorage.setItem('kt.layout', JSON.stringify(state.layout));
  if (state.user) {
    api('/api/settings', { method: 'PUT', body: { layout: state.layout } }).catch(() => {});
  }
}

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  const init = { credentials: 'same-origin', ...options, headers };
  if (options.body && typeof options.body !== 'string') {
    init.body = JSON.stringify(options.body);
    init.headers['content-type'] = 'application/json';
  }
  const response = await fetch(path, init);
  const text = await response.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!response.ok) throw new Error(data.error || data.statusMessage || `HTTP ${response.status}`);
  return data;
}

function fmt(value, digits = 2) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '데이터 없음';
  const number = Number(value);
  if (Math.abs(number) >= 1_000_000_000) return `${(number / 1_000_000_000).toFixed(digits)}B`;
  if (Math.abs(number) >= 1_000_000) return `${(number / 1_000_000).toFixed(digits)}M`;
  if (Math.abs(number) >= 1000) return number.toLocaleString(undefined, { maximumFractionDigits: digits });
  return number.toLocaleString(undefined, { maximumFractionDigits: digits });
}

function pct(value, digits = 2) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '데이터 없음';
  return `${Number(value).toFixed(digits)}%`;
}

function signed(value, suffix = '') {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '데이터 없음';
  const num = Number(value);
  return `${num > 0 ? '+' : ''}${fmt(num)}${suffix}`;
}

function clsChange(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num === 0) return 'flat';
  return num > 0 ? 'up' : 'down';
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
}

function statusBadge(status, message = '') {
  const text = escapeHtml(status || '데이터 없음');
  const statusClass = status === '실시간' || status === '근실시간' || status === '정상' ? 'ok' : status === '지연 데이터' || status === 'API 필요' || status === '일부 가격 데이터 없음' ? 'warn' : 'err';
  return `<span class="badge ${statusClass}" title="${escapeHtml(message)}">${text}</span>`;
}

function setStatus(text) {
  $('#connection-state').textContent = text;
}

function getViewLayout(tab = state.activeTab) {
  const saved = state.layout.tabs?.[tab];
  const base = DEFAULT_VIEWS[tab] || DEFAULT_VIEWS.market;
  return {
    left: saved?.left || base.left,
    center: saved?.center || base.center,
    right: saved?.right || base.right
  };
}

function setViewLayout(tab, next) {
  state.layout.tabs ||= {};
  state.layout.tabs[tab] = next;
  saveLayout();
}

function renderWorkspace() {
  const layout = getViewLayout();
  for (const panelName of ['left', 'center', 'right']) {
    const panel = $(`[data-panel="${panelName}"]`);
    panel.innerHTML = '';
    panel.dataset.panel = panelName;
    panel.addEventListener('dragover', onPanelDragOver);
    panel.addEventListener('drop', onPanelDrop);
    for (const widgetId of layout[panelName]) panel.appendChild(createWidget(widgetId, panelName));
  }
  restorePanelWidths();
}

function createWidget(widgetId, panelName) {
  const spec = WIDGETS[widgetId];
  const template = $('#widget-template').content.firstElementChild.cloneNode(true);
  template.dataset.widgetId = widgetId;
  template.dataset.panel = panelName;
  template.querySelector('.widget-title').textContent = spec?.title || widgetId;
  template.querySelector('.widget-subtitle').textContent = spec?.subtitle || '';
  const actions = template.querySelector('.widget-actions');
  const refresh = document.createElement('button');
  refresh.textContent = 'REF';
  refresh.title = '새로고침';
  refresh.addEventListener('click', (event) => { event.stopPropagation(); refreshWidget(widgetId); });
  actions.appendChild(refresh);
  if (spec?.big) {
    const big = document.createElement('button');
    big.textContent = 'BIG';
    big.title = '크게 보기';
    big.addEventListener('click', (event) => { event.stopPropagation(); openBigWidget(widgetId); });
    actions.appendChild(big);
  }
  const savedSize = state.layout.sizes?.[widgetId];
  if (savedSize?.height) template.style.height = `${savedSize.height}px`;
  template.addEventListener('dragstart', onWidgetDragStart);
  template.addEventListener('dragend', onWidgetDragEnd);
  template.addEventListener('dragover', onWidgetDragOver);
  template.addEventListener('drop', onWidgetDrop);
  const body = template.querySelector('.widget-body');
  try {
    spec?.render(body, widgetId);
  } catch (error) {
    body.innerHTML = `<div class="badge err">렌더 오류</div><pre>${escapeHtml(error.message)}</pre>`;
  }
  observeWidgetResize(template, widgetId);
  return template;
}

function observeWidgetResize(element, widgetId) {
  if (!state.resizeObserver) {
    state.resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const id = entry.target.dataset.widgetId;
        if (!id) continue;
        const rect = entry.contentRect;
        state.layout.sizes ||= {};
        state.layout.sizes[id] = { height: Math.round(rect.height) };
      }
      clearTimeout(state.resizeSaveTimer);
      state.resizeSaveTimer = setTimeout(saveLayout, 350);
    });
  }
  state.resizeObserver.observe(element);
}

function onWidgetDragStart(event) {
  const article = event.currentTarget;
  state.dragging = { widgetId: article.dataset.widgetId, panel: article.dataset.panel };
  article.classList.add('dragging');
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', article.dataset.widgetId);
}

function onWidgetDragEnd(event) {
  event.currentTarget.classList.remove('dragging');
  $$('.drop-target').forEach((el) => el.classList.remove('drop-target'));
  state.dragging = null;
}

function onWidgetDragOver(event) {
  event.preventDefault();
  event.currentTarget.classList.add('drop-target');
}

function onWidgetDrop(event) {
  event.preventDefault();
  event.stopPropagation();
  const target = event.currentTarget;
  target.classList.remove('drop-target');
  moveWidget(state.dragging?.widgetId, target.dataset.panel, target.dataset.widgetId);
}

function onPanelDragOver(event) {
  event.preventDefault();
}

function onPanelDrop(event) {
  event.preventDefault();
  moveWidget(state.dragging?.widgetId, event.currentTarget.dataset.panel, null);
}

function moveWidget(widgetId, targetPanel, beforeWidgetId = null) {
  if (!widgetId || !targetPanel) return;
  const layout = getViewLayout();
  for (const panel of ['left', 'center', 'right']) layout[panel] = layout[panel].filter((id) => id !== widgetId);
  const target = layout[targetPanel];
  const idx = beforeWidgetId ? target.indexOf(beforeWidgetId) : -1;
  if (idx >= 0) target.splice(idx, 0, widgetId);
  else target.push(widgetId);
  setViewLayout(state.activeTab, layout);
  renderWorkspace();
}

async function refreshWidget(widgetId) {
  if (widgetId === 'chart') await loadChart();
  if (widgetId === 'news') await loadNews();
  if (widgetId === 'sec-filings') await loadSec();
  if (widgetId === 'dart-filings') await loadDart();
  if (widgetId === 'options-chain') await loadOptions();
  if (widgetId.startsWith('portfolio')) await loadPortfolio();
  if (['market-pulse', 'watchlist', 'rates-commodities', 'monitor-grid'].includes(widgetId)) await loadSnapshot();
  renderWorkspace();
}

function openBigWidget(widgetId) {
  const spec = WIDGETS[widgetId];
  $('#big-modal-title').textContent = spec?.title || '크게 보기';
  const content = $('#big-modal-content');
  content.innerHTML = '<div class="widget-body"></div>';
  const body = content.querySelector('.widget-body');
  spec?.render(body, widgetId, { big: true });
  $('#big-modal').showModal();
}

async function loadMeta() {
  state.meta = await api('/api/meta');
  state.user = state.meta.user;
  if (state.user?.settings?.defaultSymbol) state.activeSymbol = state.user.settings.defaultSymbol;
  if (state.user?.settings?.layout && !localStorage.getItem('kt.layout')) {
    state.layout = state.user.settings.layout;
  }
  $('#login-open').textContent = state.user ? state.user.email.split('@')[0].toUpperCase() : 'LOGIN';
}

async function loadSnapshot() {
  try {
    const symbols = state.meta?.marketUniverse?.map((item) => item.symbol).join(',') || '^GSPC,^IXIC,^DJI,^VIX,^TNX,GC=F,CL=F,KRW=X,SPY,QQQ,005930.KS';
    state.snapshot = await api(`/api/market/snapshot?symbols=${encodeURIComponent(symbols)}`);
    renderIndexStrip();
    setStatus('시장 데이터 갱신 완료');
  } catch (error) {
    setStatus(`시장 데이터 오류: ${error.message}`);
  }
}

async function loadChart() {
  localStorage.setItem('kt.activeSymbol', state.activeSymbol);
  localStorage.setItem('kt.range', state.range);
  localStorage.setItem('kt.interval', state.interval);
  state.chart = await api(`/api/market/chart?symbol=${encodeURIComponent(state.activeSymbol)}&range=${encodeURIComponent(state.range)}&interval=${encodeURIComponent(state.interval)}`);
  $('#active-symbol-status').textContent = `${state.activeSymbol} ${state.range}/${state.interval} ${state.chart.status}`;
  evaluateAlerts(state.watchlistQuotes?.quotes || state.snapshot?.quotes || []); // RSI alerts use fresh chart
}

async function loadNews() {
  state.news = await api(`/api/news?symbol=${encodeURIComponent(state.activeSymbol)}`);
}

async function loadSec() {
  state.sec = await api(`/api/filings/sec?symbol=${encodeURIComponent(state.activeSymbol)}`);
}

async function loadDart(input = '005930') {
  state.dart = await api(`/api/filings/dart?symbol=${encodeURIComponent(input)}`);
}

async function loadOptions() {
  state.options = await api(`/api/options?symbol=${encodeURIComponent(state.activeSymbol)}`);
}

async function loadPortfolio() {
  if (!state.user) return;
  state.portfolio = await api('/api/portfolio');
}

async function loadWatchlistQuotes() {
  const list = currentWatchlist();
  if (!list.length) return;
  state.watchlistQuotes = await api(`/api/market/snapshot?symbols=${encodeURIComponent(list.join(','))}`);
}

function currentWatchlist() {
  const fallback = ['AAPL', 'MSFT', 'NVDA', 'SPY', 'QQQ', '005930.KS'];
  const fromUser = state.user?.watchlist;
  const fromLocal = JSON.parse(localStorage.getItem('kt.watchlist') || 'null');
  return (fromUser?.length ? fromUser : fromLocal?.length ? fromLocal : fallback).slice(0, 60);
}

async function saveWatchlist(list) {
  const clean = [...new Set(list.map((s) => String(s).trim().toUpperCase()).filter(Boolean))].slice(0, 60);
  localStorage.setItem('kt.watchlist', JSON.stringify(clean));
  if (state.user) {
    const result = await api('/api/settings', { method: 'PUT', body: { watchlist: clean } });
    state.user = result.user;
  }
  await loadWatchlistQuotes();
  renderWorkspace();
  startStream(); // resubscribe the live stream to the updated symbol set
}

function renderIndexStrip() {
  const container = $('#index-strip');
  const quotes = state.snapshot?.quotes || [];
  const reduced = prefersReducedMotion();
  container.innerHTML = quotes.map((q) => {
    const prev = state.priceMap.get(q.symbol);
    const flash = !reduced && prev != null && q.price != null && q.price !== prev ? (q.price > prev ? 'flash-up' : 'flash-down') : '';
    return `
    <div class="index-card ${flash}" title="${escapeHtml(q.statusMessage || '')}">
      <div class="label"><span>${escapeHtml(labelFor(q.symbol))}</span><span>${escapeHtml(q.status || '')}</span></div>
      <div class="value">${fmt(q.price)}</div>
      <div class="change ${clsChange(q.changePercent)}">${signed(q.change)} / ${signed(q.changePercent, '%')}</div>
    </div>`;
  }).join('') || '<div class="index-card"><div class="label">데이터 없음</div></div>';
}

function prefersReducedMotion() {
  return Boolean(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
}

function cssAttrValue(value) {
  return String(value).replace(/["\\]/g, '\\$&');
}

function flashCell(el, dir) {
  if (!dir || prefersReducedMotion()) return;
  el.classList.remove('flash-up', 'flash-down');
  void el.offsetWidth; // restart the animation
  el.classList.add(dir === 'up' ? 'flash-up' : 'flash-down');
}

// In-place live update of any table cell tagged with data-live-price / data-live-chg,
// with a directional flash. Updates priceMap last so renderIndexStrip (called first)
// still sees the previous price for its own flash.
function applyLiveQuotes(quotes) {
  for (const q of quotes || []) {
    const prev = state.priceMap.get(q.symbol);
    const dir = prev != null && q.price != null && q.price !== prev ? (q.price > prev ? 'up' : 'down') : '';
    if (q.price != null) state.priceMap.set(q.symbol, q.price);
    const sel = cssAttrValue(q.symbol);
    $$(`[data-live-price="${sel}"]`).forEach((el) => { el.textContent = fmt(q.price); flashCell(el, dir); });
    $$(`[data-live-chg="${sel}"]`).forEach((el) => {
      el.textContent = pct(q.changePercent);
      el.classList.remove('up', 'down', 'flat');
      el.classList.add(clsChange(q.changePercent));
      flashCell(el, dir);
    });
  }
}

function setStreamState(status) {
  state.streamState = status;
  const el = $('#stream-state');
  if (!el) return;
  const map = { LIVE: ['live', 'LIVE'], RECONNECT: ['reconnect', 'RECONNECT'], OFF: ['', 'OFF'] };
  const [cls, text] = map[status] || map.OFF;
  el.className = `stream-badge ${cls}`.trim();
  el.textContent = text;
}

function mergeStreamSnapshot(snap) {
  const quotes = snap.quotes || [];
  const map = new Map(quotes.map((q) => [q.symbol, q]));
  const universe = state.meta?.marketUniverse?.map((item) => item.symbol) || [];
  state.snapshot = {
    updatedAt: snap.updatedAt,
    provider: snap.provider,
    quotes: universe.map((symbol) => map.get(symbol)).filter(Boolean)
  };
  const watchlist = new Set(currentWatchlist());
  state.watchlistQuotes = { updatedAt: snap.updatedAt, quotes: quotes.filter((q) => watchlist.has(q.symbol)) };
}

function startStream() {
  if (typeof EventSource === 'undefined') return;
  stopStream();
  const cryptoSymbols = state.meta?.cryptoUniverse?.map((item) => item.symbol) || [];
  const symbols = [...new Set([...currentWatchlist(), ...cryptoSymbols])].join(',');
  const es = new EventSource(`/api/stream?symbols=${encodeURIComponent(symbols)}`);
  state.stream = es;
  es.addEventListener('open', () => setStreamState('LIVE'));
  es.addEventListener('snapshot', (event) => {
    let snap;
    try { snap = JSON.parse(event.data); } catch { return; }
    mergeStreamSnapshot(snap);
    renderIndexStrip();              // flashes the strip against the previous priceMap
    applyLiveQuotes(snap.quotes);    // flashes table cells and advances priceMap
    evaluateAlerts(snap.quotes);     // check price/%-change alerts against the live tick
    setStreamState('LIVE');
  });
  es.onerror = () => setStreamState('RECONNECT'); // EventSource reconnects automatically
}

function stopStream() {
  if (state.stream) { state.stream.close(); state.stream = null; }
}

function labelFor(symbol) {
  return state.meta?.marketUniverse?.find((item) => item.symbol === symbol)?.label || symbol;
}

function renderMarketPulse(body) {
  const quotes = state.snapshot?.quotes || [];
  const valid = quotes.filter((q) => Number.isFinite(Number(q.changePercent)));
  const advancers = valid.filter((q) => q.changePercent > 0).length;
  const decliners = valid.filter((q) => q.changePercent < 0).length;
  const avg = valid.length ? valid.reduce((sum, q) => sum + q.changePercent, 0) / valid.length : null;
  const noData = quotes.filter((q) => !Number.isFinite(Number(q.price))).length;
  const risk = avg === null ? '데이터 없음' : avg > 0.25 ? 'RISK-ON' : avg < -0.25 ? 'RISK-OFF' : 'NEUTRAL';
  body.innerHTML = `
    <div class="grid2">
      <div class="metric"><div class="k">Market Regime</div><div class="v ${avg > 0 ? 'up' : avg < 0 ? 'down' : 'flat'}">${risk}</div></div>
      <div class="metric"><div class="k">Average Move</div><div class="v ${clsChange(avg)}">${pct(avg)}</div></div>
      <div class="metric"><div class="k">Adv / Dec</div><div class="v">${advancers} / ${decliners}</div></div>
      <div class="metric"><div class="k">No Data</div><div class="v ${noData ? 'down' : 'up'}">${noData}</div></div>
    </div>
    <div class="stack" style="margin-top:8px">
      ${quotes.slice(0, 8).map((q) => `
        <div>
          <div class="row" style="justify-content:space-between"><span>${escapeHtml(labelFor(q.symbol))}</span><span class="${clsChange(q.changePercent)}">${pct(q.changePercent)}</span></div>
          <div class="progress-bar ${q.changePercent < 0 ? 'err' : q.changePercent > 0 ? '' : 'warn'}"><div style="width:${Math.min(100, Math.max(2, Math.abs(q.changePercent || 0) * 12))}%"></div></div>
        </div>
      `).join('')}
    </div>
  `;
}

function renderWatchlist(body) {
  const list = currentWatchlist();
  body.innerHTML = `
    <form class="row gap" id="watchlist-form">
      <input name="symbol" placeholder="AAPL / 005930.KS" />
      <button>ADD</button>
    </form>
    <div class="scroll" style="margin-top:6px" id="watchlist-table">불러오는 중</div>
  `;
  $('#watchlist-form', body).addEventListener('submit', async (event) => {
    event.preventDefault();
    const symbol = new FormData(event.currentTarget).get('symbol');
    if (!symbol) return;
    await saveWatchlist([...list, String(symbol).toUpperCase()]);
  });
  const tableHost = $('#watchlist-table', body);
  const quotes = state.watchlistQuotes?.quotes || [];
  if (!quotes.length) {
    tableHost.innerHTML = `<div class="muted">관심종목: ${list.join(', ')}. ${statusBadge('데이터 없음', '아직 로드되지 않았습니다.')}</div>`;
    loadWatchlistQuotes().then(renderWorkspace).catch(() => {});
    return;
  }
  tableHost.innerHTML = `
    <table class="table">
      <thead><tr><th>Symbol</th><th>Px</th><th>Chg%</th><th>Status</th><th></th></tr></thead>
      <tbody>
      ${quotes.map((q) => `<tr>
        <td class="left"><button class="symbol-link" data-symbol="${escapeHtml(q.symbol)}">${escapeHtml(q.symbol)}</button></td>
        <td data-live-price="${escapeHtml(q.symbol)}">${fmt(q.price)}</td><td class="${clsChange(q.changePercent)}" data-live-chg="${escapeHtml(q.symbol)}">${pct(q.changePercent)}</td><td>${statusBadge(q.status, q.statusMessage)}</td>
        <td><button class="remove-watch" data-symbol="${escapeHtml(q.symbol)}">DEL</button></td>
      </tr>`).join('')}
      </tbody>
    </table>`;
  $$('.symbol-link', body).forEach((button) => button.addEventListener('click', async () => selectSymbol(button.dataset.symbol)));
  $$('.remove-watch', body).forEach((button) => button.addEventListener('click', async () => saveWatchlist(list.filter((s) => s !== button.dataset.symbol))));
}

function renderDataSources(body) {
  const providers = state.meta?.providers || {};
  body.innerHTML = `
    <div class="stack">
      <div class="metric"><div class="k">Market Provider</div><div class="v">${escapeHtml(providers.marketDataProvider || 'auto')}</div></div>
      <table class="table">
        <tbody>
          ${providerRow('Finnhub', providers.finnhub, '미국 주식/뉴스/실적. API 키 필요')}
          ${providerRow('Twelve Data', providers.twelveData, '주식/ETF/FX/원자재. API 키 필요')}
          ${providerRow('Polygon', providers.polygon, '실시간/옵션 권장. API 키 필요')}
          ${providerRow('SEC EDGAR', providers.sec, '공개 API. User-Agent 필요')}
          ${providerRow('OpenDART', providers.dart, '한국 공시. API 키 필요')}
          ${providerRow('FRED', providers.fred, '미국 경제지표 릴리즈 일정. 무료 키')}
          ${providerRow('Gemini', providers.gemini, '번역/AI 분석. 선택 연결')}
          ${providerRow('Alpaca Paper', providers.alpacaPaper, 'Paper 주문 API')}
        </tbody>
      </table>
      <div class="muted">공개 fallback은 실제 응답만 표시하며 값이 없으면 숫자를 채우지 않습니다.</div>
    </div>
  `;
}

function providerRow(name, configured, description) {
  return `<tr><td class="left">${escapeHtml(name)}</td><td>${statusBadge(configured ? '정상' : 'API 필요', description)}</td></tr>`;
}

function renderRatesCommodities(body) {
  const wanted = ['^TNX', 'KRW=X', 'GC=F', 'CL=F', '^VIX'];
  const quotes = (state.snapshot?.quotes || []).filter((q) => wanted.includes(q.symbol));
  body.innerHTML = `<table class="table"><thead><tr><th>Asset</th><th>Value</th><th>Chg%</th><th>Status</th></tr></thead><tbody>
    ${quotes.map((q) => `<tr><td class="left">${escapeHtml(labelFor(q.symbol))}</td><td>${fmt(q.price)}</td><td class="${clsChange(q.changePercent)}">${pct(q.changePercent)}</td><td>${statusBadge(q.status, q.statusMessage)}</td></tr>`).join('') || '<tr><td>데이터 없음</td><td></td><td></td><td></td></tr>'}
  </tbody></table>`;
}

function renderMonitorGrid(body) {
  const symbols = ['AAPL', 'MSFT', 'NVDA', 'TSLA', 'AMZN', 'GOOGL', 'META', 'SPY', 'QQQ', 'VTI', '005930.KS', '000660.KS'];
  body.innerHTML = `<div id="monitor-grid-body">로딩 중</div>`;
  api(`/api/market/snapshot?symbols=${encodeURIComponent(symbols.join(','))}`).then((snapshot) => {
    $('#monitor-grid-body', body).innerHTML = `
      <table class="table"><thead><tr><th>Symbol</th><th>Px</th><th>Chg</th><th>Vol</th><th>Status</th></tr></thead><tbody>
      ${snapshot.quotes.map((q) => `<tr><td class="left"><button class="symbol-link" data-symbol="${escapeHtml(q.symbol)}">${escapeHtml(q.symbol)}</button></td><td data-live-price="${escapeHtml(q.symbol)}">${fmt(q.price)}</td><td class="${clsChange(q.changePercent)}" data-live-chg="${escapeHtml(q.symbol)}">${pct(q.changePercent)}</td><td>${fmt(q.volume, 0)}</td><td>${statusBadge(q.status, q.statusMessage)}</td></tr>`).join('')}
      </tbody></table>`;
    $$('.symbol-link', body).forEach((button) => button.addEventListener('click', () => selectSymbol(button.dataset.symbol)));
  }).catch((error) => { $('#monitor-grid-body', body).textContent = `데이터 없음: ${error.message}`; });
}

function renderCryptoMonitor(body) {
  const universe = state.meta?.cryptoUniverse || [];
  const symbols = universe.map((item) => item.symbol);
  body.innerHTML = '<div id="crypto-monitor-body">로딩 중</div>';
  if (!symbols.length) { $('#crypto-monitor-body', body).textContent = '암호화폐 유니버스 정보 없음'; return; }
  api(`/api/market/snapshot?symbols=${encodeURIComponent(symbols.join(','))}`).then((snapshot) => {
    $('#crypto-monitor-body', body).innerHTML = `
      <table class="table"><thead><tr><th>Symbol</th><th>Px</th><th>Chg%</th><th>Ccy</th><th>Status</th></tr></thead><tbody>
      ${snapshot.quotes.map((q) => `<tr><td class="left"><button class="symbol-link" data-symbol="${escapeHtml(q.symbol)}">${escapeHtml(q.symbol)}</button></td><td data-live-price="${escapeHtml(q.symbol)}">${fmt(q.price)}</td><td class="${clsChange(q.changePercent)}" data-live-chg="${escapeHtml(q.symbol)}">${pct(q.changePercent)}</td><td>${escapeHtml(q.currency || '')}</td><td>${statusBadge(q.status, q.statusMessage)}</td></tr>`).join('')}
      </tbody></table>`;
    $$('.symbol-link', body).forEach((button) => button.addEventListener('click', () => selectSymbol(button.dataset.symbol)));
  }).catch((error) => { $('#crypto-monitor-body', body).textContent = `데이터 없음: ${error.message}`; });
}

function renderCalendar(body) {
  body.innerHTML = '<div id="cal-earn">실적 캘린더 로딩 중</div><div id="cal-econ" style="margin-top:10px">경제 캘린더 로딩 중</div>';
  const watch = new Set(currentWatchlist());
  api('/api/calendar/earnings').then((data) => {
    const rows = (data.events || []).slice(0, 60);
    $('#cal-earn', body).innerHTML = `
      <div class="row gap" style="justify-content:space-between"><strong>EARNINGS</strong>${statusBadge(data.status, data.statusMessage)}</div>
      <div class="scroll" style="max-height:240px; margin-top:4px"><table class="table"><thead><tr><th>Date</th><th>Symbol</th><th>When</th><th>EPS Est</th><th>EPS Act</th></tr></thead><tbody>
      ${rows.map((event) => `<tr class="${watch.has(event.symbol) ? 'cal-watch' : ''}"><td class="left">${escapeHtml(event.date || '')}</td><td class="left"><button class="symbol-link" data-symbol="${escapeHtml(event.symbol)}">${escapeHtml(event.symbol)}</button></td><td>${escapeHtml(event.hour || '')}</td><td>${fmt(event.epsEstimate)}</td><td>${fmt(event.epsActual)}</td></tr>`).join('') || '<tr><td>데이터 없음</td><td colspan="4"></td></tr>'}
      </tbody></table></div>`;
    $$('.symbol-link', $('#cal-earn', body)).forEach((button) => button.addEventListener('click', () => selectSymbol(button.dataset.symbol)));
  }).catch((error) => { $('#cal-earn', body).textContent = `실적 캘린더 오류: ${error.message}`; });
  api('/api/calendar/economic').then((data) => {
    const rows = (data.events || []).slice(0, 40);
    $('#cal-econ', body).innerHTML = `
      <div class="row gap" style="justify-content:space-between"><strong>ECONOMIC (US)</strong>${statusBadge(data.status, data.statusMessage)}</div>
      <div class="scroll" style="max-height:200px; margin-top:4px"><table class="table"><thead><tr><th>Date</th><th>Release</th></tr></thead><tbody>
      ${rows.map((event) => `<tr><td class="left">${escapeHtml(event.date || '')}</td><td class="left">${escapeHtml(event.name || '')}</td></tr>`).join('') || `<tr><td>${escapeHtml(data.status)}</td><td>${escapeHtml(data.statusMessage || '')}</td></tr>`}
      </tbody></table></div>`;
  }).catch((error) => { $('#cal-econ', body).textContent = `경제 캘린더 오류: ${error.message}`; });
}

function renderChartWidget(body, widgetId, options = {}) {
  body.innerHTML = `
    <div class="chart-wrap ${options.big ? 'big-chart' : ''}">
      <div class="chart-controls">
        <input id="chart-symbol" value="${escapeHtml(state.activeSymbol)}" />
        <select id="chart-range">${['1M', '3M', '6M', '1Y', '2Y', '5Y', '10Y'].map((r) => `<option ${state.range === r ? 'selected' : ''}>${r}</option>`).join('')}</select>
        <select id="chart-interval">${['1D', '1W', '1M'].map((r) => `<option ${state.interval === r ? 'selected' : ''}>${r}</option>`).join('')}</select>
        <button id="chart-load">LOAD</button>
        <span>${state.chart ? statusBadge(state.chart.status, state.chart.statusMessage) : statusBadge('데이터 없음')}</span>
        <span class="muted">${escapeHtml(state.chart?.source || '데이터 로드 전')}</span>
      </div>
      <svg class="chart-svg" id="price-chart"></svg>
      <svg class="indicator-svg" id="rsi-chart"></svg>
      <svg class="indicator-svg" id="macd-chart"></svg>
    </div>
  `;
  const load = async () => {
    state.activeSymbol = $('#chart-symbol', body).value.trim().toUpperCase() || 'AAPL';
    state.range = $('#chart-range', body).value;
    state.interval = $('#chart-interval', body).value;
    await loadChart();
    renderWorkspace();
  };
  $('#chart-load', body).addEventListener('click', load);
  $('#chart-symbol', body).addEventListener('keydown', (event) => { if (event.key === 'Enter') load(); });
  if (!state.chart || state.chart.symbol !== state.activeSymbol || state.chart.range !== state.range || state.chart.interval !== state.interval) {
    loadChart().then(renderWorkspace).catch((error) => { $('#price-chart', body).outerHTML = `<div class="badge err">${escapeHtml(error.message)}</div>`; });
    return;
  }
  drawPriceChart($('#price-chart', body), state.chart.candles || []);
  drawRsi($('#rsi-chart', body), state.chart.candles || []);
  drawMacd($('#macd-chart', body), state.chart.candles || []);
}

function valuesForScale(candles) {
  const highs = candles.map((d) => Number(d.high)).filter(Number.isFinite);
  const lows = candles.map((d) => Number(d.low)).filter(Number.isFinite);
  return { min: Math.min(...lows), max: Math.max(...highs) };
}

function drawPriceChart(svg, candles) {
  const width = 920;
  const height = 330;
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  if (!candles.length) {
    svg.innerHTML = `<text x="20" y="40" fill="#7c8b94">데이터 없음 / API 필요 / 네트워크 오류</text>`;
    return;
  }
  const close = candles.map((d) => Number(d.close));
  const ma20 = sma(close, 20);
  const ma50 = sma(close, 50);
  const bb = bollinger(close, 20, 2);
  const { min, max } = valuesForScale(candles);
  const pad = (max - min) * 0.08 || 1;
  const yMin = min - pad;
  const yMax = max + pad;
  const volMax = Math.max(...candles.map((d) => Number(d.volume) || 0), 1);
  const plotTop = 15;
  const plotBottom = 260;
  const volumeTop = 270;
  const x = (i) => 40 + (i / Math.max(1, candles.length - 1)) * (width - 70);
  const y = (value) => plotBottom - ((value - yMin) / (yMax - yMin)) * (plotBottom - plotTop);
  const candleWidth = Math.max(2, Math.min(10, (width - 90) / candles.length * 0.62));
  const grid = [0, .25, .5, .75, 1].map((p) => {
    const gy = plotTop + p * (plotBottom - plotTop);
    const value = yMax - p * (yMax - yMin);
    return `<line x1="35" x2="900" y1="${gy}" y2="${gy}" stroke="#16222a"/><text x="904" y="${gy + 4}" fill="#7c8b94" font-size="10">${fmt(value)}</text>`;
  }).join('');
  const volumeBars = candles.map((d, i) => {
    const h = ((Number(d.volume) || 0) / volMax) * 48;
    const cls = Number(d.close) >= Number(d.open) ? 'up-fill' : 'down-fill';
    return `<rect class="${cls}" x="${x(i) - candleWidth / 2}" y="${volumeTop + 50 - h}" width="${candleWidth}" height="${h}" opacity="0.35"/>`;
  }).join('');
  const candlesSvg = candles.map((d, i) => {
    const cx = x(i);
    const open = Number(d.open), high = Number(d.high), low = Number(d.low), c = Number(d.close);
    const up = c >= open;
    const cls = up ? 'up-stroke up-fill' : 'down-stroke down-fill';
    const top = Math.min(y(open), y(c));
    const bodyHeight = Math.max(1, Math.abs(y(open) - y(c)));
    return `<line class="${up ? 'up-stroke' : 'down-stroke'}" x1="${cx}" x2="${cx}" y1="${y(high)}" y2="${y(low)}"/><rect class="${cls}" x="${cx - candleWidth / 2}" y="${top}" width="${candleWidth}" height="${bodyHeight}"/>`;
  }).join('');
  const path = (series) => series.map((value, i) => Number.isFinite(value) ? `${i === 0 || !Number.isFinite(series[i - 1]) ? 'M' : 'L'}${x(i)},${y(value)}` : '').join(' ');
  svg.innerHTML = `
    <defs><style>
      .up-stroke{stroke:#28d17c}.down-stroke{stroke:#f05b65}.up-fill{fill:#28d17c}.down-fill{fill:#f05b65}
      .ma20{fill:none;stroke:#f4b84a;stroke-width:1.2}.ma50{fill:none;stroke:#4da3ff;stroke-width:1.2}.bb{fill:none;stroke:#9a8cff;stroke-width:.8;stroke-dasharray:3 3}
    </style></defs>
    ${grid}
    ${volumeBars}
    ${candlesSvg}
    <path class="bb" d="${path(bb.map((d) => d.upper))}"/>
    <path class="bb" d="${path(bb.map((d) => d.lower))}"/>
    <path class="ma20" d="${path(ma20)}"/>
    <path class="ma50" d="${path(ma50)}"/>
    <text x="40" y="12" fill="#dbe6ec" font-size="11">${escapeHtml(state.chart.symbol)} ${escapeHtml(state.chart.range)} ${escapeHtml(state.chart.interval)} | MA20/MA50/Bollinger/Volume</text>
  `;
}

function drawRsi(svg, candles) {
  const width = 920, height = 70;
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  const closes = candles.map((d) => Number(d.close));
  const values = rsi(closes, 14);
  const x = (i) => 40 + (i / Math.max(1, values.length - 1)) * (width - 70);
  const y = (value) => 62 - (value / 100) * 54;
  const path = values.map((value, i) => Number.isFinite(value) ? `${i === 0 || !Number.isFinite(values[i - 1]) ? 'M' : 'L'}${x(i)},${y(value)}` : '').join(' ');
  svg.innerHTML = `<line x1="35" x2="900" y1="${y(70)}" y2="${y(70)}" stroke="#33434e"/><line x1="35" x2="900" y1="${y(30)}" y2="${y(30)}" stroke="#33434e"/><path d="${path}" fill="none" stroke="#f4b84a" stroke-width="1.2"/><text x="40" y="12" fill="#7c8b94" font-size="10">RSI(14)</text>`;
}

function drawMacd(svg, candles) {
  const width = 920, height = 70;
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  const closes = candles.map((d) => Number(d.close));
  const set = macd(closes);
  const all = [...set.macd, ...set.signal, ...set.histogram].filter(Number.isFinite);
  const maxAbs = Math.max(...all.map((v) => Math.abs(v)), 1);
  const x = (i) => 40 + (i / Math.max(1, closes.length - 1)) * (width - 70);
  const y = (value) => height / 2 - (value / maxAbs) * 25;
  const path = (series) => series.map((value, i) => Number.isFinite(value) ? `${i === 0 || !Number.isFinite(series[i - 1]) ? 'M' : 'L'}${x(i)},${y(value)}` : '').join(' ');
  const bars = set.histogram.map((value, i) => Number.isFinite(value) ? `<rect x="${x(i) - 2}" y="${Math.min(y(0), y(value))}" width="3" height="${Math.max(1, Math.abs(y(value) - y(0)))}" fill="${value >= 0 ? '#28d17c' : '#f05b65'}" opacity=".55"/>` : '').join('');
  svg.innerHTML = `<line x1="35" x2="900" y1="${y(0)}" y2="${y(0)}" stroke="#33434e"/>${bars}<path d="${path(set.macd)}" fill="none" stroke="#4da3ff" stroke-width="1.2"/><path d="${path(set.signal)}" fill="none" stroke="#f4b84a" stroke-width="1.2"/><text x="40" y="12" fill="#7c8b94" font-size="10">MACD(12,26,9)</text>`;
}

function sma(values, period) {
  return values.map((_, idx) => {
    if (idx + 1 < period) return null;
    const window = values.slice(idx + 1 - period, idx + 1).filter(Number.isFinite);
    return window.length === period ? window.reduce((sum, value) => sum + value, 0) / period : null;
  });
}

function ema(values, period) {
  const multiplier = 2 / (period + 1);
  const result = [];
  let previous = null;
  const seed = [];
  for (const value of values) {
    if (!Number.isFinite(value)) { result.push(null); continue; }
    if (previous === null) {
      seed.push(value);
      if (seed.length < period) { result.push(null); continue; }
      previous = seed.slice(-period).reduce((sum, v) => sum + v, 0) / period;
      result.push(previous);
      continue;
    }
    previous = (value - previous) * multiplier + previous;
    result.push(previous);
  }
  return result;
}

function bollinger(values, period, deviations) {
  return values.map((_, idx) => {
    if (idx + 1 < period) return { mid: null, upper: null, lower: null };
    const window = values.slice(idx + 1 - period, idx + 1).filter(Number.isFinite);
    if (window.length !== period) return { mid: null, upper: null, lower: null };
    const mid = window.reduce((sum, value) => sum + value, 0) / period;
    const variance = window.reduce((sum, value) => sum + (value - mid) ** 2, 0) / period;
    const sd = Math.sqrt(variance);
    return { mid, upper: mid + deviations * sd, lower: mid - deviations * sd };
  });
}

function rsi(values, period = 14) {
  const result = values.map(() => null);
  let avgGain = 0, avgLoss = 0;
  for (let i = 1; i < values.length; i += 1) {
    const diff = values[i] - values[i - 1];
    const gain = Math.max(diff, 0), loss = Math.max(-diff, 0);
    if (i <= period) {
      avgGain += gain; avgLoss += loss;
      if (i === period) { avgGain /= period; avgLoss /= period; result[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss); }
    } else {
      avgGain = ((avgGain * (period - 1)) + gain) / period;
      avgLoss = ((avgLoss * (period - 1)) + loss) / period;
      result[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
    }
  }
  return result;
}

function macd(values, fast = 12, slow = 26, signal = 9) {
  const fastEma = ema(values, fast), slowEma = ema(values, slow);
  const line = values.map((_, i) => fastEma[i] !== null && slowEma[i] !== null ? fastEma[i] - slowEma[i] : null);
  const signalLine = ema(line.map((v) => v === null ? Number.NaN : v), signal);
  return { macd: line, signal: signalLine, histogram: line.map((v, i) => v !== null && signalLine[i] !== null ? v - signalLine[i] : null) };
}

function renderNews(body, widgetId, options = {}) {
  body.innerHTML = `
    <div class="row gap">
      <input id="news-symbol" value="${escapeHtml(state.activeSymbol)}" />
      <button id="news-load">LOAD</button>
      <span>${state.news ? statusBadge(state.news.status, state.news.statusMessage) : statusBadge('데이터 없음')}</span>
    </div>
    <div class="scroll" style="max-height:${options.big ? '690px' : '420px'}; margin-top:6px" id="news-list"></div>`;
  $('#news-load', body).addEventListener('click', async () => {
    state.activeSymbol = $('#news-symbol', body).value.trim().toUpperCase() || state.activeSymbol;
    await loadNews(); renderWorkspace();
  });
  const list = $('#news-list', body);
  if (!state.news || state.news.symbol !== state.activeSymbol.replace(/\.(KS|KQ)$/u, '')) {
    loadNews().then(renderWorkspace).catch((error) => { list.textContent = `뉴스 데이터 없음: ${error.message}`; });
    return;
  }
  list.innerHTML = (state.news.items || []).map((item) => `
    <article class="news-item">
      <a class="news-title" href="${escapeHtml(item.url)}" target="_blank" rel="noreferrer">${escapeHtml(item.title)}</a>
      <div class="news-ko">${item.koTitle ? escapeHtml(item.koTitle) : '번역 데이터 없음 / Gemini API 필요'}</div>
      <div class="muted">${escapeHtml(item.koSummary || item.summary || '')}</div>
      <div class="news-meta">
        ${statusBadge(item.sentiment?.label || '중립')} ${statusBadge(item.importance || '낮음')} ${statusBadge(item.translationStatus || 'API 필요')}
        <span>${escapeHtml(item.source || '')}</span><span>${escapeHtml(item.publishedAt ? item.publishedAt.slice(0, 16).replace('T', ' ') : '')}</span><span>${escapeHtml((item.relatedTickers || []).join(','))}</span>
      </div>
    </article>`).join('') || `<div class="muted">${escapeHtml(state.news.statusMessage || '뉴스 데이터 없음')}</div>`;
}

function renderSecFilings(body) {
  body.innerHTML = `
    <div class="row gap"><input id="sec-symbol" value="${escapeHtml(state.activeSymbol)}"/><button id="sec-load">LOAD</button><span>${state.sec ? statusBadge(state.sec.status, state.sec.statusMessage) : statusBadge('데이터 없음')}</span></div>
    <div id="sec-list" class="scroll" style="margin-top:6px"></div>`;
  $('#sec-load', body).addEventListener('click', async () => { state.activeSymbol = $('#sec-symbol', body).value.trim().toUpperCase() || state.activeSymbol; await loadSec(); renderWorkspace(); });
  const list = $('#sec-list', body);
  if (!state.sec || state.sec.symbol !== state.activeSymbol) {
    loadSec().then(renderWorkspace).catch((error) => { list.textContent = `SEC 데이터 없음: ${error.message}`; });
    return;
  }
  list.innerHTML = (state.sec.filings || []).map((f) => `<div class="filing-item"><div><strong>${escapeHtml(f.form)}</strong> ${escapeHtml(f.description || '')}</div><div class="muted">${escapeHtml(f.filingDate || '')} / ${escapeHtml(f.reportDate || '')}</div>${f.url ? `<a target="_blank" rel="noreferrer" href="${escapeHtml(f.url)}">원문</a>` : ''}</div>`).join('') || `<div class="muted">${escapeHtml(state.sec.statusMessage || 'SEC 데이터 없음')}</div>`;
}

function renderDartFilings(body) {
  body.innerHTML = `
    <div class="row gap"><input id="dart-symbol" value="005930"/><button id="dart-load">LOAD</button><span>${state.dart ? statusBadge(state.dart.status, state.dart.statusMessage) : statusBadge('API 필요')}</span></div>
    <div id="dart-list" class="scroll" style="margin-top:6px"></div>`;
  $('#dart-load', body).addEventListener('click', async () => { await loadDart($('#dart-symbol', body).value.trim()); renderWorkspace(); });
  const list = $('#dart-list', body);
  if (!state.dart) {
    loadDart().then(renderWorkspace).catch((error) => { list.textContent = `DART 데이터 없음: ${error.message}`; });
    return;
  }
  list.innerHTML = (state.dart.filings || []).map((f) => `<div class="filing-item"><div><strong>${escapeHtml(f.reportName)}</strong></div><div class="muted">${escapeHtml(f.corpName || '')} / ${escapeHtml(f.filingDate || '')} / ${escapeHtml(f.submitter || '')}</div>${f.url ? `<a target="_blank" rel="noreferrer" href="${escapeHtml(f.url)}">DART 원문</a>` : ''}</div>`).join('') || `<div class="muted">${escapeHtml(state.dart.statusMessage || 'DART 데이터 없음')}</div>`;
}

function requireLoginBody(body) {
  body.innerHTML = `<div class="stack"><div class="badge warn">로그인 필요</div><div class="muted">포트폴리오, 사용자 API 키, 레이아웃 저장은 로그인 후 사용 가능합니다.</div><button id="login-inline">LOGIN</button></div>`;
  $('#login-inline', body)?.addEventListener('click', () => $('#login-dialog').showModal());
}

function renderPortfolioSummary(body) {
  if (!state.user) return requireLoginBody(body);
  if (!state.portfolio) { loadPortfolio().then(renderWorkspace).catch(() => {}); body.textContent = '포트폴리오 로딩 중'; return; }
  const s = state.portfolio.summary || {};
  const base = s.baseCurrency || state.portfolio.baseCurrency || 'USD';
  const currencies = ['USD', 'KRW', 'EUR', 'JPY'];
  body.innerHTML = `
    <div class="row gap" style="justify-content:space-between">
      <label style="grid-auto-flow:column; align-items:center; gap:5px">기준통화
        <select id="base-currency">${currencies.map((c) => `<option ${base === c ? 'selected' : ''}>${c}</option>`).join('')}</select>
      </label>
      <span class="muted">${escapeHtml(s.updatedAt ? s.updatedAt.slice(11, 19) : '')}</span>
    </div>
    <div class="grid2" style="margin-top:6px">
      <div class="metric"><div class="k">Total (${escapeHtml(base)})</div><div class="v">${fmt(s.totalValue)}</div></div>
      <div class="metric"><div class="k">P/L (${escapeHtml(base)})</div><div class="v ${clsChange(s.pnl)}">${signed(s.pnl)}</div></div>
      <div class="metric"><div class="k">P/L %</div><div class="v ${clsChange(s.pnlPercent)}">${pct(s.pnlPercent)}</div></div>
      <div class="metric"><div class="k">Missing Px / FX</div><div class="v ${(s.missingPrices?.length || s.missingFx?.length) ? 'down' : 'up'}">${s.missingPrices?.length || 0} / ${s.missingFx?.length || 0}</div></div>
    </div>
    <div class="muted" style="margin-top:8px">${escapeHtml(s.dataStatus || '')}${s.missingFx?.length ? ' · 환율 없음: ' + escapeHtml(s.missingFx.join(', ')) : ''}</div>`;
  $('#base-currency', body)?.addEventListener('change', async (event) => {
    await api('/api/portfolio', { method: 'PUT', body: { baseCurrency: event.target.value } });
    state.portfolio = null;
    await loadPortfolio();
    renderWorkspace();
  });
}

function renderPortfolioTable(body, widgetId, options = {}) {
  if (!state.user) return requireLoginBody(body);
  body.innerHTML = `<div id="portfolio-table-inner">로딩 중</div>`;
  if (!state.portfolio) { loadPortfolio().then(renderWorkspace).catch((error) => { $('#portfolio-table-inner', body).textContent = error.message; }); return; }
  $('#portfolio-table-inner', body).innerHTML = `
    <form class="form-grid" id="holding-form">
      <label>Symbol<input name="symbol" placeholder="AAPL" required></label>
      <label>Qty<input name="quantity" type="number" step="0.0001" required></label>
      <label>Avg Px<input name="averagePrice" type="number" step="0.0001"></label>
      <label>Target %<input name="targetWeight" type="number" step="0.1"></label>
      <label title="매입 시점 환율(기준통화 1단위당 native). 입력하면 환차익을 분리 계산합니다.">Buy FX<input name="purchaseFxRate" type="number" step="0.0001"></label>
      <button>ADD / UPDATE</button>
    </form>
    <div class="scroll" style="max-height:${options.big ? '640px' : '360px'}; margin-top:8px">
    <table class="table"><thead><tr><th>Symbol</th><th>Ccy</th><th>Qty</th><th>Last</th><th>Value</th><th>Value(${escapeHtml(base)})</th><th>P/L</th><th>Wgt</th><th>FX</th><th>Status</th><th></th></tr></thead><tbody>
      ${(state.portfolio.holdings || []).map((h) => `<tr>
        <td class="left"><button class="symbol-link" data-symbol="${escapeHtml(h.symbol)}">${escapeHtml(h.symbol)}</button></td><td>${escapeHtml(h.currency || '')}</td><td>${fmt(h.quantity)}</td><td>${fmt(h.lastPrice)}</td><td>${fmt(h.marketValueNative)}</td><td>${fmt(h.marketValueBase)}</td><td class="${clsChange(h.pnl)}" title="native ${signed(h.pnl)} / base ${signed(h.pnlBase)}">${signed(h.pnl)}</td><td>${pct(h.weight)}</td><td>${h.currency === base ? '<span class="badge">1.0000</span>' : (h.fxRate === null ? statusBadge('데이터 없음', h.fxStatus || '') : `<span class="badge ok" title="${escapeHtml(h.fxSource || '')}">${fmt(h.fxRate, 4)}</span>`)}</td><td>${statusBadge(h.priceStatus, h.quoteStatusMessage)}</td><td><button class="delete-holding" data-id="${escapeHtml(h.id)}">DEL</button></td>
      </tr>`).join('') || '<tr><td>보유 종목 없음</td><td colspan="10"></td></tr>'}
    </tbody></table></div>`;
  $('#holding-form', body).addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget).entries());
    await api('/api/portfolio/holding', { method: 'POST', body: data });
    state.portfolio = null;
    await loadPortfolio();
    renderWorkspace();
  });
  $$('.symbol-link', body).forEach((button) => button.addEventListener('click', () => selectSymbol(button.dataset.symbol)));
  $$('.delete-holding', body).forEach((button) => button.addEventListener('click', async () => {
    await api(`/api/portfolio/holding?id=${encodeURIComponent(button.dataset.id)}`, { method: 'DELETE' });
    state.portfolio = null; await loadPortfolio(); renderWorkspace();
  }));
}

function renderPortfolioGraph(body, widgetId, options = {}) {
  if (!state.user) return requireLoginBody(body);
  if (!state.portfolio) { loadPortfolio().then(renderWorkspace).catch(() => {}); body.textContent = '로딩 중'; return; }
  const holdings = (state.portfolio.holdings || []).filter((h) => Number.isFinite(Number(h.weight))).sort((a, b) => b.weight - a.weight);
  body.innerHTML = `
    <button id="portfolio-big">크게 보기</button>
    <div class="stack" style="margin-top:8px; max-height:${options.big ? '700px' : '320px'}; overflow:auto">
      ${holdings.map((h) => `<div><div class="row" style="justify-content:space-between"><span>${escapeHtml(h.symbol)} / ${escapeHtml(h.sector || '')}</span><span>${pct(h.weight)}</span></div><div class="progress-bar ${h.rebalanceNeeded ? 'warn' : ''}"><div style="width:${Math.max(2, Math.min(100, h.weight || 0))}%"></div></div></div>`).join('') || '<div class="muted">표시할 평가액 데이터 없음</div>'}
    </div>`;
  $('#portfolio-big', body).addEventListener('click', () => openBigWidget('portfolio-graph'));
}

function renderPortfolioRisk(body) {
  if (!state.user) return requireLoginBody(body);
  if (!state.portfolio) { loadPortfolio().then(renderWorkspace).catch(() => {}); body.textContent = '로딩 중'; return; }
  const exposureHtml = (title, map) => `<div><strong>${title}</strong>${Object.entries(map || {}).sort((a, b) => b[1] - a[1]).map(([key, value]) => {
    const pctValue = state.portfolio.summary?.totalValue ? (value / state.portfolio.summary.totalValue) * 100 : null;
    return `<div class="row" style="justify-content:space-between"><span>${escapeHtml(key)}</span><span>${pct(pctValue)}</span></div>`;
  }).join('') || '<div class="muted">데이터 없음</div>'}</div>`;
  const rebalance = (state.portfolio.holdings || []).filter((h) => h.rebalanceNeeded);
  body.innerHTML = `<div class="stack">${exposureHtml('Sector', state.portfolio.exposure?.sector)}${exposureHtml('Country', state.portfolio.exposure?.country)}${exposureHtml('Currency', state.portfolio.exposure?.currency)}<div><strong>Rebalance</strong>${rebalance.map((h) => `<div class="muted">${escapeHtml(h.symbol)} ${signed(h.rebalanceDeltaValue)}</div>`).join('') || '<div class="muted">임계치 초과 없음 / 목표 비중 데이터 없음</div>'}</div></div>`;
}

function renderOptionsChain(body, widgetId, options = {}) {
  body.innerHTML = `<div class="row gap"><input id="option-symbol" value="${escapeHtml(state.activeSymbol)}"><button id="option-load">LOAD</button><span>${state.options ? statusBadge(state.options.status, state.options.statusMessage) : statusBadge('데이터 없음')}</span></div><div id="option-list" class="scroll" style="max-height:${options.big ? '690px' : '420px'}; margin-top:6px"></div>`;
  $('#option-load', body).addEventListener('click', async () => { state.activeSymbol = $('#option-symbol', body).value.trim().toUpperCase() || state.activeSymbol; await loadOptions(); renderWorkspace(); });
  const list = $('#option-list', body);
  if (!state.options || state.options.symbol !== state.activeSymbol.replace(/\.(KS|KQ)$/u, '')) { loadOptions().then(renderWorkspace).catch((error) => { list.textContent = `옵션 데이터 없음: ${error.message}`; }); return; }
  list.innerHTML = `<table class="table"><thead><tr><th>Contract</th><th>Exp</th><th>Type</th><th>Strike</th><th>Last</th><th>Bid</th><th>Ask</th><th>Vol</th><th>OI</th><th>IV</th></tr></thead><tbody>
    ${(state.options.options || []).map((o) => `<tr><td class="left">${escapeHtml(o.contractSymbol)}</td><td>${escapeHtml(o.expiration || '')}</td><td>${escapeHtml(o.type)}</td><td>${fmt(o.strike)}</td><td>${fmt(o.lastPrice)}</td><td>${fmt(o.bid)}</td><td>${fmt(o.ask)}</td><td>${fmt(o.volume, 0)}</td><td>${fmt(o.openInterest, 0)}</td><td>${pct((o.impliedVolatility || 0) * 100)}</td></tr>`).join('') || '<tr><td>옵션 데이터 없음</td><td colspan="9"></td></tr>'}
  </tbody></table>`;
}

function renderOrderTicket(body) {
  const logged = Boolean(state.user);
  body.innerHTML = `
    <div class="paper-banner">기본 모드: PAPER TRADING. 실거래와 모의거래가 혼동되지 않도록 분리됩니다.</div>
    ${logged ? '' : '<div class="muted" style="margin-top:6px">주문 기록은 로그인 후 저장됩니다.</div>'}
    <form id="order-form" class="stack" style="margin-top:8px">
      <div class="form-grid compact">
        <label>Symbol<input name="symbol" value="${escapeHtml(state.activeSymbol)}"></label>
        <label>Side<select name="side"><option value="buy">BUY</option><option value="sell">SELL</option></select></label>
        <label>Qty<input name="quantity" type="number" step="0.0001" value="1"></label>
        <label>Type<select name="type"><option value="market">MARKET</option><option value="limit">LIMIT</option></select></label>
        <label>Limit<input name="limitPrice" type="number" step="0.0001"></label>
        <label>Mode<select name="mode"><option value="paper">PAPER</option><option value="live">LIVE DISABLED</option></select></label>
      </div>
      <label class="live-block">실거래 확인 문구<input name="acknowledgement" placeholder="LIVE_ORDER_CONFIRMED 없으면 live 거절"></label>
      <button ${logged ? '' : 'disabled'}>SUBMIT PAPER ORDER</button>
    </form>
    <div id="order-result" class="muted" style="margin-top:8px"></div>`;
  $('#order-form', body).addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!state.user) return;
    const raw = Object.fromEntries(new FormData(event.currentTarget).entries());
    const mode = raw.mode;
    const order = { ...raw };
    delete order.mode;
    try {
      const result = await api('/api/trading/order', { method: 'POST', body: { mode, order } });
      $('#order-result', body).innerHTML = `${statusBadge(result.status || '정상')} ${escapeHtml(result.statusMessage || '')}`;
    } catch (error) {
      $('#order-result', body).innerHTML = `${statusBadge('오류')} ${escapeHtml(error.message)}`;
    }
  });
}

function renderOrderHistory(body) {
  if (!state.user) return requireLoginBody(body);
  body.innerHTML = '<div id="orders">로딩 중</div>';
  api('/api/trading/orders').then((data) => {
    $('#orders', body).innerHTML = `<table class="table"><thead><tr><th>Time</th><th>Symbol</th><th>Side</th><th>Qty</th><th>Type</th><th>Status</th></tr></thead><tbody>${(data.orders || []).map((o) => `<tr><td>${escapeHtml(o.createdAt?.slice(0, 16).replace('T', ' ') || '')}</td><td>${escapeHtml(o.symbol)}</td><td>${escapeHtml(o.side)}</td><td>${fmt(o.quantity)}</td><td>${escapeHtml(o.type)}</td><td>${escapeHtml(o.brokerStatus || o.status)}</td></tr>`).join('') || '<tr><td>주문 기록 없음</td><td colspan="5"></td></tr>'}</tbody></table>`;
  }).catch((error) => { $('#orders', body).textContent = error.message; });
}

const ALERT_TYPES = [
  ['price_above', '가격 ≥'],
  ['price_below', '가격 ≤'],
  ['pct_change', '|변동%| ≥'],
  ['rsi_above', 'RSI ≥'],
  ['rsi_below', 'RSI ≤']
];

function currentAlerts() {
  const fromUser = state.user?.settings?.alerts;
  const fromLocal = JSON.parse(localStorage.getItem('kt.alerts') || 'null');
  return (fromUser?.length ? fromUser : fromLocal?.length ? fromLocal : []).slice(0, 100);
}

async function saveAlerts(list) {
  const clean = list.slice(0, 100);
  localStorage.setItem('kt.alerts', JSON.stringify(clean));
  if (state.user) {
    const result = await api('/api/settings', { method: 'PUT', body: { alerts: clean } });
    state.user = result.user;
  }
}

function alertCondLabel(alert) {
  const label = (ALERT_TYPES.find(([value]) => value === alert.type) || [])[1] || alert.type;
  return `${label} ${alert.value}`;
}

function ensureNotificationPermission() {
  if (window.Notification && Notification.permission === 'default') {
    Notification.requestPermission().catch(() => {});
  }
}

function showToast(message, kind = '') {
  let host = $('#toast-host');
  if (!host) { host = document.createElement('div'); host.id = 'toast-host'; document.body.appendChild(host); }
  const toast = document.createElement('div');
  toast.className = `toast ${kind}`.trim();
  toast.textContent = message;
  host.appendChild(toast);
  setTimeout(() => { toast.classList.add('out'); setTimeout(() => toast.remove(), 400); }, 6000);
}

function fireAlert(alert, detail) {
  showToast(`알림 발동: ${detail}`, 'warn');
  if (window.Notification && Notification.permission === 'granted') {
    try { new Notification('K Terminal 알림', { body: detail }); } catch { /* ignore */ }
  }
}

// Client-side evaluation against the live stream (price/%-change) and the active chart (RSI).
function evaluateAlerts(quotes) {
  const alerts = currentAlerts();
  if (!alerts.length) return;
  const now = Date.now();
  const bySymbol = new Map((quotes || []).map((q) => [q.symbol, q]));
  let changed = false;
  for (const alert of alerts) {
    if (!alert.enabled) continue;
    if (alert.snoozedUntil && now < alert.snoozedUntil) continue;
    const quote = bySymbol.get(alert.symbol);
    let hit = false;
    let detail = '';
    if (['price_above', 'price_below', 'pct_change'].includes(alert.type) && quote && quote.price != null) {
      if (alert.type === 'price_above' && quote.price >= alert.value) { hit = true; detail = `${alert.symbol} ${fmt(quote.price)} ≥ ${alert.value}`; }
      else if (alert.type === 'price_below' && quote.price <= alert.value) { hit = true; detail = `${alert.symbol} ${fmt(quote.price)} ≤ ${alert.value}`; }
      else if (alert.type === 'pct_change' && Number.isFinite(quote.changePercent) && Math.abs(quote.changePercent) >= alert.value) { hit = true; detail = `${alert.symbol} ${pct(quote.changePercent)} (|Δ| ≥ ${alert.value}%)`; }
    } else if (['rsi_above', 'rsi_below'].includes(alert.type) && state.chart?.symbol === alert.symbol) {
      const value = rsi(state.chart.candles.map((c) => Number(c.close)), 14).at(-1);
      if (Number.isFinite(value)) {
        if (alert.type === 'rsi_above' && value >= alert.value) { hit = true; detail = `${alert.symbol} RSI ${value.toFixed(1)} ≥ ${alert.value}`; }
        else if (alert.type === 'rsi_below' && value <= alert.value) { hit = true; detail = `${alert.symbol} RSI ${value.toFixed(1)} ≤ ${alert.value}`; }
      }
    }
    if (hit) {
      alert.triggeredAt = new Date().toISOString();
      alert.snoozedUntil = now + 10 * 60 * 1000; // auto-snooze 10m to avoid repeat spam
      fireAlert(alert, detail);
      changed = true;
    }
  }
  if (changed) saveAlerts(alerts).catch(() => {});
}

function renderAlerts(body) {
  const alerts = currentAlerts();
  body.innerHTML = `
    <form class="form-grid compact" id="alert-form">
      <label>Symbol<input name="symbol" value="${escapeHtml(state.activeSymbol)}" required></label>
      <label>Type<select name="type">${ALERT_TYPES.map(([value, label]) => `<option value="${value}">${label}</option>`).join('')}</select></label>
      <label>Value<input name="value" type="number" step="0.0001" required></label>
      <button>ADD</button>
    </form>
    <div class="scroll" style="margin-top:6px">
      <table class="table"><thead><tr><th>Symbol</th><th>Condition</th><th>State</th><th></th></tr></thead><tbody>
      ${alerts.map((alert, index) => `<tr>
        <td class="left">${escapeHtml(alert.symbol)}</td>
        <td>${escapeHtml(alertCondLabel(alert))}</td>
        <td>${alert.enabled ? (alert.triggeredAt ? statusBadge('발동', alert.triggeredAt) : statusBadge('대기')) : statusBadge('중지')}</td>
        <td><button data-index="${index}" class="alert-toggle">${alert.enabled ? 'OFF' : 'ON'}</button> <button data-index="${index}" class="alert-del">DEL</button></td>
      </tr>`).join('') || '<tr><td>알림 없음</td><td colspan="3"></td></tr>'}
      </tbody></table>
    </div>
    <div class="muted" style="margin-top:6px">알림은 실시간 스트림(가격/변동%)과 현재 차트(RSI) 기준으로 브라우저에서 평가됩니다. 알림이 울리면 10분간 자동 스누즈됩니다.</div>`;
  $('#alert-form', body).addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget).entries());
    const value = Number(data.value);
    if (!data.symbol || !Number.isFinite(value)) return;
    ensureNotificationPermission();
    const next = [...alerts, { id: `al_${Date.now()}`, symbol: String(data.symbol).toUpperCase(), type: data.type, value, enabled: true, triggeredAt: null, snoozedUntil: 0 }];
    await saveAlerts(next);
    renderWorkspace();
  });
  $$('.alert-toggle', body).forEach((button) => button.addEventListener('click', async () => {
    const list = currentAlerts();
    const alert = list[Number(button.dataset.index)];
    if (alert) { alert.enabled = !alert.enabled; alert.snoozedUntil = 0; alert.triggeredAt = alert.enabled ? null : alert.triggeredAt; await saveAlerts(list); renderWorkspace(); }
  }));
  $$('.alert-del', body).forEach((button) => button.addEventListener('click', async () => {
    const list = currentAlerts();
    list.splice(Number(button.dataset.index), 1);
    await saveAlerts(list);
    renderWorkspace();
  }));
}

function renderAiAssistant(body, widgetId, options = {}) {
  body.innerHTML = `
    <div class="stack">
      <div class="row gap"><span>${statusBadge(state.meta?.providers?.gemini ? 'Gemini 연결' : '로컬 규칙', 'Gemini API 키가 없으면 로컬 요약이 사용됩니다.')}</span><span class="muted">컨텍스트: 시세/뉴스/차트/포트폴리오</span></div>
      <div id="chat-log" class="scroll" style="max-height:${options.big ? '600px' : '310px'}"></div>
      <textarea class="ai-input" id="ai-question" placeholder="예: NVDA 최근 뉴스와 차트 기준 리스크를 요약해줘"></textarea>
      <button id="ai-send">ASK</button>
    </div>`;
  renderChatLog($('#chat-log', body));
  $('#ai-send', body).addEventListener('click', async () => {
    const question = $('#ai-question', body).value.trim();
    if (!question) return;
    state.chat.push({ role: 'user', text: question, time: new Date().toISOString() });
    renderChatLog($('#chat-log', body));
    const context = { symbol: state.activeSymbol, quote: quoteFor(state.activeSymbol), news: state.news, chart: state.chart, portfolio: state.portfolio };
    try {
      const answer = await api('/api/ai/chat', { method: 'POST', body: { question, context, provider: state.user?.settings?.aiProvider || (state.meta?.providers?.gemini ? 'gemini' : 'local') } });
      state.chat.push({ role: 'assistant', text: answer.answer, time: new Date().toISOString(), provider: answer.provider, status: answer.status });
    } catch (error) {
      state.chat.push({ role: 'assistant', text: `AI 응답 오류: ${error.message}`, time: new Date().toISOString() });
    }
    $('#ai-question', body).value = '';
    renderChatLog($('#chat-log', body));
  });
}

function renderChatLog(host) {
  host.innerHTML = state.chat.map((m) => `<div class="chat-message"><div class="muted">${escapeHtml(m.role)} ${escapeHtml(m.provider || '')} ${escapeHtml(m.status || '')}</div><div style="white-space:pre-wrap">${escapeHtml(m.text)}</div></div>`).join('') || '<div class="muted">질문을 입력하십시오. API 키가 없으면 로컬 규칙 기반 요약이 작동합니다.</div>';
  host.scrollTop = host.scrollHeight;
}

function quoteFor(symbol) {
  return state.snapshot?.quotes?.find((q) => q.symbol === symbol) || state.watchlistQuotes?.quotes?.find((q) => q.symbol === symbol) || null;
}

function renderSettings(body) {
  const providers = ['finnhub', 'twelvedata', 'gemini', 'dart'];
  body.innerHTML = `
    <div class="stack">
      <div>${state.user ? `로그인: ${escapeHtml(state.user.email)}` : statusBadge('로그인 필요')}</div>
      <label>기본 종목<input id="default-symbol" value="${escapeHtml(state.user?.settings?.defaultSymbol || state.activeSymbol)}"></label>
      <button id="save-default" ${state.user ? '' : 'disabled'}>SAVE DEFAULT</button>
      <div class="muted">API 키는 서버 파일 DB에 AES-GCM으로 암호화 저장됩니다. 운영 서버에서는 SECRET_KEY를 강한 난수로 고정하고 백업/권한 관리를 분리하십시오.</div>
      ${providers.map((p) => `<form class="row gap api-key-form" data-provider="${p}"><input type="password" placeholder="${p.toUpperCase()} API KEY"/><button ${state.user ? '' : 'disabled'}>SAVE</button><button type="button" class="delete-key" ${state.user ? '' : 'disabled'}>DEL</button><span>${statusBadge(state.user?.apiKeyProviders?.[p] ? '정상' : 'API 필요')}</span></form>`).join('')}
      <button id="reset-layout">RESET LAYOUT</button>
      <button id="save-layout" ${state.user ? '' : 'disabled'}>SAVE LAYOUT TO ACCOUNT</button>
    </div>`;
  $('#save-default', body).addEventListener('click', async () => {
    const defaultSymbol = $('#default-symbol', body).value.trim().toUpperCase();
    const result = await api('/api/settings', { method: 'PUT', body: { defaultSymbol } });
    state.user = result.user; state.activeSymbol = defaultSymbol; renderWorkspace();
  });
  $$('.api-key-form', body).forEach((form) => {
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const value = $('input', form).value.trim();
      if (!value) return;
      const result = await api('/api/settings/api-key', { method: 'PUT', body: { provider: form.dataset.provider, value } });
      state.user = result.user; await loadMeta(); renderWorkspace();
    });
    $('.delete-key', form).addEventListener('click', async () => {
      const result = await api(`/api/settings/api-key?provider=${encodeURIComponent(form.dataset.provider)}`, { method: 'DELETE' });
      state.user = result.user; await loadMeta(); renderWorkspace();
    });
  });
  $('#reset-layout', body).addEventListener('click', () => { state.layout = {}; localStorage.removeItem('kt.layout'); renderWorkspace(); });
  $('#save-layout', body).addEventListener('click', saveLayout);
}

async function selectSymbol(symbol) {
  state.activeSymbol = symbol;
  state.chart = null; state.news = null; state.sec = null; state.options = null;
  localStorage.setItem('kt.activeSymbol', symbol);
  state.activeTab = 'chart';
  updateTabs();
  renderWorkspace();
  setTimeout(() => Promise.allSettled([loadChart(), loadNews(), loadSec(), loadOptions()]).then(renderWorkspace), 0);
}

function updateTabs() {
  $$('#subtabs button').forEach((button) => button.classList.toggle('active', button.dataset.tab === state.activeTab));
}

function installTabs() {
  $$('#subtabs button').forEach((button) => button.addEventListener('click', () => {
    state.activeTab = button.dataset.tab;
    updateTabs();
    renderWorkspace();
    backgroundLoadForTab(state.activeTab);
  }));
  $$('.global-menu button').forEach((button) => button.addEventListener('click', () => {
    const map = { markets: 'market', portfolio: 'portfolio', research: 'news', tools: 'monitor', ai: 'ai' };
    state.activeTab = map[button.dataset.global] || 'market';
    updateTabs(); renderWorkspace(); backgroundLoadForTab(state.activeTab);
  }));
}

function backgroundLoadForTab(tab) {
  if (tab === 'chart') loadChart().then(renderWorkspace).catch(() => {});
  if (tab === 'news') Promise.allSettled([loadNews(), loadSec(), loadDart()]).then(renderWorkspace);
  if (tab === 'portfolio') loadPortfolio().then(renderWorkspace).catch(() => {});
  if (tab === 'options') loadOptions().then(renderWorkspace).catch(() => {});
}

function installCommand() {
  $('#ai-copilot').addEventListener('click', () => { state.activeTab = 'ai'; updateTabs(); renderWorkspace(); });
  $('#command-input').addEventListener('keydown', async (event) => {
    if (event.key !== 'Enter') return;
    const raw = event.currentTarget.value.trim();
    if (!raw) return;
    const [cmd, arg] = raw.split(/\s+/);
    const upper = cmd.toUpperCase();
    if (upper === 'NEWS') { state.activeSymbol = (arg || state.activeSymbol).toUpperCase(); state.activeTab = 'news'; await loadNews().catch(() => {}); }
    else if (upper === 'PORT') { state.activeTab = 'portfolio'; await loadPortfolio().catch(() => {}); }
    else if (upper === 'AI') { state.activeTab = 'ai'; state.chat.push({ role: 'user', text: raw.slice(2).trim(), time: new Date().toISOString() }); }
    else { state.activeSymbol = upper; state.activeTab = 'chart'; state.chart = null; await loadChart().catch(() => {}); }
    event.currentTarget.value = '';
    updateTabs(); renderWorkspace();
  });
}

function installAuth() {
  $('#login-open').addEventListener('click', () => $('#login-dialog').showModal());
  $('#login-submit').addEventListener('click', async () => authSubmit('/api/auth/login'));
  $('#register-submit').addEventListener('click', async () => authSubmit('/api/auth/register'));
  $('#logout-submit').addEventListener('click', async () => {
    await api('/api/auth/logout', { method: 'POST' });
    state.user = null; state.portfolio = null; await loadMeta(); renderWorkspace(); $('#auth-message').textContent = '로그아웃 완료';
  });
}

async function authSubmit(path) {
  const email = $('#auth-email').value.trim();
  const password = $('#auth-password').value;
  try {
    const result = await api(path, { method: 'POST', body: { email, password } });
    state.user = result.user; await loadMeta(); $('#auth-message').textContent = '인증 완료'; $('#login-dialog').close(); renderWorkspace();
  } catch (error) {
    $('#auth-message').textContent = error.message;
  }
}

function installSplitters() {
  restorePanelWidths();
  let active = null;
  $$('.splitter').forEach((splitter) => splitter.addEventListener('pointerdown', (event) => {
    active = splitter.dataset.splitter;
    splitter.setPointerCapture(event.pointerId);
  }));
  window.addEventListener('pointermove', (event) => {
    if (!active) return;
    const width = window.innerWidth;
    if (active === 'left') {
      const next = Math.min(520, Math.max(210, event.clientX));
      document.documentElement.style.setProperty('--left-width', `${next}px`);
      state.layout.leftWidth = next;
    } else {
      const next = Math.min(560, Math.max(230, width - event.clientX));
      document.documentElement.style.setProperty('--right-width', `${next}px`);
      state.layout.rightWidth = next;
    }
  });
  window.addEventListener('pointerup', () => { if (active) saveLayout(); active = null; });
}

function restorePanelWidths() {
  if (state.layout.leftWidth) document.documentElement.style.setProperty('--left-width', `${state.layout.leftWidth}px`);
  if (state.layout.rightWidth) document.documentElement.style.setProperty('--right-width', `${state.layout.rightWidth}px`);
}

function tickClock() {
  const now = new Date();
  $('#clock').textContent = now.toLocaleTimeString('ko-KR', { hour12: false });
}

async function init() {
  tickClock(); setInterval(tickClock, 1000);
  installTabs(); installCommand(); installAuth(); installSplitters();
  renderWorkspace();
  try {
    await loadMeta();
    renderWorkspace();
    await loadSnapshot();
    renderWorkspace();
    setTimeout(() => Promise.allSettled([loadWatchlistQuotes(), loadChart(), loadNews(), loadSec()]).then(renderWorkspace), 50);
    startStream();
    // Fallback polling only kicks in when the live SSE stream is not connected.
    setInterval(() => { if (state.streamState !== 'LIVE') loadSnapshot().then(renderWorkspace).catch(() => {}); }, 60_000);
  } catch (error) {
    setStatus(`초기화 오류: ${error.message}`);
  }
}

init();
