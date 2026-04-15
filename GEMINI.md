# 🚀 보드게임 대여 시스템 개선 로드맵

이 문서는 보안 취약점 수정 및 성능 최적화를 위한 단계별 할 일 목록입니다. 
각 단계가 완료될 때마다 체크 표시(`[x]`)를 하고 다음 단계로 넘어갑니다.

---

## 🔒 Phase 1: 보안 강화 (Security Hotfixes)
- [x] **Task 1.1: 관리자 RPC 권한 체크 강화**
  - `admin_rent_game`, `admin_return_game` 등 관리자 전용 RPC 내부에 `is_admin()` 체크 로직 추가.
- [x] **Task 1.2: Rentals 테이블 RLS 정책 수정**
  - `Public Read Rentals` (USING true) 정책을 제거하고, 본인 또는 관리자만 조회 가능하도록 수정.
- [x] **Task 1.3: IDOR 방지를 위한 API 구조 변경**
  - `fetchMyRentals`, `fetchPointHistory` 등에서 `userId` 인자를 제거하고 `auth.uid()` 기반으로 작동하도록 수정.

## ⚡ Phase 2: 성능 최적화 (Performance & Data)
- [x] **Task 2.1: Surgical Select 적용 (fetchGames)**
  - 전체 필드(`*`) 조회를 중단하고, `calculateGameStatus`에 필요한 최소 필드만 조회하도록 변경.
- [x] **Task 2.2: Server-side Join 도입**
  - JS에서의 수동 데이터 병합(Application-side Join)을 Supabase 단일 쿼리로 통합.
- [x] **Task 2.3: 리뷰 중복 제거 로직 DB 이전**
  - DB에 `UNIQUE` 제약 조건을 추가하고, `api.jsx`의 무거운 JS 필터 제거.

## 🛠️ Phase 3: 리팩토링 및 안정화 (Refactoring)
- [x] **Task 3.1: 핵심 로직 필드 명세화**
  - `gameStatus.js`에서 사용하는 필드 목록을 상수로 관리하여 API와 동기화.
- [x] **Task 3.2: 관리자 유저 목록 최적화**
  - 유저 목록 조회 시 민감 정보(전화번호 등) 제외 및 필요 시에만 개별 로드.

---
*주의: 각 태스크 완료 후 반드시 로컬 빌드 및 기능 테스트를 수행한다.*
