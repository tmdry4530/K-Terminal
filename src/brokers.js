import { config } from './config.js';
import { DATA_STATUS } from './marketData.js';
import { store } from './store.js';

function normalizeOrder(raw = {}) {
  const symbol = String(raw.symbol || '').trim().toUpperCase();
  const side = String(raw.side || '').toLowerCase();
  const type = String(raw.type || 'market').toLowerCase();
  const timeInForce = String(raw.timeInForce || raw.time_in_force || 'day').toLowerCase();
  const quantity = Number(raw.quantity || raw.qty);
  const limitPrice = raw.limitPrice === undefined || raw.limitPrice === '' ? null : Number(raw.limitPrice);
  if (!symbol) throw new Error('심볼이 필요합니다.');
  if (!['buy', 'sell'].includes(side)) throw new Error('side는 buy 또는 sell이어야 합니다.');
  if (!Number.isFinite(quantity) || quantity <= 0) throw new Error('수량이 유효하지 않습니다.');
  if (!['market', 'limit'].includes(type)) throw new Error('주문 유형은 market 또는 limit만 허용됩니다.');
  if (type === 'limit' && (!Number.isFinite(limitPrice) || limitPrice <= 0)) throw new Error('지정가 주문에는 양수 limitPrice가 필요합니다.');
  return { symbol, side, type, timeInForce, quantity, limitPrice };
}

async function fetchJson(url, options = {}, timeoutMs = 9000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const text = await response.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
    if (!response.ok) throw new Error(data?.message || data?.error || `HTTP ${response.status}`);
    return data;
  } finally {
    clearTimeout(timeout);
  }
}

async function placeAlpacaPaperOrder(order) {
  if (!config.alpacaKeyId || !config.alpacaSecretKey) return null;
  if (!config.alpacaPaper) return null;
  const body = {
    symbol: order.symbol,
    qty: String(order.quantity),
    side: order.side,
    type: order.type,
    time_in_force: order.timeInForce
  };
  if (order.type === 'limit') body.limit_price = String(order.limitPrice);
  const data = await fetchJson(`${config.alpacaPaperBaseUrl}/v2/orders`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'APCA-API-KEY-ID': config.alpacaKeyId,
      'APCA-API-SECRET-KEY': config.alpacaSecretKey
    },
    body: JSON.stringify(body)
  });
  return {
    broker: 'alpaca-paper',
    mode: 'paper',
    brokerOrderId: data.id,
    status: data.status || 'submitted',
    raw: data
  };
}

export async function placeOrder({ userId, order: rawOrder, mode = 'paper', userSettings = {} }) {
  const order = normalizeOrder(rawOrder);
  const requestedMode = String(mode || 'paper').toLowerCase();

  if (requestedMode !== 'paper') {
    const userEnabled = Boolean(userSettings.liveTradingEnabled);
    const ack = rawOrder?.acknowledgement === 'LIVE_ORDER_CONFIRMED';
    if (!config.realTradingEnabled || !userEnabled || !ack) {
      return {
        accepted: false,
        mode: requestedMode,
        status: DATA_STATUS.API_REQUIRED,
        statusMessage: '실거래는 REAL_TRADING_ENABLED=true, 사용자 설정 liveTradingEnabled=true, acknowledgement=LIVE_ORDER_CONFIRMED가 모두 필요합니다. 기본 구현은 안전상 거절합니다.',
        order
      };
    }
    return {
      accepted: false,
      mode: requestedMode,
      status: DATA_STATUS.API_REQUIRED,
      statusMessage: '실거래 브로커 주문 어댑터는 구조만 제공됩니다. Alpaca/IBKR/KIS live 어댑터 구현 후 별도 보안 검토가 필요합니다.',
      order
    };
  }

  let brokerResult = null;
  try {
    brokerResult = await placeAlpacaPaperOrder(order);
  } catch (error) {
    brokerResult = { broker: 'alpaca-paper', status: 'failed', statusMessage: error.message };
  }

  if (brokerResult?.brokerOrderId) {
    const record = await store.addPaperOrder({ userId, ...order, broker: brokerResult.broker, brokerOrderId: brokerResult.brokerOrderId, brokerStatus: brokerResult.status });
    return { accepted: true, mode: 'paper', status: brokerResult.status, statusMessage: 'Alpaca Paper Trading 주문으로 제출되었습니다.', order: record, brokerResult };
  }

  const record = await store.addPaperOrder({ userId, ...order, broker: 'local-paper', brokerStatus: 'accepted-paper-local' });
  return {
    accepted: true,
    mode: 'paper',
    status: 'accepted-paper-local',
    statusMessage: brokerResult?.statusMessage ? `로컬 Paper 주문으로 기록됨. Alpaca Paper 실패: ${brokerResult.statusMessage}` : '브로커 API 키가 없어 로컬 Paper 주문으로 기록되었습니다.',
    order: record
  };
}

export function brokerCapabilities() {
  return [
    {
      id: 'local-paper',
      name: 'Local Paper Trading',
      mode: 'paper',
      configured: true,
      canPlaceOrder: true,
      statusMessage: 'API 키 없이 로컬 파일 DB에 모의 주문을 기록합니다.'
    },
    {
      id: 'alpaca-paper',
      name: 'Alpaca Paper Trading API',
      mode: 'paper',
      configured: Boolean(config.alpacaKeyId && config.alpacaSecretKey && config.alpacaPaper),
      canPlaceOrder: Boolean(config.alpacaKeyId && config.alpacaSecretKey && config.alpacaPaper),
      statusMessage: 'ALPACA_KEY_ID, ALPACA_SECRET_KEY, ALPACA_PAPER=true 필요.'
    },
    {
      id: 'ibkr',
      name: 'Interactive Brokers Client Portal / TWS API',
      mode: 'paper/live',
      configured: Boolean(config.ibkrBaseUrl),
      canPlaceOrder: false,
      statusMessage: '어댑터 구조 문서화. 게이트웨이 인증과 주문 확인 UI 구현 후 활성화하십시오.'
    },
    {
      id: 'kis',
      name: '한국투자증권 Open API',
      mode: 'paper/live',
      configured: Boolean(config.kisAppKey && config.kisAppSecret),
      canPlaceOrder: false,
      statusMessage: '어댑터 구조 문서화. 토큰 발급/계좌 검증/주문 확인 UI 구현 후 활성화하십시오.'
    }
  ];
}
