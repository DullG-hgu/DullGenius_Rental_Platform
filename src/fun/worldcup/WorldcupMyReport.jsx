// 내 보드게임 취향 (/play/me) — 로그인한 회원 본인의 월드컵 기록만. 운영진은 이 화면을 볼 수 없다 (spec §6-2)
import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { fetchMyWorldcupProfile } from '../../api_fun';
import { useAuth } from '../../contexts/AuthContext';
import { useGameData } from '../../contexts/GameDataContext';
import '../fun.css';

const RELIABLE_RUNS = 3;
const pct = (v) => `${Math.round(v * 100)}%`;

const GameRow = ({ item, meta, status }) => (
    <li>
        <Link to={`/game/${item.id}`} className="wc-rank-row">
            {item.image
                ? <img className="wc-rank-img" src={item.image} alt="" loading="lazy" />
                : <span className="wc-rank-img is-empty" aria-hidden="true">🎲</span>}
            <span className="wc-rank-body">
                <span className="wc-rank-name">{item.name}</span>
                <span className="wc-rank-meta">
                    {meta}
                    {status && <span className={`wc-my-status${status === '대여가능' ? ' is-on' : ''}`}> · {status}</span>}
                </span>
            </span>
        </Link>
    </li>
);

const WorldcupMyReport = () => {
    const navigate = useNavigate();
    const { user, loading: authLoading } = useAuth();
    const { games } = useGameData();
    const [data, setData] = useState(null);
    const [error, setError] = useState(null);

    useEffect(() => {
        window.scrollTo(0, 0);
        if (authLoading || !user) return;
        fetchMyWorldcupProfile()
            .then(setData)
            .catch(() => setError('취향 리포트를 불러오지 못했어요.'));
    }, [authLoading, user]);

    const statusOf = (id) => games.find((g) => g.id === id)?.status;

    const header = (
        <div className="fun-header">
            <button type="button" onClick={() => navigate(-1)} className="fun-back-btn" aria-label="뒤로가기">←</button>
            <h2 className="fun-title">내 보드게임 취향</h2>
        </div>
    );

    if (authLoading) return <div className="loading-container"><div className="spinner"></div></div>;

    if (!user) {
        return (
            <div className="fun-page">
                {header}
                <div className="fun-status">
                    <p>로그인하면 월드컵에서 고른 기록으로 내 취향을 보여드려요.</p>
                    <Link to="/login" state={{ from: '/play/me' }} className="fun-primary-btn wc-link-btn">로그인하기</Link>
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="fun-page">
                {header}
                <div className="fun-status" role="alert">
                    <p>{error}</p>
                    <button type="button" onClick={() => { setError(null); fetchMyWorldcupProfile().then(setData).catch(() => setError('취향 리포트를 불러오지 못했어요.')); }}>다시 시도</button>
                </div>
            </div>
        );
    }

    if (!data) return <div className="loading-container"><div className="spinner"></div></div>;

    if (data.matches === 0) {
        return (
            <div className="fun-page">
                {header}
                <div className="fun-status">
                    <p>아직 월드컵 기록이 없어요. 한 판 해보면 취향을 모아 드릴게요.</p>
                    <Link to="/play/worldcup?theme=all-boardgames" className="fun-primary-btn wc-link-btn">월드컵 하러 가기</Link>
                </div>
                <p className="wc-my-privacy">이 리포트는 나만 볼 수 있어요. 운영진은 전체 통계만 봐요.</p>
            </div>
        );
    }

    return (
        <div className="fun-page">
            {header}
            <p className="wc-rank-summary">
                월드컵 {data.runs_total}판 (끝까지 {data.runs_finished}판) · 대결 {data.matches}번
            </p>

            {data.runs_finished < RELIABLE_RUNS && (
                <div className="wc-my-hint">
                    끝까지 {RELIABLE_RUNS}판 이상 하면 취향이 더 정확해져요. (지금 {data.runs_finished}판)
                    <Link to="/play/worldcup?theme=all-boardgames">한 판 더 →</Link>
                </div>
            )}

            {data.genres.length > 0 && (
                <section className="wc-my-section">
                    <h3>내가 끌리는 장르</h3>
                    <ul className="wc-my-genres">
                        {data.genres.map((g) => (
                            <li key={g.genre}>
                                <span className="wc-my-genre-name">{g.genre}</span>
                                <span className="wc-my-bar" aria-hidden="true"><span style={{ width: pct(g.pick_rate) }} /></span>
                                <span className="wc-my-genre-rate">{pct(g.pick_rate)}</span>
                            </li>
                        ))}
                    </ul>
                    <p className="wc-my-footnote">그 장르 게임이 대결에 나왔을 때 내가 고른 비율 (3번 이상 나온 장르만)</p>
                </section>
            )}

            {data.curious.length > 0 && (
                <section className="wc-my-section">
                    <h3>안 해봤는데 끌린 게임</h3>
                    <p className="wc-my-footnote">「안 해봄」을 누르고도 고른 게임이에요. 이번에 빌려서 해보는 건 어때요?</p>
                    <ul className="wc-rank-list">
                        {data.curious.map((it) => (
                            <GameRow key={it.id} item={it} meta={`안 해본 채로 ${it.wins}번 고름`} status={statusOf(it.id)} />
                        ))}
                    </ul>
                </section>
            )}

            {data.top_picks.length > 0 && (
                <section className="wc-my-section">
                    <h3>내가 가장 많이 고른 게임</h3>
                    <ol className="wc-rank-list">
                        {data.top_picks.map((it) => (
                            <GameRow key={it.id} item={it} meta={`${it.wins}승 ${it.losses}패`} status={statusOf(it.id)} />
                        ))}
                    </ol>
                </section>
            )}

            {data.champions.length > 0 && (
                <section className="wc-my-section">
                    <h3>내 우승작</h3>
                    <ul className="wc-rank-list">
                        {data.champions.map((it) => (
                            <GameRow key={it.id} item={it} meta={it.times > 1 ? `${it.times}번 우승` : '우승'} status={statusOf(it.id)} />
                        ))}
                    </ul>
                </section>
            )}

            <p className="wc-my-privacy">이 리포트는 나만 볼 수 있어요. 운영진은 전체 통계만 봐요.</p>
            <Link to="/play/worldcup?theme=all-boardgames" className="fun-primary-btn wc-link-btn">월드컵 한 판 더</Link>
        </div>
    );
};

export default WorldcupMyReport;
