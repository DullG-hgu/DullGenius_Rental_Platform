// 월드컵 대결 화면 (/play/worldcup/:slug/play?size=16 | ?resume=1)
// 대진·위아래 배치는 서버(fun_wc_start)가 정한 그대로 쓴다. 고를 때마다 fun_wc_record 로 진행분을 보내고(응답 대기 없음),
// 마지막 선택에서 fun_wc_finish 로 우승을 확정한다.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { finishWorldcup, recordWorldcupPicks, startWorldcup } from '../../api_fun';
import { getMatchState, getUpcomingCandidates, ROUND_LABEL } from './worldcupLogic';
import { clearProgress, loadProgress, saveProgress } from './worldcupProgress';
import '../fun.css';

const PICK_ANIMATION_MS = 380;

const playerText = (c) => {
    if (!c.min_players && !c.max_players) return null;
    if (c.min_players === c.max_players || !c.max_players) return `${c.min_players}인`;
    return `${c.min_players ?? 1}~${c.max_players}인`;
};

const Card = ({ candidate, state, onPick, disabled }) => {
    const meta = [playerText(candidate), candidate.playingtime].filter(Boolean).join(' · ');
    return (
        <button
            type="button"
            className={`wc-card${state ? ` is-${state}` : ''}`}
            onClick={() => onPick(candidate.id)}
            disabled={disabled}
            aria-label={`${candidate.name} 선택`}
        >
            {candidate.image
                ? <img className="wc-card-img" src={candidate.image} alt="" draggable="false" />
                : <div className="wc-card-img is-empty" aria-hidden="true">🎲</div>}
            <div className="wc-card-name">{candidate.name}</div>
            {meta && <div className="wc-card-meta">{meta}</div>}
        </button>
    );
};

const WorldcupPlay = () => {
    const { slug } = useParams();
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();

    const [run, setRun] = useState(null);
    const [picks, setPicks] = useState([]);
    const [error, setError] = useState(null);
    const [chosenId, setChosenId] = useState(null);
    const [submitting, setSubmitting] = useState(false);
    const [submitError, setSubmitError] = useState(null);

    const startedRef = useRef(false);
    const matchShownAt = useRef(Date.now());

    // 판 준비: 이어하기면 기기 저장분, 아니면 서버에서 새 판 발급
    useEffect(() => {
        if (startedRef.current) return; // StrictMode 이중 실행 방지 (판이 두 번 발급되지 않게)
        startedRef.current = true;

        if (searchParams.get('resume') === '1') {
            const saved = loadProgress(slug);
            if (saved) {
                setRun(saved.run);
                setPicks(saved.picks);
            } else {
                setError('이어할 판이 없어요. 새로 시작해 주세요.');
            }
            return;
        }

        const size = Number(searchParams.get('size'));
        startWorldcup(slug, size)
            .then((data) => {
                setRun(data);
                saveProgress(data, []);
            })
            .catch((e) => setError(e?.message || '월드컵을 시작하지 못했어요.'));
    }, [slug, searchParams]);

    const state = useMemo(() => {
        if (!run) return null;
        try {
            return getMatchState(run.candidates, run.top_first, picks);
        } catch {
            return { invalid: true };
        }
    }, [run, picks]);

    useEffect(() => {
        if (state?.invalid) {
            clearProgress();
            setError('저장된 진행 상태가 올바르지 않아요. 새로 시작해 주세요.');
        }
    }, [state]);

    // 다음 대결 이미지 미리 받기 (한 판 전체 이미지를 한꺼번에 받지 않는다)
    useEffect(() => {
        if (!run || !state || state.done || state.invalid) return;
        matchShownAt.current = Date.now();
        getUpcomingCandidates(run.candidates, run.top_first, picks).forEach((c) => {
            if (c.image) {
                const img = new Image();
                img.src = c.image;
            }
        });
    }, [run, state, picks]);

    const submit = useCallback((finalPicks) => {
        setSubmitting(true);
        setSubmitError(null);
        finishWorldcup(run.run_id, finalPicks)
            .then((result) => {
                clearProgress();
                navigate(`/play/worldcup/r/${run.run_id}`, { replace: true, state: { result, fresh: true } });
            })
            .catch((e) => {
                setSubmitting(false);
                setSubmitError(e?.message || '결과를 저장하지 못했어요.');
            });
    }, [run, navigate]);

    const pick = (id) => {
        if (chosenId !== null || !state || state.done) return;
        const ms = Date.now() - matchShownAt.current;
        setChosenId(id);
        setTimeout(() => {
            const next = [...picks, { w: id, ms }];
            setPicks(next);
            setChosenId(null);
            saveProgress(run, next);
            if (next.length === state.totalMatches) submit(next);
            else recordWorldcupPicks(run.run_id, next); // 끝까지 안 하고 꺼도 여기까지의 대결은 남는다
        }, PICK_ANIMATION_MS);
    };

    const exit = () => navigate('/play/worldcup');

    if (error) {
        return (
            <div className="wc-play">
                <div className="wc-play-status" role="alert">
                    <p>{error}</p>
                    <button type="button" className="fun-secondary-btn" onClick={exit}>월드컵 목록으로</button>
                </div>
            </div>
        );
    }

    if (!run || !state || state.invalid) {
        return <div className="loading-container"><div className="spinner"></div></div>;
    }

    if (state.done) {
        return (
            <div className="wc-play">
                <div className="wc-play-status" role={submitError ? 'alert' : 'status'}>
                    {submitError ? (
                        <>
                            <p>{submitError}</p>
                            <button type="button" className="fun-primary-btn" onClick={() => submit(picks)}>다시 저장하기</button>
                        </>
                    ) : (
                        <>
                            <div className="spinner" />
                            <p>{submitting ? '결과를 모으는 중…' : '마무리하는 중…'}</p>
                        </>
                    )}
                </div>
            </div>
        );
    }

    const percent = Math.round((state.index / state.totalMatches) * 100);
    const cardState = (id) => {
        if (chosenId === null) return null;
        return chosenId === id ? 'winner' : 'loser';
    };

    return (
        <div className="wc-play">
            <div className="wc-play-top">
                <button type="button" className="wc-exit-btn" onClick={exit}>← 나가기</button>
                <div className="wc-round" aria-live="polite">
                    {ROUND_LABEL(state.roundSize)}
                    {state.roundSize > 2 && <small>{state.matchNo}/{state.roundMatches}</small>}
                </div>
                <div className="wc-percent">{percent}%</div>
            </div>
            <div className="wc-progress" aria-hidden="true">
                <div className="wc-progress-fill" style={{ width: `${percent}%` }} />
            </div>

            <div className="wc-arena" key={state.index}>
                <Card candidate={state.top} state={cardState(state.top.id)} onPick={pick} disabled={chosenId !== null} />
                <Card candidate={state.bottom} state={cardState(state.bottom.id)} onPick={pick} disabled={chosenId !== null} />
                <div className="wc-vs" aria-hidden="true">VS</div>
            </div>
        </div>
    );
};

export default WorldcupPlay;
