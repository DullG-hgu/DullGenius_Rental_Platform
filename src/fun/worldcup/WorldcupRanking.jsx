// 월드컵 랭킹 (/play/worldcup/:slug/ranking) — 기본 정렬은 1:1 승률 (우승 수 정렬은 대진 운에 크게 휘둘려서)
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { fetchWorldcupRanking } from '../../api_fun';
import '../fun.css';

const pct = (v) => (v == null ? '-' : `${Math.round(v * 1000) / 10}%`);

const Row = ({ item, rank }) => (
    <li>
        <Link to={`/game/${item.id}`} className="wc-rank-row">
            <span className="wc-rank-no">{rank ?? '·'}</span>
            {item.image
                ? <img className="wc-rank-img" src={item.image} alt="" loading="lazy" />
                : <span className="wc-rank-img is-empty" aria-hidden="true">🎲</span>}
            <span className="wc-rank-body">
                <span className="wc-rank-name">{item.name}</span>
                <span className="wc-rank-meta">
                    승률 {pct(item.win_rate)} ({item.wins}승 {item.losses}패) · 우승 {item.championships}회
                </span>
            </span>
        </Link>
    </li>
);

const WorldcupRanking = () => {
    const { slug } = useParams();
    const navigate = useNavigate();
    const [scope, setScope] = useState('member');
    const [sort, setSort] = useState('win_rate');
    const [data, setData] = useState(null);
    const [error, setError] = useState(null);
    const [showUnranked, setShowUnranked] = useState(false);

    const load = useCallback(() => {
        setError(null);
        setData(null);
        fetchWorldcupRanking(slug, scope)
            .then(setData)
            .catch(() => setError('랭킹을 불러오지 못했어요.'));
    }, [slug, scope]);

    useEffect(() => { load(); }, [load]);

    const { ranked, unranked } = useMemo(() => {
        const items = data?.items ?? [];
        const r = items.filter((i) => i.ranked);
        if (sort === 'champion_rate') {
            r.sort((a, b) => (b.champion_rate ?? -1) - (a.champion_rate ?? -1) || b.championships - a.championships);
        }
        return { ranked: r, unranked: items.filter((i) => !i.ranked) };
    }, [data, sort]);

    return (
        <div className="fun-page">
            <div className="fun-header">
                <button type="button" onClick={() => navigate(-1)} className="fun-back-btn" aria-label="뒤로가기">←</button>
                <h2 className="fun-title">랭킹</h2>
            </div>

            <div className="wc-tabs" role="tablist" aria-label="집계 범위">
                {[['member', '회원'], ['all', '전체']].map(([key, label]) => (
                    <button key={key} type="button" role="tab" aria-selected={scope === key}
                        className="wc-tab" onClick={() => setScope(key)}>
                        {label}
                    </button>
                ))}
            </div>
            <div className="wc-sort" role="group" aria-label="정렬">
                {[['win_rate', '1:1 승률순'], ['champion_rate', '우승률순']].map(([key, label]) => (
                    <button key={key} type="button" aria-pressed={sort === key}
                        className="wc-sort-btn" onClick={() => setSort(key)}>
                        {label}
                    </button>
                ))}
            </div>

            {error && (
                <div className="fun-status" role="alert">
                    <p>{error}</p>
                    <button type="button" onClick={load}>다시 시도</button>
                </div>
            )}

            {!error && !data && <div className="loading-container"><div className="spinner"></div></div>}

            {data && (
                <>
                    <p className="wc-rank-summary">
                        {data.title} · 완료 {data.total_runs.toLocaleString()}판 기준
                        {scope === 'member' ? ' (로그인한 회원)' : ''}
                    </p>

                    {ranked.length === 0 && (
                        <p className="fun-status">
                            아직 순위를 매길 만큼 대결이 쌓이지 않았어요.
                            {' '}게임마다 {data.min_matches}번 이상 대결하면 순위에 올라가요.
                        </p>
                    )}

                    <ol className="wc-rank-list">
                        {ranked.map((item, i) => <Row key={item.id} item={item} rank={i + 1} />)}
                    </ol>

                    {unranked.length > 0 && (
                        <div className="wc-unranked">
                            <button type="button" className="wc-text-link" onClick={() => setShowUnranked((v) => !v)}>
                                대결이 {data.min_matches}번 미만인 게임 {unranked.length}개 {showUnranked ? '접기' : '보기'}
                            </button>
                            {showUnranked && (
                                <ul className="wc-rank-list">
                                    {unranked.map((item) => <Row key={item.id} item={item} />)}
                                </ul>
                            )}
                        </div>
                    )}

                    <Link to="/play/worldcup" className="fun-primary-btn wc-link-btn wc-rank-cta">나도 월드컵 하기</Link>
                </>
            )}
        </div>
    );
};

export default WorldcupRanking;
