# K Terminal Finance

한국어 기반 고밀도 금융 터미널입니다. 미국 주식 투자자를 기본 대상으로 하며 미국 주식, ETF, 지수, 금리, 원자재, 환율, 암호화폐, 뉴스, SEC 공시, 옵션, 포트폴리오(다통화 환산), AI 요약, Paper Trading, 한국 주식과 DART 공시, 실적·경제 캘린더를 함께 다룹니다.

첨부된 레퍼런스 이미지는 `docs/reference-terminal.png`에 포함되어 있으며 UI 밀도와 패널 배치 기준으로 사용했습니다.

## 주요 기능

- **실시간 스트리밍**: SSE(`/api/stream`)로 지수·관심종목·암호화폐 시세를 자동 갱신하고 변동 시 셀이 점멸합니다. 상단 `LIVE` 배지로 연결 상태를 표시합니다.
- **암호화폐**: Binance/CoinGecko/Coinbase 공개 API로 BTC/ETH/SOL 등 USD·KRW 시세와 차트를 제공합니다.
- **다통화 포트폴리오**: 모든 보유 종목을 기준통화로 환산해 합산하며(USD+KRW 혼합 정확), 자본이익과 환차익을 분리합니다.
- **가격/지표 알림**: 가격·변동%·RSI 임계치 알림을 브라우저 알림과 토스트로 발동합니다.
- **실적·경제 캘린더**: Finnhub/Nasdaq 실적, FRED 미국 경제지표 릴리즈 일정.
- **터미널 UX**: 명령창 자동완성·기록, 키보드 단축키(`?`로 도움말), 차트 크로스헤어와 다중 심볼 정규화 비교.
- **보안**: CSP·보안 헤더, IP 기반 레이트리밋(인증 엄격), Origin 기반 CSRF 방어.
- **성능**: TTL + stale-while-revalidate + single-flight 캐시로 동시 동일 요청을 1회 업스트림 호출로 합칩니다.

## 핵심 정책

- 가짜 숫자를 실제처럼 표시하지 않습니다.
- 값이 없으면 `데이터 없음`, 키가 필요하면 `API 필요`, 공개 지연 데이터이면 `지연 데이터`, 공급자 오류이면 `오류`로 표시합니다.
- 비로그인 사용자는 일반 시장 데이터, 차트, 뉴스, SEC 공시, 옵션 조회를 사용할 수 있습니다.
- 로그인 사용자는 포트폴리오, 관심종목, API 키, AI 설정, 레이아웃, 주문 기록을 저장할 수 있습니다.
- 주문은 기본적으로 Paper Trading이며 실거래는 서버 환경변수와 사용자 설정, 명시 확인 문구가 모두 없으면 거절됩니다.

## 빠른 실행

```bash
cp .env.example .env
# .env의 SECRET_KEY를 운영 전 반드시 강한 난수로 교체
npm start
```

브라우저에서 `http://localhost:8080` 접속.

의존성 없는 Node.js 프로젝트입니다. Node 20.10 이상에서 실행됩니다. `.env` 파일은 시작 시 자동으로 로드되며(실제 환경변수가 우선), 키가 없어도 공개 무료 데이터로 동작합니다.

## 테스트

```bash
npm test
npm run check
npm run smoke
```

`npm run smoke`는 서버를 임시 포트로 띄운 뒤 `/api/health`, `/api/meta`, `/api/market/chart`를 호출합니다. 외부 네트워크가 차단되어 있으면 차트 API는 `데이터 없음` 또는 `오류` 상태를 반환할 수 있으며, 이 경우에도 가짜 값은 생성하지 않습니다.

## Docker 실행

```bash
cp .env.example .env
docker compose up --build
```

데이터는 `./data` 볼륨에 저장됩니다.

## 주요 화면

- 상단: 전역 메뉴, 명령창, AI 버튼, 로그인, 지수 스트립
- 내부 탭: 시장, 모니터, 차트, 뉴스, 포트폴리오, 옵션, 주문, AI
- 패널: 좌측/중앙/우측 폭 조절 가능
- 위젯: 드래그앤드롭 순서 변경, CSS resize 기반 크기 조절, 사용자별 레이아웃 저장
- 차트: 캔들, 거래량, MA20, MA50, Bollinger Band, RSI, MACD
- 기간: 1M / 3M / 6M / 1Y / 2Y / 5Y / 10Y
- 인터벌: 1D / 1W / 1M

## API 키 요약

| 기능 | 환경변수 | 필수 여부 | 설명 |
|---|---|---:|---|
| 미국 주식/뉴스 | `FINNHUB_API_KEY` | 선택 | 근실시간 quote, candle, company news |
| 주식/ETF/FX/원자재 | `TWELVE_DATA_API_KEY` | 선택 | 글로벌 time series/quote |
| 옵션/실시간 고급 데이터 | `POLYGON_API_KEY` | 선택 | 현재 구조와 문서 포함. 운영 연결 권장 |
| SEC EDGAR | `SEC_USER_AGENT` | 권장 | SEC 공개 API 호출 시 식별 User-Agent |
| OpenDART | `DART_API_KEY` | DART 필요 | 한국 공시 조회 |
| 실적 캘린더 | `FINNHUB_API_KEY` | 선택 | 기간 실적 일정(없으면 Nasdaq 당일 비공식 fallback) |
| 경제 캘린더 | `FRED_API_KEY` | 선택 | 미국 경제지표 릴리즈 일정 |
| 암호화폐 | (불필요) | — | Binance/CoinGecko/Coinbase 공개 API, 키 없이 동작 |
| AI/번역 | `GEMINI_API_KEY` | 선택 | 한국어 번역/분석. 없으면 로컬 규칙 요약 |
| Alpaca Paper | `ALPACA_KEY_ID`, `ALPACA_SECRET_KEY`, `ALPACA_PAPER=true` | 선택 | Paper 주문 API 제출 |
| IBKR | `IBKR_BASE_URL` | 선택 | Client Portal/TWS 어댑터 구조 |
| 한국투자증권 | `KIS_APP_KEY`, `KIS_APP_SECRET` | 선택 | Open API 어댑터 구조 |

상세 문서는 `docs/API_KEYS.md`, `docs/DATA_POLICY.md`, `docs/BROKERS.md`, `docs/SECURITY.md`, `docs/DEPLOYMENT.md`를 확인하십시오.

## 명령창 예시

- `AAPL`: AAPL 차트로 이동
- `NEWS NVDA`: NVDA 뉴스 화면 이동
- `PORT`: 포트폴리오 화면 이동
- `AI NVDA 리스크 요약`: AI 탭 이동

## 프로젝트 구조

```text
src/
  server.js       HTTP API + 정적 파일 서버
  marketData.js   Yahoo fallback, Finnhub, Twelve Data quote/chart, 옵션
  news.js         뉴스, 감성, 중요도, 번역 연결
  filings.js      SEC EDGAR, OpenDART
  portfolio.js    보유종목 평가/비중/리밸런싱
  brokers.js      Paper Trading, Alpaca Paper, live 주문 안전 차단
  store.js        파일 기반 사용자/세션/설정/API 키/포트폴리오 저장
  crypto.js       scrypt 비밀번호 해시, AES-GCM API 키 암호화
public/
  index.html
  styles.css
  app.js          드래그/리사이즈/차트/탭 UI
docs/
  *.md
  reference-terminal.png
```

## 운영 전 필수 점검

1. `SECRET_KEY`를 충분히 긴 난수로 교체하고 유출하지 마십시오.
2. `COOKIE_SECURE=true`, HTTPS reverse proxy, 방화벽, 백업 암호화를 적용하십시오.
3. 운영 데이터는 파일 DB 대신 PostgreSQL 또는 관리형 DB로 교체하는 것을 권장합니다.
4. 실거래 주문은 기본적으로 차단되어 있습니다. 브로커별 live 어댑터 구현, 권한 분리, 주문 확인 UX, 감사 로그, 장애 대응 절차가 완료되기 전 활성화하지 마십시오.
5. 공개 fallback 데이터는 운영용 실시간 시세 SLA가 없습니다. 실시간/상업용 서비스에는 정식 데이터 공급자 계약이 필요합니다.
