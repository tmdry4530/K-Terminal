import { spawn } from 'node:child_process';
import fs from 'node:fs';

const port = String(18080 + Math.floor(Math.random() * 1000));
const dataDir = new URL(`../data/smoke-${port}`, import.meta.url);
const child = spawn(process.execPath, ['src/server.js'], {
  cwd: new URL('..', import.meta.url),
  env: { ...process.env, PORT: port, DATA_DIR: `./data/smoke-${port}`, SECRET_KEY: 'smoke-test-secret-key-with-enough-length' },
  stdio: ['ignore', 'pipe', 'pipe']
});

let stdout = '';
child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
child.stderr.on('data', (chunk) => process.stderr.write(chunk));

function wait(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
async function fetchJson(path) {
  const res = await fetch(`http://127.0.0.1:${port}${path}`);
  const data = await res.json();
  if (!res.ok) throw new Error(`${path} HTTP ${res.status}`);
  return data;
}

try {
  for (let i = 0; i < 30; i += 1) {
    if (stdout.includes('listening')) break;
    await wait(100);
  }
  const health = await fetchJson('/api/health');
  if (!health.ok) throw new Error('health failed');
  const meta = await fetchJson('/api/meta');
  if (meta.app !== 'K Terminal Finance') throw new Error('meta failed');
  const chart = await fetchJson('/api/market/chart?symbol=AAPL&range=1M&interval=1D');
  if (!['실시간', '근실시간', '지연 데이터', 'API 필요', '데이터 없음', '오류'].includes(chart.status)) {
    throw new Error(`unexpected chart status ${chart.status}`);
  }
  console.log('Smoke test passed');
} finally {
  child.kill('SIGTERM');
  fs.rmSync(dataDir, { recursive: true, force: true });
}
