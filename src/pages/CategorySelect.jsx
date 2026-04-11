import React, { useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useGameData } from '../contexts/GameDataContext';
import { sendLog } from '../api';
import './CategorySelect.css';

const CategorySelect = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const { games, config, loading } = useGameData();

    // URL 파라미터 확인
    const queryParams = new URLSearchParams(location.search);
    const currentTab = queryParams.get('tab');

    // 카테고리 추출 및 정렬
    const categories = ["전체", ...new Set(games.map(g => g.category).filter(Boolean))].filter(c => c !== "전체");

    useEffect(() => {
        window.scrollTo(0, 0);
    }, [currentTab]); // 탭 전환 시에도 최상단

    useEffect(() => {
        if (!loading) sendLog(null, 'VIEW', { value: 'Category Select Page' });
    }, [loading]);

    const handleCategoryClick = (category) => {
        navigate(`/search?category=${encodeURIComponent(category)}`);
    };

    if (loading) return <div className="loading-container"><div className="spinner"></div></div>;

    return (
        <div className="category-select-container">
            <div className="category-header">
                <button onClick={() => navigate(-1)} className="back-btn">←</button>
                <h2 className="category-title">카테고리 선택</h2>
            </div>

            {/* 인원수로 찾기 섹션 */}
            <div className="player-count-section">
                <h3 className="section-subtitle">👥 인원수로 찾기</h3>
                <div className="player-btn-grid">
                    {['2인', '3인', '4인', '5인 이상', '6인 이상', '8인 이상'].map((p, i) => (
                        <button
                            key={i}
                            onClick={() => navigate(`/search?players=${encodeURIComponent(p)}`)}
                            className="player-btn"
                        >
                            {p}
                        </button>
                    ))}
                </div>
            </div>

            {/* 트렌딩 보러가기 입구 타일 */}
            <div className="trending-entrance-section" style={{ padding: '0 20px', marginBottom: '15px' }}>
                <div
                    onClick={() => navigate('/search?type=trending')}
                    className="trending-entrance-card"
                >
                    <div className="trending-entrance-icon">🔥</div>
                    <div className="trending-entrance-text">
                        <div className="entrance-title">요즘 뜨는 보드게임</div>
                        <div className="entrance-desc">Top 20 랭킹 보기</div>
                    </div>
                    <div className="trending-entrance-arrow">➔</div>
                </div>
            </div>

            {/* 상황별 추천 섹션 */}
            <div className="recommendation-section-cat">
                <h3 className="section-subtitle">🎯 상황별 추천</h3>
                {config && (
                    <div className="theme-grid-cat">
                        {config.map((btn, idx) => (
                            <button
                                key={idx}
                                // [NOTE] 여기서 query 파라미터로 넘기면 GameSearch에서 검색어로 인식함.
                                // 만약 필터로 적용하려면 로직 확인 필요. 현재는 query로 넘김.
                                onClick={() => navigate(`/search?query=${encodeURIComponent(btn.value)}`)}
                                className="theme-btn-cat"
                                style={{ borderLeft: `4px solid ${btn.color}` }}
                            >
                                <div className="theme-btn-content-cat">
                                    {btn.label.split("\\n").map((line, i) => <div key={i}>{line}</div>)}
                                </div>
                                <span className="theme-btn-arrow-cat">➔</span>
                            </button>
                        ))}
                    </div>
                )}
            </div>

            <div className="category-section">
                <h3 className="section-subtitle">📂 장르별 카테고리</h3>
                <div className="category-grid">
                    {categories.map((cat, idx) => (
                        <div
                            key={idx}
                            onClick={() => handleCategoryClick(cat)}
                            className="category-card"
                        >
                            <div className="category-icon">
                                {getCategoryIcon(cat)}
                            </div>
                            <div className="category-name">{cat}</div>
                            <div className="category-count">
                                {games.filter(g => g.category === cat).length}개
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};

// 간단한 카테고리 아이콘 매핑 헬퍼
function getCategoryIcon(category) {
    if (category.includes('머더') || category.includes('미스터리')) return '🕵️‍♂️'; // 머더 미스터리는 탐정(돋보기 포함)
    if (category.includes('추리')) return '🔍'; // 일반 추리는 돋보기
    if (category.includes('심리')) return '🧠'; // 심리는 뇌/마음
    if (category.includes('블러핑')) return '🤥'; // 블러핑은 거짓말
    if (category.includes('전략')) return '♟️'; // 전략은 체스
    if (category.includes('파티')) return '🎉'; // 파티는 폭죽
    if (category.includes('카드')) return '🃏'; // 카드는 조커
    if (category.includes('가족')) return '👨‍👩‍👧‍👦'; // 가족
    if (category.includes('어린이')) return '🧸'; // 어린이/키즈
    if (category.includes('협력')) return '🤝'; // 협력
    if (category.includes('전쟁') || category.includes('워게임')) return '⚔️'; // 워게임
    if (category.includes('추상')) return '🧩'; // 추상 전략
    if (category.includes('테마') || category.includes('스토리')) return '📖'; // 테마/스토리
    if (category.includes('마피아')) return '🕶️'; // 마피아
    if (category.includes('배팅') || category.includes('경매')) return '💰'; // 배팅/경매
    if (category.includes('순발력')) return '⚡'; // 순발력/피지컬
    return '🎲'; // 기본 주사위
}

export default CategorySelect;
