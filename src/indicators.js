export function sma(values, period) {
  return values.map((_, idx) => {
    if (idx + 1 < period) return null;
    const window = values.slice(idx + 1 - period, idx + 1).filter(Number.isFinite);
    if (window.length !== period) return null;
    return window.reduce((sum, value) => sum + value, 0) / period;
  });
}

export function ema(values, period) {
  const multiplier = 2 / (period + 1);
  const result = [];
  let previous = null;
  const seed = [];
  for (const value of values) {
    if (!Number.isFinite(value)) {
      result.push(null);
      continue;
    }
    if (previous === null) {
      seed.push(value);
      if (seed.length < period) {
        result.push(null);
        continue;
      }
      previous = seed.slice(-period).reduce((sum, v) => sum + v, 0) / period;
      result.push(previous);
      continue;
    }
    previous = (value - previous) * multiplier + previous;
    result.push(previous);
  }
  return result;
}

export function bollinger(values, period = 20, deviations = 2) {
  return values.map((_, idx) => {
    if (idx + 1 < period) return { mid: null, upper: null, lower: null };
    const window = values.slice(idx + 1 - period, idx + 1).filter(Number.isFinite);
    if (window.length !== period) return { mid: null, upper: null, lower: null };
    const mid = window.reduce((sum, value) => sum + value, 0) / period;
    const variance = window.reduce((sum, value) => sum + (value - mid) ** 2, 0) / period;
    const sd = Math.sqrt(variance);
    return { mid, upper: mid + deviations * sd, lower: mid - deviations * sd };
  });
}

export function rsi(values, period = 14) {
  const result = values.map(() => null);
  let avgGain = 0;
  let avgLoss = 0;
  for (let idx = 1; idx < values.length; idx += 1) {
    const change = values[idx] - values[idx - 1];
    const gain = Math.max(change, 0);
    const loss = Math.max(-change, 0);
    if (idx <= period) {
      avgGain += gain;
      avgLoss += loss;
      if (idx === period) {
        avgGain /= period;
        avgLoss /= period;
        result[idx] = avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss));
      }
    } else {
      avgGain = ((avgGain * (period - 1)) + gain) / period;
      avgLoss = ((avgLoss * (period - 1)) + loss) / period;
      result[idx] = avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss));
    }
  }
  return result;
}

export function macd(values, fast = 12, slow = 26, signal = 9) {
  const fastEma = ema(values, fast);
  const slowEma = ema(values, slow);
  const line = values.map((_, idx) => (fastEma[idx] !== null && slowEma[idx] !== null ? fastEma[idx] - slowEma[idx] : null));
  const compactLine = line.map((value) => (value === null ? Number.NaN : value));
  const signalLine = ema(compactLine, signal);
  const histogram = line.map((value, idx) => (value !== null && signalLine[idx] !== null ? value - signalLine[idx] : null));
  return { macd: line, signal: signalLine, histogram };
}

export function technicalSnapshot(candles) {
  const closes = (candles || []).map((bar) => Number(bar.close)).filter(Number.isFinite);
  if (closes.length < 30) return { status: '데이터 부족' };
  const last = closes.at(-1);
  const ma20 = sma(closes, 20).at(-1);
  const ma50 = sma(closes, 50).at(-1);
  const rsi14 = rsi(closes, 14).at(-1);
  const macdSet = macd(closes);
  const macdLast = macdSet.macd.at(-1);
  const signalLast = macdSet.signal.at(-1);
  return {
    last,
    ma20,
    ma50,
    rsi14,
    macd: macdLast,
    macdSignal: signalLast,
    trend: ma20 && last > ma20 ? '상방' : ma20 && last < ma20 ? '하방' : '중립',
    momentum: rsi14 > 70 ? '과열' : rsi14 < 30 ? '과매도' : '중립',
    macdState: macdLast !== null && signalLast !== null ? (macdLast > signalLast ? '상승 모멘텀' : '하락 모멘텀') : '데이터 부족'
  };
}
