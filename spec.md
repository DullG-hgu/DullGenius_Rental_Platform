# Feature Spec: MyPage 대여 이력 + 검색 필터 UX 개선

**작성자:** Claude (Architect)
**작성일:** 2026-03-13
**대상:** @scout (구현), @gemini (리뷰)

---

## 작업 범위
1. MyPage에 과거 대여 이력 섹션 추가
2. GameSearch 대여 가능 필터 토글 칩 추가

---

## Feature 1: MyPage 과거 대여 이력

### 배경
현재 `fetchMyRentals`는 `returned_at IS NULL` (미반납) 건만 반환.
과거에 빌렸다 반납한 이력을 확인하는 기능이 없음.

### 1-1. API 추가 (`src/api.jsx`)

파일에서 `fetchMyRentals` 함수 바로 아래에 추가:

```js
export const fetchMyRentalHistory = async (userId) => {
  const { data, error } = await supabase
    .from('rentals')
    .select(`
      rental_id,
      borrowed_at,
      returned_at,
      type,
      game_id,
      games (id, name, image)
    `)
    .eq('user_id', userId)
    .not('returned_at', 'is', null)
    .order('returned_at', { ascending: false })
    .limit(30);

  if (error) {
    console.error("대여 이력 로딩 실패:", error);
    return { status: "error", message: error.message };
  }

  const formatted = data.map(r => ({
    rentalId: r.rental_id,
    gameId: r.game_id,
    gameName: r.games?.name || "알 수 없는 게임",
    gameImage: r.games?.image,
    borrowedAt: r.borrowed_at,
    returnedAt: r.returned_at,
    type: r.type || 'RENT',
  }));

  return { status: "success", data: formatted };
};
```

### 1-2. UI 추가 (`src/components/MyPage.jsx`)

**import 변경:**
```js
// 기존
import { fetchMyRentals, fetchUserPoints, fetchPointHistory, withdrawAccount, cancelDibsGame } from '../api';
// 변경
import { fetchMyRentals, fetchUserPoints, fetchPointHistory, withdrawAccount, cancelDibsGame, fetchMyRentalHistory } from '../api';
```

**state 추가 (기존 useState 선언부 근처):**
```js
const [rentalHistory, setRentalHistory] = useState([]);
```

**loadData 변경:**
```js
// 기존
const [rentalsResult, points, history] = await Promise.all([
  fetchMyRentals(user.id),
  fetchUserPoints(user.id),
  fetchPointHistory(user.id)
]);

// 변경
const [rentalsResult, points, history, historyResult] = await Promise.all([
  fetchMyRentals(user.id),
  fetchUserPoints(user.id),
  fetchPointHistory(user.id),
  fetchMyRentalHistory(user.id)
]);

if (historyResult.status === "success") {
  setRentalHistory(historyResult.data);
}
```

**섹션 추가 위치:** `/* 3. 포인트 내역 섹션 */` 바로 위에 삽입:

```jsx
{/* 2-b. 과거 대여 이력 섹션 */}
<section style={{ ...styles.card, marginTop: "20px" }}>
  <h3 style={styles.sectionTitle}>📋 과거 대여 이력 (최근 30건)</h3>
  {loading ? (
    <div style={{ padding: "20px", textAlign: "center", color: "#888" }}>로딩 중...</div>
  ) : rentalHistory.length === 0 ? (
    <div style={{ padding: "20px", textAlign: "center", color: "#95a5a6" }}>
      아직 반납한 게임이 없습니다.
    </div>
  ) : (
    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
      {rentalHistory.map((item) => (
        <div key={item.rentalId} style={{
          display: "flex", justifyContent: "space-between", alignItems: "center",
          padding: "10px 12px", background: "#f8f9fa", borderRadius: "8px",
          border: "1px solid #eee"
        }}>
          <div>
            <div style={{ fontWeight: "bold", color: "#2c3e50", fontSize: "0.95em" }}>
              {item.gameName}
            </div>
            <div style={{ fontSize: "0.8em", color: "#7f8c8d", marginTop: "2px" }}>
              {formatDate(item.borrowedAt)} → {formatDate(item.returnedAt)}
            </div>
          </div>
          <span style={{
            fontSize: "0.75em", padding: "3px 8px", borderRadius: "10px",
            background: "#ecf0f1", color: "#7f8c8d", fontWeight: "bold"
          }}>
            반납완료
          </span>
        </div>
      ))}
    </div>
  )}
</section>
```

---

## Feature 2: GameSearch 대여 가능 필터 토글 칩

### 배경
`onlyAvailable` state와 FilterBar 체크박스는 이미 존재.
모바일에서 FilterBar를 스크롤해야 접근 가능해 불편함.
검색 결과 상단(search-status-bar)에 눈에 띄는 토글 칩 추가.

### 변경 파일: `src/pages/GameSearch.jsx`

`search-status-bar` div를 아래와 같이 수정:

```jsx
{/* 기존 */}
<div className="search-status-bar">
    {isTrendingMode ? (
        <span>인기 순위 <strong>{filteredGames.length}</strong>개의 게임</span>
    ) : (
        <span>총 <strong>{filteredGames.length}</strong>개의 게임</span>
    )}
</div>

{/* 변경 */}
<div className="search-status-bar">
    {isTrendingMode ? (
        <span>인기 순위 <strong>{filteredGames.length}</strong>개의 게임</span>
    ) : (
        <>
            <span>총 <strong>{filteredGames.length}</strong>개의 게임</span>
            <button
                onClick={() => setOnlyAvailable(v => !v)}
                className={`available-filter-chip${onlyAvailable ? ' active' : ''}`}
            >
                🟢 대여 가능만
            </button>
        </>
    )}
</div>
```

### CSS 추가 (`src/pages/GameSearch.css`)

`search-status-bar` 관련 스타일에 추가 (기존 선택자 확인 후 flex 속성 보완):

```css
.search-status-bar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  /* 기존 속성 유지 */
}

.available-filter-chip {
  padding: 4px 12px;
  border-radius: 20px;
  border: 1px solid #ccc;
  background: white;
  color: #888;
  font-weight: bold;
  font-size: 0.82em;
  cursor: pointer;
  transition: all 0.2s;
}

.available-filter-chip.active {
  border: none;
  background: #2ecc71;
  color: white;
}
```

---

## 주의사항
- `fetchMyRentalHistory`는 DB 스키마/RLS 변경 없이 기존 `rentals` 테이블 조회만 사용
- MyPage는 전체 inline styles 사용 중 — 새 섹션도 동일 패턴 유지
- FilterBar의 기존 "대여 가능만" 체크박스는 그대로 유지 (동일 state 공유)
- 트렌딩 모드(`isTrendingMode === true`)에서 토글 칩 자동으로 숨겨짐 (조건분기 내부이므로)
- `GameSearch.css`에서 `.search-status-bar` 기존 스타일을 먼저 읽고 수정 (덮어쓰지 말 것)
