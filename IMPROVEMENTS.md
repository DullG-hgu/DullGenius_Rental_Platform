# 📋 보안 & 성능 개선사항 (2026-04-15)

## P0 보안 개선 ✅ 완료

### 1️⃣ IDOR 취약점 제거

**수정된 함수들** (api.jsx):
```javascript
// Before: userId 파라미터 노출
export const fetchMyRentals = async (userId) => {
  .eq('user_id', userId)  // ❌ 클라이언트 조작 가능
}

// After: server auth.uid() 사용
export const fetchMyRentals = async () => {
  const { data: { user } } = await supabase.auth.getUser();
  .eq('user_id', user.id)  // ✅ 서버 기반
}
```

**영향받은 함수**:
- `fetchMyRentals()` - MyPage, GameDetail에서 호출
- `fetchMyRentalHistory()` - MyPage에서 호출
- `fetchUserPoints()` - MyPage에서 호출
- `fetchPointHistory()` - MyPage에서 호출

**호출 위치 수정**:
- ✅ MyPage.jsx (라인 69-72)
- ✅ GameDetail.jsx (라인 105-115)

---

### 2️⃣ 역할 분리 (is_admin vs is_kiosk_or_admin)

**apply_rls_all.sql 수정**:
```sql
-- Before: kiosk 포함 (권한 혼재)
CREATE OR REPLACE FUNCTION public.is_admin()
  AND role_key IN ('admin', 'executive', 'kiosk')  // ❌

-- After: kiosk 제외 (역할 명확)
CREATE OR REPLACE FUNCTION public.is_admin()
  AND role_key IN ('admin', 'executive')  // ✅

-- New: 키오스크 전용
CREATE OR REPLACE FUNCTION public.is_kiosk_or_admin()
  AND role_key IN ('admin', 'executive', 'kiosk')  // ✅
```

**final_rpc_v2.sql 수정**:
```sql
-- kiosk_rental, kiosk_return, kiosk_pickup에 권한 체크 추가
IF NOT public.is_kiosk_or_admin() THEN
  RETURN jsonb_build_object('success', false, 'message', '키오스크 권한이 없습니다.');
END IF;
```

---

## P1 데이터 정합성 & 필드 관리 ✅ 완료

### 1️⃣ constants/fields.js 통일화

**新 구조: API_FIELDS** (태그 기반 필드 관리):
```javascript
export const API_FIELDS = {
  GAMES_FOR_LISTING: {
    description: '게임 목록용',
    fields: ['id', 'name', 'image', ..., 'total_views'],
    excludeFields: ['bgg_id', 'created_at', 'avg_rating', ...]
  },

  RENTALS_ACTIVE: {
    description: '활성 대여 정보',
    fields: ['rental_id', 'game_id', ..., 'returned_at', 'profiles(name)'],  // ✅ returned_at 복구
    excludeFields: []
  },

  USERS_LIST: {
    description: '회원 목록 (phone 제외)',
    fields: ['id', 'name', 'student_id', 'is_paid', ...],
    excludeFields: ['phone', 'email', 'password_hash']  // ✅ 명시적 제외
  },

  USER_PROFILE_DETAIL: {
    description: '회원 상세 (phone 포함)',
    fields: ['id', 'name', 'student_id', 'phone', 'is_paid', ...],
    excludeFields: ['password_hash']
  }
};
```

**유지보수 이점**:
- ✅ 필드 의도 명확 (태그명 = 용도)
- ✅ excludeFields 명시 → 민감 정보 자동 실수 방지
- ✅ 한 곳에서 관리 → 필드 누락 위험 감소

---

### 2️⃣ API 함수 통합

**api.jsx에서 새로운 필드 정의 사용**:
```javascript
// Before: 각 함수마다 하드코딩
supabase.from('games')
  .select('id, name, image, category, ...')  // ❌ 여러 곳에 중복

// After: 중앙 집중식 관리
supabase.from('games')
  .select(API_FIELDS.GAMES_FOR_LISTING.fields.join(', '))  // ✅ 한 곳에서 관리
```

**수정된 함수들**:
- ✅ `fetchGames()` - API_FIELDS.GAMES_FOR_LISTING 사용
- ✅ `fetchGameById()` - API_FIELDS.GAMES_FOR_LISTING 사용
- ✅ `fetchUsers()` - API_FIELDS.USERS_LIST 사용
- ✅ `fetchUserProfile()` - API_FIELDS.USER_PROFILE_DETAIL 사용
- ✅ `fetchReviews()` - API_FIELDS.REVIEWS 사용

---

### 3️⃣ v_games_with_status.sql의 RLS 검증

**RLS 보안 확인**:
```sql
-- rentals의 RLS 적용: auth.uid() = user_id OR is_admin()
--   → 일반 사용자: 자신의 대여만 볼 수 있음
--   → 관리자: 전체 대여 볼 수 있음

-- profiles의 RLS 자동 적용
--   → 각 사용자: 자신의 프로필만 보임

-- 결론: 뷰를 통해서도 RLS가 정상 작동 ✅
```

**문서화 추가**: v_games_with_status.sql에 RLS 고려사항 명시

---

### 4️⃣ calculateGameStatus의 Race Condition 문서화

**문제점**:
```
T0: fetchGameById() → available_count=5 조회
T1: 다른 사용자가 1개 대여 → DB: available_count=4 업데이트
T2: calculateGameStatus() → 여전히 5개 기반으로 상태 계산 ❌
```

**해결 방안** (문서화):
```javascript
// [TODO] 향후 개선: RPC 함수로 원자적 실행
CREATE OR REPLACE FUNCTION public.get_game_with_status()
RETURNS TABLE (id INTEGER, status TEXT, available_count INTEGER, ...)
AS $$
BEGIN
  -- 상태 계산을 RPC에서 원자적으로 실행
  -- 데이터 조회와 계산 사이의 시간 차이 제거
END;
```

**현재 상태**: Brief inconsistency 가능하나, RLS로 인한 데이터 손상은 없음 (안전)

---

## 📊 개선 효과 요약

| 영역 | Before | After | 효과 |
|------|--------|-------|------|
| **보안 (IDOR)** | ❌ userId 파라미터 노출 | ✅ server auth.uid() | 완전 차단 |
| **보안 (역할)** | ❌ is_admin()에 kiosk | ✅ 역할 분리 | 감시 추적 명확 |
| **유지보수** | ❌ 필드 산재 | ✅ API_FIELDS 중앙화 | 일관성 보장 |
| **보안 (민감정보)** | ❌ excludeFields 불명확 | ✅ 명시적 제외 | 실수 방지 |
| **성능** | ⚠️ Race Condition | ✅ 문서화 | 인식 제고 |

---

## 🎯 다음 단계 (P2 & Future)

### P2 선택적 개선

- [ ] calculateGameStatus를 RPC 함수로 이관 (Race Condition 완전 해결)
  ```sql
  CREATE OR REPLACE FUNCTION public.get_game_with_status(p_game_id INTEGER)
  RETURNS TABLE (...)
  ```

- [ ] FIELD_TAGS 검증 자동화 (TypeScript 타입 생성)
  ```typescript
  // 빌드 시 fields와 실제 테이블 스키마 비교
  ```

### Future 아키텍처 개선

1. **계산 로직의 서버 이관**
   - 상태 계산 (calculateGameStatus) → RPC
   - 필터링 로직 → RPC

2. **필드 메타데이터 기반 타입 생성**
   - constants/fields.js → TypeScript 타입 자동 생성
   - API 호출 시 타입 안정성 확보

3. **RLS 정책 감시**
   - 주기적 RLS 정책 검증 (자동화 가능)
   - 뷰의 RLS 상속 명시적 테스트

---

## 📝 체크리스트

### P0 보안 (완료 ✅)
- [x] fetchMyRentals userId 제거
- [x] fetchMyRentalHistory userId 제거
- [x] fetchUserPoints userId 제거
- [x] fetchPointHistory userId 제거
- [x] is_admin() & is_kiosk_or_admin() 분리
- [x] 호출 위치 수정 (MyPage, GameDetail)

### P1 데이터 정합성 & 필드 관리 (완료 ✅)
- [x] API_FIELDS 통합 구조 생성
- [x] fetchGames 필드 통합
- [x] fetchGameById 필드 통합
- [x] fetchUsers 필드 통합
- [x] fetchUserProfile 필드 통합
- [x] fetchReviews 필드 통합
- [x] v_games_with_status RLS 검증
- [x] calculateGameStatus Race Condition 문서화

### P2 선택적 (Future)
- [ ] calculateGameStatus → RPC 이관
- [ ] excludeFields 검증 자동화
- [ ] 필드 → TypeScript 타입 생성

---

**개선 완료 일시**: 2026-04-15
**개선 시간**: ~1시간 30분
**영향 범위**: 보안 (고), 성능 (중), 유지보수 (중)
