// src/components/FilterBar.js
// 설명: 유저/관리자 공통 필터링 UI 컴포넌트

import React from 'react';

function FilterBar({
  inputValue, setInputValue,
  selectedCategory, setSelectedCategory,
  difficultyFilter, setDifficultyFilter,
  playerFilter, setPlayerFilter,
  onlyAvailable, setOnlyAvailable,
  categories,
  onReset,
  // 관리자 전용 Props
  isAdmin = false,
  renterFilter, setRenterFilter,
  renterOptions = [],
  ownerFilter, setOwnerFilter, // [NEW] props 추가
  hideSearch = false
}) {
  return (
    <div
      className={isAdmin ? "filter-bar-container admin-filter-bar" : "filter-bar-container"}
      style={isAdmin ? {} : styles.container}
    >

      {/* 1. 검색창 (게임 이름/태그) */}
      {!hideSearch && (
        <input
          type="text"
          placeholder="🔍 검색 (태그는 #)"
          aria-label="게임 이름 또는 태그 검색"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          className={isAdmin ? "admin-input search-input" : ""}
          style={isAdmin ? {} : styles.inputSearch}
        />
      )}

      {/* 2. [관리자 전용] 현재 대여·예약자 이름 선택 */}
      {isAdmin && (
        <select
          value={renterFilter}
          onChange={(e) => setRenterFilter(e.target.value)}
          className="admin-select admin-renter-select"
          aria-label="대여·예약자 선택"
        >
          <option value="">대여·예약자 전체</option>
          {renterFilter && !renterOptions.includes(renterFilter) && (
            <option value={renterFilter}>{renterFilter} (현재 내역 없음)</option>
          )}
          {renterOptions.map(name => <option key={name} value={name}>{name}</option>)}
        </select>
      )}

      {/* 2-2. [관리자 전용] 소유자 검색 - 관리자일 때만 노출 */}
      {isAdmin && (
        <input
          type="text"
          placeholder="🏢 소유자 검색"
          aria-label="소유자 검색"
          value={ownerFilter}
          onChange={(e) => setOwnerFilter(e.target.value)}
          className="admin-input admin-owner-input"
          style={isAdmin ? {} : { ...styles.inputSearch, borderColor: "#27ae60", background: "#f0fff4" }}
        />
      )}

      {/* 3. 카테고리 선택 */}
      <select
        value={selectedCategory}
        onChange={(e) => setSelectedCategory(e.target.value)}
        className={isAdmin ? "admin-select" : ""}
        style={isAdmin ? {} : styles.select}
        aria-label="카테고리 선택"
      >
        {categories.map(cat => <option key={cat} value={cat}>{cat}</option>)}
      </select>

      {/* 4. 난이도 선택 */}
      <select
        value={difficultyFilter}
        onChange={(e) => setDifficultyFilter(e.target.value)}
        className={isAdmin ? "admin-select" : ""}
        style={isAdmin ? {} : styles.select}
        aria-label="난이도 선택"
      >
        <option value="전체">난이도 전체</option>
        <option value="입문">🐣 입문 (0~2점)</option>
        <option value="초중급">🎲 초중급 (2~3점)</option>
        <option value="전략">🧠 전략 (3점+)</option>
      </select>

      {/* 5. 인원수 선택 */}
      <select
        value={playerFilter}
        onChange={(e) => setPlayerFilter(e.target.value)}
        className={isAdmin ? "admin-select" : ""}
        style={isAdmin ? { fontWeight: playerFilter !== "all" ? "bold" : "normal", color: playerFilter !== "all" ? "var(--admin-primary)" : "inherit" } : { ...styles.select, fontWeight: playerFilter !== "all" ? "bold" : "normal", color: playerFilter !== "all" ? "#3498db" : "black" }}
        aria-label="인원수 선택"
      >
        <option value="all">인원수 전체</option>
        <option value="2">2인</option>
        <option value="3">3인</option>
        <option value="4">4인</option>
        <option value="5">5인</option>
        <option value="5+">5인 이상</option>
        <option value="6+">6인 이상</option>
        <option value="8+">8인 이상</option>
      </select>

      {/* 6. 대여 가능만 보기 체크박스 */}
      <label className={isAdmin ? 'admin-available-filter' : undefined} style={isAdmin ? undefined : styles.checkboxLabel}>
        <input
          type="checkbox"
          checked={onlyAvailable}
          onChange={(e) => setOnlyAvailable(e.target.checked)}
          style={isAdmin ? undefined : { transform: "scale(1.2)" }}
        />
        <span style={{ fontWeight: onlyAvailable ? "bold" : "normal" }}>대여 가능만</span>
      </label>

      {/* 7. 초기화 버튼 */}
      <button type="button" onClick={onReset} className={isAdmin ? 'admin-filter-reset' : undefined} style={isAdmin ? undefined : styles.resetBtn}>
        🔄 초기화
      </button>
    </div>
  );
}

const styles = {
  container: {
    background: "#f8f9fa", padding: "15px", borderRadius: "15px", marginBottom: "20px",
    display: "flex", flexWrap: "wrap", gap: "10px", alignItems: "center", justifyContent: "center",
    border: "1px solid #eee"
  },
  inputSearch: { padding: "10px 15px", borderRadius: "20px", border: "1px solid #ddd", width: "180px" },
  select: { padding: "10px", borderRadius: "10px", border: "1px solid #ddd", cursor: "pointer" },
  checkboxLabel: { display: "flex", alignItems: "center", gap: "5px", cursor: "pointer", userSelect: "none", margin: "0 10px" },
  resetBtn: { padding: "10px 20px", background: "#e74c3c", color: "white", border: "none", borderRadius: "25px", cursor: "pointer", fontWeight: "bold", fontSize: "1.05em", boxShadow: "0 4px 6px rgba(0,0,0,0.15)", display: "flex", alignItems: "center", gap: "5px", transition: "all 0.2s" }
};

export default FilterBar;
