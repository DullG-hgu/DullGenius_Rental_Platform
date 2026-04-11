import React from 'react';

const UserSelectModal = ({ isOpen, onClose, candidates, onSelectUser, onSelectManual }) => {
    if (!isOpen) return null;

    return (
        <div style={styles.modalOverlay}>
            <div style={styles.modalContent}>
                <h3>👥 동명이인 선택</h3>
                <p>검색된 사용자가 여러 명입니다. 대상 유저를 선택해주세요.</p>
                <div style={{ maxHeight: "300px", overflowY: "auto", border: "1px solid #eee", borderRadius: "8px" }}>
                    {candidates.map(u => (
                        <div
                            key={u.id}
                            onClick={() => onSelectUser(u)}
                            style={styles.userItem}
                            onMouseEnter={(e) => e.currentTarget.style.background = "#f8f9fa"}
                            onMouseLeave={(e) => e.currentTarget.style.background = "#fff"}
                        >
                            <div>
                                <div style={{ fontWeight: "bold", fontSize: "1.1em" }}>{u.name}</div>
                                <div style={{ fontSize: "0.9em", color: "#666" }}>학번: {u.student_id || "-"}</div>
                            </div>
                            <div style={{ fontSize: "0.9em", color: "#888" }}>{u.phone || "전화번호 없음"}</div>
                        </div>
                    ))}
                </div>

                <div style={{ marginTop: "20px", display: "flex", justifyContent: "flex-end", gap: "10px" }}>
                    <button
                        onClick={onSelectManual}
                        style={styles.actionBtn}
                        onMouseEnter={(e) => {
                            e.target.style.transform = 'translateY(-1px)';
                            e.target.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.25)';
                        }}
                        onMouseLeave={(e) => {
                            e.target.style.transform = 'translateY(0)';
                            e.target.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.15)';
                        }}
                    >
                        ✓ 비회원(수기)으로 진행
                    </button>
                    <button
                        onClick={onClose}
                        style={styles.cancelBtn}
                        onMouseEnter={(e) => {
                            e.target.style.transform = 'translateY(-1px)';
                            e.target.style.backgroundColor = 'rgba(108, 117, 125, 1)';
                        }}
                        onMouseLeave={(e) => {
                            e.target.style.transform = 'translateY(0)';
                            e.target.style.backgroundColor = 'rgba(108, 117, 125, 0.9)';
                        }}
                    >
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
        top: 0, alert: 0,
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
        background: "var(--admin-card-bg, #fff)", // fallback check
        color: "var(--admin-text-main, #333)",
        padding: "25px",
        borderRadius: "15px",
        width: "90%",
        maxWidth: "500px",
        boxShadow: "0 5px 20px rgba(0,0,0,0.5)",
        maxHeight: "90vh",
        overflowY: "auto"
    },
    userItem: {
        padding: "15px",
        borderBottom: "1px solid #eee",
        cursor: "pointer",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        background: "#fff"
    },
    actionBtn: { padding: "10px 15px", borderRadius: "8px", border: "1px solid rgba(255, 255, 255, 0.2)", background: "rgba(52, 152, 219, 0.95)", color: "white", fontWeight: "600", cursor: "pointer", transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)", boxShadow: "0 2px 8px rgba(0, 0, 0, 0.15)" },
    cancelBtn: { padding: "10px 15px", borderRadius: "8px", border: "1px solid rgba(255, 255, 255, 0.2)", background: "rgba(108, 117, 125, 0.9)", color: "white", fontWeight: "600", cursor: "pointer", transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)", boxShadow: "0 2px 8px rgba(0, 0, 0, 0.15)" }
};

export default UserSelectModal;
