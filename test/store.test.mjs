import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { JsonStore } from '../src/store.js';

test('JsonStore creates users, sessions, settings and holdings', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'kt-store-'));
  const dbPath = path.join(dir, 'db.json');
  const store = new JsonStore(dbPath);
  await store.init();
  const user = await store.createUser('tester@example.com', 'very-secure-password');
  assert.equal(user.email, 'tester@example.com');
  const full = await store.verifyUser('tester@example.com', 'very-secure-password');
  assert.ok(full.id);
  const session = await store.createSession(full.id);
  const bySession = await store.getUserBySessionToken(session.token);
  assert.equal(bySession.email, 'tester@example.com');
  await store.setApiKey(full.id, 'gemini', 'secret-value');
  assert.equal(store.getApiKey(full.id, 'gemini'), 'secret-value');
  await store.upsertHolding(full.id, { symbol: 'AAPL', quantity: 2, averagePrice: 100, targetWeight: 50 });
  const portfolio = store.getPortfolio(full.id);
  assert.equal(portfolio.holdings.length, 1);
  assert.equal(portfolio.holdings[0].symbol, 'AAPL');
});

test('ensureSingleUser is idempotent and returns one local operator account', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'kt-single-'));
  const store = new JsonStore(path.join(dir, 'db.json'));
  await store.init();
  const first = await store.ensureSingleUser();
  const second = await store.ensureSingleUser();
  assert.equal(first.id, second.id);
  assert.equal(first.email, 'local@k-terminal.local');
  assert.equal(Object.keys(store.db.users).length, 1);
});
