// 월드컵 결과 (/play/worldcup/r/:runId) — 방금 끝낸 판이면 제출 응답을 그대로, 공유 링크면 서버에서 조회
import React, { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { fetchWorldcupRun } from '../../api_fun';
import { useGameData } from '../../contexts/GameDataContext';
import { useToast } from '../../contexts/ToastContext';
import { ROUND_LABEL } from './worldcupLogic';
import '../fun.css';

const percent = (n, d) => (d > 0 ? Math.round((n / d) * 1000) / 10 : 0);

const WorldcupResult = () => {
    const { runId } = useParams();
    const location = useLocation();
    const navigate = useNavigate();
    const { showToast } = useToast();
    const { games } = useGameData();

    const fresh = location.state?.fresh === true;
    const [result, setResult] = useState(location.state?.result ?? undefined);
    const [error, setError] = useState(null);

    useEffect(() => {
        window.scrollTo(0, 0);
        if (result !== undefined) return;
        fetchWorldcupRun(runId)
            .then((data) => setResult(data))
            .catch(() => setError('결과를 불러오지 못했어요.'));
    }, [runId, result]);

    if (error) {
        return (
            <div className="fun-page">
                <div className="fun-status" role="alert">
                    <p>{error}</p>
                    <button type="button" onClick={() => { setError(null); setResult(undefined); }}>다시 시도</button>
                </div>
            </div>
        );
    }

    if (result === undefined) {
        return <div className="loading-container"><div className="spinner"></div></div>;
    }

    if (result === null) {
        return (
            <div className="fun-page">
                <div className="fun-status">
                    <p>결과를 찾을 수 없어요. 아직 끝나지 않은 판이거나 잘못된 링크예요.</p>
                    <Link to="/play/worldcup" className="fun-primary-btn wc-link-btn">월드컵 하러 가기</Link>
                </div>
            </div>
        );
    }

    const { champion, champion_stats: stats, path } = result;
    const game = games.find((g) => g.id === champion.id);
    const rentable = game?.status === '대여가능';
    const shareUrl = `${window.location.origin}/play/worldcup/r/${result.run_id}`;

    const share = async () => {
        const text = `나의 보드게임 원픽은 「${champion.name}」! 너의 원픽은?`;
        try {
            if (navigator.share) {
                await navigator.share({ title: result.title, text, url: shareUrl });
                return;
            }
            await navigator.clipboard.writeText(`${text}\n${shareUrl}`);
            showToast('결과 링크를 복사했어요.');
        } catch (e) {
            if (e?.name !== 'AbortError') showToast('공유하지 못했어요. 주소창의 링크를 복사해 주세요.', { type: 'error' });
        }
    };

    const players = champion.min_players
        ? (champion.min_players === champion.max_players || !champion.max_players
            ? `${champion.min_players}인`
            : `${champion.min_players}~${champion.max_players}인`)
        : null;

    return (
        <div className="fun-page wc-result">
            <div className="fun-header">
                <button type="button" onClick={() => navigate('/play/worldcup')} className="fun-back-btn" aria-label="월드컵 목록으로">←</button>
                <h2 className="fun-title">{fresh ? '나의 원픽' : '친구의 원픽'}</h2>
            </div>

            <div className="wc-result-card">
                <div className="wc-result-badge">
                    🏆 {ROUND_LABEL(result.size)} 최종 우승
                    {result.entrants < result.size && <span className="wc-result-entrants"> · {result.entrants}개 참가</span>}
                </div>
                {champion.image
                    ? <img className="wc-result-img" src={champion.image} alt="" />
                    : <div className="wc-result-img is-empty" aria-hidden="true">🎲</div>}
                <div className="wc-result-name">{champion.name ?? '삭제된 게임'}</div>
                <div className="wc-card-meta">{[players, champion.playingtime].filter(Boolean).join(' · ')}</div>
                {game && (
                    <div className={`wc-rent-badge${rentable ? ' is-available' : ''}`}>
                        {rentable ? '지금 빌릴 수 있어요' : `지금은 ${game.status}`}
                    </div>
                )}
            </div>

            {result.champion_unplayed && (
                <p className="wc-unplayed-note">
                    {fresh ? '안 해본 게임이 우승했어요!' : '안 해본 게임을 원픽으로 골랐어요!'}
                    {rentable ? ' 이번 기회에 빌려서 해보세요.' : ' 다음에 꼭 해보세요.'}
                </p>
            )}

            <div className="wc-result-stats">
                <div>
                    <strong>{percent(stats.championships, stats.total_runs)}%</strong>
                    <span>우승 비율 ({stats.championships}/{stats.total_runs}판)</span>
                </div>
                <div>
                    <strong>{stats.wins}승 {stats.losses}패</strong>
                    <span>지금까지 1:1 전적</span>
                </div>
            </div>

            {path.length > 0 && (
                <section className="wc-result-path">
                    <h3>우승까지 이긴 게임</h3>
                    <ol>
                        {path.map((p) => (
                            <li key={p.round_size}>
                                <span className="wc-path-round">{ROUND_LABEL(p.round_size)}</span>
                                <span className="wc-path-name">{p.opponent.name ?? '삭제된 게임'}</span>
                            </li>
                        ))}
                    </ol>
                </section>
            )}

            <div className="wc-result-actions">
                {champion.name && (
                    <Link to={`/game/${champion.id}`} className="fun-primary-btn wc-link-btn">
                        {rentable ? '이 게임 빌리러 가기' : '이 게임 자세히 보기'}
                    </Link>
                )}
                {fresh ? (
                    <div className="wc-result-actions-row">
                        <button type="button" className="fun-secondary-btn" onClick={share}>결과 공유하기</button>
                        <Link to={`/play/worldcup/${result.slug}/play?size=${result.size}`} className="fun-secondary-btn wc-link-btn">다시 하기</Link>
                    </div>
                ) : (
                    <Link to="/play/worldcup" className="fun-secondary-btn wc-link-btn">나도 해보기</Link>
                )}
                <Link to={`/play/worldcup/${result.slug}/ranking`} className="wc-text-link">전체 랭킹 보기 →</Link>
            </div>
        </div>
    );
};

export default WorldcupResult;
