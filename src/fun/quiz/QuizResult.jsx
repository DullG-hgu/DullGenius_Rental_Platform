// 성향검사 결과 (/play/quiz/r/:id) — 본인 결과만. 서버가 채점·저장한 four/eight/code 로 그린다 (spec §3).
import React, { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { deleteQuizResult, fetchQuizResult } from '../../api_fun';
import ConfirmModal from '../../components/ConfirmModal';
import { useAuth } from '../../contexts/AuthContext';
import { useGameData } from '../../contexts/GameDataContext';
import { axisLines, extraBlocks, familyGames, familyName } from './quizLogic';
import { AXES8, DISPLAY, EIGHT_POLES } from './quizData';
import QuizBar from './QuizBar';
import '../fun.css';
import './quiz.css';

const formatDate = (iso) => new Date(iso).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' });

const GameRow = ({ game, meta, info }) => (
    <li>
        <Link to={`/game/${game.id}`} className="wc-rank-row">
            {info?.image
                ? <img className="wc-rank-img" src={info.image} alt="" loading="lazy" />
                : <span className="wc-rank-img is-empty" aria-hidden="true">🎲</span>}
            <span className="wc-rank-body">
                <span className="wc-rank-name">{game.name}</span>
                <span className="wc-rank-meta">
                    {meta}
                    {info?.status && <span className={`wc-my-status${info.status === '대여가능' ? ' is-on' : ''}`}> · {info.status}</span>}
                </span>
            </span>
        </Link>
    </li>
);

const QuizResult = () => {
    const { id } = useParams();
    const navigate = useNavigate();
    const location = useLocation();
    const { user, loading: authLoading } = useAuth();
    const { games } = useGameData();
    const [result, setResult] = useState(location.state?.result?.id === id ? location.state.result : null);
    const [error, setError] = useState(null);
    const [showEight, setShowEight] = useState(false);
    const [confirmDelete, setConfirmDelete] = useState(false);

    useEffect(() => {
        window.scrollTo(0, 0);
        if (result || authLoading || !user) return;
        fetchQuizResult(id)
            .then((r) => (r ? setResult(r) : setError('결과를 찾을 수 없어요. 내 결과만 볼 수 있어요.')))
            .catch(() => setError('결과를 불러오지 못했어요.'));
    }, [id, result, authLoading, user]);

    const header = (
        <div className="fun-header">
            <button type="button" onClick={() => navigate('/play/quiz')} className="fun-back-btn" aria-label="성향검사로">←</button>
            <h2 className="fun-title">내 보드게임 성향</h2>
        </div>
    );

    if (authLoading) return <div className="loading-container"><div className="spinner"></div></div>;
    if (!user) {
        return (
            <div className="fun-page">{header}
                <div className="fun-status">
                    <p>로그인하면 내 결과를 볼 수 있어요.</p>
                    <Link to="/login" state={{ from: `/play/quiz/r/${id}` }} className="fun-primary-btn wc-link-btn">로그인하기</Link>
                </div>
            </div>
        );
    }
    if (error) return <div className="fun-page">{header}<div className="fun-status" role="alert"><p>{error}</p></div></div>;
    if (!result) return <div className="loading-container"><div className="spinner"></div></div>;

    const four = result.four.map(Number);
    const eight = result.eight.map(Number);
    const lines = axisLines(four);
    const { picks, heavy } = familyGames(four);
    const blocks = extraBlocks(four, eight);
    const infoOf = (gid) => games.find((g) => String(g.id) === String(gid));

    return (
        <div className="fun-page quiz-result">
            {header}

            <section className="quiz-hero">
                <p className="quiz-hero-kicker">이번 응답으로 보면</p>
                <h3 className="quiz-hero-name">{familyName(result.code)}</h3>
                <span className="quiz-code">{result.code}</span>
                {result.previous && (
                    <p className="quiz-compare">
                        지난번({formatDate(result.previous.created_at)})에는 <strong>{familyName(result.previous.code)}</strong>
                        <span className="quiz-code is-small">{result.previous.code}</span>
                        {result.previous.code === result.code ? ' — 그대로예요.' : ' 였어요.'}
                    </p>
                )}
            </section>

            <section className="wc-my-section">
                <ul className="quiz-lines">
                    {lines.map((l) => (
                        <li key={l.axis}>
                            <span className="quiz-line-axis">{l.axis}{l.letter ? ` · ${l.letter}` : ''}</span>
                            <p>{l.line}</p>
                            {l.compare && <p className="quiz-line-compare">{l.compare}</p>}
                        </li>
                    ))}
                </ul>
                <ul className="quiz-bars">
                    {DISPLAY.map((d, i) => (
                        <QuizBar key={d.name} lo={d.lo} hi={d.hi} name={d.name} value={four[i]} />
                    ))}
                </ul>
                <button type="button" className="quiz-toggle" aria-expanded={showEight} onClick={() => setShowEight(!showEight)}>
                    8가지 세부 성향 보기 {showEight ? '▲' : '▼'}
                </button>
                {showEight && (
                    <>
                        <p className="wc-my-footnote">네 축은 아래 8가지를 둘씩 묶어 만든 거예요.</p>
                        <ul className="quiz-bars is-eight">
                            {AXES8.map((name, k) => (
                                <QuizBar key={name} lo={EIGHT_POLES[k][0]} hi={EIGHT_POLES[k][1]} name={name} value={eight[k]} />
                            ))}
                        </ul>
                    </>
                )}
            </section>

            <section className="wc-my-section">
                <h3>이번 학기, 이런 게임을 차려 드려요</h3>
                <ul className="wc-rank-list">
                    {picks.map((g) => <GameRow key={g.id} game={g} meta="입문용" info={infoOf(g.id)} />)}
                </ul>
                {heavy && (
                    <>
                        <p className="wc-my-footnote">몇 판 해 보고 더 깊은 게 당기면</p>
                        <ul className="wc-rank-list"><GameRow game={heavy} meta="익숙해지면" info={infoOf(heavy.id)} /></ul>
                    </>
                )}
            </section>

            {blocks.includes('murder') && (
                <section className="quiz-extra">
                    <p>이야기에 빠져드는 걸 좋아하고 사람을 읽는 게임도 즐긴다면, <strong>머더미스터리</strong>도 잘 맞을 수 있어요.
                        4~6명이 1.5~3시간 동안 각자 인물을 맡아 사건의 진상을 찾는 게임이에요.</p>
                    <Link to={`/search?category=${encodeURIComponent('머더미스터리')}`}>덜지에서 빌릴 수 있는 작품 보기 →</Link>
                </section>
            )}
            {blocks.includes('trpg') && (
                <section className="quiz-extra">
                    <p>이야기 속에서 천천히 캐릭터를 키워 가는 <strong>TRPG</strong>도 맞을 수 있어요. 진행자 1명과 3~5명이 보통 3~5시간 함께해요.</p>
                    <Link to={`/search?category=${encodeURIComponent('TRPG')}`}>덜지에서 빌릴 수 있는 룰북 보기 →</Link>
                </section>
            )}

            <p className="quiz-closing">
                이 결과는 질문에 대한 이번 응답을 정리한 거예요. 성격 진단이 아니라 지금 끌리는 게임 취향이에요.
                어떤 결과가 나와도 괜찮아요. 오마카세부가 이번 학기에 여러 성향의 게임을 골고루 차려 드릴 거고, 해 볼수록 취향은 달라져요.
                학기 말에 한 번 더 해 보고 이번 결과와 비교해 봐요.
            </p>
            <p className="wc-my-privacy">이 결과는 나만 볼 수 있어요. 마이페이지에서 켜면 내 리뷰 옆에 네 글자가 보여요. 운영진은 전체 통계만 봐요.</p>
            <Link to="/play/quiz" className="fun-secondary-btn wc-link-btn">처음으로</Link>
            <button type="button" className="quiz-history-del-all" onClick={() => setConfirmDelete(true)}>이 결과 지우기</button>

            <ConfirmModal
                isOpen={confirmDelete}
                onClose={() => setConfirmDelete(false)}
                onConfirm={() => deleteQuizResult(result.id)
                    .then(() => navigate('/play/quiz', { replace: true }))
                    .catch(() => setError('결과를 지우지 못했어요. 다시 시도해 주세요.'))}
                title="이 결과를 지울까요?"
                message="지운 결과는 되돌릴 수 없어요. 최신 결과를 지우면 리뷰 옆 배지는 그 전 결과로 바뀌어요."
                confirmText="지우기"
                cancelText="취소"
                type="danger"
            />
        </div>
    );
};

export default QuizResult;
