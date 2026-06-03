# 배포 방법

## 로컬 실행

```bash
cp .env.example .env
npm start
```

접속: `http://localhost:8080`

## Docker Compose

```bash
cp .env.example .env
# SECRET_KEY 교체
# 필요한 API 키 설정
docker compose up --build -d
```

로그 확인:

```bash
docker compose logs -f
```

중지:

```bash
docker compose down
```

## Linux 서버 + Nginx 예시

1. 서버에 Docker와 Docker Compose 설치
2. 프로젝트 업로드
3. `.env` 생성 및 `SECRET_KEY` 교체
4. `docker compose up --build -d`
5. Nginx reverse proxy 설정

```nginx
server {
    listen 443 ssl http2;
    server_name terminal.example.com;

    ssl_certificate /etc/letsencrypt/live/terminal.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/terminal.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

`.env` 운영 권장값:

```bash
NODE_ENV=production
APP_BASE_URL=https://terminal.example.com
COOKIE_SECURE=true
SECRET_KEY=<64자 이상 난수>
```

## 데이터 볼륨

기본 파일 DB:

```text
data/db.json
```

운영 서비스에서는 PostgreSQL, MySQL 또는 관리형 DB로 대체하는 것을 권장합니다. 현재 구조는 `src/store.js`를 교체하면 됩니다.

## 헬스체크

```bash
curl http://localhost:8080/api/health
```

정상 응답:

```json
{"ok": true}
```
