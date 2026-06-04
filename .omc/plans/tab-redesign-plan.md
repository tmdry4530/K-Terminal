# K Terminal — 탭별 화면 재구성 + UI 버그 일괄 수정

## 프로젝트 목적 (재확인)
크립토 전용 **auto-dom 운영 콕핏**. 파이프라인: 원격 AI 에이전트(뉴스→시그널) → auto-dom(Binance 선물 실행/라이브 게이팅) → **이 터미널은 관측만**(시그널 피드·실행 게이트·포지션+근거). 자체 주문/거래 기능 없음.

현재 탭(3): 시장 / 시그널 / 차트. 위젯(9): market-pulse, watchlist, data-sources, chart, alerts, settings, signals, execution-gate, positions.

## 감사 결과 (2026-06-04, Playwright 1440×900 + 390)
- 전 탭 가로 오버플로 없음, 콘솔 에러 없음(로그인 password autocomplete VERBOSE 힌트만).
- 모바일 390: 3패널 스택 정상.
- **버그 ①(🔴)**: `getViewLayout` sanitizer — 저장 레이아웃이 제거된 위젯만 담으면 패널이 DEFAULT로 폴백하지 않고 전부 빈 화면(0,0,0). 재현됨.
- **버그 ②**: 로그인 password input `autocomplete` 누락(콘솔 힌트 x6).
- **버그 ③**: 죽은 CSS 10+ 클래스(news-*, chat-*, ai-input, filing-item, cal-watch, paper-banner, live-block 등) — app.js 미참조.
- **구성 이슈**: SETTINGS가 시장·차트 패널 위젯으로 노출돼 공간 차지(콕핏엔 config는 헤더 기어/모달이 적합). 탭 목적 분화 약함. 기본 탭이 시장(콕핏이면 시그널이 자연스러움).

## 스토리
### G001 — 시그널 콕핏 재구성
시그널 탭을 운영자 중심 화면으로: SIGNALS 피드 → EXECUTION GATE → POSITIONS(근거 포함) 흐름을 시각적으로 강조하고 레이아웃 균형. 콕핏을 기본 진입 탭으로. fixtures로 채운 상태 + 오프라인 빈 상태 모두 검증. Playwright 데스크탑+모바일, 콘솔 0.

### G002 — 시장·차트 탭 재구성 + SETTINGS 모달화
시장=시장 개요(펄스·워치리스트·알림·차트·데이터소스), 차트=집중 차트로 목적 분리. SETTINGS를 패널 위젯에서 빼고 헤더 기어 버튼→모달로 이동해 패널 정리. 위젯 분포 재균형. Playwright 검증, 콘솔 0.

### G003 — UI 버그 일괄 수정 + 최종 게이트
모든 자잘한 UI 버그 수정: (1) sanitizer 빈-패널 시 DEFAULT 폴백, (2) 로그인 autocomplete 속성, (3) 죽은 CSS 제거, (4) 스윕 중 추가 발견분. 최종 게이트: ai-slop-cleaner + verification(check/test/smoke + Playwright) + code-review(APPROVE) + architect(CLEAR).

## 검증 정책
각 스토리: check + test + smoke green, Playwright 실측(레이아웃/콘솔), 커밋+푸시. no-fake-numbers 정책 유지. 터미널 관측-전용 불변식 유지.
