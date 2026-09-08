// src/admin/SystemTab.jsx
// 시스템 설정 탭 - 회비 관리, 학기 초기화 등

import { useState, useEffect, useRef } from 'react';
import { fetchUsers } from '../api';
import { resetSemesterPayments } from '../api_members';
import { useToast } from '../contexts/ToastContext';
import ConfirmModal from '../components/ConfirmModal';

function SystemTab({ users, onUsersReload }) {
    const { showToast } = useToast();
    const [loading, setLoading] = useState(true);
    const [resetting, setResetting] = useState(false);
    const resetInFlight = useRef(false);
    const [stats, setStats] = useState({
        totalMembers: 0,
        paidMembers: 0,
        unpaidMembers: 0
    });
    const [confirmModal, setConfirmModal] = useState({
        isOpen: false,
        title: '',
        message: '',
        onConfirm: null,
        type: 'info'
    });

    const showConfirmModal = (title, message, onConfirm, type = 'info') => {
        setConfirmModal({ isOpen: true, title, message, onConfirm, type });
    };

    const closeConfirmModal = () => {
        setConfirmModal({ isOpen: false, title: '', message: '', onConfirm: null, type: 'info' });
    };

    // 데이터 로드
    const loadData = async (freshMembers) => {
        setLoading(true);
        try {
            const members = Array.isArray(freshMembers) ? freshMembers : Array.isArray(users) ? users : await fetchUsers();

            // 통계 계산
            const totalMembers = members.length;
            const paidMembers = members.filter(m => m.is_paid).length;
            const unpaidMembers = totalMembers - paidMembers;

            setStats({ totalMembers, paidMembers, unpaidMembers });

        } catch (e) {
            console.error('[SystemTab] 데이터 로딩 실패:', e);
            showToast('데이터 로딩 실패: ' + e.message, { type: 'error' });
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadData();
    }, [users]);

    // 학기 초기화
    const handleResetSemester = async () => {
        if (resetInFlight.current || loading) return;
        showConfirmModal(
            '학기 종료 - 회비 일괄 초기화',
            `⚠️ 모든 일반 회원의 회비 납부 상태를 "미납"으로 초기화합니다.\n\n` +
            `• 전체 회원 수: ${stats.totalMembers}명\n` +
            `• 관리자, 운영진, 회비 면제 역할 보유자는 자동 제외\n\n` +
            `이 작업은 되돌릴 수 없습니다. 계속하시겠습니까?`,
            async () => {
                if (resetInFlight.current) return;
                resetInFlight.current = true;
                setResetting(true);
                try {
                    const result = await resetSemesterPayments();
                    showToast(`✅ ${result.reset_count}명의 회비 상태가 초기화되었습니다.`, { type: 'success' });
                    try {
                        const members = onUsersReload ? await onUsersReload() : await fetchUsers();
                        await loadData(members);
                    } catch {
                        showToast('초기화는 완료됐지만 회원 목록을 새로 불러오지 못했습니다. 페이지를 새로고침해주세요.', { type: 'warning' });
                    }
                } catch (e) {
                    console.error('[SystemTab] 학기 초기화 실패:', e);
                    showToast('초기화 실패: ' + e.message, { type: 'error' });
                } finally {
                    resetInFlight.current = false;
                    setResetting(false);
                }
            },
            'danger'
        );
    };

    return (
        <div>
            <h3>⚙️ 시스템 설정</h3>
            <p style={{ color: 'var(--admin-text-sub)', marginBottom: '30px', fontSize: '0.9em' }}>
                회비 관리, 학기 초기화 등 시스템 전반의 설정을 관리합니다.
            </p>

            {/* 통계 대시보드 */}
            <div style={styles.statsContainer}>
                <div style={styles.statCard}>
                    <div style={styles.statIcon}>👥</div>
                    <div style={styles.statValue}>{stats.totalMembers}</div>
                    <div style={styles.statLabel}>전체 회원</div>
                </div>
                <div style={{ ...styles.statCard, borderColor: '#27ae60' }}>
                    <div style={styles.statIcon}>✅</div>
                    <div style={styles.statValue}>{stats.paidMembers}</div>
                    <div style={styles.statLabel}>회비 납부</div>
                </div>
                <div style={{ ...styles.statCard, borderColor: '#e74c3c' }}>
                    <div style={styles.statIcon}>❌</div>
                    <div style={styles.statValue}>{stats.unpaidMembers}</div>
                    <div style={styles.statLabel}>회비 미납</div>
                </div>

            </div>

            {/* 학기 초기화 */}
            <div className="admin-card" style={{ marginTop: '20px' }}>
                <h4 style={{ marginBottom: '15px' }}>🔄 학기 종료 관리</h4>
                <p style={{ color: 'var(--admin-text-sub)', fontSize: '0.9em', marginBottom: '20px' }}>
                    학기가 끝나면 모든 일반 회원의 회비 납부 상태를 "미납"으로 초기화합니다.<br />
                    관리자, 운영진, 회비 면제 역할을 가진 회원은 초기화 대상에서 제외되므로 납부 인원이 0명이 아닐 수 있습니다.
                </p>

                <button
                    onClick={handleResetSemester}
                    disabled={loading || resetting}
                    style={styles.resetBtn}
                >
                    {resetting ? '초기화 처리 중…' : '🔄 학기 종료 - 회비 일괄 초기화'}
                </button>
            </div>

            {/* 안내 메시지 */}
            <div style={styles.infoBox}>
                <p><strong>💡 사용 안내:</strong></p>
                <ul style={{ margin: '10px 0', paddingLeft: '20px', lineHeight: '1.6' }}>
                    <li>무료 대여 전환과 출근·퇴근은 오피스아워 탭에서 관리합니다.</li>
                    <li>학기 초기화는 되돌릴 수 없으므로 신중하게 실행하세요.</li>
                    <li>영구 면제 역할은 회원 관리 탭에서 개별적으로 부여할 수 있습니다.</li>
                </ul>
            </div>

            {/* Confirm 모달 */}
            <ConfirmModal
                isOpen={confirmModal.isOpen}
                onClose={closeConfirmModal}
                onConfirm={confirmModal.onConfirm}
                title={confirmModal.title}
                message={confirmModal.message}
                type={confirmModal.type}
            />
        </div>
    );
}

const styles = {
    statsContainer: {
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
        gap: '15px',
        marginBottom: '20px'
    },
    statCard: {
        background: 'var(--admin-card-bg)',
        border: '2px solid var(--admin-border)',
        borderRadius: '12px',
        padding: '20px',
        textAlign: 'center'
    },
    statIcon: {
        fontSize: '2em',
        marginBottom: '10px'
    },
    statValue: {
        fontSize: '2.5em',
        fontWeight: 'bold',
        color: 'var(--admin-primary)',
        marginBottom: '5px'
    },
    statLabel: {
        fontSize: '0.9em',
        color: 'var(--admin-text-sub)'
    },
    resetBtn: {
        width: '100%',
        padding: '15px',
        background: '#e74c3c',
        color: 'white',
        border: 'none',
        borderRadius: '8px',
        fontWeight: 'bold',
        fontSize: '1.1em',
        cursor: 'pointer'
    },
    infoBox: {
        marginTop: '30px',
        padding: '20px',
        background: 'rgba(187, 134, 252, 0.1)',
        border: '1px solid var(--admin-primary)',
        borderRadius: '8px',
        color: 'var(--admin-text-main)',
        fontSize: '0.9em'
    },

};

export default SystemTab;
