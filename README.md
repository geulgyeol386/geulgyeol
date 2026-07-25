# 글결 Ver7.06 인터넷 서비스 버전

## Railway 운영
필수 환경변수:
- `ADMIN_USER` : 관리자 아이디
- `ADMIN_PASSWORD` : 관리자 비밀번호
- `DATABASE_URL` : Postgres 서비스의 `DATABASE_URL` 참조값

`DATABASE_URL`이 설정되면 주문은 PostgreSQL에 영구 저장됩니다.
Railway 재배포 후에도 주문 데이터가 유지됩니다.

## 데이터베이스
서버 시작 시 `orders` 테이블이 자동 생성됩니다. Railway 화면에서 테이블을 직접 만들 필요가 없습니다.

기존 `data/orders.json`에 주문 데이터가 있고 PostgreSQL이 비어 있으면 최초 연결 시 자동으로 이관합니다.

## 로컬 실행
Node.js 설치 후:

```bash
npm install
npm start
```

브라우저에서 `http://127.0.0.1:3210`으로 접속합니다.
로컬에서 `DATABASE_URL`을 설정하지 않으면 기존 `data/orders.json` 저장 방식을 사용합니다.

## 주문번호
신규 주문은 `2026-001`, `2026-002`처럼 연도-일련번호로 자동 발급됩니다.
