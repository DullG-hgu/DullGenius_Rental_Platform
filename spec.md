# Feature Spec: 회원 분류 (정회원 / 무료대여 / 드롭아웃) 탭 필터

**작성자:** Claude (Architect)
**작성일:** 2026-04-21
**대상:** @scout (프론트 구현), @gemini (리뷰)

---

## 배경 및 문제

현재 `MembersTab`은 회원을 단일 `is_paid` boolean으로만 분류하여,
1. 이번 학기 정회원
2. 무료 대여만 가입한 유령 회원
3. 지난 학기 회원이었다가 이번 학기 미갱신한 드롭아웃

이 **모두 "미납"으로 섞여 관리가 어려움**.

`joined_semester`만으로는 다음 학기에 무료대여 가입자가 "드롭아웃"으로 오분류되는 구조적 결함이 있어, **학기별 납부 이력을 기록할 컬럼이 필요**.

---

## 최종 분류 로직

```
IF status == 'withdrawn'                    → 🚪 탈퇴
ELIF roles ∩ {admin, executive, payment_exempt}  → 🎖️ 면제
ELIF is_paid == true                        → ✅ 이번 학기 정회원
ELIF last_paid_semester IS NULL             → 🆓 무료 대여만
ELIF last_paid_semester < CURRENT_SEMESTER  → ⚠️ 드롭아웃
ELSE                                        → (fallback) 드롭아웃
```

---

## 1. DB 변경 (Claude 직접 — MCP 도구)

### 마이그레이션
```sql
ALTER TABLE public.profiles
  ADD COLUMN last_paid_semester text;

-- 백필: 현재 is_paid=true인 유저 = 이번 학기 정회원으로 간주
UPDATE public.profiles
  SET last_paid_semester = '2026-1'
  WHERE is_paid = true;

COMMENT ON COLUMN public.profiles.last_paid_semester IS
  '가장 최근 회비를 납부한 학기 (YYYY-S). is_paid=true 전환 시점에 자동 기록. 학기 리셋 후에도 유지되어 드롭아웃 식별에 사용.';
```

### `reset_semester_payments()` 변경 불필요
- `is_paid=false`로 리셋하되 `last_paid_semester`는 건드리지 않아야 드롭아웃 판별 가능
- 현재 함수는 `is_paid`만 업데이트 중 → 그대로 유지 OK

---

## 2. `src/constants.jsx` — 학기 유틸 추가

```js
// [NEW] 현재 학기 계산 (1~6월 → S1, 7~12월 → S2)
export const getCurrentSemester = () => {
  const now = new Date();
  const year = now.getFullYear();
  const sem = now.getMonth() + 1 <= 6 ? 1 : 2;
  return `${year}-${sem}`;
};

// [NEW] 학기 문자열 비교 ('YYYY-S' 형식). a < b면 음수, a > b면 양수
export const compareSemester = (a, b) => {
  if (!a || !b) return 0;
  const [ay, as] = a.split('-').map(Number);
  const [by, bs] = b.split('-').map(Number);
  if (ay !== by) return ay - by;
  return as - bs;
};

// DEFAULT_SEMESTER는 fallback용으로만. 런타임 분류에는 getCurrentSemester() 사용
export const DEFAULT_SEMESTER = '2026-1';  // [UPDATED] 2025-1 → 2026-1
```

---

## 3. `src/api.jsx` — `fetchUsers` 확장

`line 710` `select` 문자열에 `last_paid_semester` 추가:
```js
.select('id, name, student_id, phone, is_paid, joined_semester, status, last_paid_semester')
```

---

## 4. `src/api_members.jsx` — `updatePaymentStatus` 확장

```js
import { getCurrentSemester } from './constants';

export const updatePaymentStatus = async (userId, isPaid) => {
    const updates = { is_paid: isPaid };
    // is_paid=true로 전환 시 현재 학기를 기록. false로 되돌릴 땐 기존 값 유지.
    if (isPaid) {
        updates.last_paid_semester = getCurrentSemester();
    }
    const { error } = await supabase
        .from('profiles')
        .update(updates)
        .eq('id', userId);
    if (error) throw error;
    return { status: "success" };
};
```

---

## 5. `src/admin/MembersTab.jsx` — 탭 필터 UI

### 5-1. import 추가
```js
import { DEFAULT_SEMESTER, getCurrentSemester, compareSemester } from '../constants';
```

### 5-2. state 추가
```js
const [categoryFilter, setCategoryFilter] = useState('all');
// 'all' | 'paid' | 'free_rental' | 'dropout' | 'exempt' | 'withdrawn'
```

### 5-3. 분류 함수 (컴포넌트 내부 또는 파일 상단)
```js
const EXEMPT_ROLES = ['admin', 'executive', 'payment_exempt'];

const classifyMember = (member, currentSemester) => {
    if (member.status === 'withdrawn') return 'withdrawn';
    const roles = member.roles || [];
    if (roles.some(r => EXEMPT_ROLES.includes(r))) return 'exempt';
    if (member.is_paid) return 'paid';
    if (!member.last_paid_semester) return 'free_rental';
    if (compareSemester(member.last_paid_semester, currentSemester) < 0) return 'dropout';
    return 'dropout'; // fallback
};
```

### 5-4. `filteredAndSortedMembers` 변경
- 기존 `showWithdrawn` state 제거 → 탭 `'withdrawn'`으로 통합
- 필터 로직에 `classifyMember(member, currentSemester) === categoryFilter` 추가
- `categoryFilter === 'all'`이면 탈퇴 제외한 전체

### 5-5. 카운트 + 탭 UI
탭 바는 제목 아래, 검색/정렬 필터 바 위에 배치. 각 탭에 개수 배지.

```jsx
const counts = useMemo(() => {
    const currentSem = getCurrentSemester();
    const acc = { all: 0, paid: 0, free_rental: 0, dropout: 0, exempt: 0, withdrawn: 0 };
    members.forEach(m => {
        const cat = classifyMember(m, currentSem);
        acc[cat]++;
        if (cat !== 'withdrawn') acc.all++;
    });
    return acc;
}, [members]);

const TABS = [
    { key: 'all',         label: '전체',       emoji: '👥', color: '#95a5a6' },
    { key: 'paid',        label: '정회원',     emoji: '✅', color: '#27ae60' },
    { key: 'free_rental', label: '무료대여',   emoji: '🆓', color: '#7f8c8d' },
    { key: 'dropout',     label: '드롭아웃',   emoji: '⚠️', color: '#e67e22' },
    { key: 'exempt',      label: '면제',       emoji: '🎖️', color: '#3498db' },
    { key: 'withdrawn',   label: '탈퇴',       emoji: '🚪', color: '#e74c3c' },
];
```

탭 버튼 렌더:
```jsx
<div style={styles.tabBar}>
    {TABS.map(tab => (
        <button
            key={tab.key}
            onClick={() => setCategoryFilter(tab.key)}
            style={{
                ...styles.tabBtn,
                background: categoryFilter === tab.key ? tab.color : 'var(--admin-card-bg)',
                color: categoryFilter === tab.key ? 'white' : 'var(--admin-text-main)',
                border: `1px solid ${categoryFilter === tab.key ? tab.color : 'var(--admin-border)'}`
            }}
        >
            {tab.emoji} {tab.label} <span style={styles.tabCount}>{counts[tab.key]}</span>
        </button>
    ))}
</div>
```

### 5-6. 행에 `last_paid_semester` 정보 표시
"활동 기간" 셀 아래 또는 회비 셀 hover 툴팁으로:
```jsx
<td>
  {hasExemption ? (... existing ...) : (
    <button ...>
      {member.is_paid ? '✅ 납부' : '❌ 미납'}
    </button>
  )}
  {/* [NEW] 최근 납부 학기 (미납일 때만 표시) */}
  {!member.is_paid && member.last_paid_semester && (
    <div style={{ fontSize: '0.75em', color: 'var(--admin-text-sub)', marginTop: '2px' }}>
      최근 납부: {member.last_paid_semester}
    </div>
  )}
</td>
```

### 5-7. 기존 `showWithdrawn` 토글 제거
`'탈퇴' 탭`으로 대체되므로 checkbox 및 관련 state 삭제.

---

## 6. 엣지 케이스 처리

| 케이스 | 처리 |
|--------|------|
| `joined_semester == null` | 분류 영향 없음 (last_paid_semester로만 판단) |
| 면제 role 해제 시 `is_paid=true` 잔존 | **범위 외** — 추후 별도 개선. 현재는 관리자가 수동 토글 |
| 학기 리셋 직후 (is_paid 전부 false) | 정상 작동: 지난 학기 낸 사람 = 드롭아웃, 신규 = 무료대여 |
| 탈퇴 후 재가입 | `withdrawn` → 분류 우선순위 최상위라 OK |
| 과거 미백필 데이터 | 마이그레이션의 `last_paid_semester='2026-1'` 백필로 커버 |

---

## 7. 작업 순서

1. **Claude**: DB 마이그레이션 적용 + `npm run pull-schema`
2. **Claude**: `api.jsx` `fetchUsers` select 확장
3. **Claude**: `api_members.jsx` `updatePaymentStatus` 확장
4. **@scout**: `constants.jsx` 유틸 추가
5. **@scout**: `MembersTab.jsx` 탭 UI + 분류 로직
6. **@gemini 리뷰 필수 항목**:
   - DB 스키마 변경 (컬럼 추가)
   - 분류 로직의 엣지 케이스
   - `updatePaymentStatus`의 학기 전환 시점 안전성

---

## 참고 사항

- 면제 role 해제 시 자동으로 `is_paid=false` 처리하는 로직은 **이 PR 범위 외**. 추후 논의.
- `getCurrentSemester()`는 클라이언트 시간 기준 — 학기 경계 시점 (7/1, 1/1)에는 서버와 1시간 이내 차이 가능. 분류 정확도에 실질 영향 없음.
- 탭 카운트는 `members` 전체 기준 (검색어 무관).
