import { config } from './config.js';
import { technicalSnapshot } from './indicators.js';

async function fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function summarizeQuote(quote) {
  if (!quote || quote.price === null || quote.price === undefined) return '시세 데이터 없음';
  const change = Number.isFinite(quote.changePercent) ? `${quote.changePercent.toFixed(2)}%` : '변동률 없음';
  return `${quote.symbol}: ${quote.price} ${quote.currency || ''}, 변동률 ${change}, 상태 ${quote.status}`;
}

function summarizeNews(news) {
  const items = news?.items || [];
  if (!items.length) return '뉴스 데이터 없음';
  const counts = items.reduce((acc, item) => {
    const label = item.sentiment?.label || '중립';
    acc[label] = (acc[label] || 0) + 1;
    return acc;
  }, {});
  const high = items.filter((item) => item.importance === '높음').slice(0, 3).map((item) => item.koTitle || item.title);
  return `감성 분포 ${JSON.stringify(counts)}. 중요 뉴스: ${high.join(' / ') || '없음'}`;
}

function summarizePortfolio(portfolio) {
  if (!portfolio?.holdings?.length) return '포트폴리오 데이터 없음';
  const total = portfolio.summary?.totalValue ?? null;
  const top = [...portfolio.holdings].sort((a, b) => (b.weight || 0) - (a.weight || 0)).slice(0, 3).map((h) => `${h.symbol} ${(h.weight || 0).toFixed(1)}%`);
  return `총 평가액 ${total ?? '계산 불가'} ${portfolio.baseCurrency || 'USD'}, 상위 비중 ${top.join(', ')}`;
}

function localAnswer(question, context = {}) {
  const lower = String(question || '').toLowerCase();
  const lines = [];
  lines.push('로컬 규칙 기반 분석입니다. Gemini API가 없거나 선택되지 않았습니다.');
  if (context.quote) lines.push(`시세: ${summarizeQuote(context.quote)}`);
  if (context.news) lines.push(`뉴스: ${summarizeNews(context.news)}`);
  if (context.chart?.candles?.length) {
    const snapshot = technicalSnapshot(context.chart.candles);
    lines.push(`차트: 추세 ${snapshot.trend || snapshot.status}, RSI ${snapshot.rsi14?.toFixed?.(1) ?? '없음'}, MACD ${snapshot.macdState || '없음'}`);
  }
  if (context.portfolio) lines.push(`포트폴리오: ${summarizePortfolio(context.portfolio)}`);
  if (lower.includes('매수') || lower.includes('매도') || lower.includes('투자')) {
    lines.push('판단: 이 결과는 투자 자문이 아니라 데이터 요약입니다. 실제 주문은 Paper Trading 화면에서 별도 확인 후 처리됩니다.');
  }
  if (lines.length === 1) lines.push('질문과 연결된 시세, 뉴스, 공시, 차트 또는 포트폴리오 컨텍스트가 부족합니다.');
  return lines.join('\n');
}

async function geminiAnswer(question, context, apiKey = config.geminiApiKey, model = config.geminiModel) {
  if (!apiKey) return null;
  const payload = {
    contents: [{
      role: 'user',
      parts: [{
        text: [
          '너는 한국어 금융 터미널의 분석 보조자다.',
          '실제 데이터와 데이터 없음/API 필요/지연 데이터 상태를 반드시 구분한다.',
          '매수/매도 단정 추천을 피하고, 근거와 리스크를 분리해서 답한다.',
          '질문:', question,
          '컨텍스트 JSON:', JSON.stringify(context).slice(0, 18000)
        ].join('\n')
      }]
    }],
    generationConfig: { temperature: 0.2, maxOutputTokens: 2048 }
  };
  const response = await fetchWithTimeout(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const text = response?.candidates?.[0]?.content?.parts?.map((part) => part.text).join('\n').trim();
  return text || null;
}

export async function answerQuestion({ question, context = {}, userApiKeys = {}, provider = config.aiProvider }) {
  const selectedProvider = provider || config.aiProvider;
  if (selectedProvider === 'gemini' || userApiKeys.gemini || config.geminiApiKey) {
    try {
      const answer = await geminiAnswer(question, context, userApiKeys.gemini || config.geminiApiKey, config.geminiModel);
      if (answer) return { provider: 'Gemini', status: '정상', answer };
    } catch (error) {
      const fallback = localAnswer(question, context);
      return { provider: 'local', status: 'Gemini 실패 - 로컬 대체', statusMessage: error.message, answer: fallback };
    }
  }
  return { provider: 'local', status: '정상', answer: localAnswer(question, context) };
}
