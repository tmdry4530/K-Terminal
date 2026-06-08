import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const appPath = path.resolve('public/app.js');

test('signals tab is news/gate focused while watchlist and alerts stay on market chart tab', async () => {
  const app = await fs.readFile(appPath, 'utf8');
  assert.match(app, /market:\s*{\s*left:\s*\['market-pulse', 'watchlist'\],\s*center:\s*\['chart'\],\s*right:\s*\['alerts', 'data-sources'\]/s);
  assert.match(app, /signals:\s*{\s*left:\s*\['signals'\],\s*center:\s*\['execution-gate', 'news-recommendations'\],\s*right:\s*\['positions'\]/s);
  assert.match(app, /signals:\s*new Set\(\['watchlist', 'alerts'\]\)/);
});

test('signals panel renders agent-collected news evidence instead of only trade columns', async () => {
  const app = await fs.readFile(appPath, 'utf8');
  assert.match(app, /에이전트 수집 뉴스/);
  assert.match(app, /Crypto Signal이 inbox로 넘긴 뉴스\/근거를 필터 없이 펼쳐 표시합니다/);
  assert.match(app, /signal-news-card/);
  assert.match(app, /evidence_summary/);
  assert.match(app, /근거 \$\{evidenceCount\}개/);
});
