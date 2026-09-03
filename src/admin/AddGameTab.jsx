// src/admin/AddGameTab.js
import { useRef, useState } from 'react';
import { addGame, checkGameExists, addGameCopy } from '../api';
import GameFormModal from './GameFormModal';
import ConfirmModal from '../components/ConfirmModal'; // [NEW]
import { useToast } from '../contexts/ToastContext';

function AddGameTab({ onGameAdded }) {
  const { showToast } = useToast();
  const [keyword, setKeyword] = useState("");
  const [loading, setLoading] = useState(false);

  // 모달 상태
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedGame, setSelectedGame] = useState(null);

  // 컨펌 모달 상태
  const [confirmModal, setConfirmModal] = useState({
    isOpen: false,
    title: "",
    message: "",
    onConfirm: null,
    type: "info"
  });
  const skipConfirmCancelRef = useRef(false);

  const showConfirmModal = (title, message, onConfirm, type = "info", onCancel = null) => {
    skipConfirmCancelRef.current = false;
    setConfirmModal({ isOpen: true, title, message, onConfirm, type, onCancel });
  };

  const closeConfirmModal = () => {
    setConfirmModal((prev) => ({ ...prev, isOpen: false }));
  };

  // [REFACTORED] 중복 검사 공통 로직
  const handleDuplicateFound = (matches) => {
    const exactMatch = matches[0];
    const currentCount = exactMatch.quantity || '?';
    const hasSimilar = matches.length > 1;
    const message = hasSimilar
      ? `'${exactMatch.name}' 게임이 이미 존재합니다. (유사 게임 ${matches.length}개 발견)\n새로 검색하는 대신 재고(Copy)를 추가하시겠습니까?\n(현재 재고: ${currentCount}개)`
      : `'${exactMatch.name}' 게임이 이미 존재합니다.\n새로 검색하는 대신 재고(Copy)를 추가하시겠습니까?\n(현재 재고: ${currentCount}개)`;

    return { exactMatch, message };
  };

  const handleRegister = async () => {
    if (!keyword) return;
    setLoading(true);
    try {
      // 1. 중복 검사 먼저 수행 (검색어 기준)
      const matches = await checkGameExists(keyword);

      if (matches && matches.length > 0) {
        setLoading(false); // 팝업 띄우기 전 로딩 해제

        // [REFACTORED] 공통 함수 사용
        const { exactMatch, message } = handleDuplicateFound(matches);

        showConfirmModal(
          "📢 중복 게임 발견",
          message,
          async () => {
            try {
              await addGameCopy(exactMatch.id);
              showToast("기존 게임에 재고가 추가되었습니다!", { type: "success" });
              setKeyword("");
              if (onGameAdded) onGameAdded();
            } catch (e) {
              console.error("재고 추가 실패 (Search):", e);
              showToast("재고 추가 실패: " + e.message, { type: "error" });
            }
          },
          "warning",
          () => openAddModal()
        );
        return;
      }

      // 중복이 없으면 입력한 이름으로 등록 모달을 연다.
      openAddModal();
    } catch (e) {
      console.error('[관리자 게임 추가][이름 검색 실패]', {
        keyword,
        error: e,
      });
      showToast("오류 발생", { type: "error" });
    } finally {
      setLoading(false);
    }
  };

  // 검색 결과 선택 시 모달 열기
  const openAddModal = () => {
    setSelectedGame({ name: keyword, category: "보드게임", image: "" });
    setIsModalOpen(true);
  };


  // 모달에서 '저장' 버튼 눌렀을 때 실행
  const handleSaveGame = async (formData) => {
    try {
      // 1. 중복 체크를 가장 먼저 수행
      const matches = await checkGameExists(formData.name);

      if (matches && matches.length > 0) {
        // [REFACTORED] 공통 함수 사용
        const { exactMatch, message } = handleDuplicateFound(matches);

        showConfirmModal(
          "📢 중복 게임 발견",
          message,
          async () => {
            try {
              await addGameCopy(exactMatch.id);
              showToast("기존 게임에 재고가 추가되었습니다!", { type: "success" });
              setIsModalOpen(false);
              setKeyword("");
              if (onGameAdded) onGameAdded();
            } catch (e) {
              console.error("재고 추가 실패 (Save):", e);
              showToast("재고 추가 실패: " + e.message, { type: "error" });
            }
          },
          "warning"
        );
        return; // 중복일 경우 처리 종료 (이미지 업로드 안함)
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

      {loading && <div style={{ textAlign: "center", padding: "20px", color: "var(--admin-text-sub)" }}>기존 게임을 확인하는 중... ⏳</div>}

      {!loading && !keyword && (
        <div style={{ marginBottom: "20px", padding: "15px", backgroundColor: "rgba(52, 152, 219, 0.1)", borderLeft: "4px solid #3498db", borderRadius: "5px", color: "var(--admin-text-main)", fontSize: "0.95em", lineHeight: "1.6" }}>
          💡 <strong>빠르고 간편한 게임 추가 & 재고 관리 팁</strong><br />
          게임 이름을 입력하고 <strong>[등록]</strong> 버튼(또는 Enter)을 눌러주세요.<br />
          동아리에 이미 등록된 게임이면 <strong>단 한 번의 클릭으로 재고를 +1 추가</strong>할 수 있습니다.<br />
          등록 창 왼쪽에서 <strong>BGG 정보 검색</strong>, 오른쪽에서 <strong>한국판 이미지 검색</strong>을 사용할 수 있습니다.
        </div>
      )}

      {/* 공통 모달 사용 */}
      <GameFormModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        initialData={selectedGame}
        onSubmit={handleSaveGame}
        title="📝 새 게임 추가"
      />

      {/* Confirm 모달 */}
      <ConfirmModal
        isOpen={confirmModal.isOpen}
        onClose={() => {
          if (!skipConfirmCancelRef.current && confirmModal.onCancel) {
            confirmModal.onCancel();
          }
          skipConfirmCancelRef.current = false;
          closeConfirmModal();
        }}
        onConfirm={() => {
          skipConfirmCancelRef.current = true;
          return confirmModal.onConfirm?.();
        }}
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
