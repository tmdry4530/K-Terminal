# 브로커 API 연동 설계

## 기본 모드

- 기본 주문 모드: Paper Trading
- 브로커 API 키가 없으면 로컬 Paper 주문으로 저장
- Alpaca Paper 키가 있으면 Alpaca Paper API로 제출
- live 주문은 기본 차단

## 주문 API

```http
POST /api/trading/order
Content-Type: application/json
```

Paper 주문:

```json
{
  "mode": "paper",
  "order": {
    "symbol": "AAPL",
    "side": "buy",
    "quantity": 1,
    "type": "market",
    "timeInForce": "day"
  }
}
```

Live 주문은 아래 조건 없이는 거절됩니다.

```json
{
  "mode": "live",
  "order": {
    "symbol": "AAPL",
    "side": "buy",
    "quantity": 1,
    "type": "market",
    "acknowledgement": "LIVE_ORDER_CONFIRMED"
  }
}
```

추가 조건:

```bash
REAL_TRADING_ENABLED=true
```

사용자 설정:

```json
{"liveTradingEnabled": true}
```

## Alpaca Paper

환경변수:

```bash
ALPACA_KEY_ID=...
ALPACA_SECRET_KEY=...
ALPACA_PAPER=true
ALPACA_PAPER_BASE_URL=https://paper-api.alpaca.markets
```

구현 위치:

```text
src/brokers.js -> placeAlpacaPaperOrder()
```

## Interactive Brokers

권장 구조:

- Client Portal Gateway 또는 TWS/IB Gateway를 별도 프로세스로 실행
- 계좌 인증 상태 확인
- 계좌/포트폴리오 조회 adapter 추가
- 주문 전 미리보기 endpoint 추가
- 사용자가 별도 confirmation screen에서 승인
- 감사 로그 저장

구현 위치 제안:

```text
src/brokers/ibkr.js
src/portfolio/ibkrPortfolio.js
```

## 한국투자증권 Open API

필요 항목:

- appkey/appsecret
- 접근토큰 발급
- hashkey 생성
- 실전/모의 도메인 분리
- 계좌번호와 상품코드 검증
- 국내/해외 주식 TR ID 분리

구현 위치 제안:

```text
src/brokers/kis.js
src/portfolio/kisPortfolio.js
```

## 안전 UI 원칙

- Paper 주문 배너 상시 표시
- Live 주문은 별도 색상/문구/확인 절차
- mode가 live이면 API와 UI에서 모두 재확인
- 모의 주문과 실제 주문 기록을 같은 테이블에 혼합하지 않음
- live 기능은 운영 보안 검토 후 별도 feature flag로 배포
