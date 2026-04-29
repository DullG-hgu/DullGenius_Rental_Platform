// src/admin/AdminOverviewCard.jsx
// 관리자 대시보드 상단에 표시되는 "오늘의 할 일" 안내 카드.
// 처음 관리자 페이지에 들어온 사람이 지금 무엇을 해야 하는지 한눈에 파악할 수 있도록 돕는다.

import { useEffect, useState } from 'react';
import { fetchDamageReports, fetchGameRequests } from '../api';

function AdminOverviewCard({ games = [], isOfficeOpen, onGoReports }) {
    const [pendingReports, setPendingReports] = useState(null); // null = 로딩 중
    const [pendingRequests, setPendingRequests] = useState(null);

    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            try {
                const [reports, requests] = await Promise.all([
                    fetchDamageReports(),
                    fetchGameRequests(),
                ]);
                if (cancelled) return;
                setPendingReports((reports || []).filter(r => r.status === 'pending').length);
                setPendingRequests((requests || []).filter(r => r.status === 'pending').length);
            } catch (e) {
                console.error('[AdminOverviewCard] 신고/신청 카운트 로드 실패:', e);
                if (cancelled) return;
                setPendingReports(0);
                setPendingRequests(0);
            }
        };
        load();
        return () => { cancelled = true; };
    }, []);

    // 연체 건수: adminStatus가 대여중/일부대여중이고 dueDate가 과거인 게임 수
    const now = Date.now();
    const overdueCount = games.filter(g => {
        if (!g.dueDate) return false;
        const isRentedOut = g.adminStatus === '대여중' || g.adminStatus === '일부대여중';
        return isRentedOut && new Date(g.dueDate).getTime() < now;
    }).length;

    const totalPending = (pendingReports ?? 0) + (pendingRequests ?? 0);

    return (
        <div style={styles.wrap}>
            <div style={styles.header}>
                <h3 style={styles.title}>👋 오늘의 할 일</h3>
                <span style={styles.subtitle}>관리자 페이지에 오신 걸 환영합니다</span>
            </div>

            <div style={styles.grid}>
                <StatusCell
                    icon={isOfficeOpen ? '🟢' : '⭕'}
                    label="운영 상태"
                    value={isOfficeOpen ? '운영 중' : '오프라인'}
                    hint={isOfficeOpen
                        ? '지금 회원들이 대여할 수 있어요.'
                        : '우상단 "출근" 버튼을 눌러야 대여가 열립니다.'}
                    tone={isOfficeOpen ? 'ok' : 'warn'}
                />

                <StatusCell
                    icon="📢"
                    label="미처리 신고/신청"
                    value={
                        pendingReports === null
                            ? '불러오는 중…'
                            : `${totalPending}건 (신고 ${pendingReports} · 신청 ${pendingRequests})`
                    }
                    hint={
                        totalPending > 0
                            ? '상단의 "📢 신고/신청 관리" 탭에서 확인해주세요.'
                            : '쌓인 신고/신청이 없습니다. 👍'
                    }
                    tone={totalPending > 0 ? 'warn' : 'ok'}
                    actionLabel={totalPending > 0 ? '처리하러 가기' : null}
                    onAction={onGoReports}
                />

                <StatusCell
                    icon="⏰"
                    label="반납 기한 지난 게임"
                    value={`${overdueCount}건`}
                    hint={
                        overdueCount > 0
                            ? '아래 목록에서 "대여중" 상태를 확인하고, 해당 회원에게 연락해주세요.'
                            : '연체된 게임이 없어요.'
                    }
                    tone={overdueCount > 0 ? 'danger' : 'ok'}
                />
            </div>

            <details style={styles.details}>
                <summary style={styles.summary}>📘 처음 사용하시나요? (클릭해서 펼치기)</summary>
                <ul style={styles.tips}>
                    <li><b>대여/반납:</b> 아래 게임 카드의 버튼으로 처리합니다. 이름 검색으로 회원을 찾아 연결하세요.</li>
                    <li><b>회원 문의:</b> 📢 신고/신청 관리 탭에서 먼저 확인하세요.</li>
                    <li><b>출근/퇴근:</b> 우상단 초록 버튼입니다. 출근해야 홈페이지에 "운영중"으로 보입니다.</li>
                    <li><b>위험한 작업</b> (학기 초기화, 권한 변경 등)은 ⚙️ 시스템 설정 · 👥 회원 관리에 있습니다. 두 번 확인하고 실행하세요.</li>
                    <li><b>문제가 생기면:</b> 브라우저에서 <kbd>F12</kbd> → Console 탭을 열어 빨간 에러 메시지를 캡처해 개발자에게 전달해주세요.</li>
                </ul>
            </details>
        </div>
    );
}

function StatusCell({ icon, label, value, hint, tone = 'info', actionLabel, onAction }) {
    const accent = {
        ok: '#27ae60',
        warn: '#f39c12',
        danger: '#e74c3c',
        info: '#3498db',
    }[tone];

    return (
        <div style={{ ...styles.cell, borderLeft: `4px solid ${accent}` }}>
            <div style={styles.cellTop}>
                <span style={styles.cellIcon}>{icon}</span>
                <span style={styles.cellLabel}>{label}</span>
            </div>
            <div style={{ ...styles.cellValue, color: accent }}>{value}</div>
            <div style={styles.cellHint}>{hint}</div>
            {actionLabel && onAction && (
                <button
                    type="button"
                    onClick={onAction}
                    style={{ ...styles.cellAction, background: accent }}
                >
                    {actionLabel} →
                </button>
            )}
        </div>
    );
}

const styles = {
    wrap: {
        background: 'var(--admin-card-bg)',
        border: '1px solid var(--admin-border)',
        borderRadius: '12px',
        padding: '20px',
        marginBottom: '20px',
    },
    header: {
        display: 'flex',
        alignItems: 'baseline',
        gap: '12px',
        marginBottom: '16px',
        flexWrap: 'wrap',
    },
    title: {
        margin: 0,
        color: 'var(--admin-text-main)',
        fontSize: '1.2rem',
    },
    subtitle: {
        color: 'var(--admin-text-sub)',
        fontSize: '0.9rem',
    },
    grid: {
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
        gap: '12px',
    },
    cell: {
        background: 'var(--admin-bg)',
        padding: '14px 16px',
        borderRadius: '8px',
    },
    cellTop: {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        marginBottom: '6px',
    },
    cellIcon: {
        fontSize: '1.1rem',
    },
    cellLabel: {
        color: 'var(--admin-text-sub)',
        fontSize: '0.85rem',
        fontWeight: 600,
    },
    cellValue: {
        fontSize: '1.1rem',
        fontWeight: 'bold',
        marginBottom: '6px',
    },
    cellHint: {
        color: 'var(--admin-text-sub)',
        fontSize: '0.85rem',
        lineHeight: 1.4,
    },
    cellAction: {
        marginTop: '10px',
        padding: '6px 12px',
        border: 'none',
        borderRadius: '6px',
        color: 'white',
        fontSize: '0.85rem',
        fontWeight: 600,
        cursor: 'pointer',
    },
    details: {
        marginTop: '16px',
        background: 'var(--admin-bg)',
        borderRadius: '8px',
        padding: '10px 14px',
    },
    summary: {
        cursor: 'pointer',
        color: 'var(--admin-text-main)',
        fontWeight: 600,
        userSelect: 'none',
    },
    tips: {
        margin: '10px 0 4px 0',
        paddingLeft: '20px',
        color: 'var(--admin-text-sub)',
        fontSize: '0.9rem',
        lineHeight: 1.7,
    },
};

export default AdminOverviewCard;
