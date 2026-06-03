# API 키 설정 문서

## 원칙

- API 키가 없어도 앱은 실행됩니다.
- API 키가 없으면 해당 영역에 `API 필요` 또는 `데이터 없음`을 표시합니다.
- 앱은 값을 임의 생성하지 않습니다.
- 사용자별 API 키는 로그인 후 Settings 위젯에서 저장할 수 있으며 서버 파일 DB에는 AES-256-GCM으로 암호화됩니다.
- 운영 서버에서는 `.env` 기반 서버 키를 우선 사용하고, 개인 키 저장은 최소 권한 정책을 적용하십시오.

## 시장 데이터

### FINNHUB_API_KEY

용도:
- 미국 주식 quote
- 미국 주식 candle
- 회사 뉴스
- 일부 실적/펀더멘털 확장 가능

환경변수:

```bash
FINNHUB_API_KEY=...
MARKET_DATA_PROVIDER=auto
```

상태 표시:
- 키 있음: `근실시간`
- 키 없음: Yahoo 공개 fallback 또는 `API 필요`
- 공급자 응답 없음: `데이터 없음`

### TWELVE_DATA_API_KEY

용도:
- 주식, ETF, 지수, 환율, 원자재 time series/quote 확장

환경변수:

```bash
TWELVE_DATA_API_KEY=...
MARKET_DATA_PROVIDER=auto
```

### POLYGON_API_KEY

용도:
- 운영용 실시간/저지연 주식 데이터
- 옵션 체인과 옵션 시세
- ETF/FX/crypto 등 확장

현재 프로젝트는 구조와 문서를 포함하고, 옵션 fallback은 Yahoo 공개 엔드포인트를 사용합니다. 운영 환경에서는 Polygon 어댑터를 `src/marketData.js`에 추가해 공식 계약 데이터로 전환하는 것을 권장합니다.

## 공시

### SEC_USER_AGENT

SEC EDGAR 공개 API는 API 키가 필요하지 않지만 요청자 식별 User-Agent가 필요합니다.

```bash
SEC_USER_AGENT=k-terminal-finance/1.0 your-email@example.com
```

### DART_API_KEY

OpenDART 공시 목록 API에 필요합니다.

```bash
DART_API_KEY=...
```

키가 없으면 DART 위젯은 `API 필요`를 표시합니다.

## AI / 번역

### GEMINI_API_KEY

용도:
- 뉴스 한국어 번역
- 종목/뉴스/공시/차트/포트폴리오 기반 한국어 분석

```bash
GEMINI_API_KEY=...
GEMINI_MODEL=gemini-2.5-flash
AI_PROVIDER=gemini
```

키가 없으면:
- 뉴스: 원문, 감성, 중요도, 관련 티커, 로컬 규칙 번역 가능 부분만 표시
- AI: 로컬 규칙 기반 요약으로 대체

## 브로커

### Alpaca Paper

```bash
TRADING_DEFAULT_MODE=paper
ALPACA_KEY_ID=...
ALPACA_SECRET_KEY=...
ALPACA_PAPER=true
```

키가 있으면 Alpaca Paper API로 주문을 제출합니다. 키가 없으면 로컬 Paper 주문으로 파일 DB에 기록합니다.

### Interactive Brokers

```bash
IBKR_BASE_URL=https://localhost:5000/v1/api
```

현재 프로젝트는 구조와 문서를 제공합니다. Client Portal Gateway 또는 TWS/IB Gateway 인증 흐름을 운영 환경에 맞게 구현하십시오.

### 한국투자증권 Open API

```bash
KIS_APP_KEY=...
KIS_APP_SECRET=...
KIS_ACCOUNT_NO=...
KIS_PRODUCT_CODE=...
KIS_PAPER=true
```

현재 프로젝트는 구조와 문서를 제공합니다. OAuth/token, hashkey, TR ID, 실전/모의 도메인 분리 구현이 필요합니다.

## 사용자별 API 키 저장

1. 로그인
2. Settings 위젯 열기
3. provider별 API 키 입력
4. SAVE

주의:
- API 키는 브라우저 localStorage에 저장하지 않습니다.
- 서버 DB에는 암호화된 ciphertext만 저장합니다.
- `SECRET_KEY`가 바뀌면 기존 API 키 복호화가 불가능합니다.
- 운영 서버에서는 파일 DB 권한을 서비스 계정으로 제한하십시오.
