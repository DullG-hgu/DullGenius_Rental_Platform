// 성향검사 문항 (/play/quiz/play) — 한 화면에 한 문항, A/B 5단계. 끝나면 서버에 제출하고 결과로 이동.
import React, { useEffect, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { submitQuiz } from '../../api_fun';
import ConfirmModal from '../../components/ConfirmModal';
import { useAuth } from '../../contexts/AuthContext';
import { ITEMS, VERSION } from './quizData';
import '../fun.css';
import './quiz.css';

// 「둘 중 하나만 한다면?」 게임 대 게임 문항은 마지막에 한 제목 아래 묶는다 (03-items.md)
const VERSUS_Q = '둘 중 하나만 한다면?';
const FIRST_VERSUS = ITEMS.findIndex((it) => it.question === VERSUS_Q);
const SCALE = [
    { value: -2, label: 'A', aria: 'A 쪽' },
    { value: -1, label: '', aria: '조금 A 쪽' },
    { value: 0, label: '둘 다', aria: '둘 다 비슷' },
    { value: 1, label: '', aria: '조금 B 쪽' },
    { value: 2, label: 'B', aria: 'B 쪽' },
];

const QuizPlay = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const { user, loading: authLoading } = useAuth();
    const [answers, setAnswers] = useState(() => Array(ITEMS.length).fill(null));
    const [index, setIndex] = useState(0);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState(null);
    const [confirmExit, setConfirmExit] = useState(false);

    useEffect(() => { window.scrollTo(0, 0); }, [index]);

    if (authLoading) return <div className="loading-container"><div className="spinner"></div></div>;
    if (!user || !location.state?.consent) return <Navigate to="/play/quiz" replace />;

    const item = ITEMS[index];
    const isVersus = index >= FIRST_VERSUS && FIRST_VERSUS >= 0;
    const done = answers.every((a) => a !== null);

    const choose = (value) => {
        const next = answers.slice();
        next[index] = value;
        setAnswers(next);
        if (index < ITEMS.length - 1) setTimeout(() => setIndex(index + 1), 150);
    };

    const submit = async () => {
        setSubmitting(true);
        setError(null);
        try {
            const result = await submitQuiz(answers, VERSION);
            navigate(`/play/quiz/r/${result.id}`, { replace: true, state: { result } });
        } catch (e) {
            setError(e?.message?.includes('잠시 후') ? '방금 제출했어요. 1분 뒤에 다시 시도해 주세요.' : '결과를 저장하지 못했어요. 다시 시도해 주세요.');
            setSubmitting(false);
        }
    };

    return (
        <div className="fun-page quiz-play">
            <div className="fun-header">
                {/* 왼쪽 위 ← 는 검사 종료 (확인 후). 이전 질문은 B 아래 버튼 */}
                <button type="button" onClick={() => setConfirmExit(true)} className="fun-back-btn" aria-label="검사 종료">←</button>
                <div className="quiz-progress" role="progressbar" aria-valuemin={1} aria-valuemax={ITEMS.length} aria-valuenow={index + 1}>
                    <span style={{ width: `${((index + 1) / ITEMS.length) * 100}%` }} />
                </div>
                <span className="quiz-progress-text">{index + 1}/{ITEMS.length}</span>
            </div>

            {isVersus && <p className="quiz-section-label">마지막으로, 둘 중 하나만 한다면?</p>}
            {!isVersus && <h2 className="quiz-question">{item.question}</h2>}

            {/* A(위·왼쪽) → 5단계 버튼 → B(아래·오른쪽): 고르는 칸이 두 선택지 사이에 온다 */}
            <div className="quiz-option is-a"><span className="quiz-option-tag">A</span>{item.a}</div>

            <div className="quiz-scale" role="radiogroup" aria-label="A와 B 중 더 끌리는 쪽">
                {SCALE.map((s) => (
                    <button key={s.value} type="button" role="radio" aria-checked={answers[index] === s.value} aria-label={s.aria}
                        className={`quiz-scale-btn size-${Math.abs(s.value)}${answers[index] === s.value ? ' is-on' : ''}`}
                        onClick={() => choose(s.value)}>
                        {s.label}
                    </button>
                ))}
            </div>

            <div className="quiz-option is-b"><span className="quiz-option-tag">B</span>{item.b}</div>

            {index > 0 && (
                <div className="quiz-prev-wrap">
                    <button type="button" className="quiz-prev" onClick={() => setIndex(index - 1)}>← 이전 질문</button>
                </div>
            )}

            {index === ITEMS.length - 1 && (
                <button type="button" className="fun-primary-btn quiz-submit" disabled={!done || submitting} onClick={submit}>
                    {submitting ? '결과 계산 중…' : '결과 보기'}
                </button>
            )}
            {index === ITEMS.length - 1 && !done && (
                <p className="quiz-hint">아직 고르지 않은 질문이 있어요. 「이전 질문」으로 돌아가서 골라 주세요.</p>
            )}
            {error && <p className="quiz-error" role="alert">{error} <Link to="/play/quiz">처음으로</Link></p>}

            <ConfirmModal
                isOpen={confirmExit}
                onClose={() => setConfirmExit(false)}
                onConfirm={() => navigate('/play/quiz')}
                title="종료하시겠습니까?"
                message="지금까지 고른 답은 저장되지 않아요."
                confirmText="종료"
                cancelText="계속하기"
                type="warning"
            />
        </div>
    );
};

export default QuizPlay;
