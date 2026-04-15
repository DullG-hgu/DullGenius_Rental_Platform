// src/admin/GameFormModal.js
// 설명: 게임 정보 입력/수정용 공통 모달

import { useState, useEffect } from 'react';
import { useToast } from '../contexts/ToastContext'; // [NEW]
import { searchBGG, fetchBGGGame } from '../api'; // [NEW] BGG API 함수

function GameFormModal({ isOpen, onClose, initialData, onSubmit, title }) {
  const { showToast } = useToast(); // [NEW]
  const [formData, setFormData] = useState({
    name: "",
    bgg_id: "", // [NEW]
    category: "보드게임",
    difficulty: "",
    genre: "",
    players: "",
    tags: "",
    image: "",
    video_url: "",
    recommendation_text: "",
    manual_url: "",
    owner: "",
    is_rentable: true,
    ...initialData
  });

  // [NEW] BGG 연동 상태
  const [bggSearchResults, setBggSearchResults] = useState([]);
  const [bggSearching, setBggSearching] = useState(false);
  const [bggFetching, setBggFetching] = useState(false);
  const [showBggPanel, setShowBggPanel] = useState(false);
  const [manualBggId, setManualBggId] = useState('');

  // 모달이 열릴 때마다 초기 데이터(initialData)로 폼을 리셋
  useEffect(() => {
    if (isOpen) {
      setFormData({
        name: "", category: "보드게임", difficulty: "", players: "", tags: "", image: "", video_url: "", recommendation_text: "", manual_url: "", owner: "", is_rentable: true, bgg_id: "", // [NEW]
        ...initialData // 부모가 준 데이터가 있으면 덮어씌움
      });
      setBggSearchResults([]);
      setShowBggPanel(false);
      setManualBggId('');
    }
  }, [isOpen, initialData]);

  if (!isOpen) return null;

  const handleSubmit = () => {
    if (!formData.name) return showToast("이름은 필수입니다.", { type: "warning" });
    if (formData.difficulty === "") return showToast("난이도를 입력해주세요.", { type: "warning" }); // [NEW] 난이도 필수 검증 추가
    onSubmit(formData); // 부모 컴포넌트에게 입력된 데이터 전달
  };

  // [NEW] BGG 게임 검색
  const handleBggSearch = async () => {
    if (!formData.name) return showToast("게임 이름을 먼저 입력하세요.", { type: "warning" });
    setBggSearching(true);
    setShowBggPanel(true);
    setBggSearchResults([]);
    try {
      const results = await searchBGG(formData.name);
      if (results.length === 0) {
        showToast("검색 결과가 없습니다. BGG ID를 직접 입력해보세요.", { type: "info" });
      } else {
        // 가장 순위 높은 첫 번째 결과 자동 선택
        setBggSearchResults(results);
        showToast(`"${results[0].name}"을(를) 선택했습니다. (다른 결과는 아래에서 선택 가능)`, { type: "success" });
        await applyBggData(results[0].id);
      }
    } catch (e) {
      showToast("BGG 검색 오류: " + e.message, { type: "error" });
    } finally {
      setBggSearching(false);
    }
  };

  // [NEW] 검색 결과 선택 또는 수동 ID 입력 후 상세 조회 → 폼 자동 채움
  const applyBggData = async (bggId) => {
    setBggFetching(true);
    try {
      console.log('🔍 fetchBGGGame 호출:', bggId);
      const detail = await fetchBGGGame(bggId);
      console.log('📋 fetchBGGGame 반환값:', detail);
      if (!detail) throw new Error("게임 정보를 찾을 수 없습니다.");

      setFormData(prev => ({
        ...prev,
        bgg_id: detail.id,
        difficulty: detail.weight || prev.difficulty,
        players: detail.minPlayers && detail.maxPlayers
          ? (detail.minPlayers === detail.maxPlayers
            ? `${detail.minPlayers}인`
            : `${detail.minPlayers}~${detail.maxPlayers}인`)
          : prev.players,
        image: detail.thumbnail || prev.image,
      }));

      showToast("BGG 정보가 자동으로 채워졌습니다.", { type: "success" });
      setShowBggPanel(false);
      setBggSearchResults([]);
      setManualBggId('');
    } catch (e) {
      console.error('applyBggData 에러:', e);
      showToast("BGG 정보 조회 오류: " + e.message, { type: "error" });
    } finally {
      setBggFetching(false);
    }
  };

  // [NEW] 수동 BGG ID 조회
  const handleManualBggFetch = () => {
    if (!manualBggId.trim()) return showToast("BGG ID를 입력하세요.", { type: "warning" });
    applyBggData(manualBggId.trim());
  };

  // [NEW] BGG 웹사이트에서 직접 검색
  const openBGGWebSearch = () => {
    if (!formData.name) return showToast("게임 이름을 먼저 입력해주세요.", { type: "warning" });
    const url = `https://boardgamegeek.com/geeksearch.php?action=search&objecttype=boardgame&q=${encodeURIComponent(formData.name)}`;
    window.open(url, '_blank');
  };

  // Admin.css styles are applied via class names where possible
  // Inline styles are used for layout but colors are handled by CSS variables in class context

  return (
    <div className="modal-overlay" style={{
      position: "fixed", top: 0, left: 0, width: "100%", height: "100%",
      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000
    }}>
      <div className="modal-content" style={{
        padding: "25px", borderRadius: "15px", width: "90%", maxWidth: "450px",
        boxShadow: "0 5px 20px rgba(0,0,0,0.5)", maxHeight: "90vh", overflowY: "auto"
      }}>
        <h3 style={{ marginTop: 0 }}>{title}</h3>

        <div className="admin-form-group">
          <label className="admin-label">이름</label>
          <input
            value={formData.name}
            onChange={e => setFormData({ ...formData, name: e.target.value })}
            className="admin-input"
            style={{ width: "100%" }}
          />
        </div>

        {/* [NEW] BGG 연동 섹션 */}
        <div className="admin-form-group" style={{
          border: "1px solid rgba(52, 152, 219, 0.3)",
          borderRadius: "8px",
          padding: "12px",
          background: "rgba(52, 152, 219, 0.05)"
        }}>
          <label className="admin-label" style={{ color: "#3498db", fontWeight: "bold" }}>
            BGG 자동 연동
          </label>

          {/* 버튼 행: 이름 검색 + 정보 업데이트 */}
          <div style={{ display: "flex", gap: "8px", marginBottom: "8px" }}>
            <button
              onClick={handleBggSearch}
              disabled={bggSearching || bggFetching}
              style={{
                flex: 1, padding: "8px", background: "#2c3e50", color: "white",
                border: "1px solid #3498db", borderRadius: "6px", cursor: "pointer",
                fontSize: "0.85em", opacity: (bggSearching || bggFetching) ? 0.6 : 1
              }}
            >
              {bggSearching ? "검색 중..." : "🔍 BGG 이름 검색"}
            </button>
            <button
              onClick={handleBggSearch}
              disabled={bggSearching || bggFetching}
              title="현재 이름으로 BGG에서 검색해서 정보 업데이트"
              style={{
                padding: "8px 12px", background: "#e67e22", color: "white",
                border: "none", borderRadius: "6px", cursor: "pointer",
                fontSize: "0.85em", whiteSpace: "nowrap",
                opacity: (bggSearching || bggFetching) ? 0.6 : 1
              }}
            >
              {bggSearching ? "업데이트 중..." : "🔄 정보 업데이트"}
            </button>
          </div>

          {/* 수동 BGG ID 입력 */}
          <div style={{ display: "flex", gap: "8px" }}>
            <input
              value={manualBggId}
              onChange={e => setManualBggId(e.target.value)}
              onKeyPress={e => e.key === 'Enter' && handleManualBggFetch()}
              placeholder="BGG ID 직접 입력 (예: 266192)"
              className="admin-input"
              style={{ flex: 1, fontSize: "0.85em" }}
            />
            <button
              onClick={handleManualBggFetch}
              disabled={bggFetching}
              style={{
                padding: "8px 12px", background: "#27ae60", color: "white",
                border: "none", borderRadius: "6px", cursor: "pointer",
                fontSize: "0.85em", whiteSpace: "nowrap",
                opacity: bggFetching ? 0.6 : 1
              }}
            >
              {bggFetching ? "조회 중..." : "정보 가져오기"}
            </button>
          </div>

          {/* 자동 채워진 BGG ID 표시 */}
          {formData.bgg_id && (
            <div style={{ fontSize: "0.8em", color: "#3498db", marginTop: "6px" }}>
              BGG ID: {formData.bgg_id} (연동됨)
            </div>
          )}

          {/* BGG 웹사이트 직접 검색 */}
          <button
            onClick={openBGGWebSearch}
            style={{
              marginTop: "8px", width: "100%", padding: "8px",
              background: "#555", color: "white", fontSize: "0.85em",
              border: "1px solid #777", borderRadius: "6px", cursor: "pointer"
            }}
            title="BGG 웹사이트에서 직접 검색하기"
          >
            🌐 BGG 웹사이트에서 검색
          </button>

          {/* 검색 결과 드롭다운 패널 */}
          {showBggPanel && (
            <div style={{
              marginTop: "8px", maxHeight: "200px", overflowY: "auto",
              border: "1px solid rgba(255,255,255,0.15)", borderRadius: "6px",
              background: "var(--admin-bg)"
            }}>
              {bggSearching && (
                <div style={{ padding: "10px", textAlign: "center", color: "var(--admin-text-sub)", fontSize: "0.85em" }}>
                  BGG 검색 중...
                </div>
              )}
              {!bggSearching && bggSearchResults.length === 0 && (
                <div style={{ padding: "10px", textAlign: "center", color: "var(--admin-text-sub)", fontSize: "0.85em" }}>
                  결과 없음 - BGG ID를 직접 입력해보세요
                </div>
              )}
              {bggSearchResults.map(item => (
                <div
                  key={item.id}
                  onClick={() => applyBggData(item.id)}
                  style={{
                    padding: "8px 12px", cursor: "pointer", fontSize: "0.85em",
                    borderBottom: "1px solid rgba(255,255,255,0.05)",
                    color: "var(--admin-text-main)",
                    transition: "background 0.2s"
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = 'rgba(52,152,219,0.15)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  <strong>{item.name}</strong>
                  {item.year && <span style={{ color: "var(--admin-text-sub)", marginLeft: "8px" }}>({item.year})</span>}
                  <span style={{ color: "#3498db", marginLeft: "8px", fontSize: "0.8em" }}>ID: {item.id}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
          <div className="admin-form-group">
            <label className="admin-label" htmlFor="category-select">카테고리</label>
            <select
              id="category-select"
              value={formData.category}
              onChange={e => setFormData({ ...formData, category: e.target.value })}
              className="admin-select"
              style={{ width: "100%", padding: "10px", borderRadius: "6px" }}
            >
              <option>보드게임</option>
              <option>머더미스터리</option>
              <option>TRPG</option>
              <option>TCG</option>
            </select>
          </div>

          <div className="admin-form-group">
            <label className="admin-label">난이도 (0.0~5.0)</label>
            <input
              type="number" step="0.1" min="0" max="5"
              value={formData.difficulty || ""}
              onChange={e => setFormData({ ...formData, difficulty: e.target.value })}
              placeholder="예: 2.5"
              className="admin-input"
              style={{ width: "100%" }}
            />
          </div>
        </div>

        <div className="admin-form-group">
          <label className="admin-label">장르</label>
          <input
            value={formData.genre || ""}
            onChange={e => setFormData({ ...formData, genre: e.target.value })}
            placeholder="예: 전략, 추리, 파티"
            className="admin-input"
            style={{ width: "100%" }}
          />
        </div>

        <div className="admin-form-group">
          <label className="admin-label">인원</label>
          <input
            value={formData.players || ""}
            onChange={e => setFormData({ ...formData, players: e.target.value })}
            placeholder="예: 2~4인"
            className="admin-input"
            style={{ width: "100%" }}
          />
        </div>

        <div className="admin-form-group">
          <label className="admin-label">태그 (#으로 구분)</label>
          <input
            value={formData.tags || ""}
            onChange={e => setFormData({ ...formData, tags: e.target.value })}
            placeholder="#전략 #파티"
            className="admin-input"
            style={{ width: "100%" }}
          />
        </div>

        <div className="admin-form-group">
          <label className="admin-label">이미지 URL</label>
          <input
            value={formData.image || ""}
            onChange={e => setFormData({ ...formData, image: e.target.value })}
            className="admin-input"
            style={{ width: "100%" }}
          />
        </div>

        <div className="admin-form-group">
          <label className="admin-label">추천 멘트 (한줄평)</label>
          <textarea
            value={formData.recommendation_text || ""}
            onChange={e => setFormData({ ...formData, recommendation_text: e.target.value })}
            placeholder="예: 초보자도 쉽게 즐길 수 있는 파티 게임!"
            className="admin-input"
            style={{ width: "100%", minHeight: "60px", resize: "vertical" }}
          />
        </div>

        {/* [NEW] 영상/설명서 링크 */}
        <div className="admin-form-group">
          <label className="admin-label">설명 영상 URL (유튜브)</label>
          <input
            value={formData.video_url || ""}
            onChange={e => setFormData({ ...formData, video_url: e.target.value })}
            placeholder="예: https://youtu.be/..."
            className="admin-input"
            style={{ width: "100%" }}
          />
        </div>

        <div className="admin-form-group">
          <label className="admin-label">설명서 링크 (PDF, 노션 등)</label>
          <input
            value={formData.manual_url || ""}
            onChange={e => setFormData({ ...formData, manual_url: e.target.value })}
            placeholder="예: https://..."
            className="admin-input"
            style={{ width: "100%" }}
          />
        </div>

        <div className="admin-form-group">
          <label className="admin-label">소유자</label>
          <input
            value={formData.owner || ""}
            onChange={e => setFormData({ ...formData, owner: e.target.value })}
            placeholder="예: 김철수"
            className="admin-input"
            style={{ width: "100%" }}
          />
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "10px", marginTop: "15px", marginBottom: "10px" }}>
          <input
            type="checkbox"
            id="is-rentable-checkbox"
            checked={formData.is_rentable !== false}
            onChange={e => setFormData({ ...formData, is_rentable: e.target.checked })}
            style={{ width: "20px", height: "20px", cursor: "pointer" }}
          />
          <label htmlFor="is-rentable-checkbox" style={{ fontWeight: "bold", color: "var(--admin-text-main)", cursor: "pointer" }}>
            대여 가능 여부 (체크 해제 시 게임 상세 페이지에서 대여/찜 불가)
          </label>
        </div>

        <div style={{ display: "flex", gap: "10px", marginTop: "20px" }}>
          <button
            onClick={onClose}
            style={styles.cancelBtn}
            onMouseEnter={(e) => {
              e.target.style.backgroundColor = 'rgba(108, 117, 125, 1)';
              e.target.style.transform = 'translateY(-1px)';
            }}
            onMouseLeave={(e) => {
              e.target.style.backgroundColor = 'rgba(108, 117, 125, 0.9)';
              e.target.style.transform = 'translateY(0)';
            }}
            onMouseDown={(e) => {
              e.target.style.transform = 'translateY(0) scale(0.98)';
            }}
            onMouseUp={(e) => {
              e.target.style.transform = 'translateY(-1px)';
            }}
          >
            ✕ 취소
          </button>
          <button
            onClick={handleSubmit}
            style={styles.saveBtn}
            onMouseEnter={(e) => {
              e.target.style.backgroundColor = 'rgba(52, 152, 219, 1)';
              e.target.style.transform = 'translateY(-1px)';
              e.target.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.25)';
            }}
            onMouseLeave={(e) => {
              e.target.style.backgroundColor = 'rgba(52, 152, 219, 0.95)';
              e.target.style.transform = 'translateY(0)';
              e.target.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.15)';
            }}
            onMouseDown={(e) => {
              e.target.style.transform = 'translateY(0) scale(0.98)';
            }}
            onMouseUp={(e) => {
              e.target.style.transform = 'translateY(-1px)';
            }}
          >
            ✓ 저장
          </button>
        </div>
      </div>
    </div>
  );
}

const styles = {
  // Most styles are now handled by CSS classes in Admin.css
  cancelBtn: { flex: 1, padding: "12px", borderRadius: "8px", border: "1px solid rgba(255, 255, 255, 0.2)", background: "rgba(108, 117, 125, 0.9)", color: "white", fontWeight: "600", cursor: "pointer", transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)", boxShadow: "0 2px 8px rgba(0, 0, 0, 0.15)" },
  saveBtn: { flex: 1, padding: "12px", borderRadius: "8px", border: "1px solid rgba(255, 255, 255, 0.2)", background: "rgba(52, 152, 219, 0.95)", color: "white", fontWeight: "600", cursor: "pointer", transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)", boxShadow: "0 2px 8px rgba(0, 0, 0, 0.15)" }
};

export default GameFormModal;