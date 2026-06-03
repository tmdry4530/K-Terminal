# 대상 PC 배포 체크리스트

K Terminal + auto-dom + Crypto Signal 에이전트를 **한 PC에서** 안전하게 올리는 순서.
모든 단계는 **비실거래(paper/testnet)부터**. live는 마지막, auto-dom 자체 double-lock으로만.

## 0. 프로젝트 옮기기
- GitHub 사용: 이 repo를 push → 대상 PC에서 `git clone`
- GitHub 없이: `git bundle`로 만든 `k-terminal-finance.bundle` 파일을 복사 → `git clone k-terminal-finance.bundle k-terminal-finance`
- auto-dom: `git clone https://github.com/tmdry4530/auto-dom` (터미널과 **같은 부모 폴더**에 두면 기본 경로가 맞음)

## 1. 사전 요건
- [ ] Node **20.10+** (`node --version`)
- [ ] Python **3.13+** (auto-dom 브릿지용 — 3.12면 안 뜸)
- [ ] 두 폴더가 형제 관계: `<parent>/k-terminal-finance`, `<parent>/auto-dom`

## 2. auto-dom (먼저, 안전 모드)
```bash
cd auto-dom
cp .env.example .env
# .env: BINANCE_FUTURES_ENV=testnet + testnet 키, AUTO_DOM_BRIDGE_MODE=ingest_only
make check            # lint/typecheck/test/smoke (선택)
PYTHONPATH=src python3 -m auto_dom.bridge.http --host 127.0.0.1 --port 8765
curl http://127.0.0.1:8765/health      # {"ok":true,...,"mode":"ingest_only"}
```
- [ ] `/health` ok, mode 확인. **이 단계에선 주문이 절대 안 나감.**

## 3. 터미널 (.env 연결)
```bash
cd k-terminal-finance
cp .env.example .env
# .env 확인/수정:
#   AUTO_DOM_URL=http://127.0.0.1:8765
#   AUTO_DOM_INBOX_PATH=../auto-dom/var/signals/inbox.jsonl
#   AUTO_DOM_LIVE_AUDIT_PATH=../auto-dom/var/orders/live_audit.jsonl
#   AUTO_DOM_AUDIT_ROOT=../auto-dom/var/bridge/audit
#   SECRET_KEY=<강한 난수 32자+>   (운영 시 필수, 미설정 시 NODE_ENV=production 부팅 거부)
npm start            # http://localhost:8080
```
- [ ] `시그널` 탭: EXECUTION GATE에 `MODE · INGEST_ONLY`(또는 현재 모드) 표시, 오프라인 아님

## 4. Crypto Signal 에이전트
- [ ] 에이전트가 `SIGNAL_SCHEMA.json` 형태로 **auto-dom** `POST /v1/signals/submit`에 전달하도록 설정
- [ ] 시그널 보내보면 터미널 SIGNALS 피드에 실시간 등장(SSE), 클릭 시 게이트에 근거 표시

## 5. 한 번에 올리기 (선택)
- Windows: `powershell -ExecutionPolicy Bypass -File scripts\run-all.ps1`
- mac/Linux: `AUTO_DOM_DIR=../auto-dom bash scripts/run-all.sh`
- (에이전트는 별도 실행)

## 6. 실행 모드 승급 (각 단계 검증 후에만)
1. `paper` — 게이트 통과 시 `paper_order` 생성, 거래소 호출 없음
2. `testnet` — Binance testnet 키 + envelope 필요, testnet 주문 경로
3. `mainnet_dry_run` — production 검증, 실제 체결 없음 (`BINANCE_MAINNET_DRY_RUN=1`)
4. `live` — auto-dom에서만: `AUTO_DOM_LIVE_TRADING_ENABLED=1` + `AUTO_DOM_LIVE_CONFIRMATION=AUTO_DOM_LIVE_YYYYMMDD` + caps + kill-switch clear. **터미널은 live를 못 켬.**

## 운영 안전
- [ ] Binance 키는 **auto-dom .env에만** (터미널엔 절대 두지 않음)
- [ ] 터미널 운영: `COOKIE_SECURE=true` + HTTPS reverse proxy, `SECRET_KEY` 강한 난수
- [ ] 비상정지: 터미널 게이트의 PAUSE 또는 auto-dom `var/KILL_SWITCH` 파일
- [ ] `.env` / `var/` / `data/` 는 git에 올리지 않음(이미 gitignore)
