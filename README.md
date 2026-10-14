# 골든벨 퀴즈

오프라인 행사에서 진행자가 노트북 화면을 띄우고, 참석자는 휴대폰으로 접속해 문제를 푸는 실시간 퀴즈 사이트입니다. Kahoot처럼 방 코드와 QR로 입장하고, 골든벨 방식으로 오답자는 탈락하며 마지막 1등을 가립니다.

- [공개 사이트](https://golden-bell-quiz-oyj7677.oyj7677.chatgpt.site)
- [진행자 화면](https://golden-bell-quiz-oyj7677.oyj7677.chatgpt.site/host)
- 참석자 주소는 방을 만들면 진행자 화면에 표시됩니다.
- 발표 화면은 방별 `/display/방코드` 주소를 사용합니다. 정답과 해설은 공개 전까지 숨깁니다.

## 주요 기능

- 진행자 링크와 참석자 링크 분리
- 참석자 QR/링크 입장, 닉네임 입력, 대기실 표시
- O/X, 객관식, 주관식, 순서 나열 문제 지원
- 문제당 이미지 최대 4장 첨부, 영상 업로드 없음
- 진행자가 직접 문제 시작, 제출 마감, 정답 공개, 다음 문제 진행
- 별도 발표 화면에서 방 코드, 문제, 참가 현황과 순위 표시
- 마감 후 제출 차단
- 주관식 복수 정답 자동 채점과 진행자 수동 판정
- 오답 또는 미제출 참석자 탈락, 탈락자는 문제·보기·사진·공개된 정답을 보며 관전
- 진행자가 여는 패자부활전에서 탈락자 전원이 답하고, 정답자는 기존 점수 그대로 복귀
- 일반·패자부활·동점자 문제를 별도 목록으로 저장하고, 문제 순서를 드래그 또는 위·아래 버튼으로 조정
- 미사용 문제를 무작위 또는 목록 순서대로 출제하고, 진행자가 특정 문제를 골라 미리 확인 가능
- 생존자가 1명이면 진행자가 계속 진행·패자부활·우승 확정 중 선택
- 생존자가 0명이면 패자부활 또는 마무리. 마지막 생존자가 여러 명이면 동점자 문제로 우승자 결정
- 퀴즈 세트 저장 후 재사용. 방을 만든 뒤 원본 퀴즈를 수정해도 진행 중인 방에는 반영되지 않음
- `ming`과 `oyj` 진행자 계정별 퀴즈, 방, 결과 및 최근 삭제 목록 분리

순서 나열 문제는 서로 다른 글자 보기 3~6개를 모두에게 같은 섞인 순서로 보여 줍니다. 참가자는 보기를 차례로 눌러 답하고 마감 전까지 다시 제출할 수 있습니다. 전체 순서가 맞아야 정답입니다.

## 진행자 화면

| 화면 | 주소 | 용도 |
| --- | --- | --- |
| 홈 | `/host` | 저장된 문제 세트와 진행 현황 확인, 방 만들기 |
| 퀴즈 관리 | `/host/quizzes` | 문제 세트 작성, 수정, 이미지 첨부 |
| 진행 중인 방 | `/host/rooms` | 방 선택 및 대기실, QR, 문제 진행 관리 |
| 결과 | `/host/results` | 완료된 게임의 우승자와 순위 확인 |
| 설정 | `/host/settings` | 진행자 비밀번호 변경 |

방을 만들면 `/host/rooms/방코드`로 이동합니다. 발표 화면은 별도 창으로 열 수 있습니다.

## 운영 기준

초기 버전은 한 공간에서 진행하는 오프라인 행사를 기준으로 합니다.

| 항목 | 기준 |
| --- | --- |
| 참석자 수 | 방당 10명에서 50명 |
| 진행자 ID | `ming`, `oyj` |
| 진행자 초기 비밀번호 | 저장소에 넣지 않고 배포 환경에서 각각 `HOST_BOOTSTRAP_PASSWORD`, `OYJ_BOOTSTRAP_PASSWORD`로 설정 |
| 세션 서명값 | `SESSION_SECRET`로 설정 |
| 사이트 이름 | 기본값 `골든벨 퀴즈`, 코드에서 나중에 변경 가능 |
| 저장소 | 공개 GitHub 저장소 `oyj7677/quiz` |

초기 실시간 동기화는 단순 폴링을 기준으로 둡니다. 참석자 화면은 약 3초마다 방 상태를 다시 읽고, 진행자 화면은 약 2초마다 제출 수와 참가자 상태를 갱신합니다. 50명 규모에서 1초 폴링은 요청량이 빠르게 늘 수 있으므로 특별한 이유가 없으면 피합니다.

## 기술 스택

- Next.js 16, React 19, TypeScript
- Vinext, Vite, Cloudflare Workers
- Cloudflare D1: 퀴즈 세트, 방, 참가자, 답안, 진행 상태 저장
- Cloudflare R2: 문제 이미지 저장
- Drizzle: D1 스키마와 마이그레이션 관리
- OpenAI Sites: 호스팅, D1/R2 바인딩, 배포 워크플로

`.openai/hosting.json`에는 현재 Sites 프로젝트 ID와 바인딩 이름이 들어 있습니다.

```json
{
  "d1": "DB",
  "r2": "BUCKET"
}
```

비밀값은 이 파일이나 소스 코드에 넣지 않습니다.

## 로컬 실행

필요 조건:

- Node.js `>=22.13.0`
- npm

의존성 설치:

```sh
npm run install:ci
```

개발 서버 실행:

```sh
npm run dev
```

배포용 빌드:

```sh
npm run build
```

빌드된 Worker 로컬 미리보기:

```sh
npm run start
```

`npm run start`는 먼저 `npm run build`로 `dist/server/wrangler.json`이 만들어진 뒤 사용할 수 있습니다.

로컬 전체 진행 흐름 점검은 데이터베이스 마이그레이션을 적용하고 개발 서버를 실행한 뒤 `SMOKE_HOST_PASSWORD`와 `SMOKE_BASE_URL`을 지정해 `node scripts/smoke.mjs`로 실행할 수 있습니다. 점검용 방과 퀴즈는 종료 시 삭제됩니다.

## 환경 변수

로컬 Worker 런타임 값은 `.dev.vars`처럼 Git에 포함되지 않는 파일로 관리합니다. 저장소에는 실제 비밀번호, 세션 키, 토큰을 커밋하지 않습니다.

```sh
HOST_BOOTSTRAP_PASSWORD="replace-with-a-strong-private-password"
OYJ_BOOTSTRAP_PASSWORD="replace-with-another-strong-private-password"
SESSION_SECRET="replace-with-a-long-random-secret"
```

권장 생성 방식:

```sh
openssl rand -base64 32
```

배포 환경에서는 Sites의 runtime secret 설정으로 같은 키를 등록합니다.

## 데이터베이스와 마이그레이션

D1 스키마는 `db/schema.ts`에서 관리합니다. 스키마를 바꾼 뒤 SQL 마이그레이션을 생성합니다.

```sh
npm run db:generate
```

로컬 D1에 적용할 때는 빌드 후 생성된 Wrangler 설정을 사용합니다.

```sh
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/<migration.sql>
```

`<migration.sql>`에는 새로 생성된 마이그레이션 파일명을 넣습니다. 이미 적용한 마이그레이션은 다시 실행하지 않습니다.

## 배포

이 프로젝트는 OpenAI Sites/Vinext 스타터 구조를 사용합니다.

1. 소스 변경 후 필요한 검증을 끝냅니다.
2. Sites 워크플로로 소스 패키지를 만듭니다.
3. Sites가 D1 마이그레이션을 적용하고 Worker와 정적 자산을 배포합니다.
4. 공개 행사 링크를 쓸 경우 배포 audience를 public으로 설정합니다.

GitHub 저장소는 공개로 관리하지만, 비밀값과 로컬 런타임 상태는 공개하지 않습니다. `.gitignore`는 `.env*`, `.dev.vars*`, `.wrangler/`, `.sites-runtime/`, `dist/`를 제외합니다.

## 운영 주의

- 진행자 비밀번호는 관리 화면에서 변경할 수 있으며, 실제 값은 저장소에 기록하지 않습니다.
- 기존 퀴즈와 방·결과는 `ming` 계정에 속합니다. 새 `oyj` 계정에서 작성한 퀴즈와 방·결과는 해당 계정에만 표시됩니다. 참가자 링크와 발표 화면은 계정 로그인 없이 계속 이용할 수 있습니다.
- 방 시작 후에는 늦은 입장을 막습니다.
- 참석자 재접속은 참가자 토큰으로 같은 상태를 복구하는 흐름을 유지합니다.
- 마감 버튼을 누른 뒤에는 답안 변경과 신규 제출을 막습니다.
- 이미지 업로드는 문제당 4장 이하로 제한합니다.
- 패자부활 문제는 미사용 문제만 여러 차례 사용할 수 있으며, 부활 정답에는 점수를 더하지 않습니다.
- 진행 중 네트워크가 불안정할 수 있으므로 진행자는 문제 전환 전 제출 수를 확인합니다.
- 공개 URL을 공유하기 전 테스트용 방에서 QR 입장, 제출, 마감, 정답 공개, 최종 순위를 확인합니다.

## 현재 구현 참고

프론트엔드 클라이언트는 `lib/client/quiz-api.ts`의 API 클라이언트를 기준으로 다음 경로를 호출합니다.

| 용도 | 경로 |
| --- | --- |
| 진행자 로그인 | `POST /api/host/login` |
| 진행자 로그아웃/상태 | `POST /api/host/logout`, `GET /api/host/me` |
| 퀴즈 목록/저장 | `GET /api/quizzes`, `POST /api/quizzes` |
| 퀴즈 수정/삭제 | `PUT /api/quizzes/:id`, `DELETE /api/quizzes/:id` |
| 이미지 업로드 | `POST /api/images` |
| 방 생성/조회 | `POST /api/rooms`, `GET /api/rooms` |
| 참가자 입장 | `POST /api/rooms/:code/join` |
| 방 상태 조회 | `GET /api/rooms/:code/state` |
| 방 시작 | `POST /api/rooms/:code/start` |
| 답안 제출 | `POST /api/rooms/:code/answer` |
| 제출 마감 | `POST /api/rooms/:code/close` |
| 주관식 수동 판정 | `POST /api/rooms/:code/grade` |
| 정답 공개 | `POST /api/rooms/:code/reveal` |
| 다음 일반·동점자 문제 | `POST /api/rooms/:code/next` |
| 패자부활전 | `POST /api/rooms/:code/revival` |
| 우승 확정·마무리 | `POST /api/rooms/:code/finish` |
| 현장에서 동점자 문제 추가 | `POST /api/rooms/:code/tiebreaker` |

백엔드 구현을 바꿀 때는 이 클라이언트 계약과 README의 운영 기준을 함께 업데이트합니다.
