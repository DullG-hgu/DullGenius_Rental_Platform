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

**MCP 도구 사용:**
- DDL (CREATE/ALTER/함수 생성): `mcp__supabase__apply_migration`
- 조회·DML: `mcp__supabase__execute_sql`
- **SQL 적용 후 반드시**: `npm run pull-schema` → `_LIVE` 동기화

**권한 함수:**
- `is_admin()` → admin, executive만 허용 (kiosk 제외)
- `is_kiosk_or_admin()` → admin, executive, kiosk 허용 (키오스크 RPC 전용)

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

실제 값은 저장소에 두지 않는다. **Netlify 환경변수**(Production 컨텍스트)와
**Supabase → Authentication → Users** 에서 확인·변경한다.
비밀번호를 바꿀 땐 Supabase와 Netlify를 함께 고쳐야 하고, 함수 env는 **재배포해야 반영**된다.

**회원 목록은 `kiosk_list_users()` RPC로만 조회한다.**
`fetchUsers()`는 `phone` 등 키오스크가 쓰지 않는 개인정보까지 내려주며,
그 값이 `localStorage`에 평문으로 쌓인다. 전화번호는 계정 복구 정보와 겹치므로 특히 위험.

### 환경변수 일반 규칙

- **`VITE_` 가 붙으면 그 값은 공개된다.** 자격증명에는 절대 붙이지 말 것
- 공개돼도 되는 것: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`(publishable) — RLS가 실제 관문
- Netlify `SECRETS_SCAN_ENABLED=true`가 이를 강제한다. 시크릿이 번들에 들어가면 빌드가 실패함
- 서버에서만 쓸 값은 `netlify/functions/`에서 `process.env`로 읽는다
