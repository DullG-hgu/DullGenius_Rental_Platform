// 성향검사 소개·동의 (/play/quiz) — spec_fun_quiz.md §5. 로그인 회원만 시작할 수 있다.
import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { fetchMyQuizResults } from '../../api_fun';
import { useAuth } from '../../contexts/AuthContext';
import { familyName } from './quizLogic';
import { ITEMS } from './quizData';
import '../fun.css';
import './quiz.css';

const formatDate = (iso) => new Date(iso).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' });

const QuizIntro = () => {
    const navigate = useNavigate();
    const { user, loading: authLoading } = useAuth();
    const [consent, setConsent] = useState(false);
    const [history, setHistory] = useState([]);

    useEffect(() => {
        window.scrollTo(0, 0);
        if (authLoading || !user) return;
        fetchMyQuizResults().then(setHistory).catch(() => setHistory([]));
    }, [authLoading, user]);

    const start = () => navigate('/play/quiz/play', { state: { consent: true } });

    return (
        <div className="fun-page">
            <div className="fun-header">
                <button type="button" onClick={() => navigate('/play')} className="fun-back-btn" aria-label="놀이터로">←</button>
                <h2 className="fun-title">보드게임 성향검사</h2>
            </div>

            <section className="quiz-intro">
                <p className="quiz-intro-lead">둘 중 더 끌리는 쪽을 고르면, 나와 잘 맞는 게임 가족을 알려 드려요.</p>
                <ul className="quiz-intro-facts">
                    <li>질문 {ITEMS.length}개 · 3분 정도</li>
                    <li>보드게임을 몰라도 답할 수 있어요. 할리갈리·윷놀이·마피아처럼 다들 해 본 놀이로 물어요.</li>
                    <li>정답은 없어요. 고르기 어려우면 가운데 「둘 다」를 눌러도 돼요.</li>
                </ul>
            </section>

            {authLoading && <div className="loading-container"><div className="spinner"></div></div>}

            {!authLoading && !user && (
                <div className="fun-status">
                    <p>성향검사는 로그인하고 할 수 있어요. 결과가 내 계정에 저장돼서 학기 말에 다시 해 보고 비교할 수 있어요.</p>
                    <Link to="/login" state={{ from: '/play/quiz' }} className="fun-primary-btn wc-link-btn">로그인하기</Link>
                </div>
            )}

            {!authLoading && user && (
                <>
                    <label className="quiz-consent">
                        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
                        <span>
                            응답 {ITEMS.length}개와 결과는 내 계정에 저장돼요. 결과는 나만 볼 수 있고(마이페이지에서 리뷰 옆 공개를 켜면 네 글자만 보여요), 운영진은 누가 무엇을 골랐는지가 아니라
                            전체 통계(유형별 인원 등)만 봐요. 학기 말에 다시 해 보면 이번 결과와 비교해 드려요.
                        </span>
                    </label>
                    <button type="button" className="fun-primary-btn" disabled={!consent} onClick={start}>시작하기</button>

                    {history.length > 0 && (
                        <section className="wc-my-section">
                            <h3>지난 결과</h3>
                            <ul className="quiz-history">
                                {history.map((h) => (
                                    <li key={h.id}>
                                        <Link to={`/play/quiz/r/${h.id}`}>
                                            <span className="quiz-history-date">{formatDate(h.created_at)}</span>
                                            <span className="quiz-history-name">{familyName(h.code)}</span>
                                            <span className="quiz-code">{h.code}</span>
                                        </Link>
                                    </li>
                                ))}
                            </ul>
                        </section>
                    )}
                </>
            )}
        </div>
    );
};

export default QuizIntro;
