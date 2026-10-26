// 월드컵 테마 목록 (/play/worldcup) + 강수 선택 하단 시트
// 열린 테마가 하나뿐이면 목록·시트 없이 설정 화면을 한 페이지로 보여 준다 —
// 카드 하나짜리 목록에 빠지는 일이 없게 (2026-10-08: 홈 배너 → 뒤로가기가 이상한 칸으로 가던 문제)
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { fetchMyOpenWorldcupRun, fetchWorldcupThemes } from '../../api_fun';
import { useAuth } from '../../contexts/AuthContext';
import { clearProgress, loadProgress, MEMBER_TTL_MS, saveProgress } from './worldcupProgress';
import { ALL_WEIGHTS, getMatchState, ROUND_LABEL, WEIGHT_OPTIONS } from './worldcupLogic';
import '../fun.css';

const DEFAULT_SIZE = 16;
// 인원 선택: null = 상관없음. "n명이서 뭐 하지?" 용 — 그 인원으로 할 수 있는 게임만 후보로
const PLAYER_OPTIONS = [null, 2, 3, 4, 5, 6, 7, 8, 10];

// 서버가 준 구간별 후보 수로 웨이트 범위를 적용한 후보 수·강수를 계산한다 (체크마다 서버에 묻지 않는다)
// 전부 체크면 조건 없음 — 웨이트 없는 게임도 들어간다. 강수 규칙은 서버와 같다: 후보 × 2 > 강수
const applyWeights = (theme, weights) => {
    const all = weights.length === ALL_WEIGHTS.length;
    const counts = theme.weight_counts;
    if (all || !counts) return { pool: theme.pool_count, sizes: theme.allowed_sizes };
    const pool = weights.reduce((sum, k) => sum + (counts[k] ?? 0), 0);
    return { pool, sizes: (theme.all_sizes ?? theme.allowed_sizes).filter((n) => pool * 2 > n) };
};

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

// 뒤로: 앱 안에서 왔으면 온 곳으로, 주소로 바로 들어왔으면 놀이터로
const canGoBack = () => (window.history.state?.idx ?? 0) > 0;

const WorldcupThemes = () => {
    const navigate = useNavigate();
    const { user, loading: authLoading } = useAuth();
    const [themes, setThemes] = useState(null);
    const [error, setError] = useState(null);
    const [sheetTheme, setSheetTheme] = useState(null);
    const [size, setSize] = useState(DEFAULT_SIZE);
    const [saved, setSaved] = useState(() => loadProgress());
    const [searchParams] = useSearchParams();
    const autoOpened = useRef(false);
    const [players, setPlayers] = useState(null);
    const [weights, setWeights] = useState(ALL_WEIGHTS);
    // 시트 기준 테마 정보 — 인원을 고르면 그 인원 기준으로 서버에 다시 물어본다 (구간별 후보 수 포함)
    const [sheetBase, setSheetBase] = useState(null);
    const [sheetLoad, setSheetLoad] = useState({ loading: false, error: false });
    const sheetStats = sheetBase ? { ...applyWeights(sheetBase, weights), ...sheetLoad } : null;
    const weightsPartial = weights.length < ALL_WEIGHTS.length;

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

    // 로그인 상태면 서버에 있는 진행 중인 판도 찾는다 (다른 기기에서 하던 판 이어하기, 3일)
    // 기기에 저장된 판과 다르면 더 최근에 진행한 쪽, 같은 판이면 더 많이 진행한 쪽을 쓴다
    useEffect(() => {
        if (authLoading || !user) return;
        let active = true;
        fetchMyOpenWorldcupRun()
            .then((open) => {
                if (!active || !open?.run) return;
                const local = loadProgress();
                const serverAt = new Date(open.last_activity).getTime();
                const useServer = !local
                    || (local.run.run_id === open.run.run_id
                        ? open.picks.length > local.picks.length
                        : serverAt > (local.savedAt || 0));
                if (!useServer) return;
                saveProgress(open.run, open.picks, open.unplayed ?? [], MEMBER_TTL_MS);
                setSaved(loadProgress());
            })
            .catch(() => {});
        return () => { active = false; };
    }, [authLoading, user]);

    const openSheet = (theme) => {
        setPlayers(null);
        setWeights(ALL_WEIGHTS);
        setSheetBase(theme);
        setSheetLoad({ loading: false, error: false });
        setSize(pickSize(theme.allowed_sizes, DEFAULT_SIZE));
        setSheetTheme(theme);
    };

    const choosePlayers = (n) => {
        setPlayers(n);
        if (n === null) {
            setSheetBase(sheetTheme);
            setSheetLoad({ loading: false, error: false });
            setSize((cur) => pickSize(applyWeights(sheetTheme, weights).sizes, cur));
            return;
        }
        setSheetLoad({ loading: true, error: false });
        fetchWorldcupThemes(n)
            .then((list) => {
                const t = list?.find((x) => x.slug === sheetTheme.slug)
                    ?? { ...sheetTheme, pool_count: 0, allowed_sizes: [], all_sizes: [], weight_counts: {} };
                setSheetBase(t);
                setSheetLoad({ loading: false, error: false });
                setSize((cur) => pickSize(applyWeights(t, weights).sizes, cur));
            })
            .catch(() => setSheetLoad({ loading: false, error: true }));
    };

    // 마지막 남은 하나는 끌 수 없다 (후보 0개 방지)
    const toggleWeight = (key) => {
        const next = weights.includes(key)
            ? (weights.length === 1 ? weights : weights.filter((k) => k !== key))
            : ALL_WEIGHTS.filter((k) => k === key || weights.includes(k));
        setWeights(next);
        if (sheetBase) setSize((cur) => pickSize(applyWeights(sheetBase, next).sizes, cur));
    };

    const single = themes?.length === 1;

    // 한 번에 강수 선택까지: ?theme=slug 로 들어왔거나 열린 테마가 하나뿐이면 바로 고를 수 있게 연다
    // (하나뿐이면 시트가 아니라 페이지 본문으로 펼쳐진다)
    useEffect(() => {
        if (!themes || autoOpened.current) return;
        const wanted = searchParams.get('theme');
        const target = themes.length === 1 ? themes[0] : themes.find((t) => t.slug === wanted);
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
        navigate(`/play/worldcup/${sheetTheme.slug}/play?size=${size}${players ? `&players=${players}` : ''}${weightsPartial ? `&weights=${weights.join(',')}` : ''}`);
    };

    const resume = () => navigate(`/play/worldcup/${sheetTheme.slug}/play?resume=1`);

    const savedForSheet = sheetTheme && saved?.run.slug === sheetTheme.slug ? saved : null;
    const savedLabel = savedForSheet ? describeProgress(savedForSheet) : null;

    const goBack = () => (canGoBack() ? navigate(-1) : navigate('/play'));

    return (
        <div className="fun-page">
            <div className="fun-header">
                <button type="button" onClick={goBack} className="fun-back-btn" aria-label="뒤로가기">←</button>
                <h2 className="fun-title">{single ? `🏆 ${themes[0].title}` : '이상형 월드컵'}</h2>
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

            {single && (
                <p className="fun-subtitle">
                    {themes[0].description ? `${themes[0].description} · ` : ''}
                    후보 {themes[0].pool_count}개 · {themes[0].play_count.toLocaleString()}명 참여
                </p>
            )}

            {!single && <div className="wc-theme-list">
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
            </div>}

            {sheetTheme && (
                <div className={single ? 'wc-setup-page' : 'wc-sheet-backdrop'} onClick={single ? undefined : () => setSheetTheme(null)}>
                    <div
                        className={single ? 'wc-sheet wc-sheet-inline' : 'wc-sheet'}
                        role={single ? undefined : 'dialog'}
                        aria-modal={single ? undefined : 'true'}
                        aria-labelledby="wc-sheet-title"
                        onClick={(e) => e.stopPropagation()}
                    >
                        {!single && <div className="wc-sheet-handle" aria-hidden="true" />}
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

                        {sheetBase?.weight_counts && (
                            <>
                                <h3 className="wc-sheet-label">웨이트 범위 설정</h3>
                                <div className="wc-weight-row" role="group" aria-label="웨이트 범위">
                                    {WEIGHT_OPTIONS.map((o) => {
                                        const on = weights.includes(o.key);
                                        return (
                                            <button
                                                key={o.key}
                                                type="button"
                                                className="wc-players-btn wc-weight-btn"
                                                aria-pressed={on}
                                                onClick={() => toggleWeight(o.key)}
                                            >
                                                <span className="wc-weight-check" aria-hidden="true">{on ? '✓' : ''}</span>
                                                {o.label}
                                                <span className="wc-weight-count">{sheetLoad.loading ? '…' : `${sheetBase.weight_counts[o.key] ?? 0}개`}</span>
                                            </button>
                                        );
                                    })}
                                </div>
                            </>
                        )}

                        <h3 id="wc-sheet-title" className="wc-sheet-label">몇 강으로 할까요?</h3>
                        {sheetStats?.error ? (
                            <p className="wc-sheet-note" role="alert">후보 수를 불러오지 못했어요. 인원을 다시 골라 주세요.</p>
                        ) : sheetStats?.loading ? (
                            <p className="wc-sheet-note">후보를 세는 중…</p>
                        ) : sheetStats?.sizes.length === 0 ? (
                            <p className="wc-sheet-note" role="alert">
                                {players ? `${players}명이서 할 수 있는 ` : ''}{weightsPartial ? '고른 웨이트 범위의 ' : ''}게임이 {sheetStats.pool}개뿐이라 월드컵을 열 수 없어요.
                            </p>
                        ) : (
                            <p className="wc-sheet-note">
                                {players && <>{players}명이서 할 수 있는 게임만 나와요. </>}
                                {weightsPartial && <>고른 웨이트 범위의 게임만 나와요(웨이트 정보 없는 게임 제외). </>}
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
                        {/* 수집 목적 안내 (spec §6-2) */}
                        <p className="wc-record-note">
                            {user
                                ? '로그인 상태라 고른 기록이 내 계정에 저장돼 「내 취향 리포트」와 추천에 쓰여요.'
                                : '로그인하지 않고 한 판은 익명 통계에만 쓰여요.'}
                        </p>
                    </div>
                </div>
            )}
        </div>
    );
};

export default WorldcupThemes;
