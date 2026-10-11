// src/kiosk/RouletteModal.js
import React, { useState, useMemo, useRef, useEffect } from 'react';
import useKioskData from '../hooks/useKioskData'; // useKioskData 훅 사용
import { PLAYER_OPTIONS, SPLIT_MODE, countDistinctGames, eligibleGames, formatPlayers, hasNumplayersData, spinRoulette } from '../lib/roulette';
import './Kiosk.css';

// games.category 값 그대로 (DB: '머더미스터리')
const MURDER_MYSTERY_CATEGORY = '머더미스터리';

const chipStyle = (active, locked = false) => ({
    padding: "10px 20px",
    opacity: locked && !active ? 0.5 : 1,
    background: active ? "#667eea" : "#444",
    border: "none",
    borderRadius: "10px",
    color: "white",
    fontSize: "1rem",
    cursor: "pointer",
    transition: "all 0.2s"
});

const boxStyle = {
    height: "150px",
    background: "#333",
    borderRadius: "20px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "2rem",
    fontWeight: "bold",
    padding: "20px",
    border: "5px solid gold",
    wordBreak: "keep-all", // 한글 단어가 끊기지 않도록
    overflowWrap: "anywhere", // 그래도 칸보다 긴 이름은 넘치지 않게
    lineHeight: "1.3"
};

// 당첨 카드 아래 정보: 카테고리 / 인원 범위 / 베스트 인원 / 시간
function ResultInfo({ game }) {
    const best = formatPlayers(game.best_players);
    return (
        <p style={{ wordBreak: "keep-all", margin: "8px 0 0" }}>
            {game.category} / {game.min_players}~{game.max_players}인
            {best && <strong style={{ color: "gold" }}>{` / 베스트 ${best}`}</strong>}
            {game.playingtime && ` / ⏱️ ${game.playingtime}`}
        </p>
    );
}

function RouletteModal({ onClose }) {
    // 룰렛은 게임 목록만 쓴다. 회원 목록까지 받으면 전 회원 이름·학번이
    // 태블릿 localStorage 에 다시 쌓인다 (api.jsx 의 개인정보 최소화 주석 참고).
    const { games, loading } = useKioskData({ includeUsers: false });
    // null(전체) | 2~8 | SPLIT_MODE(8명을 4명씩 두 판)
    const [mode, setMode] = useState(null);
    const [includeMurderMystery, setIncludeMurderMystery] = useState(true); // 머더미스터리 포함 여부
    const [spinning, setSpinning] = useState(false);
    const [results, setResults] = useState(null);
    const [displayGames, setDisplayGames] = useState([]); // 돌아가는 동안 보이는 이름
    // 이 모달에서 이미 나온 게임 — 다시 돌려도 같은 게임이 바로 또 나오지 않게 (조건을 바꾸면 처음부터)
    const historyRef = useRef([]);
    useEffect(() => { historyRef.current = []; }, [mode, includeMurderMystery]);

    // 대여 가능 + 머더미스터리 포함 여부
    const baseGames = useMemo(() => games.filter(game => {
        if (game.status !== '대여가능') return false;
        if (!includeMurderMystery && game.category === MURDER_MYSTERY_CATEGORY) return false;
        return true;
    }), [games, includeMurderMystery]);

    // BGG 추천 인원 컬럼이 아직 없으면(DB 적용 전·옛 캐시) 예전처럼 인원 범위 안 균등 추첨
    const useNumplayers = hasNumplayersData(games);
    const candidates = useMemo(
        () => eligibleGames(baseGames, mode, { useNumplayers }),
        [baseGames, mode, useNumplayers]
    );
    const slots = mode === SPLIT_MODE ? 2 : 1;
    // 4/4 는 서로 다른 게임이 둘 있어야 한다 (같은 게임이 두 행이면 하나로 센다)
    const canSpin = mode === SPLIT_MODE ? countDistinctGames(candidates) >= 2 : candidates.length > 0;

    // 스핀 중에 모달을 닫으면 인터벌이 그대로 남아 언마운트된 컴포넌트를 계속 갱신했다.
    const spinIntervalRef = useRef(null);
    useEffect(() => () => {
        if (spinIntervalRef.current) clearInterval(spinIntervalRef.current);
    }, []);

    const spin = () => {
        if (!canSpin) return;
        const { picks, history } = spinRoulette(baseGames, mode, historyRef.current, { useNumplayers });
        if (picks.length === 0) return;
        historyRef.current = history;
        if (spinIntervalRef.current) clearInterval(spinIntervalRef.current);
        setSpinning(true);
        setResults(null);

        let count = 0;
        const maxCount = 20;
        const randomName = () => candidates[Math.floor(Math.random() * candidates.length)];
        spinIntervalRef.current = setInterval(() => {
            count++;
            if (count > maxCount) {
                clearInterval(spinIntervalRef.current);
                spinIntervalRef.current = null;
                setDisplayGames(picks);
                setResults(picks);
                setSpinning(false);
                return;
            }
            setDisplayGames(Array.from({ length: picks.length }, randomName));
        }, 100);
    };

    // 돌아가는 중에는 조건을 바꾸지 않는다 (결과는 시작할 때 정해지고, 조건을 바꾸면 중복 방지 기록이 비워진다)
    const selectMode = (next) => {
        if (spinning) return;
        setMode(next);
        setResults(null);
        setDisplayGames([]);
    };
    const selectMurder = (next) => {
        if (spinning) return;
        setIncludeMurderMystery(next);
        setResults(null);
        setDisplayGames([]);
    };

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
                                <button onClick={() => selectMode(null)} disabled={spinning} style={chipStyle(mode === null, spinning)}>
                                    전체
                                </button>
                                {PLAYER_OPTIONS.map(num => (
                                    <button key={num} onClick={() => selectMode(num)} disabled={spinning} style={chipStyle(mode === num, spinning)}>
                                        {num}인
                                    </button>
                                ))}
                                <button onClick={() => selectMode(SPLIT_MODE)} disabled={spinning} style={chipStyle(mode === SPLIT_MODE, spinning)}>
                                    4/4 (8명)
                                </button>
                            </div>
                            {mode === SPLIT_MODE && (
                                <p style={{ fontSize: "0.9rem", color: "#aaa", margin: "10px 0 0" }}>
                                    4명씩 두 판 — 서로 다른 4인 게임 두 개
                                </p>
                            )}
                        </div>

                        {/* 머더미스터리 포함 여부 */}
                        <div style={{ marginBottom: "20px" }}>
                            <p style={{ fontSize: "1.1rem", marginBottom: "10px", color: "#ccc" }}>🔍 머더미스터리</p>
                            <div style={{ display: "flex", gap: "10px", justifyContent: "center" }}>
                                <button onClick={() => selectMurder(true)} disabled={spinning} style={chipStyle(includeMurderMystery, spinning)}>
                                    포함
                                </button>
                                <button onClick={() => selectMurder(false)} disabled={spinning} style={chipStyle(!includeMurderMystery, spinning)}>
                                    미포함
                                </button>
                            </div>
                        </div>

                        {/* 게임 표시 박스 — 4/4 는 두 판을 나란히 */}
                        <div style={{ display: "flex", gap: "20px", justifyContent: "center", margin: "0 auto 20px auto", width: "100%" }}>
                            {Array.from({ length: slots }, (_, i) => (
                                <div key={i} style={{ flex: "1 1 0", minWidth: 0, maxWidth: "400px", display: "flex", flexDirection: "column" }}>
                                    {slots > 1 && <div style={{ color: "#ccc", marginBottom: "6px" }}>{i + 1}판</div>}
                                    <div style={boxStyle}>
                                        {displayGames[i] ? displayGames[i].name : "?"}
                                    </div>
                                    {results?.[i] && !spinning && (
                                        <div style={{ animation: "popIn 0.5s" }}>
                                            <ResultInfo game={results[i]} />
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>

                        {/* 후보 게임 수 표시 */}
                        <p style={{ fontSize: "0.9rem", color: "#888", marginBottom: "15px" }}>
                            {candidates.length}개의 게임
                        </p>

                        {!spinning && !results && (
                            <button
                                className="kiosk-btn btn-roulette"
                                onClick={spin}
                                style={{ width: "100%", height: "60px" }}
                                disabled={!canSpin}
                            >
                                {canSpin ? "추천받기 START" : "조건에 맞는 게임이 없습니다"}
                            </button>
                        )}

                        {results && !spinning && (
                            <div style={{ animation: "popIn 0.5s" }}>
                                <h3 style={{ color: "gold" }}>🎉 당첨!</h3>
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
