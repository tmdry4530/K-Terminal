# auto-dom + Crypto Signal 연동

이 터미널은 [`auto-dom`](https://github.com/tmdry4530/auto-dom) 로컬 트레이딩 브릿지의 **운영 콕핏**입니다.
시그널 수집/점수화/검증은 Crypto Signal 에이전트가, 주문 승인·실행은 auto-dom의 deterministic
risk/execution gate가 담당합니다. 터미널은 **관측 + 부작용 없는 preview + 비상정지**만 하며
**주문을 개시하지 않고 Binance 키도 보유하지 않습니다.**

## 토폴로지 (한 PC에서 모두 로컬 실행)

```
[같은 PC — 전부 localhost]
  Crypto Signal 에이전트 ──POST /v1/signals/submit──▶ auto-dom 브릿지(127.0.0.1:8765) ──실행 모드시──▶ Binance USDⓈ-M
                                                            ▲
                                                            │ localhost 프록시 + inbox JSONL 읽기
                                                   K Terminal (이 앱) ←UI→ 브라우저
```

- 에이전트는 시그널을 **auto-dom에 직접** 전달합니다 (터미널은 수신구가 아님).
- 터미널은 auto-dom의 **inbox JSONL**을 읽어 SIGNALS 피드를 보여주고, 브릿지 HTTP를 프록시해
  상태/판정/비상정지를 노출합니다.
- SIGNALS 피드는 각 뉴스 시그널을 `프리뷰대상` / `게이트검토` / `관찰` / `거래금지`로 분리합니다.
  이 판정은 UI용 사전 필터이며, 주문 승인이나 실행 권한이 아닙니다.

## 실행 순서 (대상 PC)

1. **auto-dom 브릿지** (Python 3.13+):
   ```bash
   cd /path/to/auto-dom
   cp .env.example .env          # Binance 키 등은 여기(터미널 아님)에 둠
   PYTHONPATH=src python3 -m auto_dom.bridge.http --host 127.0.0.1 --port 8765
   # 기본 AUTO_DOM_BRIDGE_MODE=ingest_only → 검증·저장만, 주문 없음
   ```
2. **Crypto Signal 에이전트**: auto-dom `POST /v1/signals/submit`으로 시그널 전달하도록 설정.
3. **이 터미널**:
   ```bash
   cp .env.example .env
   # .env 에 아래를 맞춤
   #   AUTO_DOM_URL=http://127.0.0.1:8765
   #   AUTO_DOM_INBOX_PATH=../auto-dom/var/signals/inbox.jsonl   # auto-dom inbox 경로
   #   AUTO_DOM_BRIDGE_TOKEN=...                                  # 브릿지가 토큰 요구 시
   npm start
   ```

`시그널` 탭에서 SIGNALS 피드 + EXECUTION GATE(모드 배지·kill-switch·일일정지·caps·preview)를 봅니다.

## 터미널이 노출하는 것

| 라우트 | 동작 |
|---|---|
| `GET /api/autodom/status` | 브릿지 health + `/v1/status` (모드·카운터·kill-switch·daily-stop·live_enabled). 오프라인이면 `online:false` |
| `GET /api/autodom/dashboard` | `/v1/dashboard/snapshot` (caps, env readiness 불리언 — 시크릿 없음) |
| `GET /api/signals/recent` | auto-dom inbox JSONL tail을 파싱해 최신순 반환. 각 항목에 뉴스매매 사전판정(`newsTrade`) 포함 |
| `GET /api/signals/executions` | auto-dom runtime/live audit를 읽어 실행 판정과 원 signal 근거를 표시 |
| `POST /api/signals/preview` | `/v1/signals/preview` — 부작용 없는 risk/exec 판정 (로그인 필요) |
| `POST /api/autodom/agent/actions` | `pause_trading` / `resume_trading`(operator_approved 필요). 주문/레버리지 변경 불가 |

SSE `/api/stream`의 `signal` 이벤트로 새 시그널이 실시간 점멸합니다. 특정 심볼 감시/수동 진입 폼은 이 파이프라인 범위가 아니므로 제거했습니다.

## 안전 모델

- 터미널은 **Binance 키 미보유**. 키·실행은 전적으로 auto-dom 소관.
- **LIVE는 터미널로 켤 수 없음** — auto-dom 브릿지 env double-lock
  (`AUTO_DOM_LIVE_TRADING_ENABLED=1` + 날짜 확인 `AUTO_DOM_LIVE_CONFIRMATION` + kill-switch clear + caps)
  으로만 열립니다. 자세한 절차는 auto-dom `README` / `docs/OPERATOR_RUNBOOK.md` 참고.
- 터미널 preview는 **부작용 없음**(inbox/주문 미기록). 터미널에서 가능한 변경 동작은 비상 `pause`와
  operator 승인 `resume`뿐.
- 현재 모드를 상단에 크게 표시(LIVE = 빨강 + 점멸). 브릿지 오프라인도 명확히 표시.
- inbox 읽기/브릿지 호출 실패는 모두 fail-soft(정직한 "오프라인/데이터 없음"), 가짜값 미생성.
