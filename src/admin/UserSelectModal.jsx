import React from 'react';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock.jsx';

const UserSelectModal = ({ isOpen, onClose, candidates, onSelectUser, onSelectManual }) => {
    useBodyScrollLock(isOpen);
    if (!isOpen) return null;

    return (
        <div style={styles.modalOverlay} onClick={onClose}>
            <div
                className="admin-modal-scroll"
                style={styles.modalContent}
                onClick={(e) => e.stopPropagation()}
                role="dialog"
                aria-modal="true"
                aria-label="동명이인 선택"
            >
                <h3 style={{ marginTop: 0 }}>👥 동명이인 선택</h3>
                <p>검색된 사용자가 여러 명입니다. 대상 유저를 선택해주세요.</p>
                <div style={{ maxHeight: "300px", overflowY: "auto", border: "1px solid var(--admin-border)", borderRadius: "8px" }}>
                    {candidates.map(u => (
                        // button 요소: 터치 시 :active 피드백이 자연스럽고 키보드 접근도 된다.
                        // 예전 div + onMouseEnter 방식은 터치에서 hover 색이 고착됐다.
                        <button
                            key={u.id}
                            type="button"
                            onClick={() => onSelectUser(u)}
                            style={styles.userItem}
                            onPointerDown={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.12)"; }}
                            onPointerUp={(e) => { e.currentTarget.style.background = "var(--admin-bg)"; }}
                            onPointerLeave={(e) => { e.currentTarget.style.background = "var(--admin-bg)"; }}
                            onPointerCancel={(e) => { e.currentTarget.style.background = "var(--admin-bg)"; }}
                        >
                            <div style={{ textAlign: "left", minWidth: 0 }}>
                                <div style={{ fontWeight: "bold", fontSize: "1.1em" }}>{u.name}</div>
                                <div style={{ fontSize: "0.9em", color: "var(--admin-text-sub)" }}>학번: {u.student_id || "-"}</div>
                            </div>
                            <div style={{ fontSize: "0.9em", color: "var(--admin-text-sub)", textAlign: "right" }}>{u.phone || "전화번호 없음"}</div>
                        </button>
                    ))}
                </div>

                <div style={{ marginTop: "20px", display: "flex", justifyContent: "flex-end", gap: "10px", flexWrap: "wrap" }}>
                    <button onClick={onSelectManual} style={styles.actionBtn}>
                        ✓ 비회원(수기)으로 진행
                    </button>
                    <button onClick={onClose} style={styles.cancelBtn}>
                        ✕ 취소
                    </button>
                </div>
            </div>
        </div>
    );
};

const styles = {
    modalOverlay: {
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        width: "100%",
        height: "100%",
        background: "rgba(0,0,0,0.8)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 9999
    },
    modalContent: {
        background: "var(--admin-card-bg, #fff)",
        color: "var(--admin-text-main, #333)",
        padding: "20px",
        borderRadius: "15px",
        width: "95%",
        maxWidth: "500px",
        boxSizing: "border-box",
        boxShadow: "0 5px 20px rgba(0,0,0,0.5)"
        // maxHeight/overflow 는 .admin-modal-scroll 담당
    },
    userItem: {
        width: "100%",
        padding: "15px",
        border: "none",
        borderBottom: "1px solid var(--admin-border)",
        cursor: "pointer",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: "10px",
        flexWrap: "wrap",
        background: "var(--admin-bg)",
        color: "var(--admin-text-main)",
        font: "inherit",
        textAlign: "left"
    },
    actionBtn: { padding: "10px 15px", borderRadius: "8px", border: "1px solid rgba(255, 255, 255, 0.2)", background: "rgba(52, 152, 219, 0.95)", color: "white", fontWeight: "600", cursor: "pointer", boxShadow: "0 2px 8px rgba(0, 0, 0, 0.15)" },
    cancelBtn: { padding: "10px 15px", borderRadius: "8px", border: "1px solid rgba(255, 255, 255, 0.2)", background: "rgba(108, 117, 125, 0.9)", color: "white", fontWeight: "600", cursor: "pointer", boxShadow: "0 2px 8px rgba(0, 0, 0, 0.15)" }
};

export default UserSelectModal;
