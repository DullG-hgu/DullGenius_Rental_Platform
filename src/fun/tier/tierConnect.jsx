// 티어표 연결 지점 (spec_fun_tier.md §13) — 게임 상세 카드·검색 칩·리뷰 작성자 뱃지·마이페이지 대여 기록
// 데이터는 tierStore (내 표·모두의 티어 세션 캐시) 를 함께 쓴다
import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchTierBadges } from '../../api_fun';
import { useAuth } from '../../contexts/AuthContext';
import { DEFAULT_MIN_SAMPLE, isMurder, TIER_GUIDE, TIERS } from './tierData';
import { placeMyTier, useCommunity, useMyTier } from './tierStore';
import './tierConnect.css';

export { isMurder };

// 머더 전체 집계 — 게임 id(문자열) → { tier, n, split, dist, ready }
export const useTierSummary = () => {
    const { data } = useCommunity();
    return useMemo(() => {
        const min = data?.min_sample ?? DEFAULT_MIN_SAMPLE;
        return new Map((data?.items ?? []).map((i) => [String(i.id), { ...i, ready: i.n >= min && !!i.tier }]));
    }, [data]);
};

// 검색 카드용 작은 칩 — 표본이 찬 게임만. 호불호는 「A±」
export const TierChip = ({ item }) => {
    if (!item?.ready) return null;
    return (
        <span className={`tier-chip tier-${item.tier}`} title={`모두의 티어 ${item.tier} · ${item.n}명${item.split ? ' · 호불호' : ''}`}>
            {item.tier}{item.split ? '±' : ''}
        </span>
    );
};

// 게임 상세 티어 카드 — 왼쪽 모두의 티어(등급·인원·S~D 분포), 오른쪽 내 티어(없으면 「평가하러 가기」)
export const GameTierCard = ({ game }) => {
    const { user } = useAuth();
    const summary = useTierSummary();
    const { mine } = useMyTier(user?.id);
    const item = summary.get(String(game.id));
    const myTier = user ? mine.placements[String(game.id)] : null;
    const ready = !!item?.ready;
    const dist = item?.dist ?? {};
    const max = Math.max(1, ...TIERS.map((t) => dist[t] ?? 0));

    return (
        <div className="score-card score-card-tier">
            <Link to="/play/tier/murder/community" className="score-card-all"
                aria-label={ready ? `모두의 티어 ${item.tier}, ${item.n}명${item.split ? ', 호불호' : ''}` : '모두의 티어 평가 모으는 중'}>
                <span className="score-card-head">
                    <span className={`score-card-grade tier-${ready ? item.tier : 'none'}`}>{ready ? item.tier : '?'}</span>
                    <span className="score-card-meta">
                        <strong>모두의 티어</strong>
                        <span>{ready ? `${item.n}명 평가` : `모으는 중 · ${item?.n ?? 0}명`}</span>
                    </span>
                    {item?.split && ready && <span className="score-card-split">호불호</span>}
                </span>
                <span className="score-card-bars" aria-hidden="true">
                    {TIERS.map((t) => (
                        <span key={t} className="score-card-row">
                            <span className="score-card-label">{t}</span>
                            <span className="score-card-track">
                                <span className={`score-card-fill tier-${t}`} style={{ width: `${((dist[t] ?? 0) / max) * 100}%` }} />
                            </span>
                            <span className="score-card-count">{dist[t] ?? 0}</span>
                        </span>
                    ))}
                </span>
            </Link>

            <Link to={`/play/tier/murder?game=${game.id}`} className={`score-card-mine${myTier ? '' : ' is-empty'}`}>
                <strong>내 티어</strong>
                {myTier ? (
                    <>
                        <span className={`score-card-grade tier-${myTier}`}>{myTier}</span>
                        <span className="score-card-mine-sub">바꾸기 →</span>
                    </>
                ) : (
                    <>
                        <span className="score-card-grade tier-none">–</span>
                        <span className="score-card-mine-go">평가하러 가기 →</span>
                    </>
                )}
            </Link>
        </div>
    );
};

// 마이페이지 반납 기록 — 한 번 탭으로 내 티어에 올리기 (줄 맨 끝). 리뷰 별점과는 무관
export const TierQuickPlace = ({ game, title }) => {
    const { user } = useAuth();
    const { mine, status } = useMyTier(user?.id);
    const current = mine.placements[String(game.id)];
    const [pick, setPick] = useState(current ?? null);
    const [saved, setSaved] = useState(false);

    useEffect(() => { if (!saved) setPick(current ?? null); }, [current, saved]);

    const save = () => {
        if (!pick) return;
        placeMyTier(game.id, pick);
        setSaved(true);
    };

    if (saved) {
        return (
            <div className="tier-quick is-saved">
                내 티어표에 <b className={`tier-quick-saved tier-${pick}`}>{pick}</b>로 올림 ·{' '}
                <Link to="/play/tier/murder">줄 안 순서 정하기 →</Link>
            </div>
        );
    }

    return (
        <div className="tier-quick">
            <div className="tier-quick-title">
                {title ?? (current ? `내 티어 ${current} · 바꾸기` : '티어표에 올리기')}
            </div>
            <div className="tier-quick-chips" role="radiogroup" aria-label="티어">
                {TIERS.map((t) => (
                    <button key={t} type="button" role="radio" aria-checked={pick === t}
                        className={`tier-quick-chip tier-${t}${pick === t ? ' is-picked' : ''}`}
                        onClick={() => setPick(t)} title={TIER_GUIDE[t]}>
                        {t}
                    </button>
                ))}
            </div>
            {pick && <div className="tier-quick-guide">{pick} · {TIER_GUIDE[pick]}</div>}
            <button type="button" className="tier-quick-save" disabled={!pick || pick === current || status !== 'ready'} onClick={save}>
                {current ? '바꾸기' : '올리기'}
            </button>
        </div>
    );
};

// 리뷰 작성자의 이 게임 티어 — 티어표를 공개한 회원만, 로그인한 사람에게만 (fun_tier_public_badges)
export const useTierBadges = (game, reviews) => {
    const { user } = useAuth();
    const [badges, setBadges] = useState({});
    const gameId = isMurder(game) ? game.id : null;
    const ids = useMemo(() => (reviews ?? []).map((r) => r.user_id).filter(Boolean).join(','), [reviews]);
    useEffect(() => {
        if (!user || !gameId || !ids) { setBadges({}); return undefined; }
        let active = true;
        fetchTierBadges(gameId, ids.split(','))
            .then((b) => { if (active) setBadges(b || {}); })
            .catch(() => { if (active) setBadges({}); });
        return () => { active = false; };
    }, [user, gameId, ids]);
    return badges;
};

export const ReviewerTierBadge = ({ tier }) => (tier
    ? <span className={`tier-review-badge tier-${tier}`} title="이 회원의 공개 티어표 등급">티어 {tier}</span>
    : null);
