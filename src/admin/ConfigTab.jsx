// src/admin/ConfigTab.js
// 설명: 홈페이지 추천 버튼(Config) 설정 및 관리

import { useState, useEffect } from 'react';
import { saveConfig } from '../api';
import ConfirmModal from '../components/ConfirmModal'; // [NEW]
import { useToast } from '../contexts/ToastContext';

function ConfigTab({ config, onReload }) {
  const { showToast } = useToast();
  // 로컬에서 편집 중인 설정 상태
  const [items, setItems] = useState([]);

  // [NEW] Confirm 모달 상태
  const [confirmModal, setConfirmModal] = useState({
    isOpen: false,
    title: "",
    message: "",
    onConfirm: null,
    type: "info"
  });

  const showConfirmModal = (title, message, onConfirm, type = "info") => {
    setConfirmModal({ isOpen: true, title, message, onConfirm, type });
  };

  const closeConfirmModal = () => {
    setConfirmModal((prev) => ({ ...prev, isOpen: false }));
  };

  // 부모로부터 초기 데이터(config)를 받으면 로컬 상태에 동기화
  useEffect(() => {
    if (config) {
      setItems(config);
    }
  }, [config]);

  // 1. 설정값 변경 (입력창 수정 시)
  const handleChange = (idx, field, value) => {
    const newItems = [...items];
    newItems[idx][field] = value;
    setItems(newItems);
  };

  // 2. 새 버튼 추가
  const handleAdd = () => {
    const newItem = {
      key: `btn_${Date.now()}`, // 유니크 키 생성
      label: "✨\n새 버튼",
      value: "#태그입력",
      color: "#95a5a6"
    };
    setItems([...items, newItem]);
  };

  // 3. 버튼 삭제
  const handleDelete = (idx) => {
    if (items.length <= 1) {
      showToast("최소 1개의 버튼은 있어야 합니다.", { type: "warning" });
      return;
    }

    showConfirmModal(
      "버튼 삭제",
      "이 추천 버튼을 삭제하시겠습니까?",
      () => {
        const newItems = items.filter((_, i) => i !== idx);
        setItems(newItems);
      },
      "danger"
    );
  };

  // 4. 최종 저장 (서버 전송)
  const handleSave = async () => {
    showConfirmModal(
      "설정 저장",
      "현재 설정을 저장하고 적용하시겠습니까?",
      async () => {
        try {
          await saveConfig(items);
          showToast("저장되었습니다.", { type: "success" });
          if (onReload) onReload(); // 부모 컴포넌트 데이터 갱신
        } catch (e) {
          showToast("저장 실패: " + e, { type: "error" });
        }
      },
      "info"
    );
  };

  return (
    <div>
      <h3>🎨 추천 버튼 설정</h3>
      <p style={{ color: "var(--admin-text-sub)", marginBottom: "20px", fontSize: "0.9em" }}>
        홈페이지 메인 화면에 표시되는 빠른 검색 버튼들을 설정합니다.<br />
        색상을 클릭하여 변경할 수 있습니다.
      </p>

      <div style={{ display: "grid", gap: "15px", marginBottom: "30px" }}>
        {items.map((item, idx) => (
          <div key={item.key || idx} className="admin-card" style={styles.cardLayout}>

            {/* 1. 색상 선택기 */}
            <div style={{ textAlign: "center" }}>
              <div style={{ ...styles.colorPreview, background: item.color }}>
                <input
                  type="color"
                  value={item.color}
                  onChange={(e) => handleChange(idx, 'color', e.target.value)}
                  style={styles.colorInput}
                />
              </div>
            </div>

            {/* 2. 텍스트 입력 필드 */}
            <div style={styles.inputContainer}>
              <div>
                <label style={styles.label}>버튼 이름 (\n 줄바꿈)</label>
                <input
                  value={item.label}
                  onChange={(e) => handleChange(idx, 'label', e.target.value)}
                  className="admin-input"
                  style={{ width: "100%" }}
                />
              </div>
              <div>
                <label style={styles.label}>연결 태그 (#)</label>
                <input
                  value={item.value}
                  onChange={(e) => handleChange(idx, 'value', e.target.value)}
                  placeholder="#태그"
                  className="admin-input"
                  style={{ width: "100%" }}
                />
              </div>
            </div>

            {/* 3. 삭제 버튼 */}
            <div style={{ display: "flex", alignItems: "center" }}>
              <button
                onClick={() => handleDelete(idx)}
                style={styles.deleteBtn}
                title="이 버튼 삭제"
              >
                🗑️
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* 하단 액션 버튼들 */}
      <div style={{ display: "flex", gap: "10px", marginTop: "20px" }}>
        <button onClick={handleAdd} style={styles.addBtn}>
          ➕ 버튼 추가
        </button>
        <button onClick={handleSave} style={styles.saveBtn}>
          💾 설정 저장하고 적용하기
        </button>
      </div>

      {/* Confirm 모달 */}
      <ConfirmModal
        isOpen={confirmModal.isOpen}
        onClose={closeConfirmModal}
        onConfirm={confirmModal.onConfirm}
        title={confirmModal.title}
        message={confirmModal.message}
        type={confirmModal.type}
      />
    </div>
  );
}

// --- 스타일 ---
const styles = {
  cardLayout: {
    display: "flex",
    gap: "15px",
    alignItems: "center",
  },
  colorPreview: {
    width: "40px",
    height: "40px",
    borderRadius: "50%",
    border: "3px solid #f0f0f0",
    marginBottom: "5px",
    boxShadow: "0 2px 5px rgba(0,0,0,0.1)",
    cursor: "pointer",
    position: "relative",
    overflow: "hidden"
  },
  colorInput: {
    position: "absolute",
    top: "-50%",
    left: "-50%",
    width: "200%",
    height: "200%",
    opacity: 0,
    cursor: "pointer"
  },
  inputContainer: {
    flex: 1,
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: "15px"
  },
  label: {
    display: "block",
    fontSize: "0.85em",
    color: "var(--admin-text-sub)",
    marginBottom: "5px",
    fontWeight: "bold"
  },
  deleteBtn: {
    background: "#fff",
    border: "1px solid #e74c3c",
    color: "#e74c3c",
    borderRadius: "8px",
    width: "40px",
    height: "40px",
    cursor: "pointer",
    fontSize: "1.2em",
    display: "flex",
    alignItems: "center",
    justifyContent: "center"
  },
  addBtn: {
    flex: 1,
    padding: "15px",
    background: "#95a5a6",
    color: "white",
    border: "none",
    borderRadius: "12px",
    fontWeight: "bold",
    fontSize: "1.1em",
    cursor: "pointer",
    boxShadow: "0 4px 10px rgba(0,0,0,0.1)"
  },
  saveBtn: {
    flex: 2,
    padding: "15px",
    background: "#3498db",
    color: "white",
    border: "none",
    borderRadius: "12px",
    fontWeight: "bold",
    fontSize: "1.1em",
    cursor: "pointer",
    boxShadow: "0 4px 12px rgba(52, 152, 219, 0.4)"
  }
};

export default ConfigTab;