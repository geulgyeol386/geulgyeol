# 글결 Ver7 인터넷 서비스 버전

## 로컬 실행
1. Node.js 설치
2. `npm start`
3. 브라우저에서 `http://127.0.0.1:3210`

관리자 페이지는 HTTP Basic 인증을 사용합니다.
- 기본 사용자명: `admin`
- 기본 비밀번호: `change-this-password`
- 인터넷 공개 전 반드시 환경변수 `ADMIN_PASSWORD`를 변경하세요.

## Railway 환경변수
- `ADMIN_USER` : 관리자 아이디 (예: admin)
- `ADMIN_PASSWORD` : 길고 추측하기 어려운 관리자 비밀번호
- `DATA_DIR` : Railway Volume을 `/data`에 연결한 경우 `/data`

## 중요
Railway에 영구 보관할 주문 자료가 있다면 Volume을 `/data`에 연결하고 `DATA_DIR=/data`를 설정하세요.
Volume 없이 운영하면 재배포 시 주문 데이터가 사라질 수 있습니다.

## File naming policy
For deployment stability, asset filenames use lowercase ASCII letters, numbers, and hyphens only. Avoid Korean characters, spaces, and special characters in future image filenames.
