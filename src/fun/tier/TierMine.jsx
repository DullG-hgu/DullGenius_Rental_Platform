// 내 머더 티어표 (/play/tier/murder) — 회원만 작성. 비회원은 소개 + 모두의 티어
// 배치: 끌어서 놓기(터치는 꾹 누른 뒤) · 보조로 탭 → 줄 탭. 바뀌면 0.8초 모아 표 전체 저장 (tierStore)
// ?game=<id>: 게임 상세 「평가하러 가기」에서 온 경우 그 게임을 골라 둔 채로 연다
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useGameData } from '../../contexts/GameDataContext';
import { useToast } from '../../contexts/ToastContext';
import TierBoard, { TierDragGhost } from './TierBoard';
import useTierDrag from './useTierDrag';
import { isMurder, rowsFor, TIER_GUIDE, TIERS } from './tierData';
import { flushTierSave, loadMyTier, placeMyTier, retryTierSave, setMyTierLabels, setMyTierPublic, useMyTier } from './tierStore';
import '../fun.css';
import './tier.css';

const SAVE_TEXT = { saved: '저장됨', pending: '저장 대기', saving: '저장 중…' };

const TierMine = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const [searchParams, setSearchParams] = useSearchParams();
    const { user, loading: authLoading } = useAuth();
    const { games, loading, error } = useGameData();
    const { showToast } = useToast();
    const { status, mine, save } = useMyTier(user?.id);
    const [selected, setSelected] = useState(null); // { game, from: 'tray' | 'S'... }
    const [labelSheet, setLabelSheet] = useState(false);
    const [showGuide, setShowGuide] = useState(false);
    const [draftLabels, setDraftLabels] = useState(mine.labels);

    const pool = useMemo(
        () => games.filter(isMurder).sort((a, b) => a.name.localeCompare(b.name, 'ko')),
        [games]
    );

    // 화면을 떠나면 남은 저장을 바로 보낸다
    useEffect(() => () => flushTierSave(), []);

    const rows = useMemo(() => rowsFor(pool, mine.placements, mine.order), [pool, mine.placements, mine.order]);

    // 게임 상세에서 넘어온 게임을 골라 두고 화면 가운데로 — 한 번 쓰고 주소에서 지운다
    const focusId = searchParams.get('game');
    useEffect(() => {
        if (!focusId || pool.length === 0 || status !== 'ready') return;
        const game = pool.find((g) => String(g.id) === focusId);
        const next = new URLSearchParams(searchParams);
        next.delete('game');
        setSearchParams(next, { replace: true });
        if (!game) return;
        setSelected({ game, from: mine.placements[String(game.id)] ?? 'tray' });
        requestAnimationFrame(() => document.querySelector(`.tier-board [data-game-id="${game.id}"]`)
            ?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
    }, [focusId, pool, status, mine.placements, searchParams, setSearchParams]);

    const tray = pool.filter((g) => !mine.placements[g.id]);
    const placedCount = pool.length - tray.length;

    const place = useCallback((gameId, tier, index) => {
        placeMyTier(gameId, tier, index);
        setSelected(null);
    }, []);

    const onDrop = useCallback((game, tier, index) => place(game.id, tier, index), [place]);
    const { drag, cardHandlers, shouldIgnoreClick } = useTierDrag({ onDrop });

    const onCardClick = (game, from) => {
        if (shouldIgnoreClick()) return;
        // 티어 카드를 고른 상태에서 「안 해봄」 줄을 탭(카드 위 포함)하면 빼기
        if (selected && selected.from !== 'tray' && from === 'tray') {
            place(selected.game.id, null);
            return;
        }
        // 고른 카드가 있는 상태에서 티어 줄의 다른 카드를 탭하면 그 카드 앞에 끼워 넣기
        if (selected && selected.game.id !== game.id && from !== 'tray') {
            const idx = rows[from].filter(({ game: g }) => g.id !== selected.game.id).findIndex(({ game: g }) => g.id === game.id);
            place(selected.game.id, from, idx);
            return;
        }
        setSelected((s) => (s?.game.id === game.id ? null : { game, from }));
    };

    const copyLink = async () => {
        try {
            await navigator.clipboard.writeText(`${window.location.origin}/play/tier/murder/u/${user.id}`);
            showToast('링크 복사 완료', { type: 'success' });
        } catch {
            showToast('복사 실패 — 주소창에서 직접 복사', { type: 'error' });
        }
    };

    const togglePublic = async (next) => {
        try {
            await setMyTierPublic(next);
        } catch {
            showToast('공개 설정을 바꾸지 못함', { type: 'error' });
        }
    };

    const header = (
        <div className="fun-header">
            <button type="button" onClick={() => navigate('/play')} className="fun-back-btn" aria-label="놀이터로">←</button>
            <h2 className="fun-title">머더미스터리 티어표</h2>
        </div>
    );

    if (authLoading) return <div className="fun-page">{header}<div className="loading-container"><div className="spinner"></div></div></div>;

    if (!user) {
        return (
            <div className="fun-page tier-page">
                {header}
                <div className="tier-intro">
                    <p><strong>해본 머더에 S~D 등급</strong> · 모두의 티어에 이름 없이 합산</p>
                    <p>머더는 한 번 하면 다시 못 하는 게임이라, 내 표가 곧 「해본 머더 · 안 해본 머더」 기록</p>
                    <button type="button" className="fun-primary-btn"
                        onClick={() => navigate('/login', { state: { from: location.pathname + location.search } })}>
                        로그인하고 내 티어표 만들기
                    </button>
                    <Link to="/play/tier/murder/community" className="fun-secondary-btn wc-link-btn tier-intro-link">모두의 티어 보기</Link>
                </div>
            </div>
        );
    }

    return (
        <div className={`fun-page tier-page${drag ? ' is-dragging' : ''}`}>
            {header}

            <p className="tier-guide">
                {drag
                    ? '놓을 줄로 끌기 · 「안 해봄」에 놓으면 빼기'
                    : selected
                        ? `「${selected.game.name}」 놓을 줄 탭 · 카드를 탭하면 그 앞에`
                        : '해본 게임만 「안 해봄」에서 위로 · 줄 안 순서도 자유 · 끌거나(폰은 꾹 누른 뒤) 탭 → 줄 탭'}
            </p>

            <button type="button" className="tier-guide-toggle" aria-expanded={showGuide}
                onClick={() => setShowGuide((v) => !v)}>
                티어 기준 · 「안 해본 사람에게 권하겠는가」 {showGuide ? '▲' : '▼'}
            </button>
            {showGuide && (
                <ul className="tier-guide-list tier-guide-box">
                    {TIERS.map((t) => (
                        <li key={t}><span className={`tier-label-badge tier-${t}`}>{t}</span>{TIER_GUIDE[t]}</li>
                    ))}
                </ul>
            )}

            <div className="tier-top">
                <span className="tier-count"><strong>{placedCount}</strong> / {pool.length} 평가</span>
                <Link to="/play/tier/murder/community" className="tier-top-link">모두의 티어 →</Link>
            </div>

            {status === 'error' && (
                <div className="fun-status" role="alert">
                    <p>내 티어표를 불러오지 못함</p>
                    <button type="button" onClick={() => loadMyTier(user.id, { force: true })}>다시 시도</button>
                </div>
            )}
            {(status === 'loading' || (pool.length === 0 && loading)) && <div className="loading-container"><div className="spinner"></div></div>}
            {status === 'ready' && pool.length === 0 && !loading && (
                <div className="fun-status" role="alert">
                    <p>{error ? '게임 목록을 불러오지 못함' : '등록된 머더미스터리 없음'}</p>
                    {error && <button type="button" onClick={() => window.location.reload()}>다시 시도</button>}
                </div>
            )}
            {status === 'ready' && pool.length > 0 && (
                    <TierBoard rows={rows} labels={mine.labels} selectedId={selected?.game.id}
                        extraRow={{
                            key: 'tray', label: '안 해봄', empty: '전부 해본 게임',
                            items: tray.map((g) => ({ game: g, sub: mine.playedElsewhere.includes(String(g.id)) ? '대여 기록' : null })),
                        }}
                        armed={!!selected && !drag}
                        onRowClick={(t) => { if (t !== selected.from) place(selected.game.id, t === 'tray' ? null : t); else setSelected(null); }}
                        onCardClick={onCardClick} cardHandlers={cardHandlers} drag={drag} />
            )}

            <div className="tier-options">
                <label className="tier-check">
                    <input type="checkbox" checked={mine.isPublic} disabled={status !== 'ready'}
                        onChange={(e) => togglePublic(e.target.checked)} />
                    <span>다른 회원에게 공개</span>
                </label>
                <div className="tier-option-btns">
                    <button type="button" className="fun-secondary-btn"
                        onClick={() => { setDraftLabels(mine.labels); setLabelSheet(true); }}>티어 이름 바꾸기</button>
                    {mine.isPublic && <button type="button" className="fun-secondary-btn" onClick={copyLink}>링크 복사</button>}
                </div>
                <p className="tier-note">
                    올린 게임은 「해본 게임」, 아래 남은 게임은 「안 해본 게임」으로 기록 · 비공개여도 모두의 티어에는 이름 없이 반영
                </p>
                <p className={`tier-save-state${save === 'error' ? ' is-error' : ''}`} role="status">
                    {save === 'error'
                        ? <>저장 실패 · <button type="button" className="tier-inline-link" onClick={retryTierSave}>다시 시도</button></>
                        : SAVE_TEXT[save]}
                </p>
            </div>

            <TierDragGhost drag={drag} />

            {labelSheet && (
                <div className="wc-sheet-backdrop" onClick={() => setLabelSheet(false)}>
                    <div className="wc-sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="티어 이름 바꾸기">
                        <div className="wc-sheet-handle" />
                        <h3>티어 이름</h3>
                        <p className="wc-sheet-note">줄마다 10자까지 · 빈칸은 기본 글자 · 이름만 바뀌고 뜻은 아래 기준 그대로</p>
                        <div className="tier-label-inputs">
                            {TIERS.map((t, i) => (
                                <label key={t} className="tier-label-row">
                                    <span className={`tier-label-badge tier-${t}`}>{t}</span>
                                    <span className="tier-label-field">
                                        <input type="text" maxLength={10} value={draftLabels[i]} placeholder={t}
                                            onChange={(e) => setDraftLabels((d) => d.map((v, j) => (j === i ? e.target.value : v)))} />
                                        <span className="tier-label-guide">{TIER_GUIDE[t]}</span>
                                    </span>
                                </label>
                            ))}
                        </div>
                        <div className="wc-sheet-actions">
                            <button type="button" className="fun-primary-btn"
                                onClick={() => { setMyTierLabels(draftLabels); setLabelSheet(false); }}>
                                저장
                            </button>
                            <button type="button" className="fun-secondary-btn" onClick={() => setLabelSheet(false)}>취소</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default TierMine;
