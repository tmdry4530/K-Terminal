# 로그인 / 세션 / API 키 보안 설계

## 인증

- 이메일 + 비밀번호 기반 로그인
- 비밀번호는 scrypt로 해시하고 salt를 함께 저장
- 평문 비밀번호 저장 금지
- 세션 토큰은 랜덤 바이트 기반으로 생성
- 서버 DB에는 세션 토큰 원문이 아니라 SHA-256 해시 저장
- 쿠키는 `HttpOnly`, `SameSite=Lax`, `Path=/` 적용
- 운영 HTTPS에서는 `COOKIE_SECURE=true` 적용

## API 키 암호화

- 사용자별 API 키는 AES-256-GCM으로 암호화
- 암호화 키는 `SECRET_KEY`에서 SHA-256으로 파생
- `.env`의 `SECRET_KEY`는 운영 배포 전 반드시 강한 난수로 교체
- `SECRET_KEY` 변경 시 기존 사용자 API 키는 복호화 불가

## 운영 권장

- HTTPS reverse proxy 또는 L7 load balancer 사용
- `COOKIE_SECURE=true`
- `.env` 파일 권한 600 적용
- 컨테이너 실행 계정 권한 최소화
- 데이터 볼륨 백업 암호화
- 운영 DB는 PostgreSQL 또는 관리형 DB로 교체 권장
- API 키 조회/사용 감사 로그 추가 권장
- 브로커 키는 가능하면 사용자별 저장보다 서버 측 OAuth/권한 위임 구조 사용 권장

## 실거래 주문 안전장치

실거래는 다음 조건이 모두 충족되지 않으면 거절됩니다.

1. 서버 환경변수 `REAL_TRADING_ENABLED=true`
2. 사용자 설정 `liveTradingEnabled=true`
3. 요청 본문 `acknowledgement=LIVE_ORDER_CONFIRMED`
4. 브로커 live 어댑터 구현과 별도 보안 검토 완료

기본 구현은 live 주문을 실제 브로커로 보내지 않습니다. Paper Trading과 live trading은 UI와 API 응답에서 명확히 분리됩니다.

## 남은 보안 과제

프로덕션 전 다음을 추가하십시오.

- CSRF 토큰 또는 double-submit cookie
- 로그인 rate limit
- 이메일 검증 / 비밀번호 재설정
- 감사 로그와 관리자 로그 조회
- 2FA
- 브로커별 권한 스코프 제한
- API 키 rotation UI
