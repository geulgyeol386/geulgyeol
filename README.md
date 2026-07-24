# 글결 Ver7.03 인터넷 서비스 버전

## 로컬 실행
1. Node.js 설치
2. `npm start`
3. 브라우저에서 `http://127.0.0.1:3210`

관리자 페이지는 HTTP Basic 인증을 사용합니다.
- 기본 사용자명: `admin`
- 로컬 실행 기본 비밀번호: `change-this-password`
- Railway에서는 기본 비밀번호를 허용하지 않습니다. 반드시 `ADMIN_PASSWORD`를 설정하고 **staged changes를 Deploy**해야 관리자 로그인이 됩니다.

## Railway 환경변수
- `ADMIN_USER` : 관리자 아이디 (예: admin)
- `ADMIN_PASSWORD` : 길고 추측하기 어려운 관리자 비밀번호
- `DATA_DIR` : Railway Volume을 `/data`에 연결한 경우 `/data`

## 중요
Railway에 영구 보관할 주문 자료가 있다면 Volume을 `/data`에 연결하고 `DATA_DIR=/data`를 설정하세요.
Volume 없이 운영하면 재배포 시 주문 데이터가 사라질 수 있습니다.

## File naming policy
For deployment stability, asset filenames use lowercase ASCII letters, numbers, and hyphens only. Avoid Korean characters, spaces, and special characters in future image filenames.


## 주문번호

- 신규 주문은 `2026-001`, `2026-002`처럼 **연도-일련번호**로 자동 발급됩니다.
- 해가 바뀌면 `2027-001`부터 다시 시작합니다.
- 기존 `G숫자...` 형식 주문은 서버 시작 시 생성연도를 기준으로 자동 변환합니다.

## Railway Variables 적용 주의

Railway의 Variables 추가/수정은 staged changes가 됩니다. Variables를 입력한 뒤 프로젝트 캔버스의 staged changes 배너에서 **Deploy**를 눌러야 실행 중인 서비스에 적용됩니다. 기존 deployment의 단순 Redeploy만으로는 아직 커밋되지 않은 staged changes가 적용되지 않을 수 있습니다.
