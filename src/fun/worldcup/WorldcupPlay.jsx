// 월드컵 대결 화면 (/play/worldcup/:slug/play?size=16 | ?resume=1)
// 대진·위아래 배치는 서버(fun_wc_start)가 정한 그대로 쓴다. 고를 때마다 fun_wc_record 로 진행분을 보내고(응답 대기 없음),
// 마지막 선택에서 fun_wc_finish 로 우승을 확정한다.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { fetchWorldcupPrefill, finishWorldcup, recordWorldcupPicks, reportGameInfo, startWorldcup } from '../../api_fun';
import { useToast } from '../../contexts/ToastContext';
import { useGameData } from '../../contexts/GameDataContext';
import { translateGenre } from '../../constants/genreMap';
import { getMatchState, getUpcomingCandidates, ROUND_LABEL } from './worldcupLogic';
import { clearProgress, GUEST_TTL_MS, loadProgress, MEMBER_TTL_MS, saveProgress } from './worldcupProgress';
import { useAuth } from '../../contexts/AuthContext';
import '../fun.css';

const PICK_ANIMATION_MS = 380;

const playerText = (c) => {
    if (!c.min_players && !c.max_players) return null;
    if (c.min_players === c.max_players || !c.max_players) return `${c.min_players}인`;
    return `${c.min_players ?? 1}~${c.max_players}인`;
};

const REPORT_FIELDS = [
    ['players', '인원수'],
    ['playtime', '플레이 시간'],
    ['image', '이미지'],
    ['name', '이름'],
    ['other', '기타'],
];

// 신고 당시 화면에 보인 값 — 운영진이 무엇을 보고 신고했는지 알 수 있게 같이 보낸다
const shownValueFor = (c, field) => {
    if (field === 'players') return playerText(c);
    if (field === 'playtime') return c.playingtime ?? null;
    if (field === 'name') return c.name;
    if (field === 'image') return c.image ? '이미지' : '이미지 없음';
    return null;
};

// 게임 정보 오류 신고 시트 (선택은 멈춘 채로 열린다)
const ReportSheet = ({ candidate, onClose }) => {
    const { showToast } = useToast();
    const [field, setField] = useState(null);
    const [note, setNote] = useState('');
    const [sending, setSending] = useState(false);
    const needsNote = field === 'other' && !note.trim();

    const send = () => {
        setSending(true);
        reportGameInfo({ gameId: candidate.id, field, note: note.trim() || null, shownValue: shownValueFor(candidate, field) })
            .then(() => {
                showToast('고마워요! 운영진이 확인할게요.');
                onClose();
            })
            .catch((e) => {
                setSending(false);
                showToast(e?.message || '신고를 보내지 못했어요.', { type: 'error' });
            });
    };

    return (
        <div className="wc-sheet-backdrop" onClick={onClose}>
            <div className="wc-sheet" role="dialog" aria-modal="true" aria-labelledby="wc-report-title" onClick={(e) => e.stopPropagation()}>
                <div className="wc-sheet-handle" aria-hidden="true" />
                <h3 id="wc-report-title">「{candidate.name}」 정보가 이상해요</h3>
                <p className="wc-sheet-note">어떤 정보가 틀렸나요? 운영진이 확인해서 고칠게요.</p>
                <div className="wc-report-fields" role="group" aria-label="틀린 항목">
                    {REPORT_FIELDS.map(([key, label]) => (
                        <button key={key} type="button" className="wc-players-btn" aria-pressed={field === key} onClick={() => setField(key)}>
                            {label}
                        </button>
                    ))}
                </div>
                {field && field !== 'other' && shownValueFor(candidate, field) && field !== 'image' && (
                    <p className="wc-sheet-note">지금 표시: <strong>{shownValueFor(candidate, field)}</strong></p>
                )}
                <textarea
                    className="wc-report-note"
                    value={note}
                    onChange={(e) => setNote(e.target.value.slice(0, 200))}
                    placeholder={field === 'other' ? '어떤 점이 이상한지 적어 주세요' : '맞는 정보를 알면 적어 주세요 (선택)'}
                    rows={3}
                    aria-label="메모"
                />
                <div className="wc-sheet-actions">
                    <button type="button" className="fun-primary-btn" onClick={send} disabled={!field || needsNote || sending}>
                        {sending ? '보내는 중…' : '신고 보내기'}
                    </button>
                    <button type="button" className="wc-text-link" onClick={onClose}>취소</button>
                </div>
            </div>
        </div>
    );
};

// 상세 정보 시트 — 대결 화면을 벗어나지 않고 게임 정보를 본다. 정보가 틀렸으면 여기서 바로 신고.
// 게임 정보는 앱이 이미 불러둔 게임 목록(GameDataContext)을 쓴다 (추가 요청 없음)
const DetailSheet = ({ candidate, onClose, onReport }) => {
    const { games } = useGameData();
    const game = games.find((g) => g.id === candidate.id) ?? candidate;
    const genres = (game.genres ?? []).map(translateGenre).filter(Boolean);
    const rentable = game.status === '대여가능';

    return (
        <div className="wc-sheet-backdrop" onClick={onClose}>
            <div className="wc-sheet wc-detail" role="dialog" aria-modal="true" aria-labelledby="wc-detail-title" onClick={(e) => e.stopPropagation()}>
                <div className="wc-sheet-handle" aria-hidden="true" />
                <div className="wc-detail-head">
                    {game.image
                        ? <img className="wc-detail-img" src={game.image} alt="" />
                        : <div className="wc-detail-img is-empty" aria-hidden="true">🎲</div>}
                    <div className="wc-detail-body">
                        <h3 id="wc-detail-title">{game.name}</h3>
                        <ul className="wc-detail-facts">
                            <li>👥 {playerText(game) ?? '인원 정보 없음'}</li>
                            {game.playingtime && <li>⏱ {game.playingtime}</li>}
                            {game.difficulty ? <li>🧩 난이도 {Number(game.difficulty).toFixed(1)} / 5</li> : null}
                        </ul>
                        {game.status && (
                            <span className={`wc-detail-status${rentable ? ' is-on' : ''}`}>
                                {rentable ? '지금 빌릴 수 있어요' : game.status}
                            </span>
                        )}
                    </div>
                </div>
                {genres.length > 0 && (
                    <div className="wc-detail-genres">
                        {genres.map((g) => <span key={g}>{g}</span>)}
                    </div>
                )}
                {game.recommendation_text && <p className="wc-detail-reco">💡 {game.recommendation_text}</p>}
                <div className="wc-detail-actions">
                    <a href={`/game/${game.id}`} target="_blank" rel="noopener noreferrer" className="fun-secondary-btn wc-link-btn">
                        게임 페이지 ↗
                    </a>
                    <button type="button" className="fun-primary-btn" onClick={onClose}>대결로 돌아가기</button>
                </div>
                <button type="button" className="wc-text-link wc-detail-report" onClick={() => onReport(candidate)}>
                    ⚠ 정보가 이상해요
                </button>
            </div>
        </div>
    );
};

// 카드 선택 버튼과 「안 해봄」 칩·ⓘ 상세 버튼은 형제 요소 — 눌러도 선택되지 않는다
const Card = ({ candidate, state, onPick, disabled, unplayed, onToggleUnplayed, onDetail }) => {
    const meta = [playerText(candidate), candidate.playingtime].filter(Boolean).join(' · ');
    return (
        <div className={`wc-card-wrap${state ? ` is-${state}` : ''}`}>
            <button
                type="button"
                className="wc-card"
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
            <button
                type="button"
                className="wc-unplayed-chip"
                aria-pressed={unplayed}
                aria-label={`${candidate.name} 안 해봤어요`}
                onClick={() => onToggleUnplayed(candidate.id)}
                disabled={disabled}
            >
                {unplayed ? '안 해봄 ✓' : '안 해봄'}
            </button>
            <button
                type="button"
                className="wc-detail-btn"
                aria-label={`${candidate.name} 상세 정보 보기`}
                onClick={() => onDetail(candidate)}
                disabled={disabled}
            >
                ⓘ 상세
            </button>
        </div>
    );
};

const WorldcupPlay = () => {
    const { slug } = useParams();
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    const { user } = useAuth();
    // 로그인 판은 3일, 비로그인 판은 5시간 동안 이어하기
    const persist = (r, p, u) => saveProgress(r, p, u, user ? MEMBER_TTL_MS : GUEST_TTL_MS);

    const [run, setRun] = useState(null);
    const [picks, setPicks] = useState([]);
    const [unplayed, setUnplayed] = useState(() => new Set()); // 이 판에서 「안 해봄」 표시한 게임 id
    const [reportTarget, setReportTarget] = useState(null);
    const [detailTarget, setDetailTarget] = useState(null);
    const [canUndo, setCanUndo] = useState(false); // 직전 한 단계만 되돌릴 수 있다 (되돌린 뒤엔 새로 골라야 다시 가능)
    const [error, setError] = useState(null);
    const [chosenId, setChosenId] = useState(null);
    const [submitting, setSubmitting] = useState(false);
    const [submitError, setSubmitError] = useState(null);

    const startedRef = useRef(false);
    const matchShownAt = useRef(Date.now());
    const prefilledRef = useRef(new Set()); // 서버가 미리 켜 준 「안 해봄」 — 이걸 끄고 고르면 "해봤음"(p)으로 보낸다

    // 회원: 지난 판들에서 「안 해봄」 표시한 게임을 이 판에서도 미리 켠다. 실패해도 플레이엔 영향 없음
    useEffect(() => {
        if (!run?.run_id || !user) return;
        let cancelled = false;
        fetchWorldcupPrefill(run.run_id)
            .then((ids) => {
                if (cancelled || !Array.isArray(ids) || ids.length === 0) return;
                prefilledRef.current = new Set(ids);
                setUnplayed((prev) => new Set([...prev, ...ids]));
            })
            .catch(() => {});
        return () => { cancelled = true; };
    }, [run?.run_id, user]);

    // 판 준비: 이어하기면 기기 저장분, 아니면 서버에서 새 판 발급
    useEffect(() => {
        if (startedRef.current) return; // StrictMode 이중 실행 방지 (판이 두 번 발급되지 않게)
        startedRef.current = true;

        if (searchParams.get('resume') === '1') {
            const saved = loadProgress(slug);
            if (saved) {
                setRun(saved.run);
                setPicks(saved.picks);
                setUnplayed(new Set(saved.unplayed ?? []));
            } else {
                setError('이어할 판이 없어요. 새로 시작해 주세요.');
            }
            return;
        }

        const size = Number(searchParams.get('size'));
        const players = Number(searchParams.get('players')) || null;
        startWorldcup(slug, size, players)
            .then((data) => {
                setRun(data);
                persist(data, [], []);
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

    const toggleUnplayed = (id) => {
        setUnplayed((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            persist(run, picks, [...next]);
            return next;
        });
    };

    const pick = (id) => {
        if (chosenId !== null || reportTarget || detailTarget || !state || state.done) return;
        const ms = Date.now() - matchShownAt.current;
        const pair = [state.top.id, state.bottom.id];
        const u = pair.filter((gid) => unplayed.has(gid));
        const p = pair.filter((gid) => prefilledRef.current.has(gid) && !unplayed.has(gid));
        setChosenId(id);
        setTimeout(() => {
            const next = [...picks, { w: id, ms, ...(u.length ? { u } : {}), ...(p.length ? { p } : {}) }];
            setPicks(next);
            setChosenId(null);
            setCanUndo(true);
            persist(run, next, [...unplayed]);
            if (next.length === state.totalMatches) submit(next);
            else recordWorldcupPicks(run.run_id, next); // 끝까지 안 하고 꺼도 여기까지의 대결은 남는다
        }, PICK_ANIMATION_MS);
    };

    // 방금 선택 되돌리기: 직전 대결로 돌아간다. 서버에도 줄어든 목록을 보내 그 선택을 지운다(되돌림 기록에 남음)
    const undo = () => {
        if (!canUndo || chosenId !== null || reportTarget || detailTarget || picks.length === 0 || submitting) return;
        const prev = picks.slice(0, -1);
        setPicks(prev);
        setCanUndo(false);
        persist(run, prev, [...unplayed]);
        recordWorldcupPicks(run.run_id, prev);
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
                {[state.top, state.bottom].map((c) => (
                    <Card
                        key={c.id}
                        candidate={c}
                        state={cardState(c.id)}
                        onPick={pick}
                        disabled={chosenId !== null}
                        unplayed={unplayed.has(c.id)}
                        onToggleUnplayed={toggleUnplayed}
                        onDetail={setDetailTarget}
                    />
                ))}
                <div className="wc-vs" aria-hidden="true">VS</div>
            </div>
            <div className="wc-play-bottom">
                <button
                    type="button"
                    className="wc-undo-btn"
                    onClick={undo}
                    disabled={!canUndo || chosenId !== null}
                >
                    ↶ 방금 선택 되돌리기
                </button>
            </div>
            {detailTarget && !reportTarget && (
                <DetailSheet
                    candidate={detailTarget}
                    onClose={() => setDetailTarget(null)}
                    onReport={(c) => { setDetailTarget(null); setReportTarget(c); }}
                />
            )}
            {reportTarget && <ReportSheet candidate={reportTarget} onClose={() => setReportTarget(null)} />}
        </div>
    );
};

export default WorldcupPlay;
