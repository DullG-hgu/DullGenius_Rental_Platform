// 놀이터 「게임소거선택론」(구 골라 지우기) (/play/pick, 2026-10-12)
// 인원을 고르면 지금 대여 가능한 게임 중 그 인원의 베스트·추천 게임 8장 → ✕로 하나씩 지워 1장(4/4 는 2장)으로 결정.
// 동방에서 폰 하나로 같이 고르는 용도. 로그인 불필요, 새 조회 없음(전역 게임 목록), 진행 상태는 저장하지 않는다.
// 추첨 규칙은 roulette.js 한 곳 (키오스크 게임 추천 룰렛도 같은 파일). 키오스크판은 2026-10-26 제거
import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useGameData } from '../../contexts/GameDataContext';
import usePickEliminate from '../../lib/usePickEliminate';
import { PICK_COUNT, PICK_PLAYER_OPTIONS, SPLIT_MODE, formatPlayers } from '../../lib/roulette';
import '../fun.css';
import './pick.css';

const modeLabel = (mode) => (mode === SPLIT_MODE ? '8명 · 4/4로 나누기' : `${mode}명`);

const Meta = ({ game }) => {
    const best = formatPlayers(game.best_players);
    const difficulty = Number(game.difficulty);
    return (
        <div className="pk-meta">
            {best ? <span className="pk-best">베스트 {best}</span> : <span>{game.min_players}~{game.max_players}인</span>}
            {game.playingtime && <span>{game.playingtime}</span>}
            {Number.isFinite(difficulty) && difficulty > 0 && <span>난이도 {difficulty.toFixed(1)}</span>}
        </div>
    );
};

// index: 깔릴 때 한 장씩 차례로 나타나는 지연(--i)
function Card({ game, removed, gone, onRemove, index = 0 }) {
    const style = { '--i': index };
    if (removed) return <li className="pk-card pk-card-removed" style={style} aria-hidden="true" />;
    return (
        <li className={`pk-card${gone ? ' is-gone' : ''}`} style={style}>
            <button type="button" className="pk-remove" onClick={onRemove} aria-label={`${game.name} 지우기`}>✕</button>
            {gone && <span className="pk-gone">지금 대여 불가</span>}
            <div className="pk-img">
                {game.image ? <img src={game.image} alt="" loading="lazy" /> : <span>{game.name.slice(0, 1)}</span>}
            </div>
            <div className="pk-name">{game.name}</div>
            <Meta game={game} />
        </li>
    );
}

function Result({ game, label, gone }) {
    return (
        <div className="pk-result">
            <div className="pk-result-label">{label}</div>
            {game.image && <img src={game.image} alt="" />}
            <div className="pk-result-name">{game.name}</div>
            <Meta game={game} />
            {gone && <p className="pk-gone-note">지금 대여 불가</p>}
            <Link to={`/game/${game.id}`} className="fun-secondary-btn pk-result-link">게임 정보 보기</Link>
        </div>
    );
}

export default function PickPlay() {
    const navigate = useNavigate();
    const { games, loading, error, refreshGames } = useGameData();
    const pick = usePickEliminate(games);
    const { mode, cards, remaining, removed, decided, tooFew } = pick;

    return (
        <div className="fun-page pk-page">
            <div className="fun-header">
                <button type="button" onClick={() => (mode == null ? navigate('/play') : pick.backToChoose())}
                    className="fun-back-btn" aria-label={mode == null ? '놀이터로' : '인원 다시 고르기'}>←</button>
                <h2 className="fun-title">게임소거선택론{mode != null && <span className="pk-title-mode"> · {modeLabel(mode)}</span>}</h2>
            </div>

            {loading && games.length === 0 ? (
                <p className="fun-status">게임 목록 불러오는 중</p>
            ) : error && games.length === 0 ? (
                <div className="fun-status">
                    <p>게임 목록을 불러오지 못함</p>
                    <button type="button" onClick={refreshGames}>다시 시도</button>
                </div>
            ) : mode == null ? (
                <>
                    <p className="fun-subtitle">지금 빌릴 수 있는 게임 중 그 인원에 잘 맞는 {PICK_COUNT}개 → 하나씩 지워 마지막 하나로 결정</p>
                    <h3 className="pk-choose-label">몇 명이서 할 게임?</h3>
                    <div className="pk-choose-grid">
                        {PICK_PLAYER_OPTIONS.filter((n) => n !== 8).map((n) => (
                            <button key={n} type="button" className="pk-choose-btn" onClick={() => pick.start(n)}>{n}명</button>
                        ))}
                        <button type="button" className="pk-choose-btn pk-choose-split" onClick={() => pick.start(SPLIT_MODE)}>
                            8명<span>4/4로 나누기</span>
                        </button>
                    </div>
                </>
            ) : cards.length === 0 ? (
                <div className="fun-status">
                    <p>{modeLabel(mode)}에 맞는 대여 가능 게임 없음</p>
                    <button type="button" onClick={pick.backToChoose}>인원 다시 고르기</button>
                </div>
            ) : decided ? (
                <>
                    {tooFew && <p className="pk-note">{modeLabel(mode)}에 맞는 게임이 {cards.length}개뿐</p>}
                    <div className={`pk-results${mode === SPLIT_MODE && remaining.length === 2 ? ' is-split' : ''}`}>
                        {mode === SPLIT_MODE && remaining.length === 2 ? (
                            <>
                                <Result game={remaining[0]} label="테이블 A" gone={pick.isGone(remaining[0])} />
                                <Result game={remaining[1]} label="테이블 B" gone={pick.isGone(remaining[1])} />
                            </>
                        ) : remaining.map((g) => <Result key={g.id} game={g} label="결론" gone={pick.isGone(g)} />)}
                    </div>
                    <div className="pk-actions">
                        {!tooFew && <button type="button" className="fun-secondary-btn" onClick={pick.undo}>되돌리기 (한 장)</button>}
                        {!tooFew && <button type="button" className="fun-secondary-btn" onClick={pick.reset}>↻ 처음 {cards.length}개로</button>}
                        <button type="button" className="fun-secondary-btn" onClick={pick.redraw}>다른 {PICK_COUNT}개 뽑기</button>
                        <button type="button" className="fun-secondary-btn" onClick={pick.backToChoose}>인원 다시 고르기</button>
                    </div>
                </>
            ) : (
                <>
                    <p className="pk-note">
                        {mode === SPLIT_MODE ? '2개' : '1개'} 남을 때까지 ✕로 지우기 · 남은 {remaining.length}개
                        {cards.length < PICK_COUNT && ` · 맞는 게임이 ${cards.length}개뿐`}
                    </p>
                    <ul className="pk-grid">
                        {cards.map((g, i) => (
                            <Card key={g.id} index={i} game={g} removed={removed.some((id) => String(id) === String(g.id))}
                                gone={pick.isGone(g)} onRemove={() => pick.remove(g.id)} />
                        ))}
                    </ul>
                    <div className="pk-actions">
                        <button type="button" className="fun-secondary-btn" onClick={pick.undo} disabled={removed.length === 0}>되돌리기 (한 장)</button>
                        <button type="button" className="fun-secondary-btn" onClick={pick.reset} disabled={removed.length === 0}>↻ 처음 {cards.length}개로</button>
                        <button type="button" className="fun-secondary-btn" onClick={pick.redraw}>다른 {PICK_COUNT}개 뽑기</button>
                    </div>
                </>
            )}
        </div>
    );
}
