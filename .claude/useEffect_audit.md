# useEffect 전수조사 & 최적화 리포트

## 통계
- **총 54개** useEffect 사용 (32개 파일)
- 최다 사용: KioskPage (6개), GameDetail/GameSearch (4개 각각), Home/MyPage/DashboardTab (3개 각각)

---

## 🔴 **Critical Issues**

### 1. **AuthContext.jsx:147** — 불필요한 의존성
```js
useEffect(() => { ... }, [showToast]); // ❌ showToast는 항상 변함
```
**문제**: `showToast`는 ToastContext에서 매번 새로운 함수로 생성되므로 불필요한 재구독 발생
**영향**: 로그인/로그아웃 시 구독이 계속 재설정됨
**해결**: 의존성 배열을 `[]`로 변경 (마운트 시만 실행)

---

## 🟡 **High Priority Issues**

### 2. **GameDetail.jsx:55** — eslint disable 주석
```js
/* eslint-disable react-hooks/exhaustive-deps */
useEffect(() => { ... }, [id]);
```
**문제**: 규칙을 억제하고 있으나 실제 의도는 `id`가 변할 때만 실행
**영향**: 의존성 누락 발생 시 감지 불가
**해결**: 의존성 배열 정확히 정리

### 3. **GameDetail.jsx:102-120** — 중복 API 호출
```js
// Line 102-120: checkDibsStatus in GameDetail
useEffect(() => {
    if (user && game) {
        const result = await fetchMyRentals(); // ❌ 매번 호출
        // ...
    }
}, [user, game?.id]);
```
**문제**: `user` 변경 시마다 새로운 대여 목록을 조회
**영향**: 불필요한 API 호출 증가
**해결**: 특정 상황에만 호출하도록 조건 강화

### 4. **Home.jsx:38-61** — 분리된 useEffect 통합 가능
- L38-45: 오피스 상태 조회
- L47-52: 페이지 뷰 로그
- L55-61: 스크롤 복원

**문제**: 관련 없는 로직이 분리됨
**해결**: 관련 로직끼리 그룹화 또는 유지 (현재 상태가 나름 정리됨)

### 5. **MyPage.jsx:52-99** — 불필요한 의존성
```js
useEffect(() => {
    if (!authLoading && !user) { ... }
}, [user, authLoading, navigate, showToast]); // ❌ showToast 불필요
```
**문제**: `showToast` 의존성 포함
**영향**: 토스트 함수 변경 시마다 재렌더링
**해결**: `showToast` 제거

### 6. **LazyImage.jsx:21-50** — 2개 useEffect 통합 가능
```js
useEffect(() => {
    setCurrentSrc(src);
    // ...
}, [src]);

useEffect(() => {
    const observer = new IntersectionObserver(...);
    // ...
}, []);
```
**문제**: 독립적이나 로직이 단순함
**영향**: 불필요한 초기화 로직 분산
**해결**: 통합 가능하나 현재 분리도 명확하면 유지 가능

### 7. **KioskPage.jsx:93-108** — fire-and-forget 개선
```js
useEffect(() => {
    if (authLoading) return;
    if (!user) {
        supabase.auth.signInWithPassword({ ... })
            .then(...).catch(...); // ❌ 에러 처리 미흡
    }
}, [authLoading, user]);
```
**문제**: 로그인 중 네트워크 에러 발생 시 처리 부족
**영향**: 키오스크 자동 로그인 실패 후 복구 로직 없음
**해결**: 재시도 로직 추가 또는 사용자 개입 옵션 제공

---

## 🟢 **Good Patterns (유지)**

### ✅ GameDataContext.jsx
- 단순하고 명확한 구조
- 마운트 시만 실행 (`[]` 의존성)
- 캐시 로직 포함으로 효율적

### ✅ useKioskData.jsx
- 마운트 시 한 번만 실행
- 로컬스토리지 캐시와 API 병렬화
- 에러 처리 적절함

### ✅ useGameFilter (useMemo 사용)
- 훅 내에서 useMemo로 최적화
- 불필요한 의존성 제거

### ✅ InstallPromptBanner.jsx
- 마운트 시만 실행
- 이벤트 리스너 정리 완벽함

---

## 📋 **구체적 수정 사항**

| 파일 | 줄 | 현재 | 변경 | 우선순위 |
|------|-----|------|------|---------|
| AuthContext.jsx | 147 | `[showToast]` | `[]` | 🔴 High |
| MyPage.jsx | 58 | `[user, authLoading, navigate, showToast]` | 제거 `showToast` | 🟡 Medium |
| GameDetail.jsx | 100 | `[id]` 전후 검토 필요 | 정확히 정리 | 🟡 Medium |
| Header.jsx | 36 | `[logoClickCount, navigate]` | 확인 필요 | 🟢 Low |
| LoginTooltip.jsx | 14 | `[]` | 유지 | 🟢 OK |

---

## 🎯 **실행된 수정 사항** ✅

### 완료된 항목
1. ✅ **AuthContext.jsx:147** — `[showToast]` → `[]` (마운트 시만 실행)
2. ✅ **MyPage.jsx:58** — `showToast` 의존성 제거
3. ✅ **GameDetail.jsx:55** — eslint disable 주석 제거
4. ✅ **Login.jsx** — `isMountedRef` useEffect 제거 (불필요한 cleanup)
5. ✅ **Signup.jsx** — `isMountedRef` useEffect 제거 (불필요한 cleanup)

### 결과
- **불필요한 재렌더링 감소** → 성능 향상
- **코드 간결성 향상** → 유지보수 용이
- **의존성 명확화** → 버그 위험 감소

---

## 💡 **Best Practices 재확인**

✅ **필수 의존성만 포함**
✅ **정리 함수 반환 (cleanup)**
✅ **불필요한 상태 업데이트 회피**
✅ **useCallback/useMemo 적절한 사용**
