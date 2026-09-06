// src/kiosk/RouletteModal.js
import React, { useState, useMemo, useRef, useEffect } from 'react';
import useKioskData from '../hooks/useKioskData'; // useKioskData 훅 사용
import './Kiosk.css';

// games.category 값 그대로 (DB: '머더미스터리')
const MURDER_MYSTERY_CATEGORY = '머더미스터리';

const chipStyle = (active) => ({
    padding: "10px 20px",
    background: active ? "#667eea" : "#444",
    border: "none",
    borderRadius: "10px",
    color: "white",
    fontSize: "1rem",
    cursor: "pointer",
    transition: "all 0.2s"
});

function RouletteModal({ onClose }) {
    // 룰렛은 게임 목록만 쓴다. 회원 목록까지 받으면 전 회원 이름·학번이
    // 태블릿 localStorage 에 다시 쌓인다 (api.jsx 의 개인정보 최소화 주석 참고).
    const { games, loading } = useKioskData({ includeUsers: false });
    const [playerCount, setPlayerCount] = useState(null); // 선택된 인원수
    const [includeMurderMystery, setIncludeMurderMystery] = useState(true); // 머더미스터리 포함 여부
    const [spinning, setSpinning] = useState(false);
    const [result, setResult] = useState(null);
    const [displayParams, setDisplayParams] = useState(null); // Animation display

    // 대여 가능 + 머더미스터리 포함 여부 + 인원수 필터링
    // (useMemo: 매 렌더마다 새 배열을 만들어 effect 를 다시 돌리던 구조를 정리)
    const filteredGames = useMemo(() => {
        return games.filter(game => {
            if (game.status !== '대여가능') return false;
            if (!includeMurderMystery && game.category === MURDER_MYSTERY_CATEGORY) return false;
            if (playerCount === null) return true;
            if (game.min_players == null || game.max_players == null) return false;
            return playerCount >= game.min_players && playerCount <= game.max_players;
        });
    }, [games, playerCount, includeMurderMystery]);

    // 스핀 중에 모달을 닫으면 인터벌이 그대로 남아 언마운트된 컴포넌트를 계속 갱신했다.
    const spinIntervalRef = useRef(null);
    useEffect(() => () => {
        if (spinIntervalRef.current) clearInterval(spinIntervalRef.current);
    }, []);

    const spin = () => {
        if (filteredGames.length === 0) return;
        if (spinIntervalRef.current) clearInterval(spinIntervalRef.current);
        setSpinning(true);
        setResult(null);

        let count = 0;
        const maxCount = 20;
        spinIntervalRef.current = setInterval(() => {
            const random = filteredGames[Math.floor(Math.random() * filteredGames.length)];
            setDisplayParams(random);
            count++;
            if (count > maxCount) {
                clearInterval(spinIntervalRef.current);
                spinIntervalRef.current = null;
                setResult(random);
                setSpinning(false);
            }
        }, 100);
    };

    const playerOptions = [2, 3, 4, 5, 6];

    return (
        <div className="kiosk-modal-overlay" onClick={onClose}>
            <div className="kiosk-modal" style={{ textAlign: "center" }} onClick={e => e.stopPropagation()}>
                <h2 style={{ marginBottom: "20px" }}>🎰 오늘은 뭐 하지?</h2>

                {/* 로딩 상태 표시 */}
                {loading ? (
                    <div style={{ padding: "40px", fontSize: "1.2rem", color: "#888" }}>
                        <div style={{ marginBottom: "20px" }}>⏳ 게임 목록을 불러오는 중...</div>
                    </div>
                ) : (
                    <>
                        {/* 인원수 선택 */}
                        <div style={{ marginBottom: "20px" }}>
                            <p style={{ fontSize: "1.1rem", marginBottom: "10px", color: "#ccc" }}>게임 인원수를 선택하세요</p>
                            <div style={{ display: "flex", gap: "10px", justifyContent: "center", flexWrap: "wrap" }}>
                                <button onClick={() => setPlayerCount(null)} style={chipStyle(playerCount === null)}>
                                    전체
                                </button>
                                {playerOptions.map(num => (
                                    <button key={num} onClick={() => setPlayerCount(num)} style={chipStyle(playerCount === num)}>
                                        {num}인
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* 머더미스터리 포함 여부 */}
                        <div style={{ marginBottom: "20px" }}>
                            <p style={{ fontSize: "1.1rem", marginBottom: "10px", color: "#ccc" }}>🔍 머더미스터리</p>
                            <div style={{ display: "flex", gap: "10px", justifyContent: "center" }}>
                                <button onClick={() => setIncludeMurderMystery(true)} style={chipStyle(includeMurderMystery)}>
                                    포함
                                </button>
                                <button onClick={() => setIncludeMurderMystery(false)} style={chipStyle(!includeMurderMystery)}>
                                    미포함
                                </button>
                            </div>
                        </div>

                        {/* 게임 표시 박스 - 가로로 확장 */}
                        <div style={{
                            width: "100%",
                            maxWidth: "400px",
                            height: "150px",
                            background: "#333",
                            margin: "0 auto 20px auto",
                            borderRadius: "20px",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontSize: "2rem",
                            fontWeight: "bold",
                            padding: "20px",
                            border: "5px solid gold",
                            wordBreak: "keep-all", // 한글 단어가 끊기지 않도록
                            lineHeight: "1.3"
                        }}>
                            {displayParams ? displayParams.name : "?"}
                        </div>

                        {/* 필터링된 게임 수 표시 */}
                        <p style={{ fontSize: "0.9rem", color: "#888", marginBottom: "15px" }}>
                            {filteredGames.length}개의 게임
                        </p>

                        {!spinning && !result && (
                            <button
                                className="kiosk-btn btn-roulette"
                                onClick={spin}
                                style={{ width: "100%", height: "60px" }}
                                disabled={filteredGames.length === 0}
                            >
                                {filteredGames.length === 0 ? "조건에 맞는 게임이 없습니다" : "추천받기 START"}
                            </button>
                        )}

                        {result && (
                            <div style={{ animation: "popIn 0.5s" }}>
                                <h3 style={{ color: "gold" }}>🎉 당첨!</h3>
                                <p style={{ wordBreak: "keep-all" }}>
                                    {result.category} / {result.min_players}~{result.max_players}인
                                    {result.playingtime && ` / ⏱️ ${result.playingtime}`}
                                </p>
                                <button className="kiosk-btn" style={{ background: "#444", marginTop: "20px", height: "60px", width: "100%" }} onClick={onClose}>
                                    좋아, 이걸로 할래!
                                </button>
                                <button className="kiosk-btn" style={{ background: "#667eea", marginTop: "10px", height: "60px", width: "100%" }} onClick={spin}>
                                    🔄 다시 돌리기
                                </button>
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    );
}

export default RouletteModal;
