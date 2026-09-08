import { useState, useEffect } from 'react';
import { fetchPaymentCheckEnabled, fetchOfficeHoursConfig, saveOfficeHoursConfig } from '../api';
import { togglePaymentCheck } from '../api_members';
import { useToast } from '../contexts/ToastContext';
import ConfirmModal from '../components/ConfirmModal';

const COLOR_PRESETS = [
    { label: '🔴 빨강', value: 'linear-gradient(135deg, #7b1a1a, #e74c3c)' },
    { label: '🟢 초록', value: 'linear-gradient(135deg, #1a5c2a, #27ae60)' },
    { label: '⬜ 회색', value: 'linear-gradient(135deg, #3a3a3a, #666666)' },
];

function OfficeHoursTab({ isOfficeOpen, statusKnown, officeError, onReloadStatus, onOpen, onClose }) {
    const { showToast } = useToast();
    const [loading, setLoading] = useState(true);
    const [loadFailed, setLoadFailed] = useState(false);
    const [officeBusy, setOfficeBusy] = useState(false);
    const [paymentCheckEnabled, setPaymentCheckEnabled] = useState(true);
    const [officeHoursConfig, setOfficeHoursConfig] = useState(null);
    const [confirmModal, setConfirmModal] = useState({ isOpen: false, title: '', message: '', onConfirm: null, type: 'info' });
    const showConfirmModal = (title, message, onConfirm, type = 'info') => setConfirmModal({ isOpen: true, title, message, onConfirm, type });
    const closeConfirmModal = () => setConfirmModal(prev => ({ ...prev, isOpen: false }));

    useEffect(() => {
        let active = true;
        Promise.all([fetchPaymentCheckEnabled(), fetchOfficeHoursConfig()])
            .then(([paymentCheck, config]) => {
                if (!active) return;
                setPaymentCheckEnabled(paymentCheck);
                setOfficeHoursConfig(config);
            })
            .catch(() => {
                if (active) setLoadFailed(true);
            })
            .finally(() => { if (active) setLoading(false); });
        return () => { active = false; };
    }, []);

    const handleOfficeToggle = async () => {
        setOfficeBusy(true);
        try { await (isOfficeOpen ? onClose() : onOpen()); }
        finally { setOfficeBusy(false); }
    };

    // 회비 검사 토글
    const handleTogglePaymentCheck = async () => {
        const newState = !paymentCheckEnabled;
        const action = newState ? '활성화' : '비활성화';

        showConfirmModal(
            `회비 검사 ${action}`,
            `회비 검사를 ${action}하시겠습니까?\n\n${newState
                ? '⚠️ 활성화하면 회비를 내지 않은 회원은 키오스크 간편대여·예약수령이 막힙니다.'
                : '⚠️ 비활성화하면 회비 미납 회원도 키오스크에서 대여·수령할 수 있습니다. (무료 대여 기간, 축제 등)'}`,
            async () => {
                try {
                    await togglePaymentCheck(newState);
                    setPaymentCheckEnabled(newState);
                    showToast(`✅ 회비 검사가 ${action}되었습니다.`, { type: 'success' });
                } catch (e) {
                    console.error('[OfficeHoursTab] 회비 검사 토글 실패:', e);
                    showToast('설정 변경 실패: ' + e.message, { type: 'error' });
                }
            },
            'warning'
        );
    };

    // 숫자 입력 정리: 빈 값·범위 밖은 기본값/경계로 (onBlur 와 저장 시에만 적용 — 입력 중엔 빈칸 허용)
    const clampInt = (value, min, max, fallback) => {
        const n = parseInt(value, 10);
        if (Number.isNaN(n)) return fallback;
        return Math.min(max, Math.max(min, n));
    };

    // 오피스아워 설정 저장
    const handleSaveOfficeHoursConfig = async () => {
        try {
            const normalized = {
                ...officeHoursConfig,
                auto_close_hour: clampInt(officeHoursConfig.auto_close_hour, 0, 23, 0),
                auto_close_minute: clampInt(officeHoursConfig.auto_close_minute, 0, 59, 0),
            };
            setOfficeHoursConfig(normalized);
            await saveOfficeHoursConfig(normalized);
            showToast('✅ 오피스아워 설정이 저장되었습니다.', { type: 'success' });
        } catch (e) {
            console.error('[OfficeHoursTab] 오피스아워 설정 저장 실패:', e);
            showToast('저장 실패: ' + e.message, { type: 'error' });
        }
    };


    return (
        <div>
            <h3>🕒 오피스아워</h3>
            <p style={{ color: 'var(--admin-text-sub)', lineHeight: 1.6 }}>
                1주차 무료 대여 운영을 위한 출근·퇴근, 회비 검사와 운영 안내를 관리합니다.
            </p>
            <div className="admin-card">
                <div style={styles.toggleContainer}>
                    <div>
                        <h4 style={{ margin: '0 0 8px' }}>{!statusKnown ? (officeError ? '상태 확인 실패' : '상태 확인 중…') : isOfficeOpen ? '🟢 오피스아워 운영 중' : '⭕ 오피스아워 종료'}</h4>
                        <span style={{ color: 'var(--admin-text-sub)' }}>출근·퇴근으로 홈페이지 운영 상태를 전환합니다.</span>
                    </div>
                    <button type="button" disabled={officeBusy} onClick={statusKnown ? handleOfficeToggle : onReloadStatus}
                        style={{ ...styles.toggleBtn, minHeight: '48px', background: isOfficeOpen ? '#b33b35' : '#237a46' }}>
                        {officeBusy ? '처리 중…' : !statusKnown ? '상태 다시 조회' : isOfficeOpen ? '퇴근' : '출근'}
                    </button>
                </div>
            </div>
            {loading ? <p role="status">설정을 불러오는 중…</p> : loadFailed ? (
                <p role="alert">설정을 불러오지 못했습니다. 다른 탭으로 이동한 뒤 다시 열어주세요.</p>
            ) : (<>
            {/* 회비 검사 토글 */}
            <div className="admin-card" style={{ marginTop: '30px' }}>
                <h4 style={{ marginBottom: '15px' }}>🆓 무료 대여 / 회비 검사</h4>
                <p style={{ color: 'var(--admin-text-sub)', fontSize: '0.9em', marginBottom: '20px' }}>
                    회비 검사는 키오스크 간편대여·예약수령에 적용됩니다. 비활성화하면 회비 미납 회원도 키오스크에서 대여할 수 있습니다.<br />
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
                        {paymentCheckEnabled ? '전체 회원 대여 허용' : '회비 검사 복원'}
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
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' }}>
                            <input
                                type="number" min="0" max="23" inputMode="numeric"
                                aria-label="자동 퇴근 시각 (시)"
                                value={officeHoursConfig.auto_close_hour ?? ''}
                                onChange={e => setOfficeHoursConfig(prev => ({ ...prev, auto_close_hour: e.target.value }))}
                                onBlur={e => setOfficeHoursConfig(prev => ({ ...prev, auto_close_hour: clampInt(e.target.value, 0, 23, 0) }))}
                                style={{ ...styles.input, width: '70px', flexShrink: 0 }}
                            />
                            <span style={{ color: 'var(--admin-text-main)' }}>시</span>
                            <input
                                type="number" min="0" max="59" inputMode="numeric"
                                aria-label="자동 퇴근 시각 (분)"
                                value={officeHoursConfig.auto_close_minute ?? ''}
                                onChange={e => setOfficeHoursConfig(prev => ({ ...prev, auto_close_minute: e.target.value }))}
                                onBlur={e => setOfficeHoursConfig(prev => ({ ...prev, auto_close_minute: clampInt(e.target.value, 0, 59, 0) }))}
                                style={{ ...styles.input, width: '70px', flexShrink: 0 }}
                            />
                            <span style={{ color: 'var(--admin-text-main)' }}>분</span>
                            <span style={{ color: 'var(--admin-text-sub)', fontSize: '0.82em', flexBasis: '100%' }}>
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
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '8px' }}>
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

            </>)}
            <ConfirmModal {...confirmModal} onClose={closeConfirmModal} />
        </div>
    );
}

const styles = {
    toggleContainer: {
        display: 'flex',
        flexWrap: 'wrap',
        gap: '12px',
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
        fontSize: '1em',
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

export default OfficeHoursTab;
