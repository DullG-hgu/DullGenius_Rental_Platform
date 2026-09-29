// 놀이 허브 (/play) — 월드컵·성향검사 등 놀이 콘텐츠 입구
import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import './fun.css';

const FunHub = () => {
    const navigate = useNavigate();

    return (
        <div className="fun-page">
            <div className="fun-header">
                <button type="button" onClick={() => navigate('/')} className="fun-back-btn" aria-label="홈으로">←</button>
                <h2 className="fun-title">놀이터</h2>
            </div>
            <p className="fun-subtitle">가볍게 즐기고, 마음에 드는 게임은 빌려 가세요.</p>

            <div className="fun-hub-grid">
                <Link to="/play/worldcup" className="fun-hub-card">
                    <span className="fun-hub-icon" aria-hidden="true">🏆</span>
                    <div>
                        <div className="fun-hub-name">보드게임 이상형 월드컵</div>
                        <div className="fun-hub-desc">둘 중 하나! 나의 원픽 보드게임 찾기</div>
                    </div>
                </Link>

                <div className="fun-hub-card is-soon" aria-disabled="true">
                    <span className="fun-hub-icon" aria-hidden="true">🧭</span>
                    <div>
                        <div className="fun-hub-name">
                            보드게임 성향 검사
                            <span className="fun-soon-badge">준비 중</span>
                        </div>
                        <div className="fun-hub-desc">나는 어떤 게이머일까?</div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default FunHub;
