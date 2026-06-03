// Dependency-free in-memory cache with TTL, stale-while-revalidate, and single-flight
// de-duplication. The single-flight behavior is the key win for this app: when N parallel
// snapshot requests ask for the same symbol, exactly one upstream fetch runs and all N
// callers await it.
//
// Cached values are treated as READ-ONLY by convention — callers that mutate a result must
// clone it first (see news.js), otherwise the mutation corrupts later cache hits.
export function createCache({ ttlMs, staleMs = 0, now = () => Date.now(), maxEntries = 5000 } = {}) {
  const store = new Map(); // key -> { value, expires, staleUntil }
  const inflight = new Map(); // key -> Promise (in-flight fetch)

  const ttlOf = (value) => (typeof ttlMs === 'function' ? ttlMs(value) : ttlMs);
  const staleOf = (value) => (typeof staleMs === 'function' ? staleMs(value) : staleMs);

  function revalidate(key, fetcher) {
    const existing = inflight.get(key);
    if (existing) return existing; // single-flight: share the in-progress fetch

    const promise = (async () => {
      const value = await fetcher();
      const ts = now();
      const ttl = ttlOf(value);
      store.set(key, { value, expires: ts + ttl, staleUntil: ts + ttl + staleOf(value) });
      if (store.size > maxEntries) {
        const oldest = store.keys().next().value;
        if (oldest !== undefined) store.delete(oldest);
      }
      return value;
    })();

    // Always clear the in-flight entry; handling both outcomes also prevents an
    // unhandled rejection on the background-refresh path.
    inflight.set(key, promise);
    promise.then(() => inflight.delete(key), () => inflight.delete(key));
    return promise;
  }

  async function get(key, fetcher) {
    const ts = now();
    const hit = store.get(key);
    if (hit && ts < hit.expires) return hit.value; // fresh
    if (hit && ts < hit.staleUntil) {
      const bg = revalidate(key, fetcher); // serve stale, refresh in background
      bg.catch(() => {}); // a failed background refresh must not crash; stale already returned
      return hit.value;
    }
    return revalidate(key, fetcher); // miss/expired: caller awaits the fetch (errors propagate)
  }

  return {
    get,
    peek: (key) => store.get(key)?.value,
    delete: (key) => store.delete(key),
    clear: () => { store.clear(); inflight.clear(); },
    get size() { return store.size; }
  };
}
