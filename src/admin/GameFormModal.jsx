// src/admin/GameFormModal.js
// 설명: 게임 정보 입력/수정용 공통 모달

import { useState, useEffect } from 'react';
import { useToast } from '../contexts/ToastContext'; // [NEW]

function GameFormModal({ isOpen, onClose, initialData, onSubmit, title }) {
  const { showToast } = useToast(); // [NEW]
  const [formData, setFormData] = useState({
    name: "",
    category: "보드게임",
    difficulty: "",
    genre: "",
    players: "",
    tags: "",
    image: "",
    video_url: "",
    recommendation_text: "",
    manual_url: "",
    is_rentable: true,
    ...initialData
  });

  // 모달이 열릴 때마다 초기 데이터(initialData)로 폼을 리셋
  useEffect(() => {
    if (isOpen) {
      setFormData({
        name: "", category: "보드게임", difficulty: "", players: "", tags: "", image: "", video_url: "", recommendation_text: "", manual_url: "", is_rentable: true,
        ...initialData // 부모가 준 데이터가 있으면 덮어씌움
      });
    }
  }, [isOpen, initialData]);

  if (!isOpen) return null;

  const handleSubmit = () => {
    if (!formData.name) return showToast("이름은 필수입니다.", { type: "warning" });
    if (formData.difficulty === "") return showToast("난이도를 입력해주세요.", { type: "warning" }); // [NEW] 난이도 필수 검증 추가
    onSubmit(formData); // 부모 컴포넌트에게 입력된 데이터 전달
  };

  const openBGGSearch = () => {
    if (!formData.name) return showToast("게임 이름을 먼저 입력해주세요.", { type: "warning" });
    // 영문 이름 검색이 정확하므로, 사용자가 한글로 입력했더라도 일단 검색창을 띄워줌
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
          <button
            onClick={openBGGSearch}
            style={{
              marginTop: "10px", padding: "8px", width: "100%",
              background: "#2c3e50", color: "white", fontSize: "0.9em",
              border: "1px solid #555", borderRadius: "6px", cursor: "pointer"
            }}
            title="BGG에서 검색하여 난이도 확인"
          >
            🔍 BGG 검색
          </button>
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