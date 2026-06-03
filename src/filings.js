import { config } from './config.js';
import { DATA_STATUS } from './marketData.js';

export const CIK_MAP = {
  AAPL: '0000320193',
  MSFT: '0000789019',
  NVDA: '0001045810',
  AMZN: '0001018724',
  TSLA: '0001318605',
  GOOGL: '0001652044',
  GOOG: '0001652044',
  META: '0001326801',
  BRK: '0001067983',
  JPM: '0000019617',
  V: '0001403161',
  UNH: '0000731766',
  XOM: '0000034088'
};

const DART_CORP_MAP = {
  '005930': { corpCode: '00126380', name: '삼성전자' },
  '000660': { corpCode: '00164779', name: 'SK하이닉스' },
  '035420': { corpCode: '00266961', name: 'NAVER' },
  '051910': { corpCode: '00356370', name: 'LG화학' },
  '005380': { corpCode: '00164742', name: '현대자동차' }
};

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

function normalizeTicker(raw) {
  return String(raw || '').trim().toUpperCase().replace(/\.(US|O|N)$/u, '');
}

export async function getSecFilings(symbolOrCik) {
  const input = String(symbolOrCik || '').trim().toUpperCase();
  const cik = /^\d{1,10}$/.test(input) ? input.padStart(10, '0') : CIK_MAP[normalizeTicker(input)];
  if (!cik) {
    return {
      symbol: input,
      cik: null,
      filings: [],
      status: DATA_STATUS.NO_DATA,
      statusMessage: '내장 CIK 매핑에 없는 심볼입니다. CIK 번호를 직접 입력하거나 CIK_MAP을 확장하십시오.',
      source: 'SEC EDGAR'
    };
  }
  try {
    const data = await fetchWithTimeout(`https://data.sec.gov/submissions/CIK${cik}.json`, {
      headers: {
        'User-Agent': config.secUserAgent,
        'Accept-Encoding': 'gzip, deflate',
        'Host': 'data.sec.gov'
      }
    });
    const recent = data?.filings?.recent || {};
    const forms = recent.form || [];
    const filings = forms.map((form, idx) => ({
      form,
      filingDate: recent.filingDate?.[idx] || null,
      reportDate: recent.reportDate?.[idx] || null,
      accessionNumber: recent.accessionNumber?.[idx] || null,
      primaryDocument: recent.primaryDocument?.[idx] || null,
      description: recent.primaryDocDescription?.[idx] || null,
      url: recent.accessionNumber?.[idx] && recent.primaryDocument?.[idx]
        ? `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${String(recent.accessionNumber[idx]).replace(/-/g, '')}/${recent.primaryDocument[idx]}`
        : null
    })).slice(0, 30);
    return {
      symbol: input,
      cik,
      entityName: data.name || null,
      filings,
      status: filings.length ? DATA_STATUS.DELAYED : DATA_STATUS.NO_DATA,
      statusMessage: filings.length ? 'SEC EDGAR 공개 API 기반 공시입니다. 실시간 이벤트 피드는 별도 공급자가 필요할 수 있습니다.' : 'SEC recent filings가 비어 있습니다.',
      source: 'SEC EDGAR submissions API',
      updatedAt: new Date().toISOString()
    };
  } catch (error) {
    return {
      symbol: input,
      cik,
      filings: [],
      status: DATA_STATUS.ERROR,
      statusMessage: `SEC 요청 실패: ${error.message}`,
      source: 'SEC EDGAR submissions API',
      updatedAt: new Date().toISOString()
    };
  }
}

export function lookupDartCorp(input) {
  const value = String(input || '').trim().replace(/\.KS|\.KQ/iu, '');
  return DART_CORP_MAP[value] || (/^\d{8}$/.test(value) ? { corpCode: value, name: null } : null);
}

export async function getDartFilings(input, apiKey = config.dartApiKey) {
  const lookup = lookupDartCorp(input);
  if (!lookup) {
    return {
      input,
      corpCode: null,
      filings: [],
      status: DATA_STATUS.NO_DATA,
      statusMessage: '내장 DART corp_code 매핑에 없는 종목입니다. 8자리 corp_code를 직접 입력하거나 DART corpCode.xml을 동기화하십시오.',
      source: 'OpenDART'
    };
  }
  if (!apiKey) {
    return {
      input,
      corpCode: lookup.corpCode,
      entityName: lookup.name,
      filings: [],
      status: DATA_STATUS.API_REQUIRED,
      statusMessage: 'DART_API_KEY가 필요합니다. OpenDART 인증키를 환경변수 또는 사용자 설정에 저장하십시오.',
      source: 'OpenDART'
    };
  }
  const end = new Date();
  const start = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const format = (date) => date.toISOString().slice(0, 10).replace(/-/g, '');
  const params = new URLSearchParams({ crtfc_key: apiKey, corp_code: lookup.corpCode, bgn_de: format(start), end_de: format(end), page_count: '50' });
  try {
    const data = await fetchWithTimeout(`https://opendart.fss.or.kr/api/list.json?${params.toString()}`);
    if (data?.status && data.status !== '000') {
      return {
        input,
        corpCode: lookup.corpCode,
        entityName: lookup.name,
        filings: [],
        status: DATA_STATUS.NO_DATA,
        statusMessage: `OpenDART status ${data.status}: ${data.message}`,
        source: 'OpenDART disclosure list API',
        updatedAt: new Date().toISOString()
      };
    }
    const filings = (data.list || []).map((item) => ({
      corpCode: item.corp_code,
      corpName: item.corp_name,
      stockCode: item.stock_code,
      reportName: item.report_nm,
      receiptNo: item.rcept_no,
      filingDate: item.rcept_dt,
      submitter: item.flr_nm,
      url: item.rcept_no ? `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${item.rcept_no}` : null
    }));
    return {
      input,
      corpCode: lookup.corpCode,
      entityName: lookup.name,
      filings,
      status: filings.length ? DATA_STATUS.DELAYED : DATA_STATUS.NO_DATA,
      statusMessage: filings.length ? 'OpenDART 공시 목록 API 기반 데이터입니다.' : '최근 90일 DART 공시가 없습니다.',
      source: 'OpenDART disclosure list API',
      updatedAt: new Date().toISOString()
    };
  } catch (error) {
    return {
      input,
      corpCode: lookup.corpCode,
      entityName: lookup.name,
      filings: [],
      status: DATA_STATUS.ERROR,
      statusMessage: `OpenDART 요청 실패: ${error.message}`,
      source: 'OpenDART disclosure list API',
      updatedAt: new Date().toISOString()
    };
  }
}
