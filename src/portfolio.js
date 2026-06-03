import { getSnapshot, SYMBOL_PROFILE, DATA_STATUS } from './marketData.js';
import { getRates } from './fx.js';

function sectorOf(holding) {
  return holding.sector || SYMBOL_PROFILE[holding.symbol]?.sector || 'Unknown';
}

function countryOf(holding) {
  return holding.country || SYMBOL_PROFILE[holding.symbol]?.country || (holding.symbol.endsWith('.KS') || holding.symbol.endsWith('.KQ') ? 'KR' : 'US');
}

function currencyOf(holding) {
  return (holding.currency || SYMBOL_PROFILE[holding.symbol]?.currency || (holding.symbol.endsWith('.KS') || holding.symbol.endsWith('.KQ') ? 'KRW' : 'USD')).toUpperCase();
}

function addBucket(map, key, value) {
  map[key] = (map[key] || 0) + value;
}

export async function enrichPortfolio(portfolio, userApiKeys = {}, deps = {}) {
  // Dependencies are injectable so the conversion/attribution math can be unit-tested
  // without network access.
  const fetchSnapshot = deps.getSnapshot || getSnapshot;
  const fetchRates = deps.getRates || getRates;
  const baseCurrency = String(portfolio?.baseCurrency || 'USD').toUpperCase();
  const holdings = portfolio?.holdings || [];
  const symbols = holdings.map((holding) => holding.symbol);
  const snapshot = symbols.length ? await fetchSnapshot(symbols, userApiKeys) : { quotes: [] };
  const quoteMap = new Map(snapshot.quotes.map((quote) => [quote.symbol, quote]));

  // Resolve every native currency -> base rate up front (cached + de-duplicated in fx.js).
  const rates = await fetchRates(holdings.map((holding) => currencyOf(holding)), baseCurrency);

  // Cash is assumed to be held in the base currency.
  const cashBase = Number(portfolio?.cash || 0) || 0;
  let totalValueBase = cashBase;

  const enriched = holdings.map((holding) => {
    const quote = quoteMap.get(holding.symbol);
    const price = quote?.price ?? null;
    const currency = currencyOf(holding);
    const fx = rates.get(currency) || { rate: currency === baseCurrency ? 1 : null, status: DATA_STATUS.NO_DATA, source: null };
    const fxRate = fx.rate;

    const marketValueNative = price !== null ? price * holding.quantity : null;
    const costNative = holding.averagePrice !== null && holding.averagePrice !== undefined ? holding.averagePrice * holding.quantity : null;
    const pnlNative = marketValueNative !== null && costNative !== null ? marketValueNative - costNative : null;
    const pnlPercentNative = pnlNative !== null && costNative ? (pnlNative / costNative) * 100 : null;

    const marketValueBase = marketValueNative !== null && fxRate !== null ? marketValueNative * fxRate : null;
    if (marketValueBase !== null) totalValueBase += marketValueBase;

    // Capital gain (price move) vs currency gain (FX move) attribution.
    // A correct split needs the FX rate at purchase time; we only store it when the user
    // provides purchaseFxRate. Otherwise we report capital gain at the current rate and
    // mark currency gain as unknown rather than fabricate it.
    const purchaseFx = Number(holding.purchaseFxRate);
    let costBase = null;
    let pnlBase = null;
    let capitalGainBase = null;
    let currencyGainBase = null;
    if (marketValueBase !== null && costNative !== null && fxRate !== null) {
      if (Number.isFinite(purchaseFx) && purchaseFx > 0) {
        costBase = costNative * purchaseFx;
        capitalGainBase = holding.quantity * (price - holding.averagePrice) * fxRate;
        currencyGainBase = holding.quantity * holding.averagePrice * (fxRate - purchaseFx);
        pnlBase = marketValueBase - costBase;
      } else {
        costBase = costNative * fxRate;
        capitalGainBase = marketValueBase - costBase;
        currencyGainBase = null; // unknown without purchase FX rate
        pnlBase = capitalGainBase;
      }
    }

    return {
      ...holding,
      sector: sectorOf(holding),
      country: countryOf(holding),
      currency,
      baseCurrency,
      lastPrice: price,
      priceStatus: quote?.status || DATA_STATUS.NO_DATA,
      priceSource: quote?.source || null,
      priceUpdatedAt: quote?.updatedAt || null,
      quoteStatusMessage: quote?.statusMessage || '가격 없음',
      fxRate,
      fxStatus: currency === baseCurrency ? DATA_STATUS.REALTIME : fx.status,
      fxSource: currency === baseCurrency ? 'identity' : fx.source,
      marketValueNative,
      marketValue: marketValueNative, // native value (display in the holding's own currency)
      marketValueBase,
      costNative,
      cost: costNative,
      costBase,
      pnl: pnlNative,
      pnlPercent: pnlPercentNative,
      pnlBase,
      capitalGainBase,
      currencyGainBase,
      dividendExpected: null,
      dividendStatus: 'API 필요'
    };
  });

  // Weights and exposure are computed in the base currency so they sum correctly.
  for (const item of enriched) {
    item.weight = item.marketValueBase !== null && totalValueBase > 0 ? (item.marketValueBase / totalValueBase) * 100 : null;
    item.rebalanceNeeded = item.weight !== null && item.targetWeight !== null ? Math.abs(item.weight - item.targetWeight) >= 3 : null;
    item.rebalanceDeltaValue = item.weight !== null && item.targetWeight !== null && totalValueBase > 0 ? ((item.targetWeight - item.weight) / 100) * totalValueBase : null;
  }

  const buckets = { sector: {}, country: {}, currency: {} };
  for (const item of enriched) {
    if (item.marketValueBase === null) continue;
    addBucket(buckets.sector, item.sector, item.marketValueBase);
    addBucket(buckets.country, item.country, item.marketValueBase);
    addBucket(buckets.currency, item.currency, item.marketValueBase);
  }

  const investedCostBase = enriched.reduce((sum, item) => sum + (item.costBase || 0), 0);
  const pnlBaseTotal = enriched.reduce((sum, item) => sum + (item.pnlBase || 0), 0);
  const missingPrices = enriched.filter((item) => item.marketValueNative === null).map((item) => item.symbol);
  const missingFx = enriched
    .filter((item) => item.currency !== baseCurrency && item.fxRate === null)
    .map((item) => item.symbol);

  const dataIssues = [];
  if (missingPrices.length) dataIssues.push('일부 가격 데이터 없음');
  if (missingFx.length) dataIssues.push('일부 환율 데이터 없음');

  return {
    ...portfolio,
    baseCurrency,
    holdings: enriched,
    summary: {
      baseCurrency,
      totalValue: totalValueBase,
      cash: cashBase,
      investedCost: investedCostBase || null,
      pnl: investedCostBase ? pnlBaseTotal : null,
      pnlPercent: investedCostBase ? (pnlBaseTotal / investedCostBase) * 100 : null,
      missingPrices,
      missingFx,
      dataStatus: dataIssues.join(' / ') || '정상',
      updatedAt: new Date().toISOString()
    },
    exposure: buckets,
    snapshotStatus: snapshot
  };
}
