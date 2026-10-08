// 놀이 허브 (/play) — 월드컵·성향검사 등 놀이 콘텐츠 입구
import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { FUN_ITEMS } from './funItems';
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
                {FUN_ITEMS.map((item) => (
                    <Link key={item.to} to={item.to} className="fun-hub-card">
                        <span className="fun-hub-icon" aria-hidden="true">{item.icon}</span>
                        <div>
                            <div className="fun-hub-name">{item.name}</div>
                            <div className="fun-hub-desc">{item.desc}</div>
                        </div>
                    </Link>
                ))}
            </div>
        </div>
    );
};

export default FunHub;
