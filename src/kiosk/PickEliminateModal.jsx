// 소거법으로 할 보드게임 정하기 (2026-10-11, 구 골라 지우기)
// 인원을 고르면 그 인원의 베스트·추천 게임 8장을 한 화면에 깔고, ✕로 한 장씩 지워 1장(4/4 는 2장)이 남으면 결정.
// 공용 기기라 진행 상태는 저장하지 않는다 — 화면보호기에 들어가면 KioskPage 가 이 화면을 닫는다.
import React, { useMemo, useState } from 'react';
import useKioskData from '../hooks/useKioskData';
import { PICK_COUNT, PICK_PLAYER_OPTIONS, SPLIT_MODE, drawCards, formatPlayers, hasNumplayersData } from '../lib/roulette';
import './Kiosk.css';
import './PickEliminate.css';

const modeLabel = (mode) => (mode === SPLIT_MODE ? '8명 · 4/4로 나누기' : `${mode}명`);

// 판을 깐 뒤 다른 기기에서 빌려 가면 카드는 그대로 두고 표시만 한다 (판이 갑자기 바뀌지 않게)
const GoneBadge = () => <div className="pe-gone">방금 대여됨</div>;

const Difficulty = ({ value }) => {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? <span>난이도 {n.toFixed(1)}</span> : null;
};

// index: 깔릴 때 한 장씩 차례로 나타나는 지연(--i)
function GameCard({ game, onRemove, removed, gone, index = 0 }) {
    const style = { '--i': index };
    if (removed) return <div className="pe-card pe-card-removed" style={style} aria-hidden="true" />;
    const best = formatPlayers(game.best_players);
    return (
        <div className={`pe-card${gone ? ' pe-card-gone' : ''}`} style={style}>
            {gone && <GoneBadge />}
            <button type="button" className="pe-remove" onClick={onRemove} aria-label={`${game.name} 지우기`}>✕</button>
            <div className="pe-card-img">
                {game.image ? <img src={game.image} alt="" draggable={false} /> : <span className="pe-card-noimg">{game.name.slice(0, 1)}</span>}
            </div>
            <div className="pe-card-body">
                <div className="pe-card-name">{game.name}</div>
                <div className="pe-card-meta">
                    {best ? <span className="pe-best">베스트 {best}</span> : <span>{game.min_players}~{game.max_players}인</span>}
                    {game.playingtime && <span>{game.playingtime}</span>}
                    <Difficulty value={game.difficulty} />
                </div>
            </div>
        </div>
    );
}

function ResultCard({ game, label, gone }) {
    const best = formatPlayers(game.best_players);
    return (
        <div className="pe-result-card">
            {label && <div className="pe-result-label">{label}</div>}
            {gone && <GoneBadge />}
            {game.image && <img src={game.image} alt="" draggable={false} />}
            <div className="pe-result-name">{game.name}</div>
            <div className="pe-card-meta">
                {best && <span className="pe-best">베스트 {best}</span>}
                {game.playingtime && <span>{game.playingtime}</span>}
                <Difficulty value={game.difficulty} />
            </div>
        </div>
    );
}

function PickEliminateModal({ onClose }) {
    const { games, loading } = useKioskData({ includeUsers: false });
    const [mode, setMode] = useState(null); // null = 인원 고르는 중
    const [cards, setCards] = useState([]);
    const [removed, setRemoved] = useState([]); // 지운 순서 (되돌리기용)

    const available = useMemo(() => games.filter((g) => g.status === '대여가능'), [games]);
    const isGone = (card) => !available.some((g) => String(g.id) === String(card.id));
    const useNumplayers = hasNumplayersData(games);
    const target = mode === SPLIT_MODE ? 2 : 1;

    const deal = (nextMode, avoid = []) => {
        setCards(drawCards(available, nextMode, { count: PICK_COUNT, avoid, useNumplayers }));
        setRemoved([]);
    };
    const start = (nextMode) => {
        setMode(nextMode);
        deal(nextMode);
    };

    const remaining = cards.filter((c) => !removed.includes(c.id));
    const decided = cards.length > target && remaining.length <= target;
    const tooFew = cards.length > 0 && cards.length <= target;

    const remove = (id) => {
        if (decided || removed.includes(id)) return;
        setRemoved((prev) => [...prev, id]);
    };
    const undo = () => setRemoved((prev) => prev.slice(0, -1));
    const reset = () => setRemoved([]);
    const redraw = () => deal(mode, cards);

    return (
        <div className="kiosk-modal-overlay pe-overlay">
            {/* 바깥을 눌러도 닫지 않는다 — 실수로 진행 중인 판을 잃지 않게. 닫기는 ✕ 로만 */}
            <div className="pe-panel">
                <div className="pe-header">
                    <h2>소거법으로 할 보드게임 정하기{mode != null && <span className="pe-header-mode"> · {modeLabel(mode)}</span>}</h2>
                    <button type="button" className="pe-close" onClick={onClose} aria-label="닫기">✕</button>
                </div>

                {loading ? (
                    <p className="pe-note">게임 목록 불러오는 중</p>
                ) : mode == null ? (
                    <div className="pe-choose">
                        <p className="pe-choose-title">몇 명이서 할 게임?</p>
                        <div className="pe-choose-grid">
                            {PICK_PLAYER_OPTIONS.map((n) => (
                                <button key={n} type="button" className="pe-choose-btn" onClick={() => start(n)}>{n}명</button>
                            ))}
                            <button type="button" className="pe-choose-btn pe-choose-split" onClick={() => start(SPLIT_MODE)}>
                                8명
                                <span>4/4로 나누기</span>
                            </button>
                        </div>
                        <p className="pe-note">그 인원에 잘 맞는 게임 {PICK_COUNT}개 중 하나씩 지워 마지막 하나로 결정</p>
                    </div>
                ) : cards.length === 0 ? (
                    <div className="pe-choose">
                        <p className="pe-note">{modeLabel(mode)}에 맞는 대여 가능 게임 없음</p>
                        <button type="button" className="pe-action" onClick={() => setMode(null)}>인원 다시 고르기</button>
                    </div>
                ) : decided || tooFew ? (
                    <div className="pe-result">
                        {tooFew && <p className="pe-note">{modeLabel(mode)}에 맞는 게임이 {cards.length}개뿐</p>}
                        <div className="pe-result-row">
                            {mode === SPLIT_MODE && remaining.length === 2 ? (
                                <>
                                    <ResultCard game={remaining[0]} label="테이블 A" gone={isGone(remaining[0])} />
                                    <ResultCard game={remaining[1]} label="테이블 B" gone={isGone(remaining[1])} />
                                </>
                            ) : remaining.map((g) => <ResultCard key={g.id} game={g} label="결정" gone={isGone(g)} />)}
                        </div>
                        <div className="pe-actions">
                            {!tooFew && <button type="button" className="pe-action" onClick={undo}>되돌리기 (한 장)</button>}
                            {!tooFew && <button type="button" className="pe-action" onClick={reset}>↻ 처음 {cards.length}개로</button>}
                            <button type="button" className="pe-action" onClick={() => setMode(null)}>인원 다시 고르기</button>
                            <button type="button" className="pe-action pe-action-main" onClick={onClose}>이걸로 결정</button>
                        </div>
                    </div>
                ) : (
                    <>
                        <p className="pe-note">
                            {mode === SPLIT_MODE ? '2개' : '1개'} 남을 때까지 ✕로 지우기 · 남은 {remaining.length}개
                            {cards.length < PICK_COUNT && ` · 맞는 게임이 ${cards.length}개뿐`}
                        </p>
                        <div className="pe-grid">
                            {cards.map((g, i) => (
                                <GameCard key={g.id} index={i} game={g} removed={removed.includes(g.id)} gone={isGone(g)} onRemove={() => remove(g.id)} />
                            ))}
                        </div>
                        <div className="pe-actions">
                            <button type="button" className="pe-action" onClick={undo} disabled={removed.length === 0}>되돌리기 (한 장)</button>
                            <button type="button" className="pe-action" onClick={reset} disabled={removed.length === 0}>↻ 처음 {cards.length}개로</button>
                            <button type="button" className="pe-action" onClick={redraw}>다른 8개 뽑기</button>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}

export default PickEliminateModal;
