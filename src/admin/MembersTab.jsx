// src/admin/MembersTab.jsx
// 회원 관리 탭 - 회원 목록, 정렬, 검색, 회비 상태 관리, 비밀번호 재설정

import { useState, useEffect, useMemo } from 'react';
import { fetchUsers, fetchUserProfile } from '../api';
import { updatePaymentStatus, updateUserProfile, getUserRoles, updateUserRoles, resetUserPassword } from '../api_members';
import { useToast } from '../contexts/ToastContext';
import { supabase } from '../lib/supabaseClient';
import ConfirmModal from '../components/ConfirmModal';
import { DEFAULT_SEMESTER } from '../constants'; // [NEW]

// 유틸 함수: 전화번호 마스킹
const maskPhone = (phone) => {
    if (!phone) return '-';
    return `${phone.slice(0, 3)}-****-${phone.slice(-4)}`;
};

// 헬퍼: 역할 이름 표시
const getRoleDisplayName = (roleKey) => {
    switch (roleKey) {
        case 'admin': return '👑 관리자';
        case 'executive': return '⭐️ 운영진';
        case 'payment_exempt': return '🎖️ 회비 면제';
        case 'member': return '일반 회원';
        default: return roleKey;
    }
};

// 헬퍼: 역할 배지 스타일
const getRoleBadgeStyle = (roleKey) => {
    const baseStyle = {
        padding: '2px 8px',
        borderRadius: '12px',
        fontSize: '0.75em',
        fontWeight: 'bold',
        display: 'inline-block'
    };

    switch (roleKey) {
        case 'admin':
            return { ...baseStyle, background: '#e74c3c', color: 'white' };
        case 'executive':
            return { ...baseStyle, background: '#f39c12', color: 'white' };
        case 'payment_exempt':
            return { ...baseStyle, background: '#3498db', color: 'white' };
        default:
            return { ...baseStyle, background: '#95a5a6', color: 'white' };
    }
};
// 헬퍼: 활동 학기(기수) 계산
const calculateDuration = (joinedSemester) => {
    if (!joinedSemester) return '-';
    try {
        const [joinYearStr, joinSemStr] = joinedSemester.split('-');
        const joinYear = parseInt(joinYearStr);
        const joinSem = parseInt(joinSemStr);

        const now = new Date();
        const currentYear = now.getFullYear();
        const currentMonth = now.getMonth() + 1; // 1-12
        const currentSem = currentMonth <= 6 ? 1 : 2;

        if (isNaN(joinYear) || isNaN(joinSem)) return '-';

        const diff = (currentYear - joinYear) * 2 + (currentSem - joinSem) + 1;
        if (diff <= 0) return '가입 대기'; // 미래?
        return `${diff}학기차`; // (${joinYear}-${joinSem}~)
    } catch (e) {
        return '-';
    }
};

function MembersTab() {
    const { showToast } = useToast();
    const [members, setMembers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [sortBy, setSortBy] = useState('name'); // 'name', 'student_id', 'is_paid'
    const [sortOrder, setSortOrder] = useState('asc'); // 'asc', 'desc'
    const [showWithdrawn, setShowWithdrawn] = useState(false); // [NEW] 탈퇴 회원 보기 토글
    const [memberRoles, setMemberRoles] = useState({}); // { userId: ['admin', 'payment_exempt'] }
    const [roleEditModal, setRoleEditModal] = useState({ isOpen: false, member: null, selectedRoles: [] });

    // Confirm 모달 상태
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

    // 회원 목록 로드
    const loadMembers = async () => {
        setLoading(true);
        try {
            const data = await fetchUsers();
            setMembers(data || []);

            // [Optimized] fetchUsers에서 roles를 이미 가져오므로 추가 호출 불필요
            // rolesMap을 생성하여 memberRoles 상태 업데이트
            const rolesMap = {};
            if (data) {
                data.forEach(member => {
                    rolesMap[member.id] = member.roles || [];
                });
            }
            setMemberRoles(rolesMap);
        } catch (e) {
            showToast('회원 목록 로딩 실패', { type: 'error' });
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadMembers();
    }, []);

    // 정렬 처리
    const handleSort = (field) => {
        if (sortBy === field) {
            setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
        } else {
            setSortBy(field);
            setSortOrder('asc');
        }
    };

    // 필터링 및 정렬된 회원 목록 (useMemo로 최적화)
    const filteredAndSortedMembers = useMemo(() => {
        return members
            .filter(member => {
                // 1. 탈퇴 회원 필터링
                if (!showWithdrawn && member.status === 'withdrawn') return false;

                if (!searchTerm) return true;
                const term = searchTerm.toLowerCase();
                return (
                    member.name?.toLowerCase().includes(term) ||
                    member.student_id?.toLowerCase().includes(term)
                );
            })
            .sort((a, b) => {
                let aVal, bVal;

                if (sortBy === 'name') {
                    aVal = a.name || '';
                    bVal = b.name || '';
                    return sortOrder === 'asc'
                        ? aVal.localeCompare(bVal, 'ko')
                        : bVal.localeCompare(aVal, 'ko');
                } else if (sortBy === 'student_id') {
                    aVal = a.student_id || '';
                    bVal = b.student_id || '';
                    return sortOrder === 'asc'
                        ? aVal.localeCompare(bVal)
                        : bVal.localeCompare(aVal);
                } else if (sortBy === 'is_paid') {
                    aVal = a.is_paid ? 1 : 0;
                    bVal = b.is_paid ? 1 : 0;
                    return sortOrder === 'asc' ? aVal - bVal : bVal - aVal;
                }
                return 0;
            });
    }, [members, searchTerm, sortBy, sortOrder]);

    // 회비 납부 상태 토글
    const handleTogglePayment = async (member) => {
        const newStatus = !member.is_paid;
        showConfirmModal(
            '회비 상태 변경',
            `${member.name}님의 회비 납부 상태를 '${newStatus ? '납부 완료' : '미납'}' (으)로 변경하시겠습니까?`,
            async () => {
                try {
                    await updatePaymentStatus(member.id, newStatus);
                    showToast('회비 상태가 변경되었습니다.', { type: 'success' });
                    loadMembers();
                } catch (e) {
                    showToast('회비 상태 변경 실패: ' + e.message, { type: 'error' });
                }
            },
            'warning'
        );
    };

    const handleResetPassword = (member) => {
        showConfirmModal(
            '비밀번호 초기화',
            `${member.name}님의 비밀번호를 '12345678'로 초기화하시겠습니까?\n(이 작업은 되돌릴 수 없습니다.)`,
            async () => {
                try {
                    await resetUserPassword(member.id);
                    showToast(`✅ ${member.name}님의 비밀번호가 '12345678'로 초기화되었습니다.`, { type: 'success' });
                } catch (e) {
                    showToast('비밀번호 초기화 실패: ' + e.message, { type: 'error' });
                }
            },
            'warning'
        );
    };

    // [Fix] 누락된 역할 편집 핸들러 함수들 추가
    const handleOpenRoleEdit = async (member) => {
        try {
            // [Optimized] 상세 정보(전화번호 등)는 편집 시에만 개별 로드
            const profile = await fetchUserProfile(member.id);
            const currentRoles = memberRoles[member.id] || [];
            setRoleEditModal({
                isOpen: true,
                member: member,
                selectedRoles: [...currentRoles],
                tempSemester: profile?.joined_semester || member.joined_semester || '',
                tempPhone: profile?.phone || ''
            });
        } catch (e) {
            showToast('회원 상세 정보 로드 실패', { type: 'error' });
        }
    };

    const handleCloseRoleEdit = () => {
        setRoleEditModal({ isOpen: false, member: null, selectedRoles: [], tempSemester: '', tempPhone: '' });
    };

    const handleToggleRole = (roleKey) => {
        setRoleEditModal(prev => {
            const roles = prev.selectedRoles.includes(roleKey)
                ? prev.selectedRoles.filter(r => r !== roleKey)
                : [...prev.selectedRoles, roleKey];
            return { ...prev, selectedRoles: roles };
        });
    };

    const EXEMPT_ROLES = ['admin', 'executive', 'payment_exempt'];

    const handleSaveRoles = async () => {
        if (!roleEditModal.member) return;
        try {
            await updateUserRoles(roleEditModal.member.id, roleEditModal.selectedRoles);

            // 면제 역할이 포함된 경우 is_paid를 자동으로 true로 업데이트
            const hasExemptRole = roleEditModal.selectedRoles.some(r => EXEMPT_ROLES.includes(r));
            if (hasExemptRole && !roleEditModal.member.is_paid) {
                await updatePaymentStatus(roleEditModal.member.id, true);
                showToast('역할이 수정되었고, 회비 면제로 인해 납부 상태가 자동으로 업데이트되었습니다.', { type: 'success' });
            } else {
                showToast('역할이 수정되었습니다.', { type: 'success' });
            }

            // 목록 갱신
            loadMembers();
            handleCloseRoleEdit();
        } catch (e) {
            showToast('역할 수정 실패: ' + e.message, { type: 'error' });
        }
    };

    return (
        <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                    <h3 style={{ margin: 0 }}>👥 회원 관리 (총 {members.length}명)</h3>
                    {/* [NEW] 탈퇴 회원 토글을 여기로 이동하여 시인성 확보 */}
                    <label style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        cursor: 'pointer',
                        fontSize: '0.9em',
                        userSelect: 'none',
                        background: showWithdrawn ? 'rgba(231, 76, 60, 0.2)' : 'rgba(255, 255, 255, 0.05)',
                        padding: '6px 12px',
                        borderRadius: '20px',
                        border: showWithdrawn ? '1px solid #e74c3c' : '1px solid var(--admin-border)',
                        transition: 'all 0.2s'
                    }}>
                        <input
                            type="checkbox"
                            checked={showWithdrawn}
                            onChange={(e) => setShowWithdrawn(e.target.checked)}
                            style={{ cursor: 'pointer' }}
                        />
                        <span style={{ color: showWithdrawn ? '#e74c3c' : 'var(--admin-text-sub)', fontWeight: 'bold' }}>
                            탈퇴한 회원 보기
                        </span>
                    </label>
                </div>
                <button onClick={loadMembers} style={styles.refreshBtn}>🔄 새로고침</button>
            </div>

            {/* 검색 및 필터 */}
            <div style={styles.filterBar}>
                <input
                    type="text"
                    placeholder="🔍 이름, 학번 검색..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="admin-input"
                    style={{ flex: 1, maxWidth: '400px' }}
                />
                <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                    <span style={{ color: 'var(--admin-text-sub)', fontSize: '0.9em' }}>정렬:</span>
                    <select
                        value={sortBy}
                        onChange={(e) => setSortBy(e.target.value)}
                        className="admin-select"
                        style={{ padding: '8px' }}
                        aria-label="회원 목록 정렬 기준"
                    >
                        <option value="name">이름순</option>
                        <option value="student_id">학번순</option>
                        <option value="is_paid">회비 납부 여부</option>
                    </select>
                    <button
                        onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
                        style={styles.sortBtn}
                        title={sortOrder === 'asc' ? '오름차순' : '내림차순'}
                    >
                        {sortOrder === 'asc' ? '▲' : '▼'}
                    </button>
                </div>
            </div>

            {/* 회원 목록 테이블 */}
            {loading ? (
                <div style={{ textAlign: 'center', padding: '40px', color: 'var(--admin-text-sub)' }}>
                    로딩 중... ⏳
                </div>
            ) : (
                <div style={{ overflowX: 'auto' }}>
                    <table className="admin-table">
                        <thead>
                            <tr>
                                <th onClick={() => handleSort('name')} style={{ cursor: 'pointer' }}>
                                    이름 {sortBy === 'name' && (sortOrder === 'asc' ? '▲' : '▼')}
                                </th>
                                <th onClick={() => handleSort('student_id')} style={{ cursor: 'pointer' }}>
                                    학번 {sortBy === 'student_id' && (sortOrder === 'asc' ? '▲' : '▼')}
                                </th>
                                <th>활동 기간</th>
                                <th>역할</th>
                                <th onClick={() => handleSort('is_paid')} style={{ cursor: 'pointer' }}>
                                    회비 {sortBy === 'is_paid' && (sortOrder === 'asc' ? '▲' : '▼')}
                                </th>
                                <th>액션</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filteredAndSortedMembers.length === 0 ? (
                                <tr>
                                    <td colSpan="5" style={{ textAlign: 'center', padding: '40px', color: 'var(--admin-text-sub)' }}>
                                        검색 결과가 없습니다.
                                    </td>
                                </tr>
                            ) : (
                                filteredAndSortedMembers.map(member => {
                                    const roles = memberRoles[member.id] || [];
                                    const hasExemption = roles.some(r => ['admin', 'executive', 'payment_exempt'].includes(r));

                                    return (
                                        <tr key={member.id}>
                                            <td style={{ fontWeight: 'bold', color: member.status === 'withdrawn' ? '#999' : 'inherit' }}>
                                                {member.name || '-'}
                                                {member.status === 'withdrawn' && <span style={{ fontSize: '0.8em', color: '#e74c3c', marginLeft: '5px' }}>(탈퇴)</span>}
                                            </td>
                                            <td>{member.student_id || '-'}</td>
                                            <td style={{ fontSize: '0.9em' }}>
                                                <div style={{ fontWeight: 'bold', color: '#2c3e50' }}>{calculateDuration(member.joined_semester)}</div>
                                                <div style={{ fontSize: '0.8em', color: '#7f8c8d' }}>{member.joined_semester || '-'}</div>
                                            </td>
                                            <td>
                                                <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap', alignItems: 'center' }}>
                                                    {roles.length === 0 ? (
                                                        <span style={{ color: 'var(--admin-text-sub)', fontSize: '0.85em' }}>일반 회원</span>
                                                    ) : (
                                                        roles.map(role => (
                                                            <span key={role} style={getRoleBadgeStyle(role)}>
                                                                {getRoleDisplayName(role)}
                                                            </span>
                                                        ))
                                                    )}
                                                </div>
                                            </td>
                                            <td>
                                                {hasExemption ? (
                                                    <span
                                                        style={{
                                                            padding: '6px 12px',
                                                            borderRadius: '6px',
                                                            background: 'rgba(52, 152, 219, 0.2)',
                                                            color: '#3498db',
                                                            fontWeight: 'bold',
                                                            fontSize: '0.9em',
                                                            display: 'inline-block'
                                                        }}
                                                        title="회비 면제 대상입니다"
                                                    >
                                                        ✨ 면제됨
                                                    </span>
                                                ) : (
                                                    <button
                                                        onClick={() => handleTogglePayment(member)}
                                                        aria-label={`${member.name}님 회비 상태: ${member.is_paid ? '납부 완료' : '미납'}`}
                                                        style={{
                                                            ...styles.paymentBtn,
                                                            background: member.is_paid ? '#27ae60' : '#e74c3c'
                                                        }}
                                                    >
                                                        {member.is_paid ? '✅ 납부' : '❌ 미납'}
                                                    </button>
                                                )}
                                            </td>
                                            <td>
                                                <div style={{ display: 'flex', gap: '5px' }}>
                                                    <button
                                                        onClick={() => handleOpenRoleEdit(member)}
                                                        style={styles.editBtn}
                                                        title="회원 정보 수정"
                                                    >
                                                        ✏️ 수정
                                                    </button>
                                                    <button
                                                        onClick={() => handleResetPassword(member)}
                                                        aria-label={`${member.name}님 비밀번호 재설정`}
                                                        style={styles.resetBtn}
                                                        title="비밀번호를 12345678로 재설정"
                                                    >
                                                        🔑 재설정
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })
                            )}
                        </tbody>
                    </table>
                </div>
            )}

            {/* 안내 메시지 */}
            <div style={styles.infoBox}>
                <p><strong>💡 사용 안내:</strong></p>
                <ul style={{ margin: '10px 0', paddingLeft: '20px', lineHeight: '1.6' }}>
                    <li>회비 버튼을 클릭하여 납부 상태를 변경할 수 있습니다.</li>
                    <li>비밀번호 재설정 시 사용자에게 재설정 이메일이 발송됩니다.</li>
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

            {/* 역할 편집 모달 */}
            {roleEditModal.isOpen && (
                <div style={styles.modalOverlay} onClick={handleCloseRoleEdit}>
                    <div style={styles.modalContent} onClick={e => e.stopPropagation()}>
                        <h3 style={{ marginTop: 0, marginBottom: '20px', color: 'var(--admin-text-main)' }}>
                            👤 회원 정보 수정 ({roleEditModal.member?.name})
                        </h3>

                        <div style={{ marginBottom: '20px' }}>
                            <div
                                style={{
                                    ...styles.roleOption,
                                    background: roleEditModal.selectedRoles.includes('admin') ? 'rgba(231, 76, 60, 0.1)' : 'transparent',
                                    borderColor: roleEditModal.selectedRoles.includes('admin') ? '#e74c3c' : 'var(--admin-border)'
                                }}
                                onClick={() => handleToggleRole('admin')}
                            >
                                <input
                                    type="checkbox"
                                    checked={roleEditModal.selectedRoles.includes('admin')}
                                    readOnly
                                    style={styles.roleCheckbox}
                                />
                                <div>
                                    <div style={{ fontWeight: 'bold' }}>👑 관리자 (Admin)</div>
                                    <div style={{ fontSize: '0.8em', color: 'var(--admin-text-sub)' }}>
                                        모든 시스템 권한 보유, 회비 면제
                                    </div>
                                </div>
                            </div>

                            <div
                                style={{
                                    ...styles.roleOption,
                                    background: roleEditModal.selectedRoles.includes('executive') ? 'rgba(243, 156, 18, 0.1)' : 'transparent',
                                    borderColor: roleEditModal.selectedRoles.includes('executive') ? '#f39c12' : 'var(--admin-border)'
                                }}
                                onClick={() => handleToggleRole('executive')}
                            >
                                <input
                                    type="checkbox"
                                    checked={roleEditModal.selectedRoles.includes('executive')}
                                    readOnly
                                    style={styles.roleCheckbox}
                                />
                                <div>
                                    <div style={{ fontWeight: 'bold' }}>⭐️ 운영진 (Executive)</div>
                                    <div style={{ fontSize: '0.8em', color: 'var(--admin-text-sub)' }}>
                                        관리자 권한 보유, 회비 면제
                                    </div>
                                </div>
                            </div>

                            <div
                                style={{
                                    ...styles.roleOption,
                                    background: roleEditModal.selectedRoles.includes('payment_exempt') ? 'rgba(52, 152, 219, 0.1)' : 'transparent',
                                    borderColor: roleEditModal.selectedRoles.includes('payment_exempt') ? '#3498db' : 'var(--admin-border)'
                                }}
                                onClick={() => handleToggleRole('payment_exempt')}
                            >
                                <input
                                    type="checkbox"
                                    checked={roleEditModal.selectedRoles.includes('payment_exempt')}
                                    readOnly
                                    style={styles.roleCheckbox}
                                />
                                <div>
                                    <div style={{ fontWeight: 'bold' }}>🎖️ 회비 면제</div>
                                </div>
                            </div>

                            {/* [NEW] 가입 학기 수정 섹션 */}
                            <div style={{ marginBottom: '20px', padding: '15px', background: 'rgba(0,0,0,0.02)', borderRadius: '8px' }}>
                                <div style={{ fontWeight: 'bold', marginBottom: '10px', fontSize: '0.95em' }}>📅 가입 학기 수정</div>
                                <div style={{ display: 'flex', gap: '10px' }}>
                                    <input
                                        type="text"
                                        placeholder={`YYYY-S (예: ${DEFAULT_SEMESTER})`}
                                        value={roleEditModal.tempSemester}
                                        onChange={(e) => setRoleEditModal(prev => ({ ...prev, tempSemester: e.target.value }))}
                                        style={{ flex: 1, padding: '8px', borderRadius: '4px', border: '1px solid #ddd' }}
                                    />
                                    <button
                                        onClick={async () => {
                                            const val = roleEditModal.tempSemester;
                                            if (!val) return;
                                            try {
                                                await updateUserProfile(roleEditModal.member.id, { joined_semester: val });
                                                showToast('가입 학기가 수정되었습니다.', { type: 'success' });
                                                // [CRITICAL] 모달 내 member 데이터도 최신화하여 '저장' 시 권한 유실 방지
                                                setRoleEditModal(prev => ({
                                                    ...prev,
                                                    member: { ...prev.member, joined_semester: val }
                                                }));
                                                loadMembers(); // 리스트 갱신
                                            } catch (e) {
                                                showToast('수정 실패: ' + e.message, { type: 'error' });
                                            }
                                        }}
                                        style={{ ...styles.paymentBtn, background: '#3498db' }}
                                    >
                                        변경
                                    </button>
                                </div>
                            </div>

                            {/* [NEW] 전화번호 수정 섹션 */}
                            <div style={{ marginBottom: '20px', padding: '15px', background: 'rgba(0,0,0,0.02)', borderRadius: '8px' }}>
                                <div style={{ fontWeight: 'bold', marginBottom: '10px', fontSize: '0.95em' }}>📞 전화번호 수정</div>
                                <div style={{ display: 'flex', gap: '10px' }}>
                                    <input
                                        type="text"
                                        placeholder="010-XXXX-XXXX"
                                        value={roleEditModal.tempPhone}
                                        onChange={(e) => setRoleEditModal(prev => ({ ...prev, tempPhone: e.target.value }))}
                                        style={{ flex: 1, padding: '8px', borderRadius: '4px', border: '1px solid #ddd' }}
                                    />
                                    <button
                                        onClick={async () => {
                                            const val = roleEditModal.tempPhone;
                                            try {
                                                await updateUserProfile(roleEditModal.member.id, { phone: val });
                                                showToast('전화번호가 수정되었습니다.', { type: 'success' });
                                                // [CRITICAL] 모달 내 member 데이터도 최신화
                                                setRoleEditModal(prev => ({
                                                    ...prev,
                                                    member: { ...prev.member, phone: val }
                                                }));
                                                loadMembers(); // 리스트 갱신
                                            } catch (e) {
                                                showToast('수정 실패: ' + e.message, { type: 'error' });
                                            }
                                        }}
                                        style={{ ...styles.paymentBtn, background: '#3498db' }}
                                    >
                                        변경
                                    </button>
                                </div>
                            </div>

                            <div style={styles.modalActions}>
                                <button
                                    onClick={handleCloseRoleEdit}
                                    style={styles.cancelBtn}
                                    onMouseEnter={(e) => {
                                        e.target.style.transform = 'translateY(-1px)';
                                        e.target.style.backgroundColor = 'rgba(108, 117, 125, 1)';
                                    }}
                                    onMouseLeave={(e) => {
                                        e.target.style.transform = 'translateY(0)';
                                        e.target.style.backgroundColor = 'rgba(108, 117, 125, 0.9)';
                                    }}
                                >
                                    ✕ 취소
                                </button>
                                <button
                                    onClick={handleSaveRoles}
                                    style={styles.saveBtn}
                                    onMouseEnter={(e) => {
                                        e.target.style.transform = 'translateY(-1px)';
                                        e.target.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.25)';
                                        e.target.style.backgroundColor = 'rgba(52, 152, 219, 1)';
                                    }}
                                    onMouseLeave={(e) => {
                                        e.target.style.transform = 'translateY(0)';
                                        e.target.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.15)';
                                        e.target.style.backgroundColor = 'rgba(52, 152, 219, 0.95)';
                                    }}
                                >
                                    ✓ 저장
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

const styles = {
    refreshBtn: {
        padding: '8px 16px',
        background: 'var(--admin-card-bg)',
        color: 'var(--admin-text-main)',
        border: '1px solid var(--admin-border)',
        borderRadius: '6px',
        cursor: 'pointer',
        fontWeight: 'bold'
    },
    filterBar: {
        display: 'flex',
        gap: '15px',
        marginBottom: '20px',
        padding: '15px',
        background: 'var(--admin-card-bg)',
        borderRadius: '8px',
        border: '1px solid var(--admin-border)',
        flexWrap: 'wrap'
    },
    sortBtn: {
        padding: '8px 12px',
        background: 'var(--admin-primary)',
        color: '#121212',
        border: 'none',
        borderRadius: '6px',
        cursor: 'pointer',
        fontWeight: 'bold'
    },
    paymentBtn: {
        padding: '6px 12px',
        color: 'white',
        border: 'none',
        borderRadius: '6px',
        cursor: 'pointer',
        fontWeight: 'bold',
        fontSize: '0.9em'
    },
    resetBtn: {
        padding: '6px 12px',
        background: '#9b59b6',
        color: 'white',
        border: 'none',
        borderRadius: '6px',
        cursor: 'pointer',
        fontWeight: 'bold',
        fontSize: '0.9em'
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
    roleEditBtn: {
        background: 'none',
        border: 'none',
        cursor: 'pointer',
        fontSize: '1em',
        padding: '2px 5px'
    },
    modalOverlay: {
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.7)',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        zIndex: 1000
    },
    modalContent: {
        backgroundColor: 'var(--admin-card-bg)',
        padding: '30px',
        borderRadius: '12px',
        width: '90%',
        maxWidth: '400px',
        border: '1px solid var(--admin-border)',
        boxShadow: '0 4px 6px rgba(0,0,0,0.3)'
    },
    roleOption: {
        display: 'flex',
        alignItems: 'center',
        padding: '12px',
        margin: '8px 0',
        borderRadius: '8px',
        border: '1px solid var(--admin-border)',
        cursor: 'pointer',
        transition: 'background 0.2s'
    },
    roleCheckbox: {
        marginRight: '12px',
        transform: 'scale(1.2)'
    },
    modalActions: {
        display: 'flex',
        justifyContent: 'flex-end',
        gap: '10px',
        marginTop: '25px'
    },
    saveBtn: {
        padding: '10px 20px',
        background: 'rgba(52, 152, 219, 0.95)',
        color: 'white',
        border: '1px solid rgba(255, 255, 255, 0.2)',
        borderRadius: '8px',
        fontWeight: 'bold',
        cursor: 'pointer',
        transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
        boxShadow: '0 2px 8px rgba(0, 0, 0, 0.15)'
    },
    cancelBtn: {
        padding: '10px 20px',
        background: 'rgba(108, 117, 125, 0.9)',
        color: 'white',
        border: '1px solid rgba(255, 255, 255, 0.2)',
        borderRadius: '8px',
        fontWeight: 'bold',
        cursor: 'pointer',
        transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)'
    },
    editBtn: {
        padding: '6px 12px',
        background: '#3498db',
        color: 'white',
        border: 'none',
        borderRadius: '6px',
        cursor: 'pointer',
        fontWeight: 'bold',
        fontSize: '0.9em'
    }
};

export default MembersTab;

