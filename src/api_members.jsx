// ==========================================
// [Member Management APIs] - 회원 관리
// ==========================================

import { supabase } from './lib/supabaseClient';

// [Admin] 회비 납부 상태 업데이트
export const updatePaymentStatus = async (userId, isPaid) => {
    const { error } = await supabase
        .from('profiles')
        .update({ is_paid: isPaid })
        .eq('id', userId);

    if (error) throw error;
    return { status: "success" };
};

// [Admin] 사용자 정보 수정
export const updateUserProfile = async (userId, updates) => {
    const { error } = await supabase
        .from('profiles')
        .update(updates)
        .eq('id', userId);

    if (error) throw error;
    return { status: "success" };
};

// [Admin] 학기 종료 - 회비 일괄 초기화
export const resetSemesterPayments = async () => {
    const { data, error } = await supabase.rpc('reset_semester_payments');
    if (error) throw error;
    return data;
};

// [Admin] 오피스아워 출근 (자동 퇴근 시간은 DB office_hours_config에서 읽음)
export const setOfficeOpen = async () => {
    // 설정에서 자동 퇴근 시간 읽기 (없으면 21:00 기본값)
    const { data: configData } = await supabase
        .from('app_config')
        .select('value')
        .eq('key', 'office_hours_config')
        .single();
    const hour = configData?.value?.auto_close_hour ?? 21;
    const minute = configData?.value?.auto_close_minute ?? 0;

    const autoCloseAt = new Date();
    autoCloseAt.setHours(hour, minute, 0, 0);
    // 설정 시간이 이미 지났으면 내일로 설정
    if (autoCloseAt <= new Date()) {
        autoCloseAt.setDate(autoCloseAt.getDate() + 1);
    }
    const { error } = await supabase
        .from('app_config')
        .update({ value: { open: true, auto_close_at: autoCloseAt.toISOString() } })
        .eq('key', 'office_status');
    if (error) throw error;
};

// [Admin] 오피스아워 퇴근
export const setOfficeClosed = async () => {
    const { error } = await supabase
        .from('app_config')
        .update({ value: { open: false, auto_close_at: null } })
        .eq('key', 'office_status');
    if (error) throw error;
};

// [Admin] 회비 검사 활성화/비활성화 토글
export const togglePaymentCheck = async (enabled) => {
    const { error } = await supabase
        .from('app_config')
        .update({ value: enabled ? 'true' : 'false' })
        .eq('key', 'payment_check_enabled');

    if (error) throw error;
    return { status: "success" };
};

// [Admin] 사용자 역할 업데이트
export const updateUserRoles = async (userId, roleKeys) => {
    // 기존 역할 삭제
    await supabase
        .from('user_roles')
        .delete()
        .eq('user_id', userId);

    // 새 역할 추가
    if (roleKeys && roleKeys.length > 0) {
        const roles = roleKeys.map(roleKey => ({
            user_id: userId,
            role_key: roleKey
        }));

        const { error } = await supabase
            .from('user_roles')
            .insert(roles);

        if (error) throw error;
    }

    return { status: "success" };
};

// [Admin] 사용자 역할 조회
export const getUserRoles = async (userId) => {
    const { data, error } = await supabase
        .from('user_roles')
        .select('role_key')
        .eq('user_id', userId);

    if (error) throw error;
    return data || [];
};

// [Admin] 비밀번호 강제 초기화 (12345678)
export const resetUserPassword = async (userId) => {
    const { data, error } = await supabase.rpc('reset_user_password', { target_user_id: userId });
    if (error) throw error;
    if (!data.success) throw new Error(data.message);
    return data;
};

// [User] 비밀번호 재설정 - 속도 제한 확인
export const checkRateLimitOTP = async (studentId) => {
    try {
        const response = await fetch('/.netlify/functions/rate-limit-otp', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ studentId })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.message || `Rate limit exceeded (${response.status})`);
        }

        return await response.json();
    } catch (error) {
        console.warn('Rate limit check warning:', error.message);
        // 속도 제한 체크 실패 시에도 진행 (네트워크 오류 대비)
        return { success: true, message: 'Rate limit check skipped' };
    }
};

// [User] 비밀번호 재설정 - OTP 요청
export const requestPasswordResetOTP = async (studentId, name, phone) => {
    const { data, error } = await supabase.rpc('request_password_reset_otp', {
        p_student_id: studentId,
        p_name: name,
        p_phone: phone
    });

    if (error) throw error;
    if (!data.success) throw new Error(data.message);
    return data;
};

// [User] 비밀번호 재설정 - OTP 검증 후 변경
export const verifyOTPAndResetPassword = async (studentId, otpCode, newPassword) => {
    const { data, error } = await supabase.rpc('verify_otp_and_reset_password', {
        p_student_id: studentId,
        p_otp_code: otpCode,
        p_new_password: newPassword
    });

    if (error) throw error;
    if (!data.success) throw new Error(data.message);
    return data;
};

// [Legacy] 이전 비밀번호 재설정 함수 (호환성)
export const resetOwnPassword = async (studentId, name, phone, newPassword) => {
    const { data, error } = await supabase.rpc('reset_own_password', {
        p_student_id: studentId,
        p_name: name,
        p_phone: phone,
        p_new_password: newPassword
    });

    if (error) throw error;
    if (!data.success) throw new Error(data.message);
    return data;
};
