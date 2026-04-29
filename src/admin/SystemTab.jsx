// src/admin/SystemTab.jsx
// 시스템 설정 탭 - 회비 관리, 학기 초기화 등

import { useState, useEffect } from 'react';
import { fetchUsers, fetchPaymentCheckEnabled, fetchOfficeHoursConfig, saveOfficeHoursConfig } from '../api';
import { resetSemesterPayments, togglePaymentCheck } from '../api_members';
import { useToast } from '../contexts/ToastContext';
import ConfirmModal from '../components/ConfirmModal';

const COLOR_PRESETS = [
    { label: '🔴 빨강', value: 'linear-gradient(135deg, #7b1a1a, #e74c3c)' },
    { label: '🟢 초록', value: 'linear-gradient(135deg, #1a5c2a, #27ae60)' },
    { label: '⬜ 회색', value: 'linear-gradient(135deg, #3a3a3a, #666666)' },
];

function SystemTab() {
    const { showToast } = useToast();
    const [loading, setLoading] = useState(true);
    const [stats, setStats] = useState({
        totalMembers: 0,
        paidMembers: 0,
        unpaidMembers: 0
    });
    const [paymentCheckEnabled, setPaymentCheckEnabled] = useState(true);
    const [officeHoursConfig, setOfficeHoursConfig] = useState(null);
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
    const loadData = async () => {
        setLoading(true);
        try {
            const [members, paymentCheck, ohConfig] = await Promise.all([
                fetchUsers(), fetchPaymentCheckEnabled(), fetchOfficeHoursConfig()
            ]);

            // 통계 계산
            const totalMembers = members.length;
            const paidMembers = members.filter(m => m.is_paid).length;
            const unpaidMembers = totalMembers - paidMembers;

            setStats({ totalMembers, paidMembers, unpaidMembers });
            setPaymentCheckEnabled(paymentCheck);
            setOfficeHoursConfig(ohConfig);

        } catch (e) {
            console.error('[SystemTab] 데이터 로딩 실패:', e);
            showToast('데이터 로딩 실패: ' + e.message, { type: 'error' });
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadData();
    }, []);

    // 회비 검사 토글
    const handleTogglePaymentCheck = async () => {
        const newState = !paymentCheckEnabled;
        const action = newState ? '활성화' : '비활성화';

        showConfirmModal(
            `회비 검사 ${action}`,
            `회비 검사를 ${action}하시겠습니까?\n\n${newState
                ? '⚠️ 활성화하면 회비를 내지 않은 회원은 게임을 대여할 수 없습니다.'
                : '⚠️ 비활성화하면 모든 회원이 회비 납부 없이 게임을 대여할 수 있습니다. (무료 대여 기간, 축제 등)'}`,
            async () => {
                try {
                    await togglePaymentCheck(newState);
                    setPaymentCheckEnabled(newState);
                    showToast(`✅ 회비 검사가 ${action}되었습니다.`, { type: 'success' });
                } catch (e) {
                    console.error('[SystemTab] 회비 검사 토글 실패:', e);
                    showToast('설정 변경 실패: ' + e.message, { type: 'error' });
                }
            },
            'warning'
        );
    };

    // 오피스아워 설정 저장
    const handleSaveOfficeHoursConfig = async () => {
        try {
            await saveOfficeHoursConfig(officeHoursConfig);
            showToast('✅ 오피스아워 설정이 저장되었습니다.', { type: 'success' });
        } catch (e) {
            console.error('[SystemTab] 오피스아워 설정 저장 실패:', e);
            showToast('저장 실패: ' + e.message, { type: 'error' });
        }
    };

    // 학기 초기화
    const handleResetSemester = async () => {
        showConfirmModal(
            '학기 종료 - 회비 일괄 초기화',
            `⚠️ 모든 일반 회원의 회비 납부 상태를 "미납"으로 초기화합니다.\n\n` +
            `• 전체 회원 수: ${stats.totalMembers}명\n` +
            `• 관리자, OB, 면제 역할 보유자는 자동 제외\n\n` +
            `이 작업은 되돌릴 수 없습니다. 계속하시겠습니까?`,
            async () => {
                try {
                    const result = await resetSemesterPayments();
                    showToast(`✅ ${result.reset_count}명의 회비 상태가 초기화되었습니다.`, { type: 'success' });
                    loadData(); // 통계 새로고침
                } catch (e) {
                    console.error('[SystemTab] 학기 초기화 실패:', e);
                    showToast('초기화 실패: ' + e.message, { type: 'error' });
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

            {/* 회비 검사 토글 */}
            <div className="admin-card" style={{ marginTop: '30px' }}>
                <h4 style={{ marginBottom: '15px' }}>💳 회비 검사 설정</h4>
                <p style={{ color: 'var(--admin-text-sub)', fontSize: '0.9em', marginBottom: '20px' }}>
                    회비 검사를 비활성화하면 모든 회원이 회비 납부 없이 게임을 대여할 수 있습니다.<br />
                    (무료 대여 기간, 축제, 체험 행사 등에 활용)
                </p>

                <div style={styles.toggleContainer}>
                    <div>
                        <div style={{ fontWeight: 'bold', fontSize: '1.1em', marginBottom: '5px' }}>
                            현재 상태: {paymentCheckEnabled ? '🟢 활성화' : '🔴 비활성화'}
                        </div>
                        <div style={{ color: 'var(--admin-text-sub)', fontSize: '0.85em' }}>
                            {paymentCheckEnabled
                                ? '회비를 내지 않은 회원은 게임을 대여할 수 없습니다.'
                                : '모든 회원이 회비 납부 없이 게임을 대여할 수 있습니다.'}
                        </div>
                    </div>
                    <button
                        onClick={handleTogglePaymentCheck}
                        style={{
                            ...styles.toggleBtn,
                            background: paymentCheckEnabled ? '#e74c3c' : '#27ae60'
                        }}
                    >
                        {paymentCheckEnabled ? '비활성화' : '활성화'}
                    </button>
                </div>
            </div>

            {/* 오피스아워 배너 설정 */}
            {officeHoursConfig && (
                <div className="admin-card" style={{ marginTop: '20px' }}>
                    <h4 style={{ marginBottom: '8px' }}>🟢 오피스아워 배너 설정</h4>
                    <p style={{ color: 'var(--admin-text-sub)', fontSize: '0.9em', marginBottom: '20px' }}>
                        홈 화면 배너 문구/색상과 자동 퇴근 시간을 설정합니다.
                    </p>

                    {/* 자동 퇴근 시간 */}
                    <div style={{ marginBottom: '20px' }}>
                        <label style={styles.fieldLabel}>자동 퇴근 시간</label>
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                            <input
                                type="number" min="0" max="23"
                                value={officeHoursConfig.auto_close_hour}
                                onChange={e => setOfficeHoursConfig(prev => ({ ...prev, auto_close_hour: Math.min(23, Math.max(0, parseInt(e.target.value) || 0)) }))}
                                style={{ ...styles.input, width: '70px' }}
                            />
                            <span style={{ color: 'var(--admin-text-main)' }}>시</span>
                            <input
                                type="number" min="0" max="59"
                                value={officeHoursConfig.auto_close_minute}
                                onChange={e => setOfficeHoursConfig(prev => ({ ...prev, auto_close_minute: Math.min(59, Math.max(0, parseInt(e.target.value) || 0)) }))}
                                style={{ ...styles.input, width: '70px' }}
                            />
                            <span style={{ color: 'var(--admin-text-main)' }}>분</span>
                            <span style={{ color: 'var(--admin-text-sub)', fontSize: '0.82em' }}>
                                출근 후 이 시간이 지나면 자동 오프라인
                            </span>
                        </div>
                    </div>

                    {/* 배너 아이콘 */}
                    <div style={{ marginBottom: '15px' }}>
                        <label style={styles.fieldLabel}>배너 아이콘 (이모지)</label>
                        <input
                            type="text"
                            value={officeHoursConfig.banner_icon}
                            onChange={e => setOfficeHoursConfig(prev => ({ ...prev, banner_icon: e.target.value }))}
                            style={{ ...styles.input, width: '100px' }}
                            placeholder="🟢"
                        />
                    </div>

                    {/* 배너 제목 */}
                    <div style={{ marginBottom: '15px' }}>
                        <label style={styles.fieldLabel}>배너 제목</label>
                        <input
                            type="text"
                            value={officeHoursConfig.banner_title}
                            onChange={e => setOfficeHoursConfig(prev => ({ ...prev, banner_title: e.target.value }))}
                            style={styles.input}
                            placeholder="오피스아워 진행 중!"
                        />
                    </div>

                    {/* 배너 부제목 */}
                    <div style={{ marginBottom: '15px' }}>
                        <label style={styles.fieldLabel}>배너 부제목</label>
                        <input
                            type="text"
                            value={officeHoursConfig.banner_subtitle}
                            onChange={e => setOfficeHoursConfig(prev => ({ ...prev, banner_subtitle: e.target.value }))}
                            style={styles.input}
                            placeholder="지금 방문하시면 게임을 대여할 수 있어요"
                        />
                    </div>

                    {/* 배너 색상 */}
                    <div style={{ marginBottom: '20px' }}>
                        <label style={styles.fieldLabel}>배너 색상 (CSS gradient 또는 색상 코드)</label>
                        <input
                            type="text"
                            value={officeHoursConfig.banner_color}
                            onChange={e => setOfficeHoursConfig(prev => ({ ...prev, banner_color: e.target.value }))}
                            style={styles.input}
                            placeholder="linear-gradient(135deg, #1a5c2a, #27ae60)"
                        />
                        <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                            {COLOR_PRESETS.map(preset => (
                                <button
                                    key={preset.label}
                                    onClick={() => setOfficeHoursConfig(prev => ({ ...prev, banner_color: preset.value }))}
                                    style={{
                                        padding: '6px 14px',
                                        background: preset.value,
                                        border: officeHoursConfig.banner_color === preset.value
                                            ? '2px solid white' : '2px solid transparent',
                                        borderRadius: '6px',
                                        color: 'white',
                                        fontSize: '0.85em',
                                        cursor: 'pointer',
                                        fontWeight: 'bold',
                                        textShadow: '0 1px 2px rgba(0,0,0,0.4)'
                                    }}
                                >
                                    {preset.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* 운영 예정 시간 안내 */}
                    <div style={{ marginBottom: '15px' }}>
                        <label style={styles.fieldLabel}>운영 예정 시간 안내 아이콘</label>
                        <input
                            type="text"
                            value={officeHoursConfig.schedule_icon ?? '📅'}
                            onChange={e => setOfficeHoursConfig(prev => ({ ...prev, schedule_icon: e.target.value }))}
                            style={{ ...styles.input, width: '100px' }}
                            placeholder="📅"
                        />
                    </div>
                    <div style={{ marginBottom: '15px' }}>
                        <label style={styles.fieldLabel}>운영 예정 시간 안내 문구 (비워두면 아래 기본 문구로 표시)</label>
                        <input
                            type="text"
                            value={officeHoursConfig.schedule_text ?? ''}
                            onChange={e => setOfficeHoursConfig(prev => ({ ...prev, schedule_text: e.target.value }))}
                            style={styles.input}
                            placeholder="예) 오늘 오후 6시~9시에 빌려갈 수 있어요"
                        />
                    </div>
                    <div style={{ marginBottom: '20px' }}>
                        <label style={styles.fieldLabel}>퇴근 중 기본 문구 (예정 시간 미입력 시 표시)</label>
                        <input
                            type="text"
                            value={officeHoursConfig.offline_text ?? ''}
                            onChange={e => setOfficeHoursConfig(prev => ({ ...prev, offline_text: e.target.value }))}
                            style={styles.input}
                            placeholder="현재 오피스아워를 운영하고 있지 않아요"
                        />
                    </div>

                    {/* 미리보기 */}
                    <div style={{ marginBottom: '20px' }}>
                        <label style={styles.fieldLabel}>미리보기</label>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            {/* 운영중 배너 */}
                            <div style={{
                                padding: '14px 20px',
                                background: officeHoursConfig.banner_color,
                                borderRadius: '12px',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '10px',
                                color: 'white',
                                fontWeight: 'bold',
                                fontSize: '1rem',
                            }}>
                                <span style={{ fontSize: '1.4rem' }}>{officeHoursConfig.banner_icon || '🟢'}</span>
                                <div>
                                    <div>{officeHoursConfig.banner_title || '(제목 없음)'}</div>
                                    <div style={{ fontWeight: 'normal', fontSize: '0.82rem', opacity: 0.85, marginTop: '2px' }}>
                                        {officeHoursConfig.banner_subtitle || '(부제목 없음)'}
                                    </div>
                                </div>
                            </div>
                            {/* 오프라인 안내 배너 (schedule_text 있을 때만) */}
                            {officeHoursConfig.schedule_text && (
                                <div style={{
                                    padding: '11px 16px',
                                    background: 'rgba(100, 120, 160, 0.15)',
                                    borderRadius: '12px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '10px',
                                    border: '1px solid rgba(100, 120, 160, 0.3)',
                                    color: 'var(--admin-text-main)',
                                    fontSize: '0.9rem',
                                }}>
                                    <span style={{ fontSize: '1.1rem' }}>{officeHoursConfig.schedule_icon || '📅'}</span>
                                    <span>{officeHoursConfig.schedule_text}</span>
                                </div>
                            )}
                        </div>
                    </div>

                    <button onClick={handleSaveOfficeHoursConfig} style={styles.saveBtn}>
                        💾 저장
                    </button>
                </div>
            )}

            {/* 학기 초기화 */}
            <div className="admin-card" style={{ marginTop: '20px' }}>
                <h4 style={{ marginBottom: '15px' }}>🔄 학기 종료 관리</h4>
                <p style={{ color: 'var(--admin-text-sub)', fontSize: '0.9em', marginBottom: '20px' }}>
                    학기가 끝나면 모든 일반 회원의 회비 납부 상태를 "미납"으로 초기화합니다.<br />
                    관리자, OB, 면제 역할을 가진 회원은 초기화 대상에서 제외됩니다.
                </p>

                <button
                    onClick={handleResetSemester}
                    style={styles.resetBtn}
                >
                    🔄 학기 종료 - 회비 일괄 초기화
                </button>
            </div>

            {/* 안내 메시지 */}
            <div style={styles.infoBox}>
                <p><strong>💡 사용 안내:</strong></p>
                <ul style={{ margin: '10px 0', paddingLeft: '20px', lineHeight: '1.6' }}>
                    <li>회비 검사 토글은 즉시 적용되며, 모든 대여 시스템에 영향을 미칩니다.</li>
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
    toggleContainer: {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '15px',
        background: 'rgba(187, 134, 252, 0.05)',
        borderRadius: '8px',
        border: '1px solid var(--admin-border)'
    },
    toggleBtn: {
        padding: '12px 24px',
        color: 'white',
        border: 'none',
        borderRadius: '8px',
        fontWeight: 'bold',
        fontSize: '1em',
        cursor: 'pointer',
        minWidth: '120px'
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
    fieldLabel: {
        display: 'block',
        marginBottom: '6px',
        fontSize: '0.9em',
        fontWeight: 'bold',
        color: 'var(--admin-text-main)'
    },
    input: {
        width: '100%',
        padding: '8px 12px',
        background: 'var(--admin-bg)',
        border: '1px solid var(--admin-border)',
        borderRadius: '6px',
        color: 'var(--admin-text-main)',
        fontSize: '0.95em',
        boxSizing: 'border-box'
    },
    saveBtn: {
        padding: '10px 24px',
        background: 'var(--admin-primary)',
        color: 'white',
        border: 'none',
        borderRadius: '8px',
        fontWeight: 'bold',
        fontSize: '1em',
        cursor: 'pointer'
    }
};

export default SystemTab;
