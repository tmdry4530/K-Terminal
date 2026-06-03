import { config } from './config.js';
import { DATA_STATUS } from './marketData.js';

const POSITIVE = ['beat', 'beats', 'gain', 'gains', 'rally', 'surge', 'surges', 'upgrade', 'upgraded', 'strong', 'growth', 'profit', 'record', 'bullish', 'raises', 'outperform'];
const NEGATIVE = ['miss', 'misses', 'fall', 'falls', 'drop', 'drops', 'plunge', 'plunges', 'lawsuit', 'probe', 'cut', 'cuts', 'downgrade', 'downgraded', 'weak', 'loss', 'bearish', 'warning'];
const IMPORTANT = ['earnings', 'guidance', 'sec', 'filing', 'merger', 'acquisition', 'antitrust', 'fda', 'dividend', 'buyback', 'bankruptcy', 'lawsuit', 'investigation', 'rates', 'inflation'];
const LOCAL_TRANSLATION_TERMS = new Map([
  ['earnings', '실적'], ['revenue', '매출'], ['profit', '이익'], ['loss', '손실'], ['stock', '주식'], ['stocks', '주식'], ['shares', '주가'],
  ['rises', '상승'], ['rise', '상승'], ['falls', '하락'], ['fall', '하락'], ['drops', '하락'], ['surges', '급등'], ['beats', '예상치 상회'],
  ['misses', '예상치 하회'], ['guidance', '가이던스'], ['upgrade', '상향'], ['downgrade', '하향'], ['dividend', '배당'], ['buyback', '자사주 매입'],
  ['market', '시장'], ['nasdaq', '나스닥'], ['fed', '연준'], ['inflation', '인플레이션'], ['rates', '금리'], ['ai', 'AI'], ['chip', '반도체'], ['chips', '반도체']
]);

async function fetchWithTimeout(url, options = {}, timeoutMs = 7000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const type = response.headers.get('content-type') || '';
    return type.includes('json') ? await response.json() : await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

function decodeXml(value = '') {
  return String(value)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/<[^>]+>/g, '')
    .trim();
}

function textBetween(item, tag) {
  const match = item.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return decodeXml(match?.[1] || '');
}

function analyzeSentiment(text) {
  const lower = String(text || '').toLowerCase();
  const pos = POSITIVE.filter((word) => lower.includes(word)).length;
  const neg = NEGATIVE.filter((word) => lower.includes(word)).length;
  const score = pos === 0 && neg === 0 ? 0 : (pos - neg) / Math.max(pos + neg, 1);
  const label = score > 0.2 ? '긍정' : score < -0.2 ? '부정' : '중립';
  return { score: Number(score.toFixed(2)), label };
}

function importance(text) {
  const lower = String(text || '').toLowerCase();
  const hits = IMPORTANT.filter((word) => lower.includes(word)).length;
  return hits >= 2 ? '높음' : hits === 1 ? '중간' : '낮음';
}

function relatedTickers(text, fallbackSymbol) {
  const candidates = [...String(text || '').matchAll(/\b[A-Z]{1,5}\b/g)].map((m) => m[0]);
  const symbols = [...new Set([fallbackSymbol, ...candidates].filter((s) => s && !['CEO', 'CFO', 'SEC', 'FDA', 'ETF', 'AI', 'US', 'USA'].includes(s)))];
  return symbols.slice(0, 8);
}

function localSummary(text) {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  const first = normalized.split(/(?<=[.!?])\s+/)[0];
  return first.length > 220 ? `${first.slice(0, 217)}...` : first;
}

function localTranslateHeadline(title) {
  const tokens = String(title || '').split(/(\s+|[.,:;!?()\[\]"'])/);
  let replaced = 0;
  const translated = tokens.map((token) => {
    const value = LOCAL_TRANSLATION_TERMS.get(token.toLowerCase());
    if (value) replaced += 1;
    return value || token;
  }).join('').replace(/\s+/g, ' ').trim();
  if (!replaced) return { koTitle: null, status: 'API 필요' };
  return { koTitle: translated, status: '로컬 규칙 번역' };
}

function normalizeNewsItem(item, symbol, sourceName = 'RSS') {
  const title = item.title || '';
  const summary = item.summary || item.description || title;
  const sentiment = analyzeSentiment(`${title} ${summary}`);
  const translation = localTranslateHeadline(title);
  return {
    id: item.id || `${sourceName}:${symbol}:${title}`.slice(0, 200),
    symbol,
    title,
    koTitle: translation.koTitle,
    translationStatus: translation.status,
    summary: localSummary(summary),
    url: item.url || '',
    source: item.source || sourceName,
    publishedAt: item.publishedAt || null,
    sentiment,
    importance: importance(`${title} ${summary}`),
    relatedTickers: relatedTickers(`${title} ${summary}`, symbol)
  };
}

async function fetchFinnhubNews(symbol, token = config.finnhubApiKey) {
  if (!token) return null;
  const to = new Date().toISOString().slice(0, 10);
  const fromDate = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const url = `https://finnhub.io/api/v1/company-news?symbol=${encodeURIComponent(symbol)}&from=${fromDate}&to=${to}&token=${encodeURIComponent(token)}`;
  const data = await fetchWithTimeout(url);
  if (!Array.isArray(data)) throw new Error('Finnhub company-news 응답 형식 오류');
  return data.slice(0, 30).map((item) => normalizeNewsItem({
    id: String(item.id || item.url || item.headline),
    title: item.headline,
    description: item.summary,
    url: item.url,
    source: item.source,
    publishedAt: item.datetime ? new Date(item.datetime * 1000).toISOString() : null
  }, symbol, 'Finnhub'));
}

async function fetchYahooRss(symbol) {
  const url = `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${encodeURIComponent(symbol)}&region=US&lang=en-US`;
  const xml = await fetchWithTimeout(url, {}, 7000);
  const items = [...String(xml).matchAll(/<item[\s\S]*?<\/item>/gi)].map((match) => match[0]);
  return items.slice(0, 30).map((item) => normalizeNewsItem({
    id: textBetween(item, 'guid') || textBetween(item, 'link') || textBetween(item, 'title'),
    title: textBetween(item, 'title'),
    description: textBetween(item, 'description'),
    url: textBetween(item, 'link'),
    source: 'Yahoo Finance RSS',
    publishedAt: textBetween(item, 'pubDate') ? new Date(textBetween(item, 'pubDate')).toISOString() : null
  }, symbol, 'Yahoo Finance RSS'));
}

export async function fetchNews(symbol, userApiKeys = {}) {
  const normalized = String(symbol || 'AAPL').trim().toUpperCase().replace(/\.(KS|KQ)$/u, '');
  const errors = [];
  if (userApiKeys.finnhub || config.finnhubApiKey) {
    try {
      const finnhub = await fetchFinnhubNews(normalized, userApiKeys.finnhub || config.finnhubApiKey);
      if (finnhub?.length) return { symbol: normalized, items: finnhub, status: DATA_STATUS.NEAR_REALTIME, statusMessage: 'Finnhub company-news API 기반 뉴스입니다.', source: 'Finnhub', updatedAt: new Date().toISOString() };
      errors.push('Finnhub: 결과 없음');
    } catch (error) {
      errors.push(`Finnhub: ${error.message}`);
    }
  }
  try {
    const rss = await fetchYahooRss(normalized);
    if (rss.length) return { symbol: normalized, items: rss, status: DATA_STATUS.DELAYED, statusMessage: 'RSS 기반 공개 뉴스입니다. 번역은 Gemini API가 없으면 일부 로컬 규칙만 적용됩니다.', source: 'Yahoo Finance RSS', updatedAt: new Date().toISOString() };
    errors.push('RSS: 결과 없음');
  } catch (error) {
    errors.push(`RSS: ${error.message}`);
  }
  return { symbol: normalized, items: [], status: DATA_STATUS.NO_DATA, statusMessage: errors.join(' | ') || '뉴스 데이터 없음', source: null, updatedAt: new Date().toISOString() };
}

export async function translateWithGemini(items, apiKey = config.geminiApiKey, model = config.geminiModel) {
  if (!apiKey || !items?.length) return items;
  const prompt = [
    '다음 미국 금융 뉴스 헤드라인을 한국어로 정확하고 간결하게 번역하라.',
    'JSON 배열만 반환하라. 각 원소는 {"id":"...","koTitle":"...","koSummary":"..."} 형식이다.',
    JSON.stringify(items.slice(0, 10).map((item) => ({ id: item.id, title: item.title, summary: item.summary })))
  ].join('\n');
  const response = await fetchWithTimeout(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.1, maxOutputTokens: 2048 } })
  }, 12000);
  const text = response?.candidates?.[0]?.content?.parts?.map((p) => p.text).join('\n') || '';
  const jsonText = text.replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
  let translated = [];
  try {
    translated = JSON.parse(jsonText);
  } catch {
    return items;
  }
  const map = new Map(translated.map((item) => [item.id, item]));
  return items.map((item) => {
    const hit = map.get(item.id);
    return hit ? { ...item, koTitle: hit.koTitle || item.koTitle, koSummary: hit.koSummary || item.summary, translationStatus: 'Gemini 번역' } : item;
  });
}

export async function getNewsWithOptionalTranslation(symbol, userApiKeys = {}) {
  const news = await fetchNews(symbol, userApiKeys);
  const geminiKey = userApiKeys.gemini || config.geminiApiKey;
  if (geminiKey && news.items.length) {
    try {
      news.items = await translateWithGemini(news.items, geminiKey, config.geminiModel);
      news.statusMessage += ' Gemini 번역이 적용되었습니다.';
    } catch (error) {
      news.statusMessage += ` Gemini 번역 실패: ${error.message}`;
    }
  }
  return news;
}
