// src/kiosk/ReturnModal.js
import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabaseClient';
import { kioskReturn } from '../api';
import { useToast } from '../contexts/ToastContext';
import ConfirmModal from '../components/ConfirmModal'; // [NEW] 커스텀 확인 모달
import './Kiosk.css';

function ReturnModal({ onClose }) {
    const { showToast } = useToast();
    const [userRentals, setUserRentals] = useState([]); // { user: {...}, rentals: [...] }
    const [loading, setLoading] = useState(true);
    const [processing, setProcessing] = useState(false);
    const [expandedUserId, setExpandedUserId] = useState(null); // Accordion state
    const [selectedRentals, setSelectedRentals] = useState(new Set()); // Set of rental_ids

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
        setConfirmModal({ isOpen: false, title: "", message: "", onConfirm: null, type: "info" });
    };

    // Load active rentals grouped by user
    useEffect(() => {
        const loadRentals = async () => {
            const { data, error } = await supabase
                .from('rentals')
                .select(`
                    rental_id,
                    game_id,
                    borrowed_at,
                    profiles:user_id (id, name, student_id),
                    game:games (id, name, image)
                `)
                .eq('type', 'RENT')
                .is('returned_at', null);

            if (error) {
                console.error(error);
                showToast("대여 목록을 불러오지 못했습니다.", { type: "error" });
                setLoading(false);
                return;
            }

            // Group by user (비회원 현장대여는 profiles가 null → renter_name 기반 그룹핑)
            const valid = data.filter(r => r.game);
            const grouped = {};

            valid.forEach(rental => {
                const groupKey = rental.profiles?.id || ('anon:' + (rental.renter_name || 'unknown'));
                if (!grouped[groupKey]) {
                    grouped[groupKey] = {
                        user: rental.profiles || { id: groupKey, name: rental.renter_name || '비회원(수기)', student_id: null },
                        rentals: []
                    };
                }
                grouped[groupKey].rentals.push(rental);
            });

            setUserRentals(Object.values(grouped));
            setLoading(false);
        };
        loadRentals();
    }, [showToast]);

    const toggleUser = (userId) => {
        setExpandedUserId(expandedUserId === userId ? null : userId);
        setSelectedRentals(new Set()); // 유저 전환 시 선택 초기화
    };

    const toggleRental = (rentalId) => {
        const newSelected = new Set(selectedRentals);
        if (newSelected.has(rentalId)) {
            newSelected.delete(rentalId);
        } else {
            newSelected.add(rentalId);
        }
        setSelectedRentals(newSelected);
    };

    const handleBulkReturn = async () => {
        if (selectedRentals.size === 0) {
            showToast("반납할 게임을 선택해주세요.", { type: "warning" });
            return;
        }

        showConfirmModal(
            "반납 확인",
            `선택한 ${selectedRentals.size}개의 게임을 반납하시겠습니까?`,
            async () => {
                setProcessing(true);
                let successCount = 0;
                let failCount = 0;
                const failedItems = []; // 실패한 항목 추적

                // Process each selected rental
                for (const rentalId of selectedRentals) {
                    // Find the rental info
                    let targetRental = null;
                    for (const userGroup of userRentals) {
                        const found = userGroup.rentals.find(r => r.rental_id === rentalId);
                        if (found) {
                            targetRental = found;
                            break;
                        }
                    }

                    if (!targetRental) continue;

                    try {
                        const result = await kioskReturn(targetRental.game_id, targetRental.profiles?.id || null, rentalId);
                        if (result.success) {
                            successCount++;
                        } else {
                            failCount++;
                            failedItems.push({
                                name: targetRental.game.name,
                                reason: result.message
                            });
                        }
                    } catch (e) {
                        console.error(e);
                        failCount++;
                        failedItems.push({
                            name: targetRental.game.name,
                            reason: "네트워크 오류"
                        });
                    }
                }

                setProcessing(false);

                // 피드백 개선
                if (successCount > 0) {
                    showToast(`✅ ${successCount}개 반납 완료! 각 건당 100P 지급되었습니다.`, { type: "success" });

                    // Remove returned rentals from UI
                    const remainingUsers = userRentals
                        .map(ug => ({
                            ...ug,
                            rentals: ug.rentals.filter(r => !selectedRentals.has(r.rental_id))
                        }))
                        .filter(ug => ug.rentals.length > 0);

                    setUserRentals(remainingUsers);
                    setSelectedRentals(new Set());

                    if (remainingUsers.length === 0) {
                        onClose();
                    }
                }

                if (failCount > 0) {
                    const failedNames = failedItems.map(item => `${item.name} (${item.reason})`).join(', ');
                    showToast(`❌ ${failCount}개 반납 실패: ${failedNames}`, { type: "error", duration: 8000 });
                }
            },
            "info"
        );
    };

    return (
        <div className="kiosk-modal-overlay" style={{ zIndex: 20000 }} onClick={onClose}>
            <div className="kiosk-modal" style={{ width: "90%", height: "90%", display: "flex", flexDirection: "column" }} onClick={e => e.stopPropagation()}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "20px" }}>
                    <h2>📦 간편 반납</h2>
                    <button onClick={onClose} style={{ background: "none", border: "none", color: "white", fontSize: "1.5rem", cursor: "pointer" }}>✖</button>
                </div>

                <div style={{ color: "#aaa", marginBottom: "10px" }}>
                    이름을 클릭하면 대여 목록이 나타납니다. 반납할 게임을 체크하세요.
                </div>
                <div style={{ color: "#888", fontSize: "0.85rem", marginBottom: "15px", fontStyle: "italic" }}>
                    💡 언제든 닫기를 눌러 원래 작업으로 돌아갈 수 있어요!
                </div>

                <div className="no-scrollbar" style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: "10px", minHeight: 0, WebkitOverflowScrolling: "touch", touchAction: "pan-y", overscrollBehavior: "contain" }}>
                    {loading ? (
                        <div className="skeleton-container">
                            {[1, 2, 3].map(i => (
                                <div key={i} className="skeleton-item" />
                            ))}
                        </div>
                    ) : userRentals.length === 0 ? (
                        <div className="empty-state">
                            <div className="empty-state-icon">📦</div>
                            <div className="empty-state-title">현재 대여 중인 게임이 없습니다</div>
                            <div className="empty-state-subtitle">게임을 대여하고 반납해보세요!</div>
                        </div>
                    ) : (
                        userRentals.map(ug => (
                            <div key={ug.user.id} style={{ background: "#1a1a1a", borderRadius: "10px", position: "relative" }}>
                                {/* User Header (Clickable) */}
                                <button
                                    onClick={() => toggleUser(ug.user.id)}
                                    style={{
                                        width: "100%",
                                        padding: "20px",
                                        position: "sticky",
                                        top: 0,
                                        zIndex: 10,
                                        background: expandedUserId === ug.user.id ? "#2a2a2a" : "#1a1a1a",
                                        border: "none",
                                        borderRadius: expandedUserId === ug.user.id ? "10px 10px 0 0" : "10px",
                                        color: "white",
                                        fontSize: "1.2rem",
                                        fontWeight: "bold",
                                        cursor: "pointer",
                                        display: "flex",
                                        justifyContent: "space-between",
                                        alignItems: "center",
                                        transition: "background 0.2s, border-radius 0.2s"
                                    }}
                                >
                                    <div style={{ display: "flex", alignItems: "center", gap: "15px" }}>
                                        <span>👤 {ug.user.name}</span>
                                        <span style={{ fontSize: "0.9rem", color: "#888" }}>({ug.rentals.length}건 대여중)</span>
                                    </div>
                                    <span style={{ fontSize: "1.5rem" }}>{expandedUserId === ug.user.id ? "▼" : "▶"}</span>
                                </button>

                                {/* Rental List (Expandable) */}
                                {expandedUserId === ug.user.id && (
                                    <div className="no-scrollbar" style={{ padding: "10px 20px 20px 20px", display: "flex", flexDirection: "column", gap: "10px", paddingBottom: "10px" }}>
                                        {ug.rentals.map(rental => (
                                            <label
                                                key={rental.rental_id}
                                                style={{
                                                    display: "flex",
                                                    alignItems: "center",
                                                    gap: "15px",
                                                    padding: "15px",
                                                    background: selectedRentals.has(rental.rental_id) ? "#2d5016" : "#222",
                                                    borderRadius: "8px",
                                                    cursor: "pointer",
                                                    transition: "background 0.2s",
                                                    border: selectedRentals.has(rental.rental_id) ? "2px solid #58cc02" : "1px solid #333"
                                                }}
                                            >
                                                <input
                                                    type="checkbox"
                                                    checked={selectedRentals.has(rental.rental_id)}
                                                    onChange={() => toggleRental(rental.rental_id)}
                                                    style={{ width: "20px", height: "20px", cursor: "pointer" }}
                                                />
                                                <div style={{ flex: 1 }}>
                                                    <div style={{ fontSize: "1.1rem", fontWeight: "bold" }}>
                                                        {rental.game.name}
                                                    </div>
                                                    <div style={{ fontSize: "0.8rem", color: "#888", marginTop: "5px" }}>
                                                        {new Date(rental.borrowed_at).toLocaleDateString()} 대여
                                                    </div>
                                                </div>
                                            </label>
                                        ))}
                                    </div>
                                )}
                            </div>
                        ))
                    )}
                </div>

                <div style={{ marginTop: "20px", display: "flex", gap: "10px" }}>
                    <button
                        className="kiosk-btn"
                        style={{ background: "#333", fontSize: "1rem", padding: "15px", flex: 1 }}
                        onClick={onClose}
                    >
                        닫기
                    </button>
                    <button
                        className="kiosk-btn"
                        style={{ background: selectedRentals.size > 0 ? "#58cc02" : "#444", fontSize: "1rem", padding: "15px", flex: 2 }}
                        onClick={handleBulkReturn}
                        disabled={processing || selectedRentals.size === 0}
                    >
                        {processing ? "처리 중..." : `선택한 ${selectedRentals.size}개 반납하기`}
                    </button>
                </div>
            </div>
            {/* [NEW] Confirm 모달 렌더링 */}
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

export default ReturnModal;
