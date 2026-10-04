// src/kiosk/ReturnModal.js
import React, { useState, useEffect, useCallback } from 'react';
import { kioskListActiveRentals, kioskReturn, sendLog } from '../api';
import { useToast } from '../contexts/ToastContext';
import ConfirmModal from '../components/ConfirmModal'; // [NEW] 커스텀 확인 모달
import { subscribeToGameChanges } from '../lib/gamesRealtime';
import { buildRentalGroups, removeProcessed, pruneSelection } from './kioskListUtils';
import KioskResultCard from './KioskResultCard';
import { withTimeout, KioskTimeoutError } from './kioskFeedback';
import './Kiosk.css';

function ReturnModal({ onClose }) {
    const { showToast } = useToast();
    const [userRentals, setUserRentals] = useState([]); // { user: {...}, rentals: [...] }
    const [loading, setLoading] = useState(true);
    const [processing, setProcessing] = useState(false);
    const [expandedUserId, setExpandedUserId] = useState(null); // Accordion state
    const [selectedRentals, setSelectedRentals] = useState(new Set()); // Set of rental_ids
    // 처리 중·결과 화면 (KioskResultCard). 토스트는 이 모달 뒤에 가려져 보이지 않았다.
    const [result, setResult] = useState(null);

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
    const loadRentals = useCallback(async () => {
        try {
            const data = await kioskListActiveRentals();

            // Group by user (비회원 현장대여는 profiles가 null → renter_name 기반 그룹핑)
            const groups = buildRentalGroups(data);
            setUserRentals(groups);
            setSelectedRentals(prev => pruneSelection(groups, 'rentals', prev));
            setLoading(false);
        } catch (error) {
            console.error(error);
            showToast("대여 목록을 불러오지 못했습니다.", { type: "error" });
            setLoading(false);
        }
    }, [showToast]);

    useEffect(() => {
        loadRentals();
    }, [loadRentals]);

    // [REALTIME] 모달이 열려 있는 동안 다른 기기의 대여·반납을 따라간다.
    useEffect(() => {
        const unsubscribe = subscribeToGameChanges({
            channelName: 'games-sync-kiosk-return',
            onChange: loadRentals,
            onReconnect: loadRentals
        });
        return unsubscribe;
    }, [loadRentals]);

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

    const dismissResult = () => {
        const shouldClose = result?.closeAfter;
        setResult(null);
        if (shouldClose) onClose();
    };

    const handleBulkReturn = async () => {
        if (selectedRentals.size === 0) {
            showToast("반납할 게임을 선택해주세요.", { type: "warning" });
            return;
        }

        // [계측] 확인창 열림 / 실제 실행을 각각 남긴다 (예약 수령과 동일한 사각지대).
        sendLog(null, 'ACTION', { step: 'kiosk_return_confirm_open', count: selectedRentals.size });

        showConfirmModal(
            "반납 확인",
            `선택한 ${selectedRentals.size}개의 게임을 반납하시겠습니까?`,
            async () => {
                sendLog(null, 'ACTION', { step: 'kiosk_return_confirm_accept', count: selectedRentals.size });
                setProcessing(true);
                // 확인창이 닫히는 즉시 처리 중 화면을 띄운다 (빈 순간이 없게)
                setResult({ phase: 'processing', label: '반납 처리 중', count: selectedRentals.size });
                let pointsAwarded = 0;
                let pointsKnown = true;
                const successes = [];
                const failures = [];
                const uncertain = []; // 응답이 늦어 결과를 모르는 건
                const succeededIds = new Set(); // 성공한 것만 목록에서 지운다

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
                    const targetName = targetRental.game.name;

                    try {
                        const res = await withTimeout(kioskReturn(targetRental.game_id, targetRental.profiles?.id || null, rentalId));
                        if (res.success) {
                            successes.push(targetName);
                            if (Number.isFinite(res.points_awarded)) {
                                pointsAwarded += res.points_awarded;
                            } else {
                                pointsKnown = false;
                            }
                            succeededIds.add(rentalId);
                        } else {
                            failures.push({ name: targetName, reason: res.message || "알 수 없는 오류" });
                        }
                    } catch (e) {
                        if (e instanceof KioskTimeoutError) {
                            uncertain.push(targetName);
                        } else {
                            console.error(e);
                            failures.push({ name: targetName, reason: "네트워크 오류" });
                        }
                    }
                }

                setProcessing(false);

                let remainingUsers = userRentals;
                if (succeededIds.size > 0) {
                    // 성공한 건만 지운다. 실패한 건은 남겨 다시 시도할 수 있게 한다.
                    remainingUsers = removeProcessed(userRentals, 'rentals', succeededIds);
                    setUserRentals(remainingUsers);
                    setSelectedRentals(prev => pruneSelection(remainingUsers, 'rentals', prev));
                }
                // 응답이 늦은 건은 실제로는 처리됐을 수 있다. 서버 기준으로 목록을 다시 읽는다.
                if (uncertain.length > 0) loadRentals();

                setResult({
                    phase: 'done',
                    verb: '반납',
                    successes,
                    failures,
                    uncertain,
                    detail: pointsKnown && pointsAwarded > 0 ? `🎁 ${pointsAwarded}P 지급` : null,
                    closeAfter: uncertain.length === 0 && remainingUsers.length === 0,
                });
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
            <KioskResultCard result={result} onDismiss={dismissResult} />

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
