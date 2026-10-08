// 회원 공개 티어표 (/play/tier/murder/u/:userId) — 회원만. 비공개·없는 회원은 「비공개 티어표」 (구분하지 않음)
import React, { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { fetchTierPublic, resetTierLabels } from '../../api_fun';
import { useAuth } from '../../contexts/AuthContext';
import { useGameData } from '../../contexts/GameDataContext';
import { useToast } from '../../contexts/ToastContext';
import TierBoard from './TierBoard';
import { isMurder, placementsFromList, rowsFor, TIER_SLUG } from './tierData';
import '../fun.css';
import './tier.css';

const fmtDate = (iso) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '' : `${d.getMonth() + 1}월 ${d.getDate()}일`;
};

const TierPublic = () => {
    const { userId } = useParams();
    const navigate = useNavigate();
    const location = useLocation();
    const { user, loading: authLoading, hasRole } = useAuth();
    const { games } = useGameData();
    const { showToast } = useToast();
    const [person, setPerson] = useState(undefined); // undefined = 불러오는 중, null = 비공개·없음
    const [reload, setReload] = useState(0);
    const isStaff = hasRole?.('admin') || hasRole?.('executive');

    useEffect(() => {
        if (!user) return undefined;
        let active = true;
        setPerson(undefined);
        fetchTierPublic(TIER_SLUG, userId)
            .then((r) => { if (active) setPerson(r ?? null); })
            .catch(() => { if (active) setPerson(null); });
        return () => { active = false; };
    }, [user, userId, reload]);

    const pool = useMemo(() => games.filter(isMurder), [games]);
    const rows = useMemo(() => {
        const { placements, order } = placementsFromList(person?.placements ?? []);
        return rowsFor(pool, placements, order);
    }, [person, pool]);

    const resetLabels = async () => {
        try {
            await resetTierLabels(TIER_SLUG, userId);
            showToast('티어 이름을 기본으로 되돌림', { type: 'success' });
            setReload((v) => v + 1);
        } catch {
            showToast('되돌리지 못함', { type: 'error' });
        }
    };

    const header = (title) => (
        <div className="fun-header">
            <button type="button" onClick={() => navigate(-1)} className="fun-back-btn" aria-label="뒤로가기">←</button>
            <h2 className="fun-title">{title}</h2>
        </div>
    );

    if (!authLoading && !user) {
        return (
            <div className="fun-page tier-page">
                {header('머더 티어표')}
                <div className="tier-intro">
                    <p>회원이 공개한 티어표는 로그인한 회원만 볼 수 있음</p>
                    <button type="button" className="fun-primary-btn"
                        onClick={() => navigate('/login', { state: { from: location.pathname } })}>로그인</button>
                    <Link to="/play/tier/murder/community" className="fun-secondary-btn wc-link-btn tier-intro-link">모두의 티어 보기</Link>
                </div>
            </div>
        );
    }

    return (
        <div className="fun-page tier-page">
            {header(person ? `${person.name}님의 머더 티어` : '머더 티어표')}

            {person === undefined && <div className="loading-container"><div className="spinner"></div></div>}
            {person === null && <p className="fun-status">비공개 티어표</p>}

            {person && (
                <>
                    <p className="fun-subtitle">
                        {person.placements.length}개 평가 · {fmtDate(person.updated_at)} 수정
                        {person.is_me && !person.is_public ? ' · 나만 보는 중(비공개)' : ''}
                    </p>
                    <TierBoard rows={rows} labels={person.labels} />
                    <Link to="/play/tier/murder" className="fun-primary-btn wc-link-btn tier-cta">
                        {person.is_me ? '내 표 고치기' : '내 티어표 만들기'}
                    </Link>
                    {isStaff && !person.is_me && person.labels.some(Boolean) && (
                        <button type="button" className="fun-secondary-btn tier-admin-btn" onClick={resetLabels}>
                            (운영진) 티어 이름 기본으로 되돌리기
                        </button>
                    )}
                </>
            )}
        </div>
    );
};

export default TierPublic;
