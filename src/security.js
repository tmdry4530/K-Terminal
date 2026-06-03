// Dependency-free security primitives: response headers, rate limiting, CSRF origin check.

// Build a Content-Security-Policy that matches this app's actual surface:
// external ES module (/app.js) → script-src 'self' (no unsafe-inline needed);
// inline <style> inside SVG + style="" attributes → style-src 'unsafe-inline';
// inline/base64 SVG → img-src data:; SSE + fetch to own origin → connect-src 'self'.
export function buildCsp({ secure = false } = {}) {
  const directives = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'"
  ];
  // upgrade-insecure-requests would break a plain-http localhost dev server, so only
  // emit it when we are actually serving over HTTPS.
  if (secure) directives.push('upgrade-insecure-requests');
  return directives.join('; ');
}

export function securityHeaders({ secure = false } = {}) {
  const headers = {
    'Content-Security-Policy': buildCsp({ secure }),
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'geolocation=(), camera=(), microphone=(), payment=(), usb=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin'
  };
  if (secure) headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains';
  return headers;
}

export function applySecurityHeaders(res, options = {}) {
  for (const [key, value] of Object.entries(securityHeaders(options))) {
    res.setHeader(key, value);
  }
}

// Extract the client IP. X-Forwarded-For is client-spoofable, so only honor it when
// the deployment explicitly opts in (behind a trusted proxy that rewrites the header).
export function clientIp(req, { trustProxy = false } = {}) {
  if (trustProxy) {
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) return String(forwarded).split(',')[0].trim();
  }
  return req.socket?.remoteAddress || 'unknown';
}

// Token-bucket limiter with lazy refill. `now` is injectable for deterministic tests.
export function createLimiter({ capacity, refillPerSec, now = () => Date.now(), idleMs = 600000 }) {
  const buckets = new Map();
  let lastSweep = now();
  function sweep(ts) {
    if (ts - lastSweep < 60000) return;
    lastSweep = ts;
    for (const [key, bucket] of buckets) {
      if (ts - bucket.last > idleMs) buckets.delete(key);
    }
  }
  return function take(key) {
    const ts = now();
    sweep(ts);
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { tokens: capacity, last: ts };
      buckets.set(key, bucket);
    }
    const elapsedSec = (ts - bucket.last) / 1000;
    bucket.tokens = Math.min(capacity, bucket.tokens + elapsedSec * refillPerSec);
    bucket.last = ts;
    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return { ok: true, remaining: Math.floor(bucket.tokens) };
    }
    const retryAfter = Math.max(1, Math.ceil((1 - bucket.tokens) / refillPerSec));
    return { ok: false, retryAfter };
  };
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// CSRF defense-in-depth for a SameSite=Lax cookie-session app:
// a cross-site browser request carries an Origin (fetch/XHR) or Referer (form post),
// so when either header is present it must match our host. When BOTH are absent the
// request is not browser-originated (no ambient cookie to abuse), so we allow it —
// this keeps non-browser clients (CLI, tests) working without weakening CSRF protection.
export function sameOriginOk(req) {
  if (SAFE_METHODS.has(req.method)) return true;
  const host = req.headers.host;
  if (!host) return false;
  const { origin, referer } = req.headers;
  if (origin) {
    try { return new URL(origin).host === host; } catch { return false; }
  }
  if (referer) {
    try { return new URL(referer).host === host; } catch { return false; }
  }
  return true;
}
