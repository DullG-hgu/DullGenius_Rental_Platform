// 모두의 머더 티어 (/play/tier/murder/community) — fun_tier_community (사람별 보정, 비회원도 봄)
// 공개된 티어표 목록은 회원에게만 (이름이 붙은 정보)
import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { fetchTierPublicLists } from '../../api_fun';
import { useAuth } from '../../contexts/AuthContext';
import TierBoard, { TierCard } from './TierBoard';
import TierMethodModal from './TierMethodModal';
import { DEFAULT_MIN_SAMPLE, TIER_SLUG, TIERS } from './tierData';
import { loadCommunity, useCommunity } from './tierStore';
import '../fun.css';
import './tier.css';

const fmtDate = (iso) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '' : `${d.getMonth() + 1}월 ${d.getDate()}일`;
};

const TierCommunity = () => {
    const navigate = useNavigate();
    const { user } = useAuth();
    const { data, error } = useCommunity();
    const [detail, setDetail] = useState(null);
    const [showMethod, setShowMethod] = useState(false);
    const [people, setPeople] = useState(null);

    // 들어올 때마다 최신 집계 (방금 내 표를 고쳤을 수 있다)
    useEffect(() => { loadCommunity({ force: true }).catch(() => {}); }, []);

    useEffect(() => {
        if (!user) { setPeople(null); return undefined; }
        let active = true;
        fetchTierPublicLists(TIER_SLUG).then((r) => { if (active) setPeople(r ?? []); }).catch(() => { if (active) setPeople([]); });
        return () => { active = false; };
    }, [user]);

    const minSample = data?.min_sample ?? DEFAULT_MIN_SAMPLE;
    const items = useMemo(() => (data?.items ?? []).map((i) => ({
        ...i,
        game: { id: i.id, name: i.name, image: i.image, min_players: i.min_players, max_players: i.max_players, playingtime: i.playingtime },
    })), [data]);

    const rows = useMemo(() => {
        const r = Object.fromEntries(TIERS.map((t) => [t, []]));
        items.filter((i) => i.n >= minSample && i.tier) // 서버가 보정 평균 내림차순으로 준다
            .forEach((i) => r[i.tier].push({ game: i.game, sub: `${i.n}명${i.split ? ' · 호불호' : ''}` }));
        return r;
    }, [items, minSample]);
    const collecting = items.filter((i) => i.n < minSample);

    return (
        <div className="fun-page tier-page">
            <div className="fun-header">
                <button type="button" onClick={() => navigate(-1)} className="fun-back-btn" aria-label="뒤로가기">←</button>
                <h2 className="fun-title">모두의 머더 티어</h2>
            </div>

            {error && !data && (
                <div className="fun-status" role="alert">
                    <p>모두의 티어를 불러오지 못함</p>
                    <button type="button" onClick={() => loadCommunity({ force: true }).catch(() => {})}>다시 시도</button>
                </div>
            )}
            {!error && !data && <div className="loading-container"><div className="spinner"></div></div>}

            {data && (
                <>
                    <p className="fun-subtitle">
                        회원 {data.raters}명의 티어표 합산 · 사람별 보정 · 평가 {minSample}명 이상만{' '}
                        <button type="button" className="tier-inline-link" onClick={() => setShowMethod(true)}>집계 방식</button>
                    </p>

                    <TierBoard rows={rows} onCardClick={(g) => setDetail(items.find((i) => i.id === g.id))} />

                    {collecting.length > 0 && (
                        <div className="tier-collecting">
                            <div className="tier-section-title">평가 모으는 중 · {collecting.length}개</div>
                            <div className="tier-row-cards">
                                {collecting.map((i) => (
                                    <TierCard key={i.id} game={i.game} sub={`${i.n}명`} onClick={() => setDetail(i)} />
                                ))}
                            </div>
                        </div>
                    )}
                </>
            )}

            {user ? (
                people && (
                    <>
                        <div className="tier-section-title">공개된 티어표 · {people.length}개</div>
                        {people.length === 0 && <p className="tier-note">아직 공개한 회원 없음</p>}
                        <ul className="tier-people">
                            {people.map((p) => (
                                <li key={p.user_id}>
                                    <Link to={`/play/tier/murder/u/${p.user_id}`} className="tier-person">
                                        <span className="tier-person-name">{p.user_id === user.id ? `${p.name} (나)` : p.name}</span>
                                        <span className="tier-person-meta">{p.count}개 평가 · {fmtDate(p.updated_at)}</span>
                                    </Link>
                                </li>
                            ))}
                        </ul>
                    </>
                )
            ) : (
                <p className="tier-note tier-login-note">로그인하면 회원들이 공개한 티어표도 볼 수 있음</p>
            )}

            <Link to="/play/tier/murder" className="fun-primary-btn wc-link-btn tier-cta">내 티어표 만들기</Link>

            <TierMethodModal open={showMethod} onClose={() => setShowMethod(false)} minSample={minSample}
                globalMean={Number(data?.global_mean ?? 3)} myOffset={data?.my_offset != null ? Number(data.my_offset) : null}
                myCount={data?.my_count ?? 0} />

            {detail && (
                <div className="wc-sheet-backdrop" onClick={() => setDetail(null)}>
                    <div className="wc-sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={detail.name}>
                        <div className="wc-sheet-handle" />
                        <h3>{detail.name}</h3>
                        <p className="wc-sheet-note">
                            {detail.n}명 평가
                            {detail.n >= minSample && detail.tier
                                ? <> · <strong>{detail.tier}</strong> (보정 평균 {Number(detail.avg).toFixed(1)} · 원래 평균 {Number(detail.raw_avg).toFixed(1)})</>
                                : ' · 평가 모으는 중'}
                            {detail.split && <> · <strong>호불호</strong></>}
                            {detail.min_players ? ` · ${detail.min_players === detail.max_players
                                ? detail.min_players : `${detail.min_players}~${detail.max_players}`}인` : ''}
                            {detail.playingtime ? ` · ${detail.playingtime}` : ''}
                        </p>
                        <div className="tier-dist">
                            {TIERS.map((t) => (
                                <div key={t} className="tier-dist-row">
                                    <span className={`tier-label-badge tier-${t}`}>{t}</span>
                                    <span className="tier-dist-bar">
                                        <span className={`tier-dist-fill tier-${t}`}
                                            style={{ width: detail.n ? `${(detail.dist[t] / detail.n) * 100}%` : 0 }} />
                                    </span>
                                    <span className="tier-dist-n">{detail.dist[t]}</span>
                                </div>
                            ))}
                        </div>
                        <div className="wc-sheet-actions">
                            <Link to={`/game/${detail.id}`} className="fun-primary-btn wc-link-btn">게임 상세</Link>
                            <button type="button" className="fun-secondary-btn" onClick={() => setDetail(null)}>닫기</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default TierCommunity;
