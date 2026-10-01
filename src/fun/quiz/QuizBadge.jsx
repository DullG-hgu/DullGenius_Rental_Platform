// 리뷰 작성자 옆 성향 배지 (spec_fun_quiz.md §6) — 네 글자를 누르면 상세 성향 / 내 성향과 비교 탭이 열린다.
// badge 는 작성자가 마이페이지에서 공개를 켰을 때만 서버가 준다 ({ code, four }).
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchMyQuizPublic } from '../../api_fun';
import { useAuth } from '../../contexts/AuthContext';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { axisLines, familyName } from './quizLogic';
import { DISPLAY } from './quizData';
import QuizBar from './QuizBar';
import './quiz.css';

const CompareTab = ({ them, authorName }) => {
    const { user } = useAuth();
    const [mine, setMine] = useState(undefined); // undefined = 아직 안 불러옴, null = 결과 없음
    const [error, setError] = useState(false);

    useEffect(() => {
        if (!user) return;
        fetchMyQuizPublic().then((d) => setMine(d.latest)).catch(() => setError(true));
    }, [user]);

    if (!user) {
        return (
            <div className="quiz-badge-empty">
                <p>로그인하면 내 성향과 비교할 수 있어요.</p>
                <Link to="/login" className="quiz-my-link">로그인하기 →</Link>
            </div>
        );
    }
    if (error) return <p className="quiz-my-note" role="alert">내 결과를 불러오지 못했어요.</p>;
    if (mine === undefined) return <p className="quiz-my-note">불러오는 중…</p>;
    if (!mine) {
        return (
            <div className="quiz-badge-empty">
                <p>아직 내 성향검사 결과가 없어요. 해 보면 바로 비교해 드려요.</p>
                <Link to="/play/quiz" className="quiz-my-link">성향검사 하러 가기 →</Link>
            </div>
        );
    }

    const myFour = mine.four.map(Number);
    const same = [...mine.code].filter((c, i) => c === them.code[i]).length;
    return (
        <div>
            <div className="quiz-compare-heads">
                <div><span className="quiz-legend is-me" aria-hidden="true" /> 나 · {familyName(mine.code)} <span className="quiz-code is-small">{mine.code}</span></div>
                <div><span className="quiz-legend is-other" aria-hidden="true" /> {authorName} · {familyName(them.code)} <span className="quiz-code is-small">{them.code}</span></div>
            </div>
            <p className="quiz-compare-summary">네 글자 중 {same}개가 같아요.</p>
            <ul className="quiz-bars">
                {DISPLAY.map((d, i) => (
                    <QuizBar key={d.name} lo={d.lo} hi={d.hi} name={d.name} value={myFour[i]} other={them.four[i]} />
                ))}
            </ul>
        </div>
    );
};

const QuizBadge = ({ badge, authorName }) => {
    const [open, setOpen] = useState(false);
    const [tab, setTab] = useState('type');
    useBodyScrollLock(open);
    const containerRef = useFocusTrap({ active: open, onEscape: () => setOpen(false) });

    const them = { code: badge.code, four: badge.four.map(Number) };
    const name = familyName(them.code);

    return (
        <>
            <button type="button" className="quiz-badge" onClick={() => { setTab('type'); setOpen(true); }}
                aria-label={`${authorName}님의 보드게임 성향: ${name} (${them.code})`}>
                {them.code}
            </button>
            {open && (
                <div className="quiz-modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
                    <div className="quiz-modal" role="dialog" aria-modal="true" aria-label={`${authorName}님의 보드게임 성향`} ref={containerRef}>
                        <div className="quiz-modal-head">
                            <div>
                                <div className="quiz-modal-kicker">{authorName}님의 보드게임 성향</div>
                                <div className="quiz-modal-name">{name} <span className="quiz-code">{them.code}</span></div>
                            </div>
                            <button type="button" className="quiz-modal-close" onClick={() => setOpen(false)} aria-label="닫기">✕</button>
                        </div>

                        <div className="quiz-tabs" role="tablist">
                            <button type="button" role="tab" aria-selected={tab === 'type'} className={tab === 'type' ? 'is-on' : ''} onClick={() => setTab('type')}>성향</button>
                            <button type="button" role="tab" aria-selected={tab === 'compare'} className={tab === 'compare' ? 'is-on' : ''} onClick={() => setTab('compare')}>나와 비교</button>
                        </div>

                        {tab === 'type' ? (
                            <div>
                                <ul className="quiz-lines">
                                    {axisLines(them.four).map((l) => (
                                        <li key={l.axis}>
                                            <span className="quiz-line-axis">{l.axis}{l.letter ? ` · ${l.letter}` : ''}</span>
                                            <p>{l.line}</p>
                                        </li>
                                    ))}
                                </ul>
                                <ul className="quiz-bars">
                                    {DISPLAY.map((d, i) => <QuizBar key={d.name} lo={d.lo} hi={d.hi} name={d.name} value={them.four[i]} />)}
                                </ul>
                            </div>
                        ) : <CompareTab them={them} authorName={authorName} />}

                        <Link to="/play/quiz" className="quiz-modal-cta">나도 해 보기 →</Link>
                    </div>
                </div>
            )}
        </>
    );
};

export default QuizBadge;
