const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const state = {
  meta: null,
  user: null,
  activeTab: 'signals', // cockpit-first: land on the auto-dom signal/gate/positions pipeline
  activeSymbol: localStorage.getItem('kt.activeSymbol') || 'BTC-USD',
  range: localStorage.getItem('kt.range') || '1Y',
  interval: localStorage.getItem('kt.interval') || '1D',
  snapshot: null,
  chart: null,
  watchlistQuotes: null,
  dragging: null,
  layout: loadLayout(),
  priceMap: new Map(),
  stream: null,
  streamState: 'OFF',
  compareSymbols: [],
  compareSeries: [],
  signals: [],
  activeSignal: null,
  autodom: null
};

const DEFAULT_VIEWS = {
  market: {
    left: ['market-pulse', 'watchlist'],
    center: ['chart'],
    right: ['alerts', 'data-sources']
  },
  signals: {
    left: ['signals', 'watchlist'],
    center: ['execution-gate', 'news-recommendations'],
    right: ['positions', 'alerts']
  },
  chart: {
    left: ['watchlist', 'market-pulse'],
    center: ['chart'],
    right: ['alerts', 'data-sources']
  }
};

const WIDGETS = {
  'market-pulse': { title: 'MARKET PULSE', subtitle: '리스크/유동성', render: renderMarketPulse },
  watchlist: { title: 'WATCHLIST', subtitle: '관심종목', render: renderWatchlist },
  'data-sources': { title: 'DATA SOURCES', subtitle: '실제/지연/API', render: renderDataSources },
  chart: { title: 'CHART', subtitle: '캔들/기술지표', render: renderChartWidget, big: true },
  alerts: { title: 'ALERTS', subtitle: '가격/지표 알림', render: renderAlerts },
  signals: { title: 'SIGNALS', subtitle: 'Crypto Signal 후보', render: renderSignals, big: true },
  'execution-gate': { title: 'EXECUTION GATE', subtitle: 'auto-dom 브릿지', render: renderExecutionGate, big: true },
  'news-recommendations': { title: 'IMPORTANT NEWS + COIN PICKS', subtitle: '뉴스 기반 추천 3개', render: renderNewsRecommendations, big: true },
  positions: { title: 'POSITIONS / 실행', subtitle: '체결 + 근거', render: renderPositions, big: true }
};

// Widgets removed from the panel surface (legacy, or moved elsewhere e.g. settings → header
// modal). Keep filtering them so stale localStorage/server layouts cannot resurrect the panels.
const REMOVED_WIDGETS = new Set(['crypto-monitor', 'ai-assistant', 'settings']);

function isRenderableWidget(widgetId) {
  return Boolean(WIDGETS[widgetId]) && !REMOVED_WIDGETS.has(widgetId);
}

function sanitizePanelWidgets(widgets = []) {
  return widgets.filter(isRenderableWidget);
}

function normalizeWidgetsForTab(tab, widgets = []) {
  const mapped = widgets.map((widgetId) => (tab === 'signals' && widgetId === 'chart' ? 'news-recommendations' : widgetId));
  return [...new Set(mapped)].filter(isRenderableWidget);
}

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

// Accessibility: never signal direction with color alone — pair with an arrow glyph.
function dirArrow(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num === 0) return '·';
  return num > 0 ? '▲' : '▼';
}

function chgText(value) {
  return `${dirArrow(value)} ${pct(value)}`;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
}

// Only allow http/https hrefs from remote-derived URLs (signals, news, filings). escapeHtml
// alone does NOT neutralize a javascript:/data: scheme, which would be a click-XSS vector.
function safeHttpUrl(value) {
  if (typeof value !== 'string') return '';
  try {
    const url = new URL(value, window.location.origin);
    return (url.protocol === 'http:' || url.protocol === 'https:') ? url.href : '';
  } catch { return ''; }
}

function extLink(url, label, extraClass = '') {
  const safe = safeHttpUrl(url);
  const cls = extraClass ? ` class="${extraClass}"` : '';
  return safe
    ? `<a${cls} href="${escapeHtml(safe)}" target="_blank" rel="noreferrer noopener">${escapeHtml(label)}</a>`
    : `<span${cls}>${escapeHtml(label)}</span>`;
}

function statusBadge(status, message = '') {
  const text = escapeHtml(status || '데이터 없음');
  const statusClass = status === '실시간' || status === '근실시간' || status === '정상' ? 'ok' : status === '지연 데이터' || status === 'API 필요' || status === '일부 가격 데이터 없음' ? 'warn' : 'err';
  return `<span class="badge ${statusClass}" title="${escapeHtml(message)}">${text}</span>`;
}

function setStatus(text) {
  $('#connection-state').textContent = text;
}

function skeletonBlock(rows = 5) {
  return `<div class="stack" style="gap:6px; margin-top:4px">${Array.from({ length: rows }, () => '<div class="skeleton" style="height:16px"></div>').join('')}</div>`;
}

function getViewLayout(tab = state.activeTab) {
  const saved = state.layout.tabs?.[tab];
  const base = DEFAULT_VIEWS[tab] || DEFAULT_VIEWS.signals;
  // Use the saved panel if it still has renderable widgets. If a saved panel had widgets but
  // they were ALL removed/renamed (stale layout), fall back to defaults instead of a blank panel.
  // An intentionally-emptied panel (saved as []) is preserved.
  const pick = (key) => {
    const savedArr = saved?.[key];
    if (Array.isArray(savedArr)) {
      const clean = normalizeWidgetsForTab(tab, savedArr);
      if (clean.length || savedArr.length === 0) return clean;
    }
    return normalizeWidgetsForTab(tab, base[key]);
  };
  return { left: pick('left'), center: pick('center'), right: pick('right') };
}

function setViewLayout(tab, next) {
  state.layout.tabs ||= {};
  state.layout.tabs[tab] = {
    left: normalizeWidgetsForTab(tab, next.left || []),
    center: normalizeWidgetsForTab(tab, next.center || []),
    right: normalizeWidgetsForTab(tab, next.right || [])
  };
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
  requestAnimationFrame(fitPriceChart); // size the chart to its laid-out height (no letterbox)
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
    template.classList.add('grow'); // big widgets claim a larger share of the panel height
    const big = document.createElement('button');
    big.textContent = 'BIG';
    big.title = '크게 보기';
    big.addEventListener('click', (event) => { event.stopPropagation(); openBigWidget(widgetId); });
    actions.appendChild(big);
  }
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
  return template;
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
  if (['market-pulse', 'watchlist'].includes(widgetId)) await loadSnapshot();
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
  if (state.meta?.singleUser) {
    $('#login-open').style.display = 'none'; // no login concept in single-user mode
  } else {
    $('#login-open').style.display = '';
    $('#login-open').textContent = state.user ? state.user.email.split('@')[0].toUpperCase() : 'LOGIN';
  }
}

async function loadSnapshot() {
  try {
    const symbols = state.meta?.cryptoUniverse?.map((item) => item.symbol).join(',') || 'BTC-USD,ETH-USD,SOL-USD,XRP-USD,BNB-USD,ADA-USD,DOGE-USD,AVAX-USD,BTC-KRW,ETH-KRW';
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

async function loadWatchlistQuotes() {
  const list = currentWatchlist();
  if (!list.length) return;
  state.watchlistQuotes = await api(`/api/market/snapshot?symbols=${encodeURIComponent(list.join(','))}`);
}

function currentWatchlist() {
  const fallback = ['BTC-USD', 'ETH-USD', 'SOL-USD', 'XRP-USD', 'BTC-KRW'];
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
      <div class="label"><span class="ix-label">${escapeHtml(labelFor(q.symbol))}</span><span class="ix-status">${escapeHtml(q.status || '')}</span></div>
      <div class="value">${fmt(q.price)}</div>
      <div class="change ${clsChange(q.changePercent)}">${dirArrow(q.changePercent)} ${signed(q.change)} / ${signed(q.changePercent, '%')}</div>
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
      el.textContent = chgText(q.changePercent);
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
  const universe = state.meta?.cryptoUniverse?.map((item) => item.symbol) || [];
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
  es.addEventListener('signal', (event) => {
    let sig;
    try { sig = JSON.parse(event.data); } catch { return; }
    state.signals = [sig, ...state.signals.filter((s) => s.signalId !== sig.signalId)].slice(0, 100);
    if (sig.urgencyScore != null && sig.urgencyScore >= 0.8) showToast(`시그널: ${sig.symbol || ''} ${sig.direction || ''} (urgency ${sig.urgencyScore.toFixed(2)})`, 'warn');
    if (document.querySelector('[data-widget-id="signals"]')) renderWorkspace();
  });
  es.onerror = () => setStreamState('RECONNECT'); // EventSource reconnects automatically
}

function stopStream() {
  if (state.stream) { state.stream.close(); state.stream = null; }
}

function labelFor(symbol) {
  const universes = [...(state.meta?.cryptoUniverse || []), ...(state.meta?.marketUniverse || [])];
  return universes.find((item) => item.symbol === symbol)?.label || symbol;
}

function regimeGauge(avg, regime) {
  const rad = (deg) => (deg * Math.PI) / 180;
  const clamped = Math.max(-1, Math.min(1, Number.isFinite(avg) ? avg : 0)); // avg is a percent; ±1% = full deflection
  const theta = 90 - clamped * 90; // 180°=left/down, 90°=top/neutral, 0°=right/up
  const cx = 100;
  const cy = 100;
  const r = 78;
  const nx = (cx + r * Math.cos(rad(theta))).toFixed(1);
  const ny = (cy - r * Math.sin(rad(theta))).toFixed(1);
  const color = !Number.isFinite(avg) ? '#7c8b94' : avg > 0.05 ? '#28d17c' : avg < -0.05 ? '#f05b65' : '#f4b84a';
  return `<svg viewBox="0 0 200 116" class="gauge" role="img" aria-label="시장 레짐 게이지: ${escapeHtml(regime)}">
    <path d="M20,100 A80,80 0 0 1 100,20" fill="none" stroke="rgba(240,91,101,.32)" stroke-width="10" stroke-linecap="round"/>
    <path d="M100,20 A80,80 0 0 1 180,100" fill="none" stroke="rgba(40,209,124,.32)" stroke-width="10" stroke-linecap="round"/>
    <line x1="${cx}" y1="${cy}" x2="${nx}" y2="${ny}" stroke="${color}" stroke-width="3"/>
    <circle cx="${cx}" cy="${cy}" r="5" fill="${color}"/>
    <text x="100" y="84" text-anchor="middle" fill="${color}" font-size="18" font-weight="800">${escapeHtml(regime)}</text>
    <text x="100" y="103" text-anchor="middle" fill="#7c8b94" font-size="11">평균 ${pct(avg)}</text>
  </svg>`;
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
    ${regimeGauge(avg, risk)}
    <div class="grid2" style="margin-top:4px">
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
      <input name="symbol" placeholder="BTC-USD / ETH-KRW" />
      <button>ADD</button>
    </form>
    <div class="scroll" style="margin-top:6px" id="watchlist-table">${skeletonBlock(5)}</div>
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
        <td data-live-price="${escapeHtml(q.symbol)}">${fmt(q.price)}</td><td class="${clsChange(q.changePercent)}" data-live-chg="${escapeHtml(q.symbol)}">${chgText(q.changePercent)}</td><td>${statusBadge(q.status, q.statusMessage)}</td>
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
          ${providerRow('Binance', true, '암호화폐 시세/차트. 공개 API')}
          ${providerRow('CoinGecko', true, '암호화폐 fallback. 공개 API')}
          ${providerRow('Coinbase', true, '암호화폐 fallback. 공개 API')}
          ${providerRow('Twelve Data', providers.twelveData, '시세 fallback. API 키 필요')}
        </tbody>
      </table>
      <div class="muted">공개 fallback은 실제 응답만 표시하며 값이 없으면 숫자를 채우지 않습니다.</div>
    </div>
  `;
}

function providerRow(name, configured, description) {
  return `<tr><td class="left">${escapeHtml(name)}</td><td>${statusBadge(configured ? '정상' : 'API 필요', description)}</td></tr>`;
}

// ---- Crypto Signal feed + auto-dom execution gate (observer/cockpit; no order initiation) ----
async function loadSignals() {
  try {
    const data = await api('/api/signals/recent?limit=50');
    state.signals = data.signals || [];
    state.signalsMeta = { configured: data.configured, statusMessage: data.statusMessage };
  } catch (error) {
    state.signalsMeta = { configured: false, statusMessage: error.message };
  }
}

async function loadAutodom() {
  const status = await api('/api/autodom/status').catch((e) => ({ online: false, statusMessage: e.message }));
  const dashboard = await api('/api/autodom/dashboard').catch(() => ({ online: false }));
  state.autodom = { status, dashboard };
}

function signalVerifyClass(value) {
  return value === 'VERIFIED' ? 'ok' : value === 'PROBABLE' ? 'warn' : 'err';
}

function newsTradeView(signal) {
  const fromApi = signal.newsTrade;
  if (fromApi && fromApi.label) return fromApi;
  const evidence = Array.isArray(signal.signal?.evidence_summary) ? signal.signal.evidence_summary : [];
  const reasons = [];
  if (signal.rumor) reasons.push('루머 플래그');
  if (!['VERIFIED', 'PROBABLE'].includes(signal.verificationState)) reasons.push('검증 부족');
  if (signal.confidenceScore == null || signal.confidenceScore < 0.75) reasons.push('신뢰도 부족');
  if (signal.urgencyScore == null || signal.urgencyScore < 0.55) reasons.push('긴급도 낮음');
  if (!evidence.length) reasons.push('근거 없음');
  if (signal.tradeAllowed === false) reasons.push('trade_allowed=false');
  if (!reasons.length && signal.verificationState === 'VERIFIED' && signal.confidenceScore >= 0.85 && signal.urgencyScore >= 0.70 && signal.tradeAllowed === true) {
    return { label: '프리뷰대상', className: 'ok', reasons: ['검증·신뢰·긴급도 통과'] };
  }
  if (evidence.length && !signal.rumor && ['VERIFIED', 'PROBABLE'].includes(signal.verificationState)) {
    return { label: '게이트검토', className: 'warn', reasons: reasons.length ? reasons : ['auto-dom 게이트 확인 필요'] };
  }
  if (evidence.length && !signal.rumor) return { label: '관찰', className: 'warn', reasons: reasons.length ? reasons : ['거래 조건 미충족'] };
  return { label: '거래금지', className: 'err', reasons: reasons.length ? reasons : ['거래 조건 미충족'] };
}

function selectSignal(signalId) {
  const signal = state.signals.find((s) => s.signalId === signalId);
  if (!signal) return;
  state.activeSignal = signal;
  if (signal.symbol) {
    const base = String(signal.symbol).replace(/USDT$|USD$|PERP$/i, ''); // BTCUSDT -> BTC-USD (USDT≈USD)
    if (base) { state.activeSymbol = `${base}-USD`; state.chart = null; loadChart().catch(() => {}); }
  }
  renderWorkspace();
}

function renderSignals(body) {
  const signals = state.signals || [];
  if (!signals.length) {
    body.innerHTML = `<div class="muted">${escapeHtml(state.signalsMeta?.statusMessage || 'auto-dom inbox에서 수신된 시그널이 없습니다.')}</div>`;
    if (!state.signalsLoaded) { state.signalsLoaded = true; loadSignals().then(renderWorkspace).catch(() => {}); }
    return;
  }
  body.innerHTML = `
    <div class="scroll"><table class="table"><thead><tr><th>Time</th><th>Symbol</th><th>Dir</th><th>Event</th><th>Verify</th><th>Conf</th><th>Urg</th><th>Trade</th><th>TTL</th></tr></thead><tbody>
      ${signals.map((s) => {
        const trade = newsTradeView(s);
        return `<tr class="signal-row ${isImportantSignal(s) ? 'signal-important' : ''} ${state.activeSignal?.signalId === s.signalId ? 'signal-active' : ''}" data-signal-id="${escapeHtml(s.signalId || '')}" title="${escapeHtml(trade.reasons.join(', '))}">
        <td class="left">${escapeHtml(String(s.receivedAt || '').slice(11, 19))}</td>
        <td class="left">${isImportantSignal(s) ? '★ ' : ''}${escapeHtml(s.symbol || '')}</td>
        <td class="${s.direction === 'LONG' ? 'up' : s.direction === 'SHORT' ? 'down' : 'flat'}">${s.direction === 'LONG' ? '▲ LONG' : s.direction === 'SHORT' ? '▼ SHORT' : escapeHtml(s.direction || '')}</td>
        <td class="left">${escapeHtml((s.eventType || '').replace(/_/g, ' '))}</td>
        <td><span class="badge ${signalVerifyClass(s.verificationState)}">${escapeHtml(s.verificationState || '?')}${s.rumor ? ' · rumor' : ''}</span></td>
        <td>${s.confidenceScore != null ? s.confidenceScore.toFixed(2) : '-'}</td>
        <td>${s.urgencyScore != null ? s.urgencyScore.toFixed(2) : '-'}</td>
        <td><span class="badge ${trade.className}">${escapeHtml(trade.label)}</span></td>
        <td>${s.ttlSec != null ? s.ttlSec + 's' : '-'}</td>
      </tr>`; }).join('')}
    </tbody></table></div>
    <div class="muted" style="margin-top:6px">뉴스매매 판정: 프리뷰대상=검증·신뢰·긴급도 통과 후 auto-dom preview 가능. 터미널은 주문을 개시하지 않습니다.</div>`;
  $$('.signal-row', body).forEach((row) => row.addEventListener('click', () => selectSignal(row.dataset.signalId)));
}

function decisionBadge(decision) {
  const cls = decision === 'approved' ? 'ok' : decision === 'rejected' ? 'err' : 'warn';
  const text = decision === 'approved' ? '승인' : decision === 'rejected' ? '거절' : decision;
  return `<span class="badge ${cls}">${escapeHtml(text)}</span>`;
}

function renderExecutionGate(body) {
  if (!state.autodom) {
    body.innerHTML = '<div class="muted">auto-dom 상태 로딩 중...</div>';
    loadAutodom().then(renderWorkspace).catch(() => {});
    return;
  }
  const status = state.autodom.status || {};
  const st = status.status || {};
  const health = status.health || {};
  const snap = state.autodom.dashboard?.snapshot || {};
  const runtime = snap.runtime || {};
  const caps = snap.risk_caps || {};
  const env = snap.env_readiness || {};
  const online = status.online;
  const mode = st.mode || health.mode || runtime.mode || '?';
  const modeClass = !online ? 'err' : mode === 'live' ? 'err' : (mode === 'ingest_only' || mode === 'paper') ? 'ok' : 'warn';
  const killActive = st.kill_switch_active ?? runtime.kill_switch_active;
  const dailyStop = st.daily_stop_active ?? runtime.daily_stop_active;
  const liveEnabled = st.live_enabled ?? runtime.live_enabled;
  body.innerHTML = `
    <div class="gate-mode ${modeClass}">${online ? `MODE · ${escapeHtml(String(mode).toUpperCase())}` : '브릿지 오프라인'}</div>
    ${online ? `
    <div class="grid2" style="margin-top:6px">
      <div class="metric"><div class="k">Kill-switch</div><div class="v ${killActive ? 'down' : 'up'}">${killActive ? 'ACTIVE' : 'off'}</div></div>
      <div class="metric"><div class="k">Daily-stop</div><div class="v ${dailyStop ? 'down' : 'up'}">${dailyStop ? 'LOCKED' : 'normal'}</div></div>
      <div class="metric"><div class="k">Live enabled</div><div class="v ${liveEnabled ? 'down' : 'up'}">${liveEnabled ? 'YES' : 'no'}</div></div>
      <div class="metric"><div class="k">Acc/Rej/Dup</div><div class="v">${st.accepted_count ?? 0}/${st.rejected_count ?? 0}/${st.duplicate_count ?? 0}</div></div>
    </div>
    <div class="muted" style="margin-top:6px">Binance: ${env.BINANCE_API_KEY ? '키✓' : '키✗'} / ${escapeHtml(env.BINANCE_FUTURES_ENV || '?')} · caps ${escapeHtml(JSON.stringify(caps.allowed_symbols || caps.allowedSymbols || '—'))} margin ${escapeHtml(String(caps.max_margin_pct ?? caps.margin_cap ?? '—'))}</div>
    <div class="row gap" style="margin-top:8px"><button id="gate-pause">PAUSE</button><button id="gate-resume">RESUME</button><span id="gate-action" class="muted"></span></div>
    ` : `<div class="muted" style="margin-top:6px">${escapeHtml(status.statusMessage || 'auto-dom 브릿지 실행 확인 (기본 127.0.0.1:8765, ingest_only).')}</div>`}
    <div style="border-top:1px solid var(--line); margin-top:8px; padding-top:8px"><strong>선택 시그널 + 근거</strong></div>
    ${state.activeSignal ? `
      ${(() => { const trade = newsTradeView(state.activeSignal); return `<div class="muted" style="margin-top:4px">${escapeHtml(state.activeSignal.symbol || '')} ${escapeHtml(state.activeSignal.direction || '')} · ${escapeHtml((state.activeSignal.eventType || '').replace(/_/g, ' '))} · conf ${state.activeSignal.confidenceScore ?? '-'} urg ${state.activeSignal.urgencyScore ?? '-'} · <span class="badge ${trade.className}">${escapeHtml(trade.label)}</span></div><div class="muted" style="margin-top:3px">판정 사유: ${escapeHtml(trade.reasons.join(', '))}</div>`; })()}
      <div style="margin-top:6px"><strong>근거 (수집 뉴스/출처)</strong></div>
      ${evidenceHtml(state.activeSignal.signal)}
      <button id="gate-preview" style="margin-top:6px" ${online ? '' : 'disabled title="브릿지 오프라인 — preview 불가"'}>PREVIEW (게이트 판정, 부작용 없음)</button>
      <div id="gate-preview-out" style="margin-top:6px"></div>`
      : '<div class="muted" style="margin-top:4px">SIGNALS 패널에서 시그널을 선택하면 근거가 표시됩니다.</div>'}`;
  if (online) {
    $('#gate-pause', body)?.addEventListener('click', async () => {
      const result = await api('/api/autodom/agent/actions', { method: 'POST', body: { action: 'pause_trading', reason: 'operator pause from terminal', requested_by: 'k-terminal' } }).catch((e) => ({ data: { error: e.message } }));
      $('#gate-action', body).textContent = JSON.stringify(result.data ?? result);
      state.autodom = null; renderWorkspace();
    });
    $('#gate-resume', body)?.addEventListener('click', async () => {
      if (!window.confirm('거래 재개(kill-switch 해제)합니다. 계속할까요?')) return;
      const result = await api('/api/autodom/agent/actions', { method: 'POST', body: { action: 'resume_trading', operator_approved: true, reason: 'operator resume from terminal' } }).catch((e) => ({ data: { error: e.message } }));
      $('#gate-action', body).textContent = JSON.stringify(result.data ?? result);
      state.autodom = null; renderWorkspace();
    });
  }
  $('#gate-preview', body)?.addEventListener('click', async () => {
    const out = $('#gate-preview-out', body);
    out.textContent = 'preview 중...';
    try {
      const result = await api('/api/signals/preview', { method: 'POST', body: { signal: state.activeSignal.signal } });
      const data = result.data?.data || result.data || {};
      const decision = data.risk_decision || data.decision || (data.approved === true ? 'approved' : data.approved === false ? 'rejected' : (result.ok ? 'preview' : '오류'));
      const reasons = data.reasons || data.rejection_reasons || data.risk?.reasons || [];
      out.innerHTML = `${decisionBadge(decision)} <span class="muted">${escapeHtml((reasons || []).join(', '))}</span><pre class="muted" style="white-space:pre-wrap; max-height:160px; overflow:auto; margin-top:4px">${escapeHtml(JSON.stringify(data, null, 2).slice(0, 1500))}</pre>`;
    } catch (error) {
      out.innerHTML = `${decisionBadge('오류')} ${escapeHtml(error.message)}`;
    }
  });
}

const CRITICAL_EVENTS = new Set(['protocol_critical_exploit', 'bridge_exploit', 'exchange_delisting_or_systemic_exchange_failure', 'war_level_global_macro_shock', 'major_regulatory_action']);

function isImportantSignal(s) {
  return (s.urgencyScore != null && s.urgencyScore >= 0.7) || (s.confidenceScore != null && s.confidenceScore >= 0.85) || s.verificationState === 'VERIFIED' || CRITICAL_EVENTS.has(s.eventType);
}

function firstEvidence(signal) {
  const evidence = Array.isArray(signal?.signal?.evidence_summary) ? signal.signal.evidence_summary : [];
  return evidence.find((item) => item?.summary || item?.url || item?.source_label) || null;
}

function cleanNewsHeadline(summary = '') {
  let text = String(summary || '')
    .replace(/\s*\|\s*published=.*$/i, '')
    .replace(/^article\s+/i, '')
    .replace(/^"|"$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  text = text.replace(/^(.{8,160}?)\s+\|\s+.*/u, '$1');
  return text || '중요 뉴스 근거 확인 필요';
}

function inferredCoinFromEvidence(signal) {
  const text = `${signal?.symbol || ''} ${(firstEvidence(signal)?.summary || '')}`.toLowerCase();
  const pairs = [
    ['ZEC', /(?:\b|\$|#)(zcash|zec)(?:\b)/i],
    ['BTC', /(?:\b|\$|#)(bitcoin|btc)(?:\b)/i],
    ['ETH', /(?:\b|\$|#)(ethereum|eth)(?:\b)/i],
    ['SOL', /(?:\b|\$|#)(solana|sol)(?:\b)/i],
    ['ADA', /(?:\b|\$|#)(cardano|ada)(?:\b)/i],
    ['LINK', /(?:\b|\$|#)(chainlink|link)(?:\b)/i]
  ];
  const found = pairs.find(([, pattern]) => pattern.test(text));
  return found?.[0] || String(signal?.symbol || '').replace(/USDT$|USD$|PERP$/i, '') || 'COIN';
}

function coinPickLabel(signal) {
  const base = inferredCoinFromEvidence(signal);
  const direction = signal.direction === 'SHORT' ? 'SHORT 후보' : signal.direction === 'LONG' ? 'LONG 후보' : '관찰 후보';
  return `${base || 'COIN'} · ${direction}`;
}

function recommendationScore(signal) {
  const trade = newsTradeView(signal);
  const statusWeight = trade.status === 'PREVIEW_READY' ? 80 : trade.status === 'GATE_REVIEW' ? 60 : trade.status === 'WATCH' ? 35 : 10;
  const criticalWeight = CRITICAL_EVENTS.has(signal.eventType) ? 15 : 0;
  const verifyWeight = signal.verificationState === 'VERIFIED' ? 15 : signal.verificationState === 'PROBABLE' ? 8 : 0;
  const rumorPenalty = signal.rumor ? 30 : 0;
  return statusWeight + criticalWeight + verifyWeight + Number(signal.urgencyScore || 0) * 10 + Number(signal.confidenceScore || 0) * 10 - rumorPenalty;
}

function topNewsRecommendations(limit = 3) {
  return (state.signals || [])
    .filter((signal) => signal?.symbol && firstEvidence(signal))
    .map((signal) => ({ signal, score: recommendationScore(signal) }))
    .sort((a, b) => b.score - a.score || String(b.signal.receivedAt || '').localeCompare(String(a.signal.receivedAt || '')))
    .slice(0, limit)
    .map((item) => item.signal);
}

function renderNewsRecommendations(body) {
  if (!state.signals?.length) {
    body.innerHTML = `<div class="muted">중요뉴스 추천 로딩 중...</div>`;
    if (!state.signalsLoaded) { state.signalsLoaded = true; loadSignals().then(renderWorkspace).catch(() => {}); }
    return;
  }
  const picks = topNewsRecommendations(3);
  if (!picks.length) {
    body.innerHTML = `<div class="muted">추천할 중요 뉴스/코인 후보가 없습니다. 검증된 뉴스 시그널이 들어오면 여기에 3개까지 표시됩니다.</div>`;
    return;
  }
  body.innerHTML = `<div class="news-picks">
    ${picks.map((signal, index) => {
      const evidence = firstEvidence(signal) || {};
      const trade = newsTradeView(signal);
      const active = state.activeSignal?.signalId === signal.signalId ? ' active' : '';
      return `<button class="news-pick${active}" data-signal-id="${escapeHtml(signal.signalId || '')}">
        <div class="news-pick-top"><span class="badge">#${index + 1}</span><span class="badge ${trade.className}">${escapeHtml(trade.label)}</span><span class="muted">${escapeHtml(String(signal.receivedAt || '').replace('T', ' ').slice(5, 16))}</span></div>
        <div class="news-pick-title">${escapeHtml(cleanNewsHeadline(evidence.summary))}</div>
        <div class="news-pick-coin"><strong>${escapeHtml(coinPickLabel(signal))}</strong><span class="${signal.direction === 'LONG' ? 'up' : signal.direction === 'SHORT' ? 'down' : 'flat'}">${signal.direction === 'LONG' ? '▲' : signal.direction === 'SHORT' ? '▼' : '·'} ${escapeHtml(signal.direction || 'WATCH')}</span></div>
        <div class="news-pick-meta">${escapeHtml((signal.eventType || '').replace(/_/g, ' '))} · conf ${signal.confidenceScore ?? '-'} · urg ${signal.urgencyScore ?? '-'} · ${escapeHtml(evidence.source_label || 'source')}</div>
        <div class="news-pick-reason">${escapeHtml((trade.reasons || []).slice(0, 2).join(', '))}</div>
      </button>`;
    }).join('')}
  </div>
  <div class="muted" style="margin-top:6px">차트 대신 최신 중요뉴스 → 코인 후보를 표시합니다. 클릭하면 게이트 패널에 근거가 열립니다.</div>`;
  $$('.news-pick', body).forEach((button) => button.addEventListener('click', () => selectSignal(button.dataset.signalId)));
}

// Renders a signal's collected-news evidence + risk notes — the rationale behind it.
function evidenceHtml(signal) {
  if (!signal) return '<div class="muted">근거 데이터 없음 (시그널 미연결)</div>';
  const evidence = signal.evidence_summary || [];
  const notes = signal.risk_notes || [];
  return `<div class="evidence">
    ${evidence.map((e) => `<div class="evidence-item">
      <div><span class="badge">${escapeHtml(e.source_type || '')}</span> <strong>${escapeHtml(e.source_label || '')}</strong></div>
      <div class="muted">${escapeHtml(e.summary || '')}</div>
      ${e.url ? extLink(e.url, '출처 →') : ''}
    </div>`).join('') || '<div class="muted">근거 항목 없음</div>'}
    ${notes.length ? `<div class="muted" style="margin-top:4px">⚠ risk: ${escapeHtml(notes.join(', '))}</div>` : ''}
  </div>`;
}

function renderPositions(body) {
  body.innerHTML = `<div id="positions-body">${skeletonBlock(4)}</div>`;
  api('/api/signals/executions?limit=40').then((data) => {
    const host = $('#positions-body', body);
    if (!data.configured) { host.innerHTML = '<div class="muted">AUTO_DOM_LIVE_AUDIT_PATH / AUTO_DOM_AUDIT_ROOT 미설정</div>'; return; }
    const executions = data.executions || [];
    if (!executions.length) { host.innerHTML = '<div class="muted">체결/실행 기록 없음</div>'; return; }
    host.innerHTML = executions.map((e, index) => {
      const signal = e.signal || state.signals.find((s) => s.signalId === e.signalId)?.signal || null;
      const decClass = (e.decision === 'sent' || e.decision === 'approved') ? 'up' : e.decision === 'rejected' ? 'down' : 'flat';
      const decLabel = e.decision === 'ingested' ? '수신 (주문없음)' : (e.decision || '?'); // ingest_only: stored, not executed
      return `<div class="position-item">
        <div class="row" style="justify-content:space-between">
          <span><strong>${escapeHtml(e.symbol || '?')}</strong> ${e.direction ? `<span class="${e.direction === 'LONG' ? 'up' : 'down'}">${escapeHtml(e.direction)}</span>` : ''}</span>
          <span class="${decClass}">${escapeHtml(decLabel)} <span class="badge">${escapeHtml(e.source)}</span></span>
        </div>
        <div class="muted">${escapeHtml(String(e.time || '').replace('T', ' ').slice(0, 19))}${e.reasons?.length ? ' · ' + escapeHtml(e.reasons.join(', ')) : ''}</div>
        <button class="pos-evidence-toggle" data-index="${index}">근거 보기 ▾</button>
        <div class="pos-evidence" data-index="${index}" style="display:none; margin-top:4px">${evidenceHtml(signal)}</div>
      </div>`;
    }).join('');
    $$('.pos-evidence-toggle', body).forEach((button) => button.addEventListener('click', () => {
      const panel = $$('.pos-evidence', body).find((el) => el.dataset.index === button.dataset.index);
      if (panel) { const shown = panel.style.display !== 'none'; panel.style.display = shown ? 'none' : ''; button.textContent = shown ? '근거 보기 ▾' : '근거 숨기기 ▴'; }
    }));
  }).catch((error) => { $('#positions-body', body).textContent = `데이터 없음: ${error.message}`; });
}

function renderChartWidget(body, widgetId, options = {}) {
  body.innerHTML = `
    <div class="chart-wrap ${options.big ? 'big-chart' : ''}">
      <div class="chart-controls">
        <input id="chart-symbol" value="${escapeHtml(state.activeSymbol)}" aria-label="차트 심볼" />
        <select id="chart-range" aria-label="기간">${['1M', '3M', '6M', '1Y', '2Y', '5Y', '10Y'].map((r) => `<option ${state.range === r ? 'selected' : ''}>${r}</option>`).join('')}</select>
        <select id="chart-interval" aria-label="인터벌">${['1D', '1W', '1M'].map((r) => `<option ${state.interval === r ? 'selected' : ''}>${r}</option>`).join('')}</select>
        <input id="chart-compare" value="${escapeHtml((state.compareSymbols || []).join(','))}" placeholder="비교: ETH-USD,SOL-USD" aria-label="비교 심볼" style="width:130px" />
        <button id="chart-load">LOAD</button>
        <span>${state.chart ? statusBadge(state.chart.status, state.chart.statusMessage) : statusBadge('데이터 없음')}</span>
        <span class="muted">${escapeHtml(state.chart?.source || '데이터 로드 전')}</span>
        <span class="muted" id="chart-readout"></span>
      </div>
      <svg class="chart-svg" id="price-chart" role="img" aria-label="가격 차트"></svg>
      <svg class="indicator-svg" id="rsi-chart" role="img" aria-label="RSI"></svg>
      <svg class="indicator-svg" id="macd-chart" role="img" aria-label="MACD"></svg>
    </div>
  `;
  const load = async () => {
    state.activeSymbol = $('#chart-symbol', body).value.trim().toUpperCase() || 'BTC-USD';
    state.range = $('#chart-range', body).value;
    state.interval = $('#chart-interval', body).value;
    state.compareSymbols = $('#chart-compare', body).value.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean).slice(0, 4);
    await loadChart();
    await loadCompare();
    renderWorkspace();
  };
  $('#chart-load', body).addEventListener('click', load);
  $('#chart-symbol', body).addEventListener('keydown', (event) => { if (event.key === 'Enter') load(); });
  $('#chart-compare', body).addEventListener('keydown', (event) => { if (event.key === 'Enter') load(); });
  if (!state.chart || state.chart.symbol !== state.activeSymbol || state.chart.range !== state.range || state.chart.interval !== state.interval) {
    loadChart().then(loadCompare).then(renderWorkspace).catch((error) => { $('#price-chart', body).outerHTML = `<div class="badge err">${escapeHtml(error.message)}</div>`; });
    return;
  }
  const readout = $('#chart-readout', body);
  if (state.compareSymbols?.length) drawComparison($('#price-chart', body), state.chart.candles || [], readout);
  else drawPriceChart($('#price-chart', body), state.chart.candles || [], readout);
  drawRsi($('#rsi-chart', body), state.chart.candles || []);
  drawMacd($('#macd-chart', body), state.chart.candles || []);
}

async function loadCompare() {
  const symbols = state.compareSymbols || [];
  if (!symbols.length) { state.compareSeries = []; return; }
  const results = await Promise.allSettled(symbols.map((symbol) => api(`/api/market/chart?symbol=${encodeURIComponent(symbol)}&range=${encodeURIComponent(state.range)}&interval=${encodeURIComponent(state.interval)}`)));
  state.compareSeries = results
    .map((result, index) => ({ symbol: symbols[index], candles: result.status === 'fulfilled' ? (result.value.candles || []) : [] }))
    .filter((series) => series.candles.length);
}

function valuesForScale(candles) {
  const highs = candles.map((d) => Number(d.high)).filter(Number.isFinite);
  const lows = candles.map((d) => Number(d.low)).filter(Number.isFinite);
  return { min: Math.min(...lows), max: Math.max(...highs) };
}

// Shared chart geometry. The right gutter (CHART_W - CHART_PLOT_R) reserves room for the
// value-axis labels so they stay inside the fixed-width viewBox and never clip at the right edge;
// every sub-chart uses the same [CHART_PLOT_L, CHART_PLOT_R] x-range so their time axes line up.
const CHART_W = 920;
const CHART_PLOT_L = 38;
const CHART_PLOT_R = 862;

function drawPriceChart(svg, candles, readout, viewH = 330) {
  const width = CHART_W;
  const height = Math.max(200, Math.round(viewH));
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
  const volH = Math.round(height * 0.16);
  const plotTop = 15;
  const plotBottom = height - volH - 14;
  const volumeTop = plotBottom + 8;
  const x = (i) => CHART_PLOT_L + (i / Math.max(1, candles.length - 1)) * (CHART_PLOT_R - CHART_PLOT_L);
  const y = (value) => plotBottom - ((value - yMin) / (yMax - yMin)) * (plotBottom - plotTop);
  const candleWidth = Math.max(2, Math.min(10, (CHART_PLOT_R - CHART_PLOT_L) / candles.length * 0.62));
  const grid = [0, .25, .5, .75, 1].map((p) => {
    const gy = plotTop + p * (plotBottom - plotTop);
    const value = yMax - p * (yMax - yMin);
    return `<line x1="${CHART_PLOT_L - 3}" x2="${CHART_PLOT_R}" y1="${gy}" y2="${gy}" stroke="#16222a"/><text x="${CHART_W - 6}" y="${gy + 4}" text-anchor="end" fill="#7c8b94" font-size="10">${fmt(value)}</text>`;
  }).join('');
  const volumeBars = candles.map((d, i) => {
    const h = ((Number(d.volume) || 0) / volMax) * volH;
    const cls = Number(d.close) >= Number(d.open) ? 'up-fill' : 'down-fill';
    return `<rect class="${cls}" x="${x(i) - candleWidth / 2}" y="${volumeTop + volH - h}" width="${candleWidth}" height="${h}" opacity="0.35"/>`;
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
    <line id="ch-line" x1="0" x2="0" y1="${plotTop}" y2="${plotBottom}" stroke="#5b6b76" stroke-dasharray="3 3" style="display:none"/>
    <text x="${CHART_PLOT_L}" y="12" fill="#dbe6ec" font-size="11">${escapeHtml(state.chart.symbol)} ${escapeHtml(state.chart.range)} ${escapeHtml(state.chart.interval)} | MA20/MA50/Bollinger/Volume</text>
  `;
  const crosshair = svg.querySelector('#ch-line');
  svg.onmousemove = (event) => {
    const rect = svg.getBoundingClientRect();
    if (!rect.width || !candles.length) return;
    const xv = ((event.clientX - rect.left) / rect.width) * width;
    const i = Math.max(0, Math.min(candles.length - 1, Math.round(((xv - CHART_PLOT_L) / (CHART_PLOT_R - CHART_PLOT_L)) * (candles.length - 1))));
    const bar = candles[i];
    crosshair.setAttribute('x1', x(i));
    crosshair.setAttribute('x2', x(i));
    crosshair.style.display = '';
    if (readout) readout.textContent = `${String(bar.time).slice(0, 10)} O ${fmt(bar.open)} H ${fmt(bar.high)} L ${fmt(bar.low)} C ${fmt(bar.close)} V ${fmt(bar.volume, 0)}`;
  };
  svg.onmouseleave = () => { crosshair.style.display = 'none'; if (readout) readout.textContent = ''; };
}

function drawComparison(svg, mainCandles, readout, viewH = 330) {
  const width = CHART_W;
  const height = Math.max(200, Math.round(viewH));
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  const series = [{ symbol: state.chart.symbol, candles: mainCandles }, ...(state.compareSeries || [])]
    .map((s) => ({ symbol: s.symbol, closes: s.candles.map((c) => Number(c.close)).filter(Number.isFinite) }))
    .filter((s) => s.closes.length > 1);
  if (!series.length) { svg.innerHTML = '<text x="20" y="40" fill="#7c8b94">비교 데이터 없음</text>'; return; }
  const colors = ['#dbe6ec', '#4da3ff', '#f4b84a', '#28d17c', '#f05b65'];
  const normalized = series.map((s) => ({ symbol: s.symbol, pct: s.closes.map((c) => (c / s.closes[0] - 1) * 100) }));
  const maxLen = Math.max(...normalized.map((n) => n.pct.length));
  const all = normalized.flatMap((n) => n.pct);
  const min = Math.min(...all);
  const max = Math.max(...all);
  const pad = (max - min) * 0.08 || 1;
  const yMin = min - pad;
  const yMax = max + pad;
  const plotTop = 20;
  const plotBottom = height - 30;
  const x = (i) => CHART_PLOT_L + (i / Math.max(1, maxLen - 1)) * (CHART_PLOT_R - CHART_PLOT_L);
  const y = (value) => plotBottom - ((value - yMin) / (yMax - yMin)) * (plotBottom - plotTop);
  const grid = [0, .25, .5, .75, 1].map((p) => {
    const gy = plotTop + p * (plotBottom - plotTop);
    const value = yMax - p * (yMax - yMin);
    return `<line x1="${CHART_PLOT_L - 3}" x2="${CHART_PLOT_R}" y1="${gy}" y2="${gy}" stroke="#16222a"/><text x="${CHART_W - 6}" y="${gy + 4}" text-anchor="end" fill="#7c8b94" font-size="10">${value.toFixed(1)}%</text>`;
  }).join('');
  const zero = `<line x1="${CHART_PLOT_L - 3}" x2="${CHART_PLOT_R}" y1="${y(0)}" y2="${y(0)}" stroke="#33434e" stroke-dasharray="3 3"/>`;
  const paths = normalized.map((n, idx) => `<path d="${n.pct.map((value, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(value)}`).join(' ')}" fill="none" stroke="${colors[idx % colors.length]}" stroke-width="1.3"/>`).join('');
  const legend = normalized.map((n, idx) => {
    const last = n.pct.at(-1);
    return `<text x="44" y="${14 + idx * 14}" fill="${colors[idx % colors.length]}" font-size="11">${escapeHtml(n.symbol)} ${last >= 0 ? '▲ +' : '▼ '}${last.toFixed(1)}%</text>`;
  }).join('');
  svg.innerHTML = `${grid}${zero}${paths}${legend}<text x="690" y="12" fill="#7c8b94" font-size="10">정규화 비교 (시작점 대비 %)</text>`;
  if (readout) readout.textContent = '정규화 비교 모드';
}

// Redraw the price chart to match its real on-screen height so it fills the widget without
// letterboxing (the SVG viewBox is fixed-width 920; height is derived from the live aspect).
function fitPriceChart() {
  const svg = $('#price-chart');
  if (!svg || !state.chart) return;
  const rect = svg.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const viewH = Math.round((rect.height * 920) / rect.width);
  const readout = $('#chart-readout');
  if (state.compareSymbols?.length) drawComparison(svg, state.chart.candles || [], readout, viewH);
  else drawPriceChart(svg, state.chart.candles || [], readout, viewH);
}

function drawRsi(svg, candles) {
  const width = CHART_W, height = 70;
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  const closes = candles.map((d) => Number(d.close));
  const values = rsi(closes, 14);
  const x = (i) => CHART_PLOT_L + (i / Math.max(1, values.length - 1)) * (CHART_PLOT_R - CHART_PLOT_L);
  const y = (value) => 62 - (value / 100) * 54;
  const path = values.map((value, i) => Number.isFinite(value) ? `${i === 0 || !Number.isFinite(values[i - 1]) ? 'M' : 'L'}${x(i)},${y(value)}` : '').join(' ');
  svg.innerHTML = `<line x1="${CHART_PLOT_L - 3}" x2="${CHART_PLOT_R}" y1="${y(70)}" y2="${y(70)}" stroke="#33434e"/><line x1="${CHART_PLOT_L - 3}" x2="${CHART_PLOT_R}" y1="${y(30)}" y2="${y(30)}" stroke="#33434e"/><path d="${path}" fill="none" stroke="#f4b84a" stroke-width="1.2"/><text x="${CHART_PLOT_L}" y="12" fill="#7c8b94" font-size="10">RSI(14)</text>`;
}

function drawMacd(svg, candles) {
  const width = CHART_W, height = 70;
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  const closes = candles.map((d) => Number(d.close));
  const set = macd(closes);
  const all = [...set.macd, ...set.signal, ...set.histogram].filter(Number.isFinite);
  const maxAbs = Math.max(...all.map((v) => Math.abs(v)), 1);
  const x = (i) => CHART_PLOT_L + (i / Math.max(1, closes.length - 1)) * (CHART_PLOT_R - CHART_PLOT_L);
  const y = (value) => height / 2 - (value / maxAbs) * 25;
  const path = (series) => series.map((value, i) => Number.isFinite(value) ? `${i === 0 || !Number.isFinite(series[i - 1]) ? 'M' : 'L'}${x(i)},${y(value)}` : '').join(' ');
  const bars = set.histogram.map((value, i) => Number.isFinite(value) ? `<rect x="${x(i) - 2}" y="${Math.min(y(0), y(value))}" width="3" height="${Math.max(1, Math.abs(y(value) - y(0)))}" fill="${value >= 0 ? '#28d17c' : '#f05b65'}" opacity=".55"/>` : '').join('');
  svg.innerHTML = `<line x1="${CHART_PLOT_L - 3}" x2="${CHART_PLOT_R}" y1="${y(0)}" y2="${y(0)}" stroke="#33434e"/>${bars}<path d="${path(set.macd)}" fill="none" stroke="#4da3ff" stroke-width="1.2"/><path d="${path(set.signal)}" fill="none" stroke="#f4b84a" stroke-width="1.2"/><text x="${CHART_PLOT_L}" y="12" fill="#7c8b94" font-size="10">MACD(12,26,9)</text>`;
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
      ${alerts.map((alert) => `<tr>
        <td class="left">${escapeHtml(alert.symbol)}</td>
        <td>${escapeHtml(alertCondLabel(alert))}</td>
        <td>${alert.enabled ? (alert.triggeredAt ? statusBadge('발동', alert.triggeredAt) : statusBadge('대기')) : statusBadge('중지')}</td>
        <td><button data-id="${escapeHtml(alert.id)}" class="alert-toggle">${alert.enabled ? 'OFF' : 'ON'}</button> <button data-id="${escapeHtml(alert.id)}" class="alert-del">DEL</button></td>
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
    const alert = list.find((item) => item.id === button.dataset.id);
    if (alert) { alert.enabled = !alert.enabled; alert.snoozedUntil = 0; alert.triggeredAt = alert.enabled ? null : alert.triggeredAt; await saveAlerts(list); renderWorkspace(); }
  }));
  $$('.alert-del', body).forEach((button) => button.addEventListener('click', async () => {
    await saveAlerts(currentAlerts().filter((item) => item.id !== button.dataset.id));
    renderWorkspace();
  }));
}

function renderSettings(body) {
  const providers = ['finnhub', 'twelvedata'];
  // Rendered into the header settings dialog (a method="dialog" form), so every button is
  // type="button" — a default submit button would close the dialog on click. API-key rows are
  // plain divs (not nested <form>s, which are invalid inside the dialog form).
  body.innerHTML = `
    <div class="stack">
      <div>${state.user ? `로그인: ${escapeHtml(state.user.email)}` : statusBadge('로그인 필요')}</div>
      <label>기본 종목<input id="default-symbol" value="${escapeHtml(state.user?.settings?.defaultSymbol || state.activeSymbol)}"></label>
      <button id="save-default" type="button" ${state.user ? '' : 'disabled'}>SAVE DEFAULT</button>
      <div class="muted">API 키는 서버 파일 DB에 AES-GCM으로 암호화 저장됩니다. 운영 서버에서는 SECRET_KEY를 강한 난수로 고정하고 백업/권한 관리를 분리하십시오.</div>
      ${providers.map((p) => `<div class="row gap api-key-form" data-provider="${p}"><input type="password" autocomplete="off" placeholder="${p.toUpperCase()} API KEY"/><button type="button" class="save-key" ${state.user ? '' : 'disabled'}>SAVE</button><button type="button" class="delete-key" ${state.user ? '' : 'disabled'}>DEL</button><span>${statusBadge(state.user?.apiKeyProviders?.[p] ? '정상' : 'API 필요')}</span></div>`).join('')}
      <button id="reset-layout" type="button">RESET LAYOUT</button>
      <button id="save-layout" type="button" ${state.user ? '' : 'disabled'}>SAVE LAYOUT TO ACCOUNT</button>
    </div>`;
  $('#save-default', body).addEventListener('click', async () => {
    const defaultSymbol = $('#default-symbol', body).value.trim().toUpperCase();
    const result = await api('/api/settings', { method: 'PUT', body: { defaultSymbol } });
    state.user = result.user; state.activeSymbol = defaultSymbol; renderWorkspace();
  });
  $$('.api-key-form', body).forEach((row) => {
    const provider = row.dataset.provider;
    const input = $('input', row);
    const save = async () => {
      const value = input.value.trim();
      if (!value) return;
      const result = await api('/api/settings/api-key', { method: 'PUT', body: { provider, value } });
      state.user = result.user; await loadMeta(); renderWorkspace(); renderSettings(body); // refresh modal badges
    };
    $('.save-key', row).addEventListener('click', save);
    input.addEventListener('keydown', (event) => { if (event.key === 'Enter') save(); });
    $('.delete-key', row).addEventListener('click', async () => {
      const result = await api(`/api/settings/api-key?provider=${encodeURIComponent(provider)}`, { method: 'DELETE' });
      state.user = result.user; await loadMeta(); renderWorkspace(); renderSettings(body); // refresh modal badges
    });
  });
  $('#reset-layout', body).addEventListener('click', () => { state.layout = {}; localStorage.removeItem('kt.layout'); renderWorkspace(); });
  $('#save-layout', body).addEventListener('click', saveLayout);
}

async function selectSymbol(symbol) {
  state.activeSymbol = symbol;
  state.chart = null;
  localStorage.setItem('kt.activeSymbol', symbol);
  state.activeTab = 'chart';
  updateTabs();
  renderWorkspace();
  setTimeout(() => loadChart().then(renderWorkspace).catch(() => {}), 0);
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
}

function backgroundLoadForTab(tab) {
  if (tab === 'chart') loadChart().then(renderWorkspace).catch(() => {});
}

function installKeyboard() {
  document.addEventListener('keydown', (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target;
    const tag = (target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable) return;
    if (event.key === '?') { event.preventDefault(); const dialog = $('#help-dialog'); if (dialog.open) dialog.close(); else dialog.showModal(); }
    else if (event.key === 'r' || event.key === 'R') { loadSnapshot().then(renderWorkspace).catch(() => {}); backgroundLoadForTab(state.activeTab); }
    else if (/^[1-9]$/.test(event.key)) { const button = $$('#subtabs button')[Number(event.key) - 1]; if (button) button.click(); }
  });
}

function installSettings() {
  $('#settings-open')?.addEventListener('click', () => {
    renderSettings($('#settings-dialog-body')); // settings is config, not dashboard data → header modal
    $('#settings-dialog').showModal();
  });
}

function installAuth() {
  $('#login-open').addEventListener('click', () => $('#login-dialog').showModal());
  $('#login-submit').addEventListener('click', async () => authSubmit('/api/auth/login'));
  $('#register-submit').addEventListener('click', async () => authSubmit('/api/auth/register'));
  $('#logout-submit').addEventListener('click', async () => {
    await api('/api/auth/logout', { method: 'POST' });
    state.user = null; await loadMeta(); renderWorkspace(); $('#auth-message').textContent = '로그아웃 완료';
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
  // Resizing a side panel changes the chart's width, so re-fit the chart to the new size (the
  // viewBox aspect is derived from the live container) — otherwise it letterboxes/squishes and
  // the price axis shrinks. rAF-throttled so a drag triggers at most one redraw per frame.
  let fitRaf = 0;
  const scheduleChartFit = () => { if (fitRaf) return; fitRaf = requestAnimationFrame(() => { fitRaf = 0; fitPriceChart(); }); };
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
    scheduleChartFit();
  });
  window.addEventListener('pointerup', () => { if (active) { saveLayout(); fitPriceChart(); } active = null; });
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
  installTabs(); installAuth(); installSettings(); installSplitters(); installKeyboard();
  let chartResizeTimer;
  window.addEventListener('resize', () => { clearTimeout(chartResizeTimer); chartResizeTimer = setTimeout(fitPriceChart, 150); });
  renderWorkspace();
  try {
    await loadMeta();
    renderWorkspace();
    await loadSnapshot();
    renderWorkspace();
    setTimeout(() => Promise.allSettled([loadWatchlistQuotes(), loadChart()]).then(renderWorkspace), 50);
    startStream();
    // Fallback polling only kicks in when the live SSE stream is not connected.
    setInterval(() => { if (state.streamState !== 'LIVE') loadSnapshot().then(renderWorkspace).catch(() => {}); }, 60_000);
  } catch (error) {
    setStatus(`초기화 오류: ${error.message}`);
  }
}

init();
