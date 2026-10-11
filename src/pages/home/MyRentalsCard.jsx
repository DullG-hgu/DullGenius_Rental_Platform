// 메인 「내 대여」 카드 (2026-10-12, 메인 구성 A안)
// 로그인 부원에게 대여 중 건수·가장 빠른 반납 D-Day, 찜 건수·수령 마감까지 남은 시간을 보여 주고, 카드 전체가 마이페이지 입구다.
// 새 조회 없이 전역 게임 목록(games[].rentals)에서 계산한다 — rentals 의 user_id 는 본인 행(관리자는 전부)에만 채워지므로 user.id 로 거른다.
import React from 'react';
import { Link } from 'react-router-dom';
import { rentalDDayLabel, rentalDueDays } from '../../lib/rentalDue';

const earliest = (rows) => rows
    .filter((r) => r.due_date && !Number.isNaN(new Date(r.due_date).getTime()))
    .sort((a, b) => new Date(a.due_date) - new Date(b.due_date))[0] ?? null;

/** 내 대여·찜 요약. userId 가 없으면 null */
export const summarizeMyRentals = (games, userId, now = new Date()) => {
    if (!userId) return null;
    const mine = [];
    for (const game of games || []) {
        for (const r of game.rentals || []) {
            if (r && !r.returned_at && r.user_id && String(r.user_id) === String(userId)) mine.push(r);
        }
    }
    const rents = mine.filter((r) => r.type === 'RENT');
    const dibs = mine.filter((r) => r.type === 'DIBS' && r.due_date && new Date(r.due_date) > now);
    const firstRent = earliest(rents);
    const firstDibs = earliest(dibs);
    return {
        rentCount: rents.length,
        dibsCount: dibs.length,
        dueLabel: firstRent ? rentalDDayLabel(firstRent.due_date, now) : null,
        overdue: rents.some((r) => rentalDueDays(r.due_date, now)?.overdue),
        dibsLeftMs: firstDibs ? new Date(firstDibs.due_date) - now : null,
    };
};

/** 수령 마감까지 남은 시간: 「45분」, 「1시간 20분」 */
export const formatLeft = (ms) => {
    const minutes = Math.max(1, Math.ceil(ms / 60000));
    if (minutes < 60) return `${minutes}분`;
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m ? `${h}시간 ${m}분` : `${h}시간`;
};

export default function MyRentalsCard({ games, userId, now, onClick }) {
    const s = summarizeMyRentals(games, userId, new Date(now));
    if (!s) return null;
    if (s.rentCount === 0 && s.dibsCount === 0) {
        return (
            <Link to="/mypage" onClick={onClick} className="home-my-link">대여 기록·찜 목록 →</Link>
        );
    }
    return (
        <Link to="/mypage" onClick={onClick} className={`home-my-card${s.overdue ? ' is-overdue' : ''}`}>
            <span className="home-my-body">
                <strong className="home-my-title">내 대여</strong>
                {s.rentCount > 0 && (
                    <span className="home-my-line">
                        대여 중 {s.rentCount}
                        <span className={`home-my-due${s.overdue ? ' is-overdue' : ''}`}>{s.dueLabel}</span>
                    </span>
                )}
                {s.dibsCount > 0 && (
                    <span className="home-my-line">
                        찜 {s.dibsCount}
                        <span className="home-my-due">수령 마감 {formatLeft(s.dibsLeftMs)} 전</span>
                    </span>
                )}
            </span>
            <span className="home-my-go" aria-hidden="true">→</span>
        </Link>
    );
}
