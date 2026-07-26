# 글결 Ver7.09 AI 맞춤 문구 추천 버전

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


## Ver7.08
- 작품 의뢰 화면에 글결 카카오톡 1:1 상담 버튼 추가


## Ver7.08 월별 결산
관리자 화면에서 월별 주문·진행·수입·취소 현황을 자동 집계하며 CSV 저장과 인쇄를 지원합니다.


## Ver7.09 AI 맞춤 문구 추천

Railway Variables에 아래 값을 추가합니다.

- `OPENAI_API_KEY`: OpenAI API 키
- `OPENAI_MODEL`: 선택 사항. 기본값 `gpt-5.6-luna`

AI 추천 시 고객의 이름, 전화번호, 이메일은 AI 서비스로 보내지 않습니다. 사연, 전하는 대상, 글씨 분위기, 희망 문구 길이만 전송합니다.
