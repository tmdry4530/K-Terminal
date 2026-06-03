# 데이터 출처 / 제한 사항 / 가짜 데이터 구분 정책

## 데이터 상태 체계

| 상태 | 의미 |
|---|---|
| `실시간` | 공식 공급자와 계약/권한이 명확한 실시간 데이터. 기본 구현에서는 보수적으로 거의 사용하지 않습니다. |
| `근실시간` | API 공급자 quote/candle 응답. 계정 권한과 거래소 정책에 따라 실시간 또는 지연일 수 있습니다. |
| `지연 데이터` | 공개 엔드포인트, RSS, 공시 API 등 지연 가능성이 있는 실제 데이터. |
| `API 필요` | 데이터 접근에 키 또는 계약이 필요합니다. |
| `데이터 없음` | 공급자가 값을 반환하지 않았습니다. |
| `오류` | 네트워크, rate limit, 인증 실패, 서버 오류 등 요청 실패입니다. |

## 금지 정책

- 차트, 가격, 손익, 환율, 금리, 옵션, 뉴스 수치를 임의로 생성하지 않습니다.
- 로딩 placeholder에 숫자 mock을 넣지 않습니다.
- 공급자 실패 시 이전 값과 새 값을 혼합해 최신처럼 표시하지 않습니다.
- 추정값은 `추정` 또는 `API 필요`로 명확히 표시합니다.

## 공개 fallback

비로그인 사용자를 위해 다음 공개 데이터 경로를 fallback으로 사용합니다.

- Yahoo Finance 공개 chart endpoint: quote/chart fallback
- Yahoo Finance RSS: 뉴스 fallback
- Yahoo Finance 공개 options endpoint: 옵션 fallback
- SEC EDGAR submissions API: 미국 공시

제한:
- 공식 SLA가 없습니다.
- 지연 또는 차단될 수 있습니다.
- 상업 운영 서비스에서는 정식 데이터 공급자 계약이 필요합니다.

## API 공급자 확장 지점

`src/marketData.js`:
- `getQuote`
- `getChart`
- `getSnapshot`
- `getOptions`

`src/news.js`:
- `fetchNews`
- `translateWithGemini`

`src/filings.js`:
- `getSecFilings`
- `getDartFilings`

## 첫 화면 성능 정책

1. `/api/meta`와 `/api/market/snapshot`을 먼저 호출합니다.
2. 지수 스트립과 기본 레이아웃을 먼저 표시합니다.
3. 차트, 뉴스, 공시, 포트폴리오는 백그라운드에서 로딩합니다.
4. 각 위젯 내부는 독립적으로 실패 처리합니다.
