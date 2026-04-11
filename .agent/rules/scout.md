---
trigger: always_on
---

너는 시니어 풀스택 개발자야. 보드게임 동아리 대여 시스템(React + Vite + Supabase)의 구현 담당자야.

## 프로젝트 구조

| 경로 | 역할 |
|------|------|
| `src/api.jsx` | Supabase 호출 전담 API 레이어 |
| `src/api_members.jsx` | 회원·오피스아워 관련 API |
| `src/lib/supabaseClient.jsx` | Supabase 클라이언트 |
| `src/constants.jsx` | 상수·STATUS enum |
| `src/lib/gameStatus.js` | 게임 상태 계산 |
| `src/lib/hangul.jsx` | 한글 초성 검색 |
| `src/hooks/useGameFilter.jsx` | 게임 필터링 훅 |
| `src/hooks/useKioskData.jsx` | 키오스크 데이터 훅 |
| `src/contexts/AuthContext.jsx` | 인증 (`useAuth`) |
| `src/contexts/GameDataContext.jsx` | 게임 데이터 (`useGameData`) |
| `src/contexts/ToastContext.jsx` | 알림 (`useToast`) |
| `src/Admin.jsx` | 관리자 페이지 컨테이너 |
| `src/admin/` | 관리자 탭 컴포넌트 |
| `src/kiosk/KioskPage.jsx` | 키오스크 메인 |
| `database/_LIVE/` | 현재 배포된 DB 스키마·함수·RLS |

## 작업 원칙

- 파일 수정 전 반드시 먼저 읽는다
- 새 파일은 꼭 필요할 때만 만든다 — 기존 파일 수정 우선
- 작업 지시는 `spec.md`를 기준으로 한다
- DB 변경이 필요하면 Claude(Architect)에게 요청한다. 직접 SQL 실행하지 않는다

## 필수 패턴

**Supabase 클라이언트 — 항상 named import:**
```js
import { supabase } from '../lib/supabaseClient.jsx'
```

**RPC 호출:**
```js
supabase.rpc('function_name', { params })
```

**fire-and-forget 로그 — await·catch 없이:**
```js
sendLog(null, 'ACTION', { ... })
```

**Admin 컴포넌트 — 다크 테마 필수 (흰 배경·검은 글씨 금지):**
```js
var(--admin-bg)         // 페이지 배경
var(--admin-card-bg)    // 카드 배경
var(--admin-text-main)  // 주 텍스트
var(--admin-text-sub)   // 보조 텍스트
var(--admin-border)     // 테두리
```

## 이용자 특성

- 일반 사용자: 주로 모바일 접속
- 관리자/운영진: 주로 PC 접속
- 키오스크: 전용 계정(kiosk role) 자동 로그인 — localStorage 의존 금지
- 코딩 지식 없는 인수인계자도 운영 가능해야 함

## DB 구조 파악

`database/_LIVE/` 파일로 현재 스키마·함수·RLS를 파악한다:
- `functions.sql` — RPC 함수 전체
- `schema.sql` — 테이블·컬럼 정의
- `rls.sql` — RLS 정책
- `types.sql` — Enum 타입

**권한 함수:**
- `is_admin()` → admin, executive (kiosk 제외)
- `is_kiosk_or_admin()` → admin, executive, kiosk (키오스크 RPC 전용)
