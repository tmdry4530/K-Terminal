import test from 'node:test';
import assert from 'node:assert/strict';
import { enrichPortfolio } from '../src/portfolio.js';

const fakeDeps = (quotes, rates) => ({
  getSnapshot: async () => ({ quotes }),
  getRates: async () => new Map(Object.entries(rates))
});

test('converts multi-currency holdings into the base currency (fixes raw-sum bug)', async () => {
  const portfolio = {
    baseCurrency: 'USD',
    cash: 0,
    holdings: [
      { symbol: 'AAPL', quantity: 1, averagePrice: 100, currency: 'USD' },
      { symbol: '005930.KS', quantity: 10, averagePrice: 60000, currency: 'KRW' }
    ]
  };
  const quotes = [
    { symbol: 'AAPL', price: 200, status: '지연 데이터' },
    { symbol: '005930.KS', price: 70000, status: '지연 데이터' }
  ];
  const rates = {
    USD: { rate: 1, status: '실시간', source: 'identity' },
    KRW: { rate: 0.00075, status: '지연 데이터', source: 'test' }
  };
  const result = await enrichPortfolio(portfolio, {}, fakeDeps(quotes, rates));
  // AAPL 200 USD + Samsung 700000 KRW * 0.00075 = 525 USD => 725 USD total (not raw 700200).
  assert.equal(result.summary.totalValue, 725);
  assert.equal(result.summary.baseCurrency, 'USD');
  const samsung = result.holdings.find((h) => h.symbol === '005930.KS');
  assert.equal(samsung.marketValueNative, 700000);
  assert.equal(samsung.marketValueBase, 525);
  const aapl = result.holdings.find((h) => h.symbol === 'AAPL');
  assert.ok(Math.abs(aapl.weight - (200 / 725) * 100) < 1e-9);
});

test('reports capital gain at current rate when purchase FX is absent', async () => {
  const portfolio = { baseCurrency: 'USD', holdings: [{ symbol: '005930.KS', quantity: 10, averagePrice: 60000, currency: 'KRW' }] };
  const quotes = [{ symbol: '005930.KS', price: 70000, status: '지연' }];
  const rates = { KRW: { rate: 0.001, status: '지연', source: 't' } };
  const r = await enrichPortfolio(portfolio, {}, fakeDeps(quotes, rates));
  const h = r.holdings[0];
  assert.equal(h.costBase, 600); // 60000*10*0.001
  assert.equal(h.marketValueBase, 700); // 70000*10*0.001
  assert.equal(h.capitalGainBase, 100);
  assert.equal(h.currencyGainBase, null); // unknown without purchase FX
  assert.equal(h.pnlBase, 100);
});

test('splits capital gain and currency gain when purchase FX is provided', async () => {
  const portfolio = { baseCurrency: 'USD', holdings: [{ symbol: '005930.KS', quantity: 10, averagePrice: 60000, currency: 'KRW', purchaseFxRate: 0.0008 }] };
  const quotes = [{ symbol: '005930.KS', price: 70000, status: '지연' }];
  const rates = { KRW: { rate: 0.001, status: '지연', source: 't' } };
  const r = await enrichPortfolio(portfolio, {}, fakeDeps(quotes, rates));
  const h = r.holdings[0];
  assert.equal(h.capitalGainBase, 100); // 10*(70000-60000)*0.001
  assert.ok(Math.abs(h.currencyGainBase - 120) < 1e-9); // 10*60000*(0.001-0.0008)
  assert.equal(h.costBase, 480); // 60000*10*0.0008
  assert.ok(Math.abs(h.pnlBase - 220) < 1e-9);
  assert.ok(Math.abs((h.capitalGainBase + h.currencyGainBase) - h.pnlBase) < 1e-9);
});

test('flags missing FX and excludes those holdings from the base total', async () => {
  const portfolio = {
    baseCurrency: 'USD',
    holdings: [
      { symbol: 'AAPL', quantity: 1, averagePrice: 100, currency: 'USD' },
      { symbol: '2222.SR', quantity: 5, averagePrice: 10, currency: 'SAR' }
    ]
  };
  const quotes = [{ symbol: 'AAPL', price: 150, status: '지연' }, { symbol: '2222.SR', price: 20, status: '지연' }];
  const rates = { USD: { rate: 1, status: '실시간', source: 'identity' }, SAR: { rate: null, status: '데이터 없음', source: null } };
  const r = await enrichPortfolio(portfolio, {}, fakeDeps(quotes, rates));
  assert.equal(r.summary.totalValue, 150); // only AAPL counted
  assert.deepEqual(r.summary.missingFx, ['2222.SR']);
  const sar = r.holdings.find((h) => h.symbol === '2222.SR');
  assert.equal(sar.marketValueBase, null);
  assert.equal(sar.marketValueNative, 100); // native still computed
});
