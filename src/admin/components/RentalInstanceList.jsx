import React from 'react';

/**
 * RentalInstanceList Component
 * 
 * 특정 게임에 속한 개별 대여/찜 기록(인스턴스)들을 리스트 형태로 보여줍니다.
 * 각 항목은 개별 반납 또는 수령 버튼을 포함합니다.
 * 
 * @param {Object} props
 * @param {Object} props.game - 게임 객체 (rentals 배열 포함)
 * @param {Function} props.onReturn - 개별 반납 핸들러 (game, rentalId) => void
 * @param {Function} props.onReceive - 개별 수령 핸들러 (game, rentalId) => void
 * @param {Function} props.onExtend - 개별 연장 핸들러 (game, rentalId) => void
 * @param {Function} props.onCancelDibs - 개별 찜 취소 핸들러 (game, rentalId) => void
 * @param {Function} props.onMarkLost - 개별 분실 처리 핸들러 (game, rentalId) => void
 */
const RentalInstanceList = ({ game, onReturn, onReceive, onExtend, onCancelDibs, onMarkLost }) => {
    if (!game.rentals || game.rentals.length <= 1) return null;

    return (
        <div style={{
            marginTop: "10px",
            background: "rgba(0,0,0,0.2)",
            borderRadius: "8px",
            padding: "12px",
            border: "1px solid rgba(255,255,255,0.1)",
            display: "flex",
            flexDirection: "column",
            gap: "10px"
        }}>
            <div style={{ fontSize: "0.85em", color: "var(--admin-primary)", fontWeight: "bold", borderBottom: "1px solid rgba(255,255,255,0.1)", paddingBottom: "5px" }}>
                👥 다중 대여 현황 ({game.rentals.length}건)
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                {game.rentals.map(r => {
                    const name = r.renter_name || r.profiles?.name || "알 수 없음";
                    const isDibs = r.type === 'DIBS';
                    // HOLD = 외부 단체대여 예약. 여기서는 반납/연장 대상이 아니다
                    // (해당 건은 '단체대여 신청' 탭에서 승인/거절로 다룬다).
                    const isHold = r.type === 'HOLD';
                    const targetDate = new Date(r.due_date || r.borrowed_at);
                    const diffDays = ~~((targetDate - new Date()) / (1000 * 60 * 60 * 24));

                    return (
                        <div key={r.rental_id} style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            background: "rgba(255,255,255,0.05)",
                            padding: "8px 10px",
                            borderRadius: "6px",
                            border: "1px solid rgba(255,255,255,0.05)"
                        }}>
                            <div style={{ flex: 1 }}>
                                <div style={{ fontSize: "0.9em", fontWeight: "bold", display: "flex", alignItems: "center", gap: "5px" }}>
                                    <span style={{ color: isHold ? "#16a085" : isDibs ? "#f39c12" : "#3498db", fontSize: "0.8em" }}>
                                        {isHold ? "🏷️ 단체" : isDibs ? "⚡ 찜" : "📦 대여"}
                                    </span>
                                    {name}
                                </div>
                                <div style={{ fontSize: "0.7em", color: "var(--admin-text-sub)" }}>
                                    {diffDays >= 0 ? `${diffDays}일 남음` : `${Math.abs(diffDays)}일 연체`}
                                </div>
                            </div>

                            {isHold ? (
                                <div style={{ fontSize: "0.7em", color: "var(--admin-text-sub)" }}>
                                    단체대여 신청 탭에서 관리
                                </div>
                            ) : isDibs ? (
                                <div style={{ display: 'flex', gap: '5px' }}>
                                    <button
                                        onClick={() => onReceive(game, r.rental_id)}
                                        style={btnStyle("#f39c12")}
                                    >
                                        수령 확인
                                    </button>
                                    <button
                                        onClick={() => onCancelDibs(game, r.rental_id)}
                                        style={btnStyle("#c0392b")}
                                    >
                                        취소
                                    </button>
                                </div>
                            ) : (
                                <div style={{ display: 'flex', gap: '5px' }}>
                                    <button
                                        onClick={() => onExtend(game, r.rental_id)}
                                        style={btnStyle("#8e44ad")}
                                    >
                                        📅 연장
                                    </button>
                                    <button
                                        onClick={() => onReturn(game, r.rental_id)}
                                        style={btnStyle("#27ae60")}
                                    >
                                        반납 확인
                                    </button>
                                    <button
                                        onClick={() => onMarkLost(game, r.rental_id)}
                                        style={btnStyle("#7f8c8d")}
                                    >
                                        분실
                                    </button>
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

// 내부 버튼 스타일
const btnStyle = (bg) => ({
    padding: "2px 8px",
    background: bg,
    color: "white",
    border: "none",
    borderRadius: "4px",
    fontSize: "0.8rem",
    cursor: "pointer"
});

export default RentalInstanceList;
