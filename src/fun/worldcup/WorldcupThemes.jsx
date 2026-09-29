// 월드컵 테마 목록 (/play/worldcup) + 강수 선택 하단 시트
import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchWorldcupThemes } from '../../api_fun';
import { clearProgress, loadProgress } from './worldcupProgress';
import { getMatchState, ROUND_LABEL } from './worldcupLogic';
import '../fun.css';

const DEFAULT_SIZE = 16;

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

    const sizesFor = (theme) => theme.allowed_sizes.filter((n) => n <= theme.pool_count);

    const openSheet = (theme) => {
        const sizes = sizesFor(theme);
        setSize(sizes.includes(DEFAULT_SIZE) ? DEFAULT_SIZE : sizes[sizes.length - 1]);
        setSheetTheme(theme);
    };

    const start = () => {
        clearProgress();
        setSaved(null);
        navigate(`/play/worldcup/${sheetTheme.slug}/play?size=${size}`);
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
                        <h3 id="wc-sheet-title">몇 강으로 할까요?</h3>
                        <p className="wc-sheet-note">
                            후보 {sheetTheme.pool_count}개 중 <strong>{size}개</strong>가 무작위로 뽑혀요.
                        </p>
                        <div className="wc-size-grid">
                            {sizesFor(sheetTheme).map((n) => (
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
                            >
                                {savedLabel ? `새로 ${size}강 시작` : `${size}강 시작하기`}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default WorldcupThemes;
