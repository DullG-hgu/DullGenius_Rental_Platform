// src/kiosk/MatchModal.js
import React, { useState, useMemo } from 'react';
import { registerMatch } from '../api';
import { useToast } from '../contexts/ToastContext';
import useKioskData from '../hooks/useKioskData';
import { filterUsers, filterGames } from '../lib/searchUtils'; // Import Search Utilities
import CharacterPicker from './CharacterPicker'; // Import Virtual Keyboard
import './Kiosk.css';

function MatchModal({ onClose }) {
    const { showToast } = useToast();
    const [step, setStep] = useState(1); // 1:Game -> 2:Players -> 3:Winner -> 4:Done

    // Data List via Hook
    const { games, users, loading } = useKioskData();

    // Search/Filter
    const [gameSearchTerm, setGameSearchTerm] = useState('');
    const [userSearchTerm, setUserSearchTerm] = useState('');

    // Selections
    const [selectedGame, setSelectedGame] = useState(null);
    const [selectedPlayers, setSelectedPlayers] = useState([]);
    const [selectedWinnerIds, setSelectedWinnerIds] = useState(new Set()); // [MOD] 다중 승자 지원

    // Processing State
    const [processing, setProcessing] = useState(false);

    // [Optimization] Memoized Filters
    const filteredGames = useMemo(() => {
        return filterGames(games, gameSearchTerm);
    }, [games, gameSearchTerm]);

    const filteredUsers = useMemo(() => {
        return filterUsers(users, userSearchTerm);
    }, [users, userSearchTerm]);

    // Handlers
    const handleGameSelect = (game) => {
        setSelectedGame(game);
        setStep(2);
    };

    const togglePlayer = (user) => {
        if (selectedPlayers.find(u => u.id === user.id)) {
            setSelectedPlayers(selectedPlayers.filter(u => u.id !== user.id));
            // 참여자 선택 해제 시 승자 목록에서도 제거
            const newWinnerIds = new Set(selectedWinnerIds);
            newWinnerIds.delete(user.id);
            setSelectedWinnerIds(newWinnerIds);
        } else {
            setSelectedPlayers([...selectedPlayers, user]);
        }
    };

    const toggleWinner = (userId) => {
        const newWinners = new Set(selectedWinnerIds);
        if (newWinners.has(userId)) {
            newWinners.delete(userId);
        } else {
            newWinners.add(userId);
        }
        setSelectedWinnerIds(newWinners);
    };

    const clearWinners = () => {
        setSelectedWinnerIds(new Set());
    };

    const handleRegister = async () => {
        // 1. 기본 입력 검증
        if (!selectedGame) {
            showToast("게임을 선택해주세요.", { type: "error" });
            return;
        }

        if (selectedPlayers.length < 1) {
            showToast("최소 1명 이상의 플레이어가 필요합니다.", { type: "error" });
            return;
        }

        // 2. 중복 참여자 체크
        const playerIds = selectedPlayers.map(u => u.id);
        const uniqueIds = new Set(playerIds);
        if (uniqueIds.size !== playerIds.length) {
            showToast("중복된 참여자가 있습니다. 다시 확인해주세요.", { type: "error" });
            return;
        }

        // 3. 승자가 참여자 목록에 있는지 확인
        const winnerIds = Array.from(selectedWinnerIds);
        const invalidWinners = winnerIds.filter(id => !selectedPlayers.find(p => p.id === id));
        if (invalidWinners.length > 0) {
            showToast("승자는 참여자 중 한 명이어야 합니다.", { type: "error" });
            return;
        }

        setProcessing(true);
        try {
            const result = await registerMatch(selectedGame.id, playerIds, winnerIds);

            if (result.success) {
                const winnerCount = winnerIds.length;
                let msg = `✅ 매치 등록 완료! `;
                if (winnerCount === 0) msg += "무승부 (+50P)";
                else if (winnerCount === 1) {
                    const winnerName = selectedPlayers.find(p => p.id === winnerIds[0])?.name;
                    msg += `승자: ${winnerName} (+200P)`;
                } else {
                    msg += `${winnerCount}명 공동 승리! (+200P)`;
                }
                showToast(msg, { type: "success" });
                onClose();
            } else {
                showToast("실패: " + result.message, { type: "error" });
            }
        } catch (e) {
            console.error(e);
            showToast("매치 등록 중 오류가 발생했습니다. 다시 시도해주세요.", { type: "error" });
        } finally {
            setProcessing(false);
        }
    };

    // Render Steps
    const renderStepContent = () => {
        if (loading) return <div style={{ textAlign: "center", padding: "50px" }}>데이터 불러오는 중...</div>;

        switch (step) {
            case 1: // Game Selection
                return (
                    <>
                        <input
                            type="text"
                            className="kiosk-search-input"
                            placeholder="🔍 게임 이름 검색..."
                            value={gameSearchTerm}
                            readOnly
                        />
                        <CharacterPicker value={gameSearchTerm} onChange={setGameSearchTerm} />

                        <div className="grid-3-col" style={{ maxHeight: "55vh" }}>
                            {filteredGames.length === 0 ? (
                                <div style={{ gridColumn: "1 / -1", textAlign: "center", padding: "50px", color: "#888" }}>
                                    검색 결과가 없습니다.
                                </div>
                            ) : (
                                filteredGames.map(game => (
                                    <button key={game.id} className="kiosk-list-btn" onClick={() => handleGameSelect(game)}>
                                        {game.image ? <img src={game.image} className="list-img" alt="" /> : "🎲"}
                                        <div className="list-label">{game.name}</div>
                                    </button>
                                ))
                            )}
                        </div>
                    </>
                );
            case 2: // Player Selection
                return (
                    <>
                        <div style={{ marginBottom: "10px", color: "#ccc" }}>함께 한 멤버를 모두 골라주세요. ({selectedPlayers.length}명 선택됨)</div>

                        <input
                            type="text"
                            className="kiosk-search-input"
                            placeholder="🔍 이름 또는 학번 검색..."
                            value={userSearchTerm}
                            readOnly
                            style={{ padding: "12px 15px", fontSize: "1rem" }}
                        />
                        <CharacterPicker value={userSearchTerm} onChange={setUserSearchTerm} />

                        <div className="grid-3-col" style={{ maxHeight: "45vh" }}>
                            {filteredUsers.length === 0 ? (
                                <div style={{ gridColumn: "1 / -1", textAlign: "center", padding: "30px", color: "#888" }}>
                                    검색 결과가 없습니다.
                                </div>
                            ) : (
                                filteredUsers.map(user => {
                                    const isSelected = selectedPlayers.find(u => u.id === user.id);
                                    return (
                                        <button
                                            key={user.id}
                                            className={`kiosk-list-btn ${isSelected ? 'active' : ''}`}
                                            onClick={() => togglePlayer(user)}
                                            style={{ border: isSelected ? "2px solid #58cc02" : "1px solid #333" }}
                                        >
                                            <div className="list-label">{user.name}</div>
                                            <div style={{ fontSize: "0.8rem", color: "#888" }}>{user.student_id ? user.student_id.slice(-4) : ""}</div>
                                        </button>
                                    );
                                })
                            )}
                        </div>
                        <div className="step-controls">
                            <button className="kiosk-btn-sub" onClick={() => setStep(1)}>이전</button>
                            <button className="kiosk-btn"
                                style={{ flex: 1, fontSize: "1rem", borderRadius: "10px" }}
                                onClick={() => selectedPlayers.length > 0 && setStep(3)}
                                disabled={selectedPlayers.length === 0}
                            >
                                다음 ({selectedPlayers.length}명)
                            </button>
                        </div>
                    </>
                );
            case 3: // Winner Selection
                return (
                    <>
                        <div style={{ marginBottom: "10px", color: "#ccc" }}>이번 판의 승자는 누구인가요? (+200P, 여러 명 선택 가능)</div>
                        <div className="grid-3-col" style={{ maxHeight: "50vh", gridTemplateColumns: "1fr 1fr" }}>
                            <button
                                className={`kiosk-list-btn ${selectedWinnerIds.size === 0 ? 'active' : ''}`}
                                onClick={clearWinners}
                                style={{ border: selectedWinnerIds.size === 0 ? "2px solid #aaa" : "1px solid #333" }}
                            >
                                🤝 무승부 / 협력
                            </button>
                            {selectedPlayers.map(user => {
                                const isSelected = selectedWinnerIds.has(user.id);
                                return (
                                    <button
                                        key={user.id}
                                        className={`kiosk-list-btn ${isSelected ? 'active' : ''}`}
                                        onClick={() => toggleWinner(user.id)}
                                        style={{ border: isSelected ? "2px solid gold" : "1px solid #333" }}
                                    >
                                        <div className="list-label">{user.name}</div>
                                        {isSelected && "👑"}
                                    </button>
                                );
                            })}
                        </div>
                        <div className="step-controls">
                            <button className="kiosk-btn-sub" onClick={() => setStep(2)}>이전</button>
                            <button className="kiosk-btn"
                                style={{ flex: 1, fontSize: "1rem", borderRadius: "10px" }}
                                onClick={handleRegister}
                                disabled={processing}
                            >
                                {processing ? "등록 중..." : "매치 등록 완료 🏁"}
                            </button>
                        </div>
                    </>
                );
            default: return null;
        }
    };

    return (
        <div className="kiosk-modal-overlay">
            <div className="kiosk-modal" style={{ height: "90%" }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "20px" }}>
                    <h2 style={{ margin: 0 }}>
                        {step === 1 && "1. 게임 선택"}
                        {step === 2 && "2. 플레이어 선택"}
                        {step === 3 && "3. 승자 선택"}
                    </h2>
                    <button onClick={onClose} style={{ background: "none", border: "none", color: "white", fontSize: "1.5rem", cursor: "pointer" }}>✖</button>
                </div>
                {renderStepContent()}
            </div>
        </div>
    );
}

export default MatchModal;
