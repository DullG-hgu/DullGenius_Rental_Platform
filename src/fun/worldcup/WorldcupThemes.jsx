// 월드컵 테마 목록 (/play/worldcup) + 강수 선택 하단 시트
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { fetchWorldcupThemes } from '../../api_fun';
import { clearProgress, loadProgress } from './worldcupProgress';
import { getMatchState, ROUND_LABEL } from './worldcupLogic';
import '../fun.css';

const DEFAULT_SIZE = 16;
// 인원 선택: null = 상관없음. "n명이서 뭐 하지?" 용 — 그 인원으로 할 수 있는 게임만 후보로
const PLAYER_OPTIONS = [null, 2, 3, 4, 5, 6, 7, 8, 10];

const pickSize = (sizes, current) => {
    if (sizes.includes(current)) return current;
    if (sizes.includes(DEFAULT_SIZE)) return DEFAULT_SIZE;
    return sizes[sizes.length - 1] ?? DEFAULT_SIZE;
};

const describeProgress = (saved) => {
    try {
        const s = getMatchState(saved.run.candidates, saved.run.top_first, saved.picks);
        return s.done ? null : `${ROUND_LABEL(s.roundSize)} ${s.matchNo}/${s.roundMatches}`;
    } catch {
        return null;
    }
};

const WorldcupThemes = () => {
    const navigate = useNavigate();
    const [themes, setThemes] = useState(null);
    const [error, setError] = useState(null);
    const [sheetTheme, setSheetTheme] = useState(null);
    const [size, setSize] = useState(DEFAULT_SIZE);
    const [saved, setSaved] = useState(() => loadProgress());
    const [searchParams] = useSearchParams();
    const autoOpened = useRef(false);
    const [players, setPlayers] = useState(null);
    // 시트에 보여줄 후보 수·가능 강수 (인원을 고르면 서버에 다시 물어본다)
    const [sheetStats, setSheetStats] = useState(null);

    const load = useCallback(() => {
        setError(null);
        fetchWorldcupThemes()
            .then((data) => setThemes(data || []))
            .catch(() => setError('월드컵 목록을 불러오지 못했어요.'));
    }, []);

    useEffect(() => {
        window.scrollTo(0, 0);
        load();
    }, [load]);

    // 서버가 부전승 규칙(후보 > 강수/2)에 맞는 강수만 내려준다
    const sizesFor = (theme) => theme.allowed_sizes;

    const openSheet = (theme) => {
        setPlayers(null);
        setSheetStats({ pool: theme.pool_count, sizes: sizesFor(theme) });
        setSize(pickSize(sizesFor(theme), DEFAULT_SIZE));
        setSheetTheme(theme);
    };

    const choosePlayers = (n) => {
        setPlayers(n);
        if (n === null) {
            setSheetStats({ pool: sheetTheme.pool_count, sizes: sizesFor(sheetTheme) });
            setSize((cur) => pickSize(sizesFor(sheetTheme), cur));
            return;
        }
        setSheetStats((prev) => ({ ...prev, loading: true }));
        fetchWorldcupThemes(n)
            .then((list) => {
                const t = list?.find((x) => x.slug === sheetTheme.slug);
                const next = { pool: t?.pool_count ?? 0, sizes: t?.allowed_sizes ?? [] };
                setSheetStats(next);
                setSize((cur) => pickSize(next.sizes, cur));
            })
            .catch(() => setSheetStats((prev) => ({ ...prev, loading: false, error: true })));
    };

    // 한 번에 강수 선택까지: ?theme=slug 로 들어왔거나 열린 테마가 하나뿐이면 시트를 바로 연다
    useEffect(() => {
        if (!themes || autoOpened.current) return;
        const wanted = searchParams.get('theme');
        const target = themes.find((t) => t.slug === wanted) ?? (themes.length === 1 ? themes[0] : null);
        if (target) {
            autoOpened.current = true;
            openSheet(target);
        }
        // openSheet 는 렌더마다 새로 만들어지지만 themes 기준 1회만 실행하면 된다
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [themes, searchParams]);

    const start = () => {
        clearProgress();
        setSaved(null);
        navigate(`/play/worldcup/${sheetTheme.slug}/play?size=${size}${players ? `&players=${players}` : ''}`);
    };

    const resume = () => navigate(`/play/worldcup/${sheetTheme.slug}/play?resume=1`);

    const savedForSheet = sheetTheme && saved?.run.slug === sheetTheme.slug ? saved : null;
    const savedLabel = savedForSheet ? describeProgress(savedForSheet) : null;

    return (
        <div className="fun-page">
            <div className="fun-header">
                <button type="button" onClick={() => navigate('/play')} className="fun-back-btn" aria-label="뒤로가기">←</button>
                <h2 className="fun-title">이상형 월드컵</h2>
            </div>

            {error && (
                <div className="fun-status" role="alert">
                    <p>{error}</p>
                    <button type="button" onClick={load}>다시 시도</button>
                </div>
            )}

            {!error && themes === null && (
                <div className="loading-container"><div className="spinner"></div></div>
            )}

            {themes?.length === 0 && (
                <p className="fun-status">지금 열린 월드컵이 없어요.</p>
            )}

            <div className="wc-theme-list">
                {themes?.map((theme) => {
                    const inProgress = saved?.run.slug === theme.slug ? describeProgress(saved) : null;
                    return (
                        <button key={theme.slug} type="button" className="wc-theme-card" onClick={() => openSheet(theme)}>
                            <div className="wc-theme-title">🏆 {theme.title}</div>
                            {theme.description && <div className="wc-theme-desc">{theme.description}</div>}
                            <div className="wc-theme-meta">
                                후보 {theme.pool_count}개 · {theme.play_count.toLocaleString()}명 참여
                            </div>
                            {inProgress && <span className="wc-resume-chip">이어하기 · {inProgress}</span>}
                        </button>
                    );
                })}
            </div>

            {sheetTheme && (
                <div className="wc-sheet-backdrop" onClick={() => setSheetTheme(null)}>
                    <div
                        className="wc-sheet"
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="wc-sheet-title"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="wc-sheet-handle" aria-hidden="true" />
                        <h3 className="wc-sheet-label">몇 명이서 할 게임인가요?</h3>
                        <div className="wc-players-row" role="group" aria-label="인원">
                            {PLAYER_OPTIONS.map((n) => (
                                <button
                                    key={n ?? 'any'}
                                    type="button"
                                    className="wc-players-btn"
                                    aria-pressed={players === n}
                                    onClick={() => choosePlayers(n)}
                                >
                                    {n === null ? '상관없음' : `${n}명`}
                                </button>
                            ))}
                        </div>

                        <h3 id="wc-sheet-title" className="wc-sheet-label">몇 강으로 할까요?</h3>
                        {sheetStats?.error ? (
                            <p className="wc-sheet-note" role="alert">후보 수를 불러오지 못했어요. 인원을 다시 골라 주세요.</p>
                        ) : sheetStats?.loading ? (
                            <p className="wc-sheet-note">후보를 세는 중…</p>
                        ) : sheetStats?.sizes.length === 0 ? (
                            <p className="wc-sheet-note" role="alert">
                                {players}명이서 할 수 있는 게임이 {sheetStats.pool}개뿐이라 월드컵을 열 수 없어요.
                            </p>
                        ) : (
                            <p className="wc-sheet-note">
                                {players && <>{players}명이서 할 수 있는 게임만 나와요. </>}
                                {size <= sheetStats.pool ? (
                                    <>후보 {sheetStats.pool}개 중 <strong>{size}개</strong>가 무작위로 뽑혀요.</>
                                ) : (
                                    <>후보 <strong>{sheetStats.pool}개 전부</strong> 참가하고, {size - sheetStats.pool}개는 첫 판 부전승이에요.</>
                                )}
                                {size >= 128 && <> 대결이 {Math.min(size, sheetStats.pool) - 1}번이라 오래 걸려요. 중간에 나가도 이어할 수 있어요.</>}
                            </p>
                        )}
                        <div className="wc-size-grid">
                            {(sheetStats?.loading ? [] : sheetStats?.sizes ?? []).map((n) => (
                                <button
                                    key={n}
                                    type="button"
                                    className="wc-size-btn"
                                    aria-pressed={size === n}
                                    onClick={() => setSize(n)}
                                >
                                    {n}강
                                </button>
                            ))}
                        </div>
                        <div className="wc-sheet-actions">
                            {savedLabel && (
                                <button type="button" className="fun-primary-btn" onClick={resume}>
                                    이어하기 ({savedLabel})
                                </button>
                            )}
                            <button
                                type="button"
                                className={savedLabel ? 'fun-secondary-btn' : 'fun-primary-btn'}
                                onClick={start}
                                disabled={!sheetStats || sheetStats.loading || sheetStats.error || !sheetStats.sizes.includes(size)}
                            >
                                {savedLabel ? `새로 ${players ? `${players}명 ` : ''}${size}강 시작` : `${players ? `${players}명 · ` : ''}${size}강 시작하기`}
                            </button>
                            <Link to={`/play/worldcup/${sheetTheme.slug}/ranking`} className="wc-text-link">
                                랭킹 먼저 보기 →
                            </Link>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default WorldcupThemes;
