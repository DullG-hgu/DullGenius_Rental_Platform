# 덜지니어스 보드게임 대여 시스템 — Claude 작업 가이드

## 스택
React + Vite + Supabase / 배포: Netlify (`netlify.toml`)

---

## 소스 구조 (핵심 파일)

| 경로 | 역할 |
|------|------|
| `src/api.jsx` | Supabase 호출 전담 API 레이어 |
| `src/api_members.jsx` | 회원·오피스아워 관련 API |
| `src/lib/supabaseClient.jsx` | Supabase 클라이언트 — **항상 named import**: `import { supabase } from '../lib/supabaseClient.jsx'` |
| `src/constants.jsx` | 상수·STATUS enum 헬퍼 |
| `src/lib/gameStatus.js` | 게임 상태 계산 로직 |
| `src/lib/hangul.jsx` | 한글 초성 검색 유틸 |
| `src/lib/searchUtils.jsx` | 검색 유틸 |
| `src/hooks/useGameFilter.jsx` | 게임 필터링 훅 |
| `src/hooks/useKioskData.jsx` | 키오스크 데이터 훅 |
| `src/contexts/AuthContext.jsx` | 인증 Context — `useAuth()` → `{ user, profile, roles, hasRole, login, logout, loading }` |
| `src/contexts/GameDataContext.jsx` | 게임 데이터 Context — `useGameData()` → `{ games, trending, loading }` |
| `src/contexts/ToastContext.jsx` | 알림 Context — `useToast()` → `showToast(msg, { type })` |
| `src/Admin.jsx` | 관리자 페이지 컨테이너 (탭 라우팅) |
| `src/admin/` | 관리자 탭 컴포넌트들 |
| `src/kiosk/KioskPage.jsx` | 키오스크 메인 (기기 마스터키 → 서버 세션 발급, 아래 참고) |
| `src/pages/` | 일반 사용자 페이지 |
| `src/components/` | 공용 컴포넌트 |

## 라우트 구조 (`src/App.jsx`)

```
/                   → Home
/categories         → CategorySelect
/search             → GameSearch
/game/:id           → GameDetail
/mypage             → MyPage
/login, /signup, /reset-password
/admin-secret       → Admin (ProtectedRoute: admin, executive)
/org-rental         → OrgRental
/kiosk              → KioskPage (기기 마스터키로 세션 자동 복구)
```

---

## DB 작업 규칙

**SQL·RPC·스키마·RLS 작업 전 반드시 읽을 파일:**

| 파일 | 내용 |
|------|------|
| `database/_LIVE/functions.sql` | 현재 배포된 모든 RPC 함수 |
| `database/_LIVE/schema.sql` | 모든 테이블 + 컬럼 정의 |
| `database/_LIVE/rls.sql` | 모든 RLS 정책 |
| `database/_LIVE/types.sql` | 커스텀 Enum 타입 |
| `database/_LIVE/grants.sql` | anon/authenticated 실효 권한 — 함수 EXECUTE, 테이블·컬럼 GRANT. **권한 변경 후 여기서 회귀 확인** |

**MCP 도구 사용:**
- DDL (CREATE/ALTER/함수 생성): `mcp__supabase__apply_migration`
- 조회·DML: `mcp__supabase__execute_sql`
- **SQL 적용 후 반드시**: `npm run pull-schema` → `_LIVE` 동기화

**권한 함수:**
- `is_admin()` → admin, executive만 허용 (kiosk 제외)
- `is_kiosk_or_admin()` → admin, executive, kiosk 허용 (키오스크 RPC 전용)
- 두 함수 모두 **anon도 EXECUTE 가능해야 한다** (auth.uid() 기준이라 anon에선 항상 false, 노출 없음).
  anon 권한을 회수하면 `TO public` 정책이 이 함수를 부르는 순간 비로그인 홈·검색·키오스크 반납이
  전부 `permission denied`로 죽는다 (2026-08 장애 원인). **회수 금지.**

**RLS 정책 작성 규칙:**
- 정책에는 `TO anon` 또는 `TO authenticated`를 명시한다. 대시보드 기본값 `TO public`은 쓰지 않는다
- 관리자·소유자 조건(`is_admin()`, `auth.uid() = ...`)이 들어가는 정책은 `TO authenticated`
- 관리자 전용 SECURITY DEFINER RPC는 `REVOKE EXECUTE ... FROM PUBLIC, anon` 을 함께 적는다.
  CREATE FUNCTION 기본값이 PUBLIC EXECUTE라 **anon만 회수하면 무효**다. 적용 후 `_LIVE/grants.sql`에서 anon 열이 `-`인지 확인
  (예외: `ingest_rental_request` — Google Apps Script가 anon 키 + 공유 시크릿으로 호출)

**비회원(anon) 노출 면 (2026-09-02 기준):**
- anon은 **모든 테이블에 쓰기 권한이 없다** (INSERT/UPDATE/DELETE 회수, 기본 권한도 회수).
  비회원이 뭔가를 기록해야 하면 SECURITY DEFINER RPC로 만든다. 테이블 GRANT를 되돌리지 말 것
- `rentals`는 anon에게 `rental_id, game_id, type, returned_at, due_date, borrowed_at` 컬럼만 열려 있다.
  비로그인 상태에서 `from('rentals').select('*')`는 **permission denied**. 새 테이블을 anon에게 열 때도
  `GRANT SELECT (컬럼...)` 로 필요한 컬럼만 준다
- 홈 목록·상세는 `get_games_with_rentals()` / `get_game_with_rentals(p_game_id)` RPC만 쓴다.
  둘 다 SECURITY DEFINER이며 `user_id`·`renter_name`·회원 이름은 **본인 행 또는 관리자에게만** 채워진다.
  `rentals`를 화면에서 직접 조회하는 코드를 새로 만들지 말 것
- 비회원이 볼 수 있는 전체 목록은 `grep 'TO anon' database/_LIVE/rls.sql` 로 확인한다

---

## 코드 패턴 규칙

**Supabase RPC 호출:**
```js
supabase.rpc('function_name', { params })
```

**fire-and-forget 로그:** `await` 없이, `.catch` 없이 호출

**Admin 다크 테마** (흰 배경·검은 글씨 절대 금지):
```js
var(--admin-bg)          // 페이지 배경
var(--admin-card-bg)     // 카드 배경
var(--admin-text-main)   // 주 텍스트
var(--admin-text-sub)    // 보조 텍스트
var(--admin-border)      // 테두리
```

**AuthContext 특이사항:**
- `kiosk` role 유저는 `profiles` 레코드 없어도 자동 로그아웃 안 됨 (AuthContext 내 분기 처리)
- `hasRole('kiosk')` 로 키오스크 여부 확인

---

## 이용자 특성
- 일반 사용자: 주로 모바일
- 관리자/운영진: 주로 PC
- 키오스크: 전용 Supabase 계정 (`kiosk` role) — 인증 방식은 아래 참고

---

## 키오스크 인증 구조

**⚠️ 프론트엔드에서 키오스크 계정 자격증명을 절대 읽지 말 것.**

예전에는 `KioskPage`가 `import.meta.env.VITE_KIOSK_EMAIL` / `VITE_KIOSK_PASSWORD`로
직접 로그인했다. `VITE_` 접두 환경변수는 **빌드 시 번들에 문자열로 박히므로**,
배포된 JS를 열면 키오스크 계정의 아이디·비밀번호가 그대로 보였다.
Netlify env에 넣어둬도 마찬가지고, 비밀번호만 바꾸면 다음 빌드에 새 값이 똑같이 박힌다.

현재 구조:

```
키오스크 기기 (localStorage: kiosk_device_key)
   │  마스터키만 전송
   ▼
netlify/functions/kiosk-session.js   ← 계정 자격증명은 여기(서버)에만 존재
   │  마스터키 검증 → Supabase 로그인
   ▼
access_token / refresh_token 반환 → supabase.auth.setSession()
```

- 세션이 만료돼도 저장된 마스터키로 **무인 자동 복구**된다 (오피스아워가 학기 초에만 열림)
- 새 기기·캐시 초기화 시에만 "기기 등록" 화면이 뜨고, `KIOSK_MASTER_KEY`를 1회 입력한다

**서버 전용 환경변수 (전부 `VITE_` 없이):**

| 변수 | 용도 |
|------|------|
| `KIOSK_EMAIL` | 키오스크 계정 이메일 |
| `KIOSK_PASSWORD` | 키오스크 계정 비밀번호 (Supabase 계정 값과 일치해야 함) |
| `KIOSK_MASTER_KEY` | 기기 등록 키. 길고 무작위하게 (`openssl rand -base64 32`) |
| `KIOSK_MASTER_KEY_PREVIOUS` | 키 회전 유예용 이전 키(선택). 기기 재등록 후 즉시 제거 |

실제 값은 저장소에 두지 않는다. **Netlify 환경변수**(Production 컨텍스트)와
**Supabase → Authentication → Users** 에서 확인·변경한다.
비밀번호를 바꿀 땐 Supabase와 Netlify를 함께 고쳐야 하고, 함수 env는 **재배포해야 반영**된다.

**회원 목록은 `kiosk_list_users()` RPC로만 조회한다.**
`fetchUsers()`는 `phone` 등 키오스크가 쓰지 않는 개인정보까지 내려주며,
그 값이 `localStorage`에 평문으로 쌓인다. 전화번호는 계정 복구 정보와 겹치므로 특히 위험.

### 환경변수 일반 규칙

- **`VITE_` 가 붙으면 그 값은 공개된다.** 자격증명에는 절대 붙이지 말 것
- 공개돼도 되는 것: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`(publishable) — RLS가 실제 관문
- Netlify `SECRETS_SCAN_ENABLED=true`가 이를 강제한다. 시크릿이 번들에 들어가면 빌드가 실패함
- 서버에서만 쓸 값은 `netlify/functions/`에서 `process.env`로 읽는다
- `npm run validate:env`와 빌드는 공개 프런트엔드 설정만 검사한다. 키오스크는 `npm run validate:env:kiosk`, 프런트엔드·키오스크·NAVER·BGG는 `npm run validate:env:all`로 명시적으로 검사하며, 금지된 `VITE_` secret은 모든 검사에서 차단한다.
- 키오스크 운영 주소는 `https://dullgrental.netlify.app/kiosk`다. 예전 주소의 PWA는 제거 후 재설치한다

---

## 관리자 화면 모바일 검증 절차 (2026-09-03 확립)

관리자 페이지는 로그인이 필요해 헤드리스 하네스로는 셸(헤더·탭·표)만 볼 수 있다.
실제 탭·모달까지 폰 폭으로 확인할 때는 아래 순서를 쓴다. **자격증명은 어떤 형태로도 Claude에게 주지 않는다.**

1. `npm run dev -- --host 0.0.0.0 --port 5173` 를 띄운다.
2. 사용자가 **자기 Chrome에서 직접** `http://localhost:5173/admin-secret` 에 관리자 계정으로 로그인한다.
3. Claude in Chrome 확장으로 같은 출처의 가벼운 페이지(`/manifest.json`)를 열고, `javascript_tool` 로
   `<iframe src="/admin-secret" style="width:390px;height:660px">` 를 주입한다.
   같은 출처라 세션이 공유되어 iframe 안이 로그인 상태로 뜬다. (Chrome 창 자체는 500px 아래로 안 줄어든다)
4. iframe 의 `contentDocument` 를 `javascript_tool` 로 조작·측정한다. 기준:
   `documentElement.scrollWidth <= innerWidth`, 높이 32px 미만 버튼 0개, font-size 16px 미만 입력 0개(color 제외).
   `browser_batch` 로 탭 클릭 → 대기 → 스크린샷 → 측정을 묶어야 빠르다.
5. 저장·삭제는 실행하지 않고 모달은 전부 「취소」로 닫는다. 게임 추가는 이미 있는 이름(예: 카탄)으로 넣어 중복 모달에서 취소하면 저장 없이 폼이 열린다.

주의:
- **Vite HMR 이 WSL 의 `/mnt/c` 경로에서 동작하지 않는다.** 파일을 고쳐도 옛 CSS/JS 를 계속 서빙한다.
  dev 서버를 재시작해야 반영된다. 종료는 `ss -ltnp` 로 5173 의 PID 를 찾아 `kill` (`pkill -f vite` 는 실행 중인 셸까지 죽인다).
- 공용 CSS 계약: `.admin-table-wrap` `.admin-btn-row` `.admin-grid-auto(--min)` `.admin-modal-scroll` `.admin-header-actions`.
  (pointer:coarse) 또는 800px 이하에서 입력 16px·버튼 min-height 36px 은 `Admin.css` 가 전역 처리하므로 인라인으로 다시 쓰지 않는다.
- 네이티브 `confirm/prompt/alert` 는 관리자 영역에서 쓰지 않는다(모바일 브라우저의 대화상자 차단 옵션에 걸리면 조용히 실패). `ConfirmModal`/`PromptModal` 을 쓴다.

---

## 앱 버전·업데이트 (2026-10-08)

- 버전은 `주.부.패치`. **패치는 빌드 때 자동**(package.json 의 "version" 줄을 마지막으로 바꾼 커밋 이후 커밋 수, `vite.config.js`). 손으로 올리지 않는다.
- **사용자가 지금 화면도 바로 바꿔야 할 만큼 중대한 변경이면 `npm version minor --no-git-tag-version`** 후 커밋 → 홈 헤더 두 번째 버튼이 「업데이트」로 바뀐다. 패치만 바뀐 배포는 버튼 없이 다음 실행 때 서비스워커가 조용히 바꾼다.
- 갱신 판단은 버전 번호가 아니라 `version.json` 의 `build`(Netlify BUILD_ID)로 한다. 키오스크는 번호와 무관하게 모든 배포를 화면보호기 때 자동 적용(`src/kiosk/useKioskAutoUpdate.js`).
- 화면 표시 `v1.0.3 · <커밋>`: 홈은 마이페이지 맨 아래, 키오스크는 헤더·화면보호기. 신고가 오면 이 값부터 받는다.

## BGG 연동 데이터 규칙 (2026-09-10)

- `bgg_id`는 **게임 폼의 이름 검색(한글 그대로 됨)에서 고른 항목**만 넣는다. 손으로 ID를 적어 넣지 않는다.
  2026-04 일괄 작업이 137개 중 61개를 TRPG·비디오게임·무관 게임에 연결해 놓았고, 9/10에 전부 재연결했다
  (`database/bgg_sync/2026-09-10_report.md`, 롤백은 같은 폴더의 `_rollback.sql`).
- BGG는 확장판을 기본 게임 타입으로도 이중 등록한다. 검색 후보의 「확장판」 배지를 보고 고른다.
  "정령섬"을 검색하면 「정령섬: 가지와 발톱」이 같이 뜬다.
- 폼 자동 채우기는 type이 boardgame/boardgameexpansion 이 아니면 거부하고, BGG 값 0·투표 0 난이도는 채우지 않는다.
- BGG 요청(`bgg-proxy.js`·`vite.config.js` 개발 프록시)은 앱 식별 UA(`dullgrental/1.0 …`)를 보낸다. **브라우저 UA로 위장하면 유효 토큰이어도 Cloudflare가 403**을 준다 (위장 UA는 4월부터 있었고, 차단 시작 시점은 모르나 9/27 운영에서 관리자 BGG 검색·상세가 전부 403이었다). 토큰 문제면 401이다.
- 값 재동기화: `node scripts/bgg_sync.mjs`(dry-run) → `--apply`. 이름 재점검: `node scripts/bgg_match_names.mjs` (읽기 전용).
  둘 다 `.env.local`의 `SUPABASE_SERVICE_ROLE_KEY`·`BGG_API_TOKEN`을 쓴다.
- `genres`는 운영자가 한글로 손질한 값이라 스크립트가 덮어쓰지 않는다. `playingtime`은 「30분」「60~120분」 형식.
- 게임 폼도 BGG 영문 카테고리를 `genres`에 넣지 않는다(참고 표시만). 9/27 기준 영문 장르가 섞인 게임 28개 — 대부분 최근 등록분이라 폼 덮어쓰기가 주원인으로 보인다(같은 날 수정).

## Jev AI 장르 제안 (2026-09-27)

- Jev(TypeSafe 판정 API)는 **관리자 작성 시점에만** 쓴다: 게임 폼 「🤖 AI 장르 제안」(`netlify/functions/jev-genre-suggest.js`)과 읽기 전용 `node scripts/jev_genre_report.mjs`(→ `database/genre_review/`).
- **사용자·키오스크 경로에서 Jev를 부르지 않는다.** 구독 해지·잔액 0·장애여도 제안 칩만 사라지고 서비스는 그대로여야 한다. 실패는 200 + `{ available: false, reason }`.
- 결과는 제안이다. 자동 적용 금지 — 운영자가 칩을 골라 넣는다. 정규 장르 목록은 `netlify/functions/_shared/jevGenres.js`의 `CANONICAL_GENRES` 한 곳.
- 키 `JEV_AI_API_KEY`는 서버 전용(Netlify 함수·`.env.local`). 보내는 건 게임 한글명과 BGG 공개 정보뿐 — 회원 이름·전화·후기는 보내지 않는다(Jev는 제출 텍스트를 보관한다).
