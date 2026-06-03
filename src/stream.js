import { getSnapshot, MARKET_UNIVERSE } from './marketData.js';

const HEARTBEAT_MS = 15000;
const DEFAULT_INTERVAL_MS = 5000;
const MAX_SYMBOLS = 120;
const MAX_CLIENTS = 500; // global cap so one process can't be exhausted by open streams
const MAX_PER_IP = 5;

// Multiplexed Server-Sent Events quote stream. A single shared poller fetches the union of
// the market universe and every connected client's requested symbols (via the cached
// getSnapshot, so it collapses to one upstream fetch) and broadcasts to all subscribers.
export function createQuoteStream({ intervalMs = DEFAULT_INTERVAL_MS, fetchSnapshot = getSnapshot } = {}) {
  const clients = new Set();
  let poller = null;
  let eventId = 0;

  function unionSymbols() {
    const set = new Set(MARKET_UNIVERSE.map((item) => item.symbol));
    for (const client of clients) for (const symbol of client.symbols) set.add(symbol);
    return [...set].slice(0, MAX_SYMBOLS);
  }

  function broadcast(event, payload) {
    const frame = `id: ${++eventId}\nevent: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
    for (const client of [...clients]) {
      try { client.res.write(frame); } catch { removeClient(client); }
    }
  }

  async function pollOnce() {
    if (!clients.size) return;
    let snapshot;
    try {
      snapshot = await fetchSnapshot(unionSymbols(), {});
    } catch {
      return; // transient upstream failure; the next tick retries
    }
    broadcast('snapshot', snapshot);
  }

  function ensurePoller() {
    if (poller || !clients.size) return;
    poller = setInterval(() => { pollOnce().catch(() => {}); }, intervalMs);
    if (poller.unref) poller.unref();
    pollOnce().catch(() => {}); // push an immediate first frame on first connect
  }

  function removeClient(client) {
    if (!clients.has(client)) return;
    clearInterval(client.heartbeat);
    clients.delete(client);
    try { client.res.end(); } catch { /* already closed */ }
    if (poller && !clients.size) { clearInterval(poller); poller = null; }
  }

  function addClient(req, res, symbols = [], ip = 'unknown') {
    if (clients.size >= MAX_CLIENTS) { res.writeHead(503).end(); return; }
    let perIp = 0;
    for (const existing of clients) if (existing.ip === ip) perIp += 1;
    if (perIp >= MAX_PER_IP) { res.writeHead(429).end(); return; }
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    res.write('retry: 3000\n\n');
    const client = { res, ip, symbols: new Set(symbols.filter(Boolean).slice(0, MAX_SYMBOLS)) };
    client.heartbeat = setInterval(() => {
      try { res.write(': hb\n\n'); } catch { removeClient(client); }
    }, HEARTBEAT_MS);
    if (client.heartbeat.unref) client.heartbeat.unref();
    clients.add(client);
    req.on('close', () => removeClient(client));
    res.on('error', () => removeClient(client));
    ensurePoller();
  }

  function closeAll() {
    if (poller) { clearInterval(poller); poller = null; }
    for (const client of [...clients]) removeClient(client);
  }

  return {
    addClient,
    closeAll,
    pollOnce,
    get clientCount() { return clients.size; }
  };
}
