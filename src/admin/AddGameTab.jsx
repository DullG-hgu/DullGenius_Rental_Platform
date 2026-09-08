// src/admin/AddGameTab.js
import { useState } from 'react';
import { addGame, checkGameExists, addGameCopy } from '../api';
import GameFormModal from './GameFormModal';
import ConfirmModal from '../components/ConfirmModal'; // [NEW]
import { useToast } from '../contexts/ToastContext';

function AddGameTab({ onGameAdded }) {
  const { showToast } = useToast();
  const [keyword, setKeyword] = useState("");

  // 모달 상태
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedGame, setSelectedGame] = useState(null);
  const [addingCopy, setAddingCopy] = useState(false);

  // 컨펌 모달 상태
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

  // 이름만으로 중복 판정하지 않고 BGG 정보를 선택할 수 있도록 모달을 연다.
  const handleRegister = () => {
    if (!keyword.trim()) return;
    setSelectedGame({ name: keyword.trim(), category: "보드게임", image: "" });
    setIsModalOpen(true);
  };


  // BGG 후보를 선택한 시점에만 재고 추가를 제안한다.
  const handleDuplicateGame = (exactMatch) => {
        const message = `같은 BGG ID(${exactMatch.bgg_id})의 '${exactMatch.name}' 게임이 이미 존재합니다.\n기존 게임에 재고를 1개 추가하시겠습니까?\n(현재 재고: ${exactMatch.quantity ?? '?'}개)`;

        showConfirmModal(
          "📢 중복 게임 발견",
          message,
          async () => {
            setAddingCopy(true);
            try {
              await addGameCopy(exactMatch.id);
              showToast("기존 게임에 재고가 추가되었습니다!", { type: "success" });
              setIsModalOpen(false);
              setKeyword("");
              if (onGameAdded) onGameAdded();
            } catch (e) {
              console.error("재고 추가 실패 (BGG 선택):", e);
              showToast("재고 추가 실패: " + e.message, { type: "error" });
            } finally {
              setAddingCopy(false);
            }
          },
          "warning"
        );
  };

  // 저장 시 재검사는 중복 신규 등록만 막고 재고는 변경하지 않는다.
  const handleSaveGame = async (formData) => {
    try {
      const matches = await checkGameExists(formData.bgg_id);
      if (matches.length > 0) {
        showToast('같은 BGG ID의 게임이 이미 등록되었습니다. BGG 항목을 다시 선택해 기존 게임을 확인해주세요.', { type: 'warning' });
        return;
      }

      // 2. 신규 생성 모달 승인 후 이미지 최적화 및 저장
      showConfirmModal(
        "게임 추가",
        `[${formData.name}] 추가하시겠습니까?`,
        async () => {
          try {
            let finalImage = formData.image;

            // 2-1. 이미지 최적화 및 업로드 (Supabase Storage)
            // 외부 이미지(네이버 등)인 경우에만 처리
            if (finalImage && finalImage.startsWith('http') && !finalImage.includes('supabase.co')) {
              try {
                // [IMPROVED] 단계별 진행률 표시
                showToast("📥 이미지를 최적화하고 있습니다...", { type: "info" });

                // weserv.nl을 통해 리사이징된 이미지(WebP, 600px) Fetch
                const cleanUrl = finalImage.replace(/^https?:\/\//, '');
                const proxyUrl = `https://images.weserv.nl/?url=${encodeURIComponent(cleanUrl)}&w=600&output=webp&il`;

                const response = await fetch(proxyUrl);

                if (!response.ok) {
                  throw new Error(`이미지 최적화 서버 응답 에러: ${response.status}`);
                }

                const blob = await response.blob();

                // [IMPROVED] 업로드 진행 표시
                showToast("☁️ 이미지를 업로드하고 있습니다...", { type: "info" });

                // Supabase Storage 업로드
                const { supabase } = await import('../lib/supabaseClient'); // Dynamic Import to avoid top-level cyclic dependency if any
                const fileName = `${Date.now()}_${Math.random().toString(36).substr(2, 9)}.webp`; // 임시 ID 사용 (실제 Game ID는 나중에 생성되므로)

                const { error: uploadError } = await supabase.storage
                  .from('game-images')
                  .upload(fileName, blob, { contentType: 'image/webp' });

                if (uploadError) {
                  console.error("[AddGameTab] 이미지 업로드 실패:", uploadError);
                  throw uploadError;
                }

                // Public URL 획득
                const { data: { publicUrl } } = supabase.storage
                  .from('game-images')
                  .getPublicUrl(fileName);


                // 이미지 URL 교체
                finalImage = publicUrl;

              } catch (imgError) {
                console.error("[AddGameTab] 이미지 최적화 실패:", imgError);
                showToast("⚠️ 이미지 최적화 실패 (원본 사용)", { type: "warning" });
                // 실패해도 원본 URL로 계속 진행
              }
            }

            // 2-2. 신규 게임 DB 저장
            // id는 DB에서 생성되므로 제거하고 보냄
            const { id, ...rest } = formData;
            await addGame({ ...rest, image: finalImage });
            showToast("추가되었습니다!", { type: "success" });
            setIsModalOpen(false);
            setKeyword("");
            if (onGameAdded) onGameAdded();
          } catch (e) {
            console.error("게임 추가 실패:", e);
            showToast("추가 실패: " + (e.message || e), { type: "error" });
          }
        }
      );
    } catch (e) {
      console.error("저장 준비 중 오류:", e);
      showToast("오류 발생: " + e.message, { type: "error" });
    }
  };

  return (
    <div>
      <div style={{ display: "flex", gap: "10px", marginBottom: "20px", flexWrap: "wrap" }}>
        <input
          value={keyword} onChange={(e) => setKeyword(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleRegister()}
          placeholder="등록할 게임 이름"
          className="admin-input"
          style={{ flex: 1, minWidth: "200px" }}
        />
        <button onClick={handleRegister} style={{ ...styles.searchBtn, background: "#2ecc71" }}>등록</button>
      </div>

      {!keyword && (
        <div style={{ marginBottom: "20px", padding: "15px", backgroundColor: "rgba(52, 152, 219, 0.1)", borderLeft: "4px solid #3498db", borderRadius: "5px", color: "var(--admin-text-main)", fontSize: "0.95em", lineHeight: "1.6" }}>
          💡 <strong>빠르고 간편한 게임 추가 & 재고 관리 팁</strong><br />
          게임 이름을 입력하고 <strong>[등록]</strong> 버튼(또는 Enter)을 눌러주세요.<br />
          BGG 항목을 선택하면 <strong>같은 ID의 기존 게임에 재고를 +1 추가</strong>할 수 있습니다. BGG ID가 다르거나 없으면 새 게임으로 등록합니다.<br />
          등록 창 왼쪽에서 <strong>BGG 정보 검색</strong>, 오른쪽에서 <strong>한국판 이미지 검색</strong>을 사용할 수 있습니다.
        </div>
      )}

      {/* 공통 모달 사용 */}
      <GameFormModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        initialData={selectedGame}
        onSubmit={handleSaveGame}
        onDuplicateGame={handleDuplicateGame}
        busy={addingCopy || confirmModal.isOpen}
        title="📝 새 게임 추가"
      />

      {/* Confirm 모달 */}
      <ConfirmModal
        isOpen={confirmModal.isOpen}
        onClose={closeConfirmModal}
        onConfirm={() => confirmModal.onConfirm?.()}
        title={confirmModal.title}
        message={confirmModal.message}
        type={confirmModal.type}
      />
    </div>
  );
}

const styles = {
  // input style removed in favor of className
  searchBtn: { padding: "10px 20px", background: "#333", color: "white", border: "1px solid #555", borderRadius: "8px", cursor: "pointer" },
};

export default AddGameTab;
