// 마이페이지 「보드게임 성향」 — 내 최신 결과 + 리뷰 옆 배지 공개 스위치 (spec_fun_quiz.md §6). 기본 비공개.
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchMyQuizPublic, setQuizPublic } from '../../api_fun';
import { familyName } from './quizLogic';
import './quiz.css';

const MyQuizCard = () => {
    const [data, setData] = useState(null);
    const [error, setError] = useState(null);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        fetchMyQuizPublic().then(setData).catch(() => setError('성향검사 정보를 불러오지 못했어요.'));
    }, []);

    if (error) return <p className="quiz-my-note" role="alert">{error}</p>;
    if (!data) return <p className="quiz-my-note">불러오는 중…</p>;

    if (!data.latest) {
        return (
            <div className="quiz-my-card">
                <p className="quiz-my-note">아직 성향검사 결과가 없어요. 질문 19개로 나와 맞는 게임 성향을 찾아보세요.</p>
                <Link to="/play/quiz" className="quiz-my-link">성향검사 하러 가기 →</Link>
            </div>
        );
    }

    const toggle = async (next) => {
        setSaving(true);
        setError(null);
        try {
            await setQuizPublic(next);
            setData({ ...data, is_public: next });
        } catch {
            setError('설정을 저장하지 못했어요. 다시 시도해 주세요.');
        } finally {
            setSaving(false);
        }
    };

    const { latest } = data;
    return (
        <div className="quiz-my-card">
            <div className="quiz-my-latest">
                <span className="quiz-my-name">{familyName(latest.code)}</span>
                <span className="quiz-code">{latest.code}</span>
                <Link to={`/play/quiz/r/${latest.id}`} className="quiz-my-link">결과 보기 →</Link>
            </div>

            <label className="quiz-switch">
                <input type="checkbox" checked={data.is_public} disabled={saving} onChange={(e) => toggle(e.target.checked)} />
                <span className="quiz-switch-track" aria-hidden="true"><span /></span>
                <span>내 리뷰 옆에 성향 표시하기</span>
            </label>
            <p className="quiz-my-note">
                켜면 내가 쓴 리뷰 옆에 가장 최근 결과의 네 글자와 네 축 점수가 다른 사람에게 보여요.
                19개 답과 세부 점수는 계속 나만 봐요. 언제든 끌 수 있어요.
            </p>
            <Link to="/play/quiz" className="quiz-my-link">다시 해 보기 →</Link>
        </div>
    );
};

export default MyQuizCard;
