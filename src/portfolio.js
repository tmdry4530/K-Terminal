import { getSnapshot, SYMBOL_PROFILE, DATA_STATUS } from './marketData.js';

function sectorOf(holding) {
  return holding.sector || SYMBOL_PROFILE[holding.symbol]?.sector || 'Unknown';
}

function countryOf(holding) {
  return holding.country || SYMBOL_PROFILE[holding.symbol]?.country || (holding.symbol.endsWith('.KS') || holding.symbol.endsWith('.KQ') ? 'KR' : 'US');
}

function currencyOf(holding) {
  return holding.currency || SYMBOL_PROFILE[holding.symbol]?.currency || (holding.symbol.endsWith('.KS') || holding.symbol.endsWith('.KQ') ? 'KRW' : 'USD');
}

function addBucket(map, key, value) {
  map[key] = (map[key] || 0) + value;
}

export async function enrichPortfolio(portfolio, userApiKeys = {}) {
  const holdings = portfolio?.holdings || [];
  const symbols = holdings.map((holding) => holding.symbol);
  const snapshot = symbols.length ? await getSnapshot(symbols, userApiKeys) : { quotes: [] };
  const quoteMap = new Map(snapshot.quotes.map((quote) => [quote.symbol, quote]));
  let totalMarketValue = Number(portfolio?.cash || 0) || 0;
  const enriched = holdings.map((holding) => {
    const quote = quoteMap.get(holding.symbol);
    const price = quote?.price ?? null;
    const marketValue = price !== null ? price * holding.quantity : null;
    if (marketValue !== null) totalMarketValue += marketValue;
    const cost = holding.averagePrice !== null && holding.averagePrice !== undefined ? holding.averagePrice * holding.quantity : null;
    const pnl = marketValue !== null && cost !== null ? marketValue - cost : null;
    const pnlPercent = pnl !== null && cost ? (pnl / cost) * 100 : null;
    return {
      ...holding,
      sector: sectorOf(holding),
      country: countryOf(holding),
      currency: currencyOf(holding),
      lastPrice: price,
      priceStatus: quote?.status || DATA_STATUS.NO_DATA,
      priceSource: quote?.source || null,
      priceUpdatedAt: quote?.updatedAt || null,
      marketValue,
      cost,
      pnl,
      pnlPercent,
      dividendExpected: null,
      dividendStatus: 'API 필요',
      quoteStatusMessage: quote?.statusMessage || '가격 없음'
    };
  });

  for (const item of enriched) {
    item.weight = item.marketValue !== null && totalMarketValue > 0 ? (item.marketValue / totalMarketValue) * 100 : null;
    item.rebalanceNeeded = item.weight !== null && item.targetWeight !== null ? Math.abs(item.weight - item.targetWeight) >= 3 : null;
    item.rebalanceDeltaValue = item.weight !== null && item.targetWeight !== null && totalMarketValue > 0 ? ((item.targetWeight - item.weight) / 100) * totalMarketValue : null;
  }

  const buckets = { sector: {}, country: {}, currency: {} };
  for (const item of enriched) {
    if (item.marketValue === null) continue;
    addBucket(buckets.sector, item.sector, item.marketValue);
    addBucket(buckets.country, item.country, item.marketValue);
    addBucket(buckets.currency, item.currency, item.marketValue);
  }

  const realizedCost = enriched.reduce((sum, item) => sum + (item.cost || 0), 0);
  const pnl = enriched.reduce((sum, item) => sum + (item.pnl || 0), 0);
  const missingPrices = enriched.filter((item) => item.marketValue === null).map((item) => item.symbol);

  return {
    ...portfolio,
    holdings: enriched,
    summary: {
      totalValue: totalMarketValue,
      cash: Number(portfolio?.cash || 0) || 0,
      investedCost: realizedCost || null,
      pnl: realizedCost ? pnl : null,
      pnlPercent: realizedCost ? (pnl / realizedCost) * 100 : null,
      missingPrices,
      dataStatus: missingPrices.length ? '일부 가격 데이터 없음' : '정상',
      updatedAt: new Date().toISOString()
    },
    exposure: buckets,
    snapshotStatus: snapshot
  };
}
