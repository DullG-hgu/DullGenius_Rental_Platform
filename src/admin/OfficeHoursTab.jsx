import { useState, useEffect } from 'react';
import { fetchPaymentCheckEnabled, fetchOfficeHoursConfig, saveOfficeHoursConfig, fetchDuesAccounts, saveDuesAccounts, fetchDuesAmount, saveDuesAmount } from '../api';
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
    const [duesAccounts, setDuesAccounts] = useState([{ bank: '', number: '', holder: '' }]);
    const [duesSaving, setDuesSaving] = useState(false);
    const [duesAmount, setDuesAmount] = useState('');
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
        // 회비 계좌는 따로 읽는다 — 실패해도 나머지 설정 화면은 그대로 쓴다
        fetchDuesAccounts()
            .then((accounts) => { if (active && accounts.length) setDuesAccounts(accounts); })
            .catch(() => {});
        fetchDuesAmount()
            .then((amount) => { if (active && amount) setDuesAmount(String(amount)); })
            .catch(() => {});
        return () => { active = false; };
    }, []);

    // 회비 계좌 저장 (회비 확인 전인 부원의 게임 상세에 표시된다)
    const handleSaveDuesAccount = async () => {
        if (duesSaving) return;
        setDuesSaving(true);
        try {
            const saved = await saveDuesAccounts(duesAccounts);
            setDuesAccounts(saved.length ? saved : [{ bank: '', number: '', holder: '' }]);
            // 금액 칸을 비워 두면 금액은 건드리지 않는다 (캡처 인증 버튼이 숨겨진 상태 그대로)
            const amountText = duesAmount.replace(/[^0-9]/g, '');
            if (amountText) setDuesAmount(String(await saveDuesAmount(Number(amountText))));
            showToast(`회비 계좌 ${saved.length}개${amountText ? '와 회비 금액' : ''}이 저장되었습니다.`, { type: 'success' });
        } catch (e) {
            console.error('[OfficeHoursTab] 회비 계좌 저장 실패:', e);
            showToast('저장 실패: ' + e.message, { type: 'error' });
        } finally {
            setDuesSaving(false);
        }
    };

    const setDuesField = (index, field, value) =>
        setDuesAccounts(prev => prev.map((row, i) => (i === index ? { ...row, [field]: value } : row)));

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

    // 홈 배너 설정 저장
    const handleSaveOfficeHoursConfig = async () => {
        try {
            const normalized = {
                ...officeHoursConfig,
                auto_close_hour: clampInt(officeHoursConfig.auto_close_hour, 0, 23, 0),
                auto_close_minute: clampInt(officeHoursConfig.auto_close_minute, 0, 59, 0),
            };
            setOfficeHoursConfig(normalized);
            await saveOfficeHoursConfig(normalized);
            showToast('✅ 홈 배너 설정이 저장되었습니다.', { type: 'success' });
        } catch (e) {
            console.error('[OfficeHoursTab] 홈 배너 설정 저장 실패:', e);
            showToast('저장 실패: ' + e.message, { type: 'error' });
        }
    };


    return (
        <div>
            <h3>🆓 무료 대여·회비</h3>
            <p style={{ color: 'var(--admin-text-sub)', lineHeight: 1.6 }}>
                1주차 무료 대여(출근·퇴근 배너, 전체 회원 대여 허용)와 회비 금액·계좌를 관리합니다. 출근·퇴근은 홈 배너만 켜고 끄며, 실제로 대여를 푸는 건 아래 「전체 회원 대여 허용」입니다.
            </p>
            <div className="admin-card">
                <div style={styles.toggleContainer}>
                    <div>
                        <h4 style={{ margin: '0 0 8px' }} aria-live="polite">{!statusKnown ? (officeError ? '상태 확인 실패' : '상태 확인 중…') : isOfficeOpen ? '🟢 출근 중 — 홈에 배너 표시' : '⭕ 퇴근 — 홈 배너 없음'}</h4>
                        <span style={{ color: 'var(--admin-text-sub)' }}>운영진이 방에 있는 동안만 출근해 두세요. 홈 맨 위에 「지금 오면 빌릴 수 있다」는 배너가 뜹니다.</span>
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

            {/* 회비 계좌 */}
            <div className="admin-card" style={{ marginTop: '20px' }}>
                <h4 style={{ marginBottom: '8px' }}>회비 입금 계좌</h4>
                <p style={{ color: 'var(--admin-text-sub)', fontSize: '0.9em', marginBottom: '16px' }}>
                    회비 확인 전인 부원이 게임 상세에서 찜하려 할 때 이 계좌가 보입니다. 계좌가 바뀌면 여기서 고치세요.<br />
                    계좌는 여러 개 넣을 수 있습니다. 계좌번호를 비운 줄은 저장할 때 빠지고, 하나도 없으면 「납부 방법은 운영진에게 문의」로 표시됩니다.
                </p>
                <div className="admin-grid-auto" style={{ marginBottom: '12px' }}>
                    <label style={styles.duesField}>
                        <span>회비 금액 (원)</span>
                        <input type="text" inputMode="numeric" className="admin-input" value={duesAmount} placeholder="예: 20000"
                            onChange={(e) => setDuesAmount(e.target.value)} />
                    </label>
                </div>
                <p style={{ color: 'var(--admin-text-sub)', fontSize: '0.9em', marginBottom: '16px' }}>
                    금액을 넣으면 부원이 이체 캡처를 올려 바로 인증할 수 있습니다. 캡처에서 이 금액을 찾으므로, 회비가 바뀌면 여기부터 고치세요.
                </p>
                {duesAccounts.map((account, index) => (
                    <div key={index} className="admin-grid-auto" style={{ marginBottom: '12px' }}>
                        <label style={styles.duesField}>
                            <span>은행</span>
                            <input type="text" className="admin-input" value={account.bank} placeholder="예: 카카오뱅크"
                                onChange={(e) => setDuesField(index, 'bank', e.target.value)} />
                        </label>
                        <label style={styles.duesField}>
                            <span>계좌번호</span>
                            <input type="text" inputMode="numeric" className="admin-input" value={account.number}
                                onChange={(e) => setDuesField(index, 'number', e.target.value)} />
                        </label>
                        <label style={styles.duesField}>
                            <span>예금주</span>
                            <input type="text" className="admin-input" value={account.holder}
                                onChange={(e) => setDuesField(index, 'holder', e.target.value)} />
                        </label>
                    </div>
                ))}
                <div className="admin-btn-row" style={{ marginTop: '16px' }}>
                    <button type="button" onClick={() => setDuesAccounts(prev => [...prev, { bank: '', number: '', holder: '' }])}
                        style={{ ...styles.toggleBtn, background: 'transparent', color: 'var(--admin-text-main)', border: '1px solid var(--admin-border)' }}>
                        계좌 추가
                    </button>
                    <button type="button" onClick={handleSaveDuesAccount} disabled={duesSaving} style={{ ...styles.toggleBtn, background: '#237a46' }}>
                        {duesSaving ? '저장 중…' : '계좌·금액 저장'}
                    </button>
                </div>
            </div>

            {/* 홈 배너 설정 */}
            {officeHoursConfig && (
                <div className="admin-card" style={{ marginTop: '20px' }}>
                    <h4 style={{ marginBottom: '8px' }}>🟢 홈 배너 설정</h4>
                    <p style={{ color: 'var(--admin-text-sub)', fontSize: '0.9em', marginBottom: '20px' }}>
                        출근해 있는 동안 홈 맨 위에 뜨는 배너의 문구·색상과 자동 퇴근 시간을 설정합니다. 퇴근 상태에서는 홈에 아무것도 뜨지 않습니다.
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
                            placeholder="무료 대여 진행 중!"
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
    duesField: {
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
        color: 'var(--admin-text-sub)',
        fontSize: '0.9em'
    },
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
