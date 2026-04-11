
// src/kiosk/RentalModal.js
import React, { useState, useMemo } from 'react';
import { kioskRental } from '../api';
import { useToast } from '../contexts/ToastContext';
import useKioskData from '../hooks/useKioskData'; // Import Hook
import { filterUsers, filterGames } from '../lib/searchUtils'; // Import Search Utilities
import CharacterPicker from './CharacterPicker'; // Import Virtual Keyboard
import './Kiosk.css';

// [Cached Data]


function RentalModal({ onClose }) {
    const { showToast } = useToast();
    const [step, setStep] = useState(1); // 1:Game -> 2:User -> 3:Auth -> 4:Done

    // Data via Hook
    const { games, users, loading } = useKioskData();

    // Filter
    const [gameSearch, setGameSearch] = useState("");
    const [userSearch, setUserSearch] = useState("");
    const [authInput, setAuthInput] = useState(""); // Student ID Input

    // Selection
    const [selectedGame, setSelectedGame] = useState(null);
    const [selectedUser, setSelectedUser] = useState(null);

    // Filter Logic
    const filteredGames = useMemo(() => {
        return filterGames(games, gameSearch);
    }, [games, gameSearch]);

    const filteredUsers = useMemo(() => {
        return filterUsers(users, userSearch);
    }, [users, userSearch]);

    // Auth Logic
    const handleAuth = async () => {
        if (!selectedUser || !selectedGame) return;

        // [Security Check]
        // Compare Full Student ID (or trimmed version if data is messy)
        const inputId = authInput.trim();
        const targetId = selectedUser.student_id?.trim();

        if (inputId !== targetId) {
            showToast("학번이 일치하지 않습니다.", { type: "error" });
            setAuthInput("");
            return;
        }

        // Proceed to Rental
        try {
            const result = await kioskRental(selectedGame.id, selectedUser.id);
            if (result.success) {
                showToast(`대여 성공! (${selectedGame.name})`, { type: "success" });
                onClose();
            } else {
                // 구체적인 에러 메시지
                const errorMsg = result.message || "대여 처리 중 오류가 발생했습니다.";
                showToast(`대여 실패: ${errorMsg}`, { type: "error", duration: 5000 });
            }
        } catch (error) {
            console.error("대여 실패:", error);
            showToast("네트워크 오류가 발생했습니다. 다시 시도해주세요.", { type: "error" });
        }
    };

    // Render Steps
    const renderStep = () => {
        if (loading) return <div>로딩 중...</div>;

        switch (step) {
            case 1: // Game Search
                return (
                    <>
                        <input
                            type="text"
                            className="kiosk-search-input"
                            placeholder="🔍 게임 이름 검색..."
                            value={gameSearch}
                            readOnly
                        />
                        <CharacterPicker value={gameSearch} onChange={setGameSearch} />
                        <div className="grid-3-col">
                            {filteredGames.map(game => (
                                <button key={game.id} className="kiosk-list-btn" onClick={() => {
                                    setSelectedGame(game);
                                    setStep(2);
                                }}>
                                    {game.image ? <img src={game.image} className="list-img" alt="" /> : "🎲"}
                                    <div className="list-label">{game.name}</div>
                                </button>
                            ))}
                        </div>
                    </>
                );
            case 2: // User Search
                return (
                    <>
                        <div style={{ color: "#ccc", marginBottom: "10px" }}>대여자를 선택해주세요</div>
                        <input
                            type="text"
                            className="kiosk-search-input"
                            placeholder="🔍 이름 검색..."
                            value={userSearch}
                            readOnly
                        />
                        <CharacterPicker value={userSearch} onChange={setUserSearch} />
                        <div className="grid-3-col">
                            {filteredUsers.map(user => (
                                <button key={user.id} className="kiosk-list-btn" onClick={() => {
                                    setSelectedUser(user);
                                    setStep(3);
                                }}>
                                    <div className="list-label">{user.name}</div>
                                    <div style={{ fontSize: "0.8rem", color: "#888" }}>{user.student_id?.slice(0, 3)}****</div>
                                </button>
                            ))}
                        </div>
                        <button className="kiosk-btn-sub" style={{ marginTop: "20px" }} onClick={() => setStep(1)}>이전</button>
                    </>
                );
            case 3: // Auth
                return (
                    <div style={{ textAlign: "center", padding: "30px" }}>
                        <h2 style={{ marginBottom: "20px" }}>🔒 본인 인증</h2>
                        <p style={{ marginBottom: "30px", fontSize: "1.2rem", color: "#ccc" }}>
                            <b>{selectedUser.name}</b>님의 학번 전체를 입력해주세요.
                        </p>
                        <input
                            type="password"
                            className="kiosk-search-input"
                            style={{ textAlign: "center", letterSpacing: "5px", fontSize: "2rem" }}
                            placeholder="학번 입력"
                            value={authInput}
                            onChange={e => setAuthInput(e.target.value)}
                            autoFocus
                            onKeyPress={e => e.key === 'Enter' && handleAuth()}
                        />
                        <div style={{ marginTop: "30px", display: "flex", gap: "10px" }}>
                            <button className="kiosk-btn-sub" onClick={() => setStep(2)}>이전</button>
                            <button className="kiosk-btn" style={{ flex: 1 }} onClick={handleAuth}>
                                대여 확정
                            </button>
                        </div>
                    </div>
                );
            default: return null;
        }
    };

    return (
        <div className="kiosk-modal-overlay">
            <div className="kiosk-modal" style={{ height: "90%" }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "20px" }}>
                    <h2>🎲 무인 대여</h2>
                    <button onClick={onClose} style={{ background: "none", border: "none", color: "white", fontSize: "1.5rem" }}>✖</button>
                </div>
                {renderStep()}
            </div>
        </div>
    );
}

export default RentalModal;
