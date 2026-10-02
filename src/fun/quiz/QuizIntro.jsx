// 성향검사 소개·동의 (/play/quiz) — spec_fun_quiz.md §5. 로그인 회원만 시작할 수 있다.
import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { deleteAllMyQuizResults, deleteQuizResult, fetchMyQuizResults } from '../../api_fun';
import ConfirmModal from '../../components/ConfirmModal';
import { useAuth } from '../../contexts/AuthContext';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { familyName } from './quizLogic';
import { DISPLAY, FAMILY_NAME, ITEMS } from './quizData';
import '../fun.css';
import './quiz.css';

const formatDate = (iso) => new Date(iso).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' });

// 축 이름 「가볍게/진지하게」에서 글자별 키워드를 뽑는다 — L→가볍게, D→진지하게 …
const POLE_WORD = Object.fromEntries(DISPLAY.flatMap((d) => {
    const [lo, hi] = d.name.split('/');
    return [[d.lo, lo], [d.hi, hi]];
}));

// 소개 화면용 아주 짧은 글자 설명 (결과 화면의 긴 설명은 quizData POLE_TEXT)
const POLE_SHORT = {
    L: '빠르고 왁자지껄, 막판 역전도 재미',
    D: '한 수씩 고민하며 차곡차곡 쌓기',
    P: '표정 읽고 속고 속이기',
    B: '내 판을 퍼즐처럼 완성하기',
    T: '다 같이 한 팀으로 힘 모으기',
    V: '사람끼리 확실하게 승부 가리기',
    S: '딱 맞는 정답 찾아내기',
    C: '웃긴 답·기발한 그림 지어내기',
};

// 시작 버튼 아래 링크 → 모달: 네 기준 요약 + 16가지 성향. mine 이 있으면 그 카드를 강조
const QuizGuide = ({ mine }) => {
    const [open, setOpen] = useState(false);
    useBodyScrollLock(open);
    const containerRef = useFocusTrap({ active: open, onEscape: () => setOpen(false) });

    return (
        <>
            <button type="button" className="quiz-guide-open" onClick={() => setOpen(true)}>
                🧭 어떤 성향들이 있나요? <span>16가지 보기 →</span>
            </button>
            {open && (
                <div className="quiz-modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
                    <div className="quiz-modal quiz-guide" role="dialog" aria-modal="true" aria-labelledby="quiz-guide-title" ref={containerRef}>
                        <div className="quiz-modal-head">
                            <div>
                                <div className="quiz-modal-name" id="quiz-guide-title">네 가지 기준, 16가지 성향</div>
                                <p className="quiz-guide-lead">기준마다 더 가까운 쪽 글자를 모아 네 글자가 돼요.</p>
                            </div>
                            <button type="button" className="quiz-modal-close" onClick={() => setOpen(false)} aria-label="닫기">✕</button>
                        </div>
                    <ul className="quiz-guide-axes">
                        {DISPLAY.map((d) => (
                            <li key={d.lo}>
                                {[d.lo, d.hi].map((c) => (
                                    <p key={c}><b>{c}</b> <strong>{POLE_WORD[c]}</strong> <span>{POLE_SHORT[c]}</span></p>
                                ))}
                            </li>
                        ))}
                    </ul>
                    <ul className="quiz-family-grid">
                        {Object.entries(FAMILY_NAME).map(([code, name]) => (
                            <li key={code} className={code === mine ? 'is-mine' : undefined}>
                                <span className="quiz-family-code">{code}</span>
                                <span className="quiz-family-name">{name}</span>
                                <span className="quiz-family-words">{[...code].map((c) => POLE_WORD[c]).join(' · ')}</span>
                                {code === mine && <span className="quiz-family-mine">내 성향</span>}
                            </li>
                        ))}
                    </ul>
                    </div>
                </div>
            )}
        </>
    );
};

const QuizIntro = () => {
    const navigate = useNavigate();
    const { user, loading: authLoading } = useAuth();
    const [consent, setConsent] = useState(false);
    const [history, setHistory] = useState([]);
    const [pendingDelete, setPendingDelete] = useState(null); // 결과 id 또는 'all'
    const [deleteError, setDeleteError] = useState(null);

    useEffect(() => {
        window.scrollTo(0, 0);
        if (authLoading || !user) return;
        fetchMyQuizResults().then(setHistory).catch(() => setHistory([]));
    }, [authLoading, user]);

    const start = () => navigate('/play/quiz/play', { state: { consent: true } });

    const confirmDelete = async () => {
        const target = pendingDelete;
        setDeleteError(null);
        try {
            if (target === 'all') {
                await deleteAllMyQuizResults();
                setHistory([]);
            } else {
                await deleteQuizResult(target);
                setHistory((h) => h.filter((x) => x.id !== target));
            }
        } catch {
            setDeleteError('지우지 못했어요. 다시 시도해 주세요.');
        }
    };

    return (
        <div className="fun-page">
            <div className="fun-header">
                <button type="button" onClick={() => navigate('/play')} className="fun-back-btn" aria-label="놀이터로">←</button>
                <h2 className="fun-title">보드게임 성향검사</h2>
            </div>

            {/* 이미 해 본 사람은 시작하기보다 내 성향 다시 보기가 먼저 */}
            {user && history.length > 0 && (
                <Link to={`/play/quiz/r/${history[0].id}`} className="quiz-mine">
                    <span className="quiz-mine-kicker">내 성향 · {formatDate(history[0].created_at)}</span>
                    <span className="quiz-mine-name">{familyName(history[0].code)} <span className="quiz-code">{history[0].code}</span></span>
                    <span className="quiz-mine-go">결과 다시 보기 →</span>
                </Link>
            )}

            <section className="quiz-intro">
                <p className="quiz-intro-lead">둘 중 더 끌리는 쪽을 고르면, 나와 잘 맞는 게임 성향을 알려 드려요.</p>
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

            {!authLoading && !user && <QuizGuide />}

            {!authLoading && user && (
                <>
                    <label className="quiz-consent">
                        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
                        <span>
                            응답 {ITEMS.length}개와 결과는 내 계정에 저장돼요. 결과는 나만 볼 수 있고(마이페이지에서 리뷰 옆 공개를 켜면 네 글자만 보여요), 운영진은 누가 무엇을 골랐는지가 아니라
                            전체 통계(유형별 인원 등)만 봐요. 학기 말에 다시 해 보면 이번 결과와 비교해 드려요.
                        </span>
                    </label>
                    <button type="button" className="fun-primary-btn" disabled={!consent} onClick={start}>
                        {history.length > 0 ? '다시 해 보기' : '시작하기'}
                    </button>

                    <QuizGuide mine={history[0]?.code} />

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
                                        <button type="button" className="quiz-history-del" onClick={() => setPendingDelete(h.id)}
                                            aria-label={`${formatDate(h.created_at)} 결과 지우기`}>지우기</button>
                                    </li>
                                ))}
                            </ul>
                            {deleteError && <p className="quiz-error" role="alert">{deleteError}</p>}
                            <button type="button" className="quiz-history-del-all" onClick={() => setPendingDelete('all')}>
                                내 성향검사 기록 모두 지우기
                            </button>
                        </section>
                    )}

                    <ConfirmModal
                        isOpen={pendingDelete !== null}
                        onClose={() => setPendingDelete(null)}
                        onConfirm={confirmDelete}
                        title={pendingDelete === 'all' ? '기록을 모두 지울까요?' : '이 결과를 지울까요?'}
                        message={pendingDelete === 'all'
                            ? '지금까지의 성향검사 결과와 리뷰 옆 공개 설정이 모두 지워져요. 되돌릴 수 없어요.'
                            : '지운 결과는 되돌릴 수 없어요. 최신 결과를 지우면 리뷰 옆 배지는 그 전 결과로 바뀌어요.'}
                        confirmText="지우기"
                        cancelText="취소"
                        type="danger"
                    />
                </>
            )}
        </div>
    );
};

export default QuizIntro;
