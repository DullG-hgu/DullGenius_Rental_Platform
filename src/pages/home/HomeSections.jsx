// 메인 페이지 조각 — 게임 카드 줄, 상황별 추천 묶음
import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useGameFilter } from '../../hooks/useGameFilter';
import { getOptimizedImageUrl } from '../../utils/imageOptimizer';
import LazyImage from '../../components/common/LazyImage';

export const HomeGameCard = ({ game, rank, onClick }) => (
    <Link to={`/game/${game.id}`} state={{ game, from: '/' }} onClick={onClick} className="home-game">
        <div className="home-game-img">
            {rank && <span className="home-rank">{rank}</span>}
            {game.image
                ? <LazyImage src={getOptimizedImageUrl(game.image, 240)} fallbackSrc={game.image} alt={game.name} aspectRatio="1/1" />
                : <span className="home-game-empty" aria-hidden="true">🎲</span>}
        </div>
        <div className="home-game-name">{game.name}</div>
        {game.status && (
            <div className={`home-game-status${game.status === '대여가능' ? ' is-on' : ''}`}>{game.status}</div>
        )}
    </Link>
);

// 상황별 추천 — 관리자 「상황별 추천」(app_config.recommendations) 항목을 한 칸에서 번갈아 보여준다.
// 자동으로 넘기다가 사용자가 태그를 누르거나 게임 줄을 만지면 멈춘다. 매칭은 검색 화면과 같은 태그 검색(useGameFilter)
const ROTATE_MS = 6000;

export const RecommendationDeck = ({ games, recs, onGameClick }) => {
    const [idx, setIdx] = useState(0);
    const [paused, setPaused] = useState(
        () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true,
    );
    const tagsRef = useRef(null);
    const rec = recs[idx % recs.length];
    const matched = useGameFilter(games, { searchTerm: rec.value });

    useEffect(() => {
        if (paused || recs.length < 2) return undefined;
        const timer = setTimeout(() => setIdx((i) => (i + 1) % recs.length), ROTATE_MS);
        return () => clearTimeout(timer);
    }, [idx, paused, recs.length]);

    // 선택된 태그가 태그 줄 밖이면 가로로만 따라간다 (scrollIntoView 는 페이지를 세로로도 움직일 수 있어 쓰지 않음)
    useEffect(() => {
        const bar = tagsRef.current;
        const tag = bar?.children[idx];
        if (!tag || typeof bar.scrollTo !== 'function') return;
        const left = tag.offsetLeft - 16;
        const right = tag.offsetLeft + tag.offsetWidth + 16 - bar.clientWidth;
        if (bar.scrollLeft > left) bar.scrollTo({ left, behavior: 'smooth' });
        else if (bar.scrollLeft < right) bar.scrollTo({ left: right, behavior: 'smooth' });
    }, [idx]);

    const choose = (i) => { setPaused(true); setIdx(i); };
    const title = rec.label.split('\\n').join(' ');

    return (
        <section className="home-section home-deck">
            <div className="home-section-head">
                <h2>상황별 추천</h2>
            </div>
            <div className="home-deck-tags" role="tablist" aria-label="추천 묶음" ref={tagsRef}>
                {recs.map((r, i) => (
                    <button
                        key={r.key ?? r.value}
                        type="button"
                        role="tab"
                        aria-selected={i === idx}
                        className="home-deck-tag"
                        onClick={() => choose(i)}
                    >
                        {r.value.startsWith('#') ? r.value : `#${r.value}`}
                    </button>
                ))}
            </div>
            <div className="home-section-head home-deck-head">
                <h3 className="home-deck-title">{title}</h3>
                <Link to={`/search?query=${encodeURIComponent(rec.value)}`}>자세히 보기 →</Link>
            </div>
            <div
                key={idx}
                className="home-rail home-deck-rail"
                role="tabpanel"
                onPointerDown={() => setPaused(true)}
                onScroll={() => setPaused(true)}
            >
                {matched.length === 0 && <p className="home-deck-empty">아직 이 묶음에 들어간 게임이 없어요.</p>}
                {matched.slice(0, 10).map((g) => <HomeGameCard key={g.id} game={g} onClick={onGameClick} />)}
            </div>
            {!paused && recs.length > 1 && (
                <div className="home-deck-timer" aria-hidden="true">
                    <span key={idx} style={{ animationDuration: `${ROTATE_MS}ms` }} />
                </div>
            )}
        </section>
    );
};
