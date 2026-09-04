// src/kiosk/ReservationModal.js
import React, { useState, useEffect, useCallback } from 'react';
import { kioskListActiveReservations, kioskPickup, sendLog } from '../api';
import { useToast } from '../contexts/ToastContext';
import ConfirmModal from '../components/ConfirmModal';
import { subscribeToGameChanges } from '../lib/gamesRealtime';
import { buildReservationGroups, removeProcessed, pruneSelection } from './kioskListUtils';
import './Kiosk.css';

function ReservationModal({ onClose }) {
    const { showToast } = useToast();
    const [userReservations, setUserReservations] = useState([]); // { user: {...}, reservations: [...] }
    const [loading, setLoading] = useState(true);
    const [processing, setProcessing] = useState(false);
    const [expandedUserId, setExpandedUserId] = useState(null); // Accordion state
    const [selectedRentalIds, setSelectedRentalIds] = useState(new Set()); // Set of rental_ids

    // Confirm 모달 상태
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

    // Load active reservations (DIBS) grouped by user
    const loadReservations = useCallback(async () => {
        try {
            const data = await kioskListActiveReservations();

            // 서버 필터를 통과했더라도 목록을 열어둔 사이 만료될 수 있어 화면에서도 거른다
            const groups = buildReservationGroups(data);
            setUserReservations(groups);
            setSelectedRentalIds(prev => pruneSelection(groups, 'reservations', prev));
            setLoading(false);
        } catch (error) {
            console.error(error);
            showToast("예약 목록을 불러오지 못했습니다.", { type: "error" });
            setLoading(false);
        }
    }, [showToast]);

    useEffect(() => {
        loadReservations();
    }, [loadReservations]);

    // [REALTIME] 모달이 열려 있는 동안 다른 기기의 대여·찜·반납을 따라간다.
    // (게임 상태가 바뀌면 games 가 UPDATE 되므로 그것을 신호로 쓴다)
    useEffect(() => {
        const unsubscribe = subscribeToGameChanges({
            channelName: 'games-sync-kiosk-reservation',
            onChange: loadReservations,
            onReconnect: loadReservations
        });
        return unsubscribe;
    }, [loadReservations]);

    const toggleUser = (userId) => {
        setExpandedUserId(expandedUserId === userId ? null : userId);
        setSelectedRentalIds(new Set()); // 유저 전환 시 선택 초기화
    };

    const toggleReservation = (rentalId) => {
        const newSelected = new Set(selectedRentalIds);
        if (newSelected.has(rentalId)) {
            newSelected.delete(rentalId);
        } else {
            newSelected.add(rentalId);
        }
        setSelectedRentalIds(newSelected);
    };

    const handleBulkPickup = async () => {
        if (selectedRentalIds.size === 0) {
            showToast("수령할 게임을 선택해주세요.", { type: "warning" });
            return;
        }

        // [계측] 확인창을 연 시점과 실제 실행 시점을 각각 남긴다.
        // open 만 있고 accept 가 없으면 확인 버튼 클릭이 유실된 것이다.
        // (2026-09-04 수령이 서버에 도달조차 못한 건이 있었는데, 이 구간이 사각지대였다)
        sendLog(null, 'ACTION', { step: 'kiosk_pickup_confirm_open', count: selectedRentalIds.size });

        showConfirmModal(
            "예약 수령 확인",
            `선택한 ${selectedRentalIds.size}개의 게임을 수령하시겠습니까?\n\n[대여 안내]\n• 반납 기한: 내일 밤 12시까지\n• 분실/파손 시: 사이트에서 즉시 신고해주세요\n\n재밌게 즐기세요! 🎲`,
            async () => {
                sendLog(null, 'ACTION', { step: 'kiosk_pickup_confirm_accept', count: selectedRentalIds.size });
                setProcessing(true);
                let successCount = 0;
                let failCount = 0;
                const failedItems = [];
                const succeededIds = new Set(); // 성공한 것만 목록에서 지운다

                // Process each selected reservation
                for (const rentalId of selectedRentalIds) {
                    // Find info for toast
                    let targetName = "게임";
                    for (const group of userReservations) {
                        const found = group.reservations.find(r => r.rental_id === rentalId);
                        if (found) {
                            targetName = found.game.name;
                            break;
                        }
                    }

                    try {
                        const result = await kioskPickup(rentalId);
                        if (result.success) {
                            successCount++;
                            succeededIds.add(rentalId);
                        } else {
                            failCount++;
                            failedItems.push({ name: targetName, reason: result.message });
                        }
                    } catch (e) {
                        console.error(e);
                        failCount++;
                        failedItems.push({ name: targetName, reason: "네트워크 오류" });
                    }
                }

                setProcessing(false);

                if (successCount > 0) {
                    showToast(`✅ ${successCount}개 수령 완료! 즐거운 시간 되세요.`, { type: "success" });
                }

                if (succeededIds.size > 0) {
                    // 성공한 건만 지운다. 실패한 건은 남겨 다시 시도할 수 있게 한다.
                    const remainingUsers = removeProcessed(userReservations, 'reservations', succeededIds);
                    setUserReservations(remainingUsers);
                    setSelectedRentalIds(prev => pruneSelection(remainingUsers, 'reservations', prev));

                    if (remainingUsers.length === 0) {
                        onClose();
                    }
                }

                if (failCount > 0) {
                    const failedNames = failedItems.map(item => `${item.name} (${item.reason})`).join(', ');
                    showToast(`❌ ${failCount}개 수령 실패: ${failedNames}`, { type: "error", duration: 8000 });
                }
            },
            "info"
        );
    };

    return (
        <div
            className="kiosk-modal-overlay"
            style={{ zIndex: 20000 }}
            // 오버레이 자신을 눌렀을 때만 닫는다. 안쪽 확인 모달의 버튼 클릭이
            // 여기까지 올라와 목록이 통째로 사라지는 것을 막는다.
            onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
        >
            <div className="kiosk-modal" style={{ width: "90%", height: "90%", display: "flex", flexDirection: "column" }} onClick={e => e.stopPropagation()}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "20px" }}>
                    <h2>📥 예약 수령</h2>
                    <button onClick={onClose} style={{ background: "none", border: "none", color: "white", fontSize: "1.5rem", cursor: "pointer" }}>✖</button>
                </div>

                <div style={{ color: "#aaa", marginBottom: "10px" }}>
                    이름을 클릭하여 예약한 게임을 확인하고 수령하세요.
                </div>
                <div style={{ color: "#888", fontSize: "0.85rem", marginBottom: "15px", fontStyle: "italic" }}>
                    💡 예약 후 30분 이내에 수령해야 합니다. (시간 초과 시 자동 취소될 수 있음)
                </div>

                <div className="no-scrollbar" style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: "10px", minHeight: 0, WebkitOverflowScrolling: "touch", touchAction: "pan-y", overscrollBehavior: "contain" }}>
                    {loading ? (
                        <div className="skeleton-container">
                            {[1, 2, 3].map(i => (
                                <div key={i} className="skeleton-item" />
                            ))}
                        </div>
                    ) : userReservations.length === 0 ? (
                        <div className="empty-state">
                            <div className="empty-state-icon">📭</div>
                            <div className="empty-state-title">수령 대기 중인 예약이 없습니다</div>
                            <div className="empty-state-subtitle">웹에서 먼저 원하는 게임을 '찜' 해주세요!</div>
                        </div>
                    ) : (
                        userReservations.map(ug => (
                            <div key={ug.user.id} style={{ background: "#1a1a1a", borderRadius: "10px", position: "relative" }}>
                                {/* User Header */}
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
                                        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start" }}>
                                            <span style={{ fontSize: "0.9rem", color: "#888" }}>
                                                {ug.user.student_id ? `${ug.user.student_id.slice(0, 4)}****` : "비회원"}
                                            </span>
                                            <span style={{ fontSize: "0.8rem", color: "#666" }}>
                                                {ug.reservations.length}건 예약중
                                            </span>
                                        </div>
                                    </div>
                                    <span style={{ fontSize: "1.5rem" }}>{expandedUserId === ug.user.id ? "▼" : "▶"}</span>
                                </button>

                                {/* Reservation List */}
                                {expandedUserId === ug.user.id && (
                                    <div className="no-scrollbar" style={{ padding: "10px 20px 20px 20px", display: "flex", flexDirection: "column", gap: "10px", paddingBottom: "10px" }}>
                                        {ug.reservations.map(rental => (
                                            <label
                                                key={rental.rental_id}
                                                style={{
                                                    display: "flex",
                                                    alignItems: "center",
                                                    gap: "15px",
                                                    padding: "15px",
                                                    background: selectedRentalIds.has(rental.rental_id) ? "#2d2d40" : "#222",
                                                    borderRadius: "8px",
                                                    cursor: "pointer",
                                                    transition: "background 0.2s",
                                                    border: selectedRentalIds.has(rental.rental_id) ? "2px solid #5865F2" : "1px solid #333"
                                                }}
                                            >
                                                <input
                                                    type="checkbox"
                                                    checked={selectedRentalIds.has(rental.rental_id)}
                                                    onChange={() => toggleReservation(rental.rental_id)}
                                                    style={{ width: "20px", height: "20px", cursor: "pointer" }}
                                                />
                                                <div style={{ flex: 1 }}>
                                                    <div style={{ fontSize: "1.1rem", fontWeight: "bold" }}>
                                                        {rental.game.name}
                                                    </div>
                                                    <div style={{ fontSize: "0.8rem", color: "#888", marginTop: "5px" }}>
                                                        예약 시간: {new Date(rental.borrowed_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
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
                        style={{ background: selectedRentalIds.size > 0 ? "#5865F2" : "#444", fontSize: "1rem", padding: "15px", flex: 2 }}
                        onClick={handleBulkPickup}
                        disabled={processing || selectedRentalIds.size === 0}
                    >
                        {processing ? "처리 중..." : `선택한 ${selectedRentalIds.size}개 수령하기`}
                    </button>
                </div>
            </div>

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

export default ReservationModal;
