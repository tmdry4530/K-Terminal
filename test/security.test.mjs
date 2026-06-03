import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCsp, createLimiter, sameOriginOk, securityHeaders } from '../src/security.js';

test('createLimiter allows up to capacity then denies, and refills over time', () => {
  let clock = 0;
  const limiter = createLimiter({ capacity: 3, refillPerSec: 1, now: () => clock });
  assert.equal(limiter('k').ok, true);
  assert.equal(limiter('k').ok, true);
  assert.equal(limiter('k').ok, true);
  const denied = limiter('k');
  assert.equal(denied.ok, false);
  assert.ok(denied.retryAfter >= 1);
  // Advance 2s -> 2 tokens refill (1 token/sec).
  clock += 2000;
  assert.equal(limiter('k').ok, true);
  assert.equal(limiter('k').ok, true);
  assert.equal(limiter('k').ok, false);
});

test('createLimiter isolates buckets by key', () => {
  let clock = 0;
  const limiter = createLimiter({ capacity: 1, refillPerSec: 1, now: () => clock });
  assert.equal(limiter('a').ok, true);
  assert.equal(limiter('a').ok, false);
  assert.equal(limiter('b').ok, true); // different key is independent
});

test('sameOriginOk allows safe methods regardless of headers', () => {
  assert.equal(sameOriginOk({ method: 'GET', headers: {} }), true);
  assert.equal(sameOriginOk({ method: 'HEAD', headers: {} }), true);
});

test('sameOriginOk enforces matching Origin on mutating requests', () => {
  assert.equal(sameOriginOk({ method: 'POST', headers: { host: 'x.com', origin: 'http://x.com' } }), true);
  assert.equal(sameOriginOk({ method: 'POST', headers: { host: 'x.com:8080', origin: 'http://x.com:8080' } }), true);
  assert.equal(sameOriginOk({ method: 'POST', headers: { host: 'x.com', origin: 'http://evil.com' } }), false);
});

test('sameOriginOk falls back to Referer, and allows when both absent', () => {
  assert.equal(sameOriginOk({ method: 'POST', headers: { host: 'x.com', referer: 'http://x.com/page' } }), true);
  assert.equal(sameOriginOk({ method: 'POST', headers: { host: 'x.com', referer: 'http://evil.com/' } }), false);
  assert.equal(sameOriginOk({ method: 'POST', headers: { host: 'x.com' } }), true); // non-browser client
  assert.equal(sameOriginOk({ method: 'POST', headers: {} }), false); // no host at all
});

test('securityHeaders gates HSTS on secure and always sets CSP + nosniff', () => {
  const insecure = securityHeaders({ secure: false });
  assert.ok(insecure['Content-Security-Policy']);
  assert.equal(insecure['X-Content-Type-Options'], 'nosniff');
  assert.equal(insecure['X-Frame-Options'], 'DENY');
  assert.equal('Strict-Transport-Security' in insecure, false);
  const secure = securityHeaders({ secure: true });
  assert.ok(secure['Strict-Transport-Security'].includes('max-age='));
});

test('buildCsp keeps strict script-src and relaxes only style-src', () => {
  const csp = buildCsp({ secure: false });
  assert.ok(csp.includes("script-src 'self'"));
  assert.ok(csp.includes("style-src 'self' 'unsafe-inline'"));
  assert.ok(csp.includes("img-src 'self' data:"));
  assert.ok(csp.includes("frame-ancestors 'none'"));
  assert.equal(csp.includes('upgrade-insecure-requests'), false);
  assert.ok(buildCsp({ secure: true }).includes('upgrade-insecure-requests'));
});
