import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { checkRateLimitOTP, resetOwnPassword } from '../api_members';
import { useToast } from '../contexts/ToastContext';

function PasswordReset() {
    const navigate = useNavigate();
    const { showToast } = useToast();
    const [loading, setLoading] = useState(false);
    const [errors, setErrors] = useState({});
    const [formData, setFormData] = useState({
        studentId: '',
        name: '',
        phone: '',
        newPassword: '',
        confirmPassword: ''
    });

    // 실시간 검증 헬퍼
    const validateField = (name, value) => {
        const newErrors = { ...errors };

        switch (name) {
            case 'studentId':
                if (value && !/^\d{0,8}$/.test(value)) {
                    newErrors.studentId = '숫자만 입력 가능합니다';
                } else if (value.length === 8) {
                    delete newErrors.studentId;
                }
                break;

            case 'name':
                if (value && !/^[a-zA-Z가-힣\s]*$/.test(value)) {
                    newErrors.name = '한글/영문 및 공백만 입력 가능합니다';
                } else if (value.length > 50) {
                    newErrors.name = '50자 이하여야 합니다';
                } else {
                    delete newErrors.name;
                }
                break;

            case 'phone':
                if (value && !/^\d{0,11}$/.test(value)) {
                    newErrors.phone = '숫자만 입력 가능합니다';
                } else if (value.length > 0 && value.length < 10) {
                    newErrors.phone = '최소 10자리 이상이어야 합니다';
                } else {
                    delete newErrors.phone;
                }
                break;


            case 'newPassword':
                if (value.length > 0 && value.length < 6) {
                    newErrors.newPassword = '최소 6자리 이상이어야 합니다';
                } else if (value.length > 128) {
                    newErrors.newPassword = '128자 이하여야 합니다';
                } else {
                    delete newErrors.newPassword;
                }
                break;

            case 'confirmPassword':
                if (value && formData.newPassword && value !== formData.newPassword) {
                    newErrors.confirmPassword = '비밀번호가 일치하지 않습니다';
                } else {
                    delete newErrors.confirmPassword;
                }
                break;

            default:
                break;
        }

        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    const handleChange = (e) => {
        const { name, value } = e.target;

        if (name === 'studentId') {
            const numOnly = value.replace(/[^0-9]/g, '');
            if (numOnly.length <= 8) {
                setFormData(prev => ({ ...prev, [name]: numOnly }));
                validateField(name, numOnly);
            }
        } else if (name === 'phone') {
            const numOnly = value.replace(/[^0-9]/g, '');
            setFormData(prev => ({ ...prev, [name]: numOnly }));
            validateField(name, numOnly);
        } else if (name === 'name') {
            if (/^[a-zA-Z가-힣\s]*$/.test(value) || value === '') {
                setFormData(prev => ({ ...prev, [name]: value }));
                validateField(name, value);
            }
        } else {
            setFormData(prev => ({ ...prev, [name]: value }));
            validateField(name, value);
        }
    };

    // 비밀번호 재설정 (학번/이름/전화 검증)
    const handleSubmit = async (e) => {
        e.preventDefault();
        const { studentId, name, phone, newPassword, confirmPassword } = formData;

        if (!studentId || !name || !phone || !newPassword || !confirmPassword) {
            showToast("모든 정보를 입력해주세요.", { type: "warning" });
            return;
        }

        if (studentId.length !== 8) {
            showToast("학번은 정확히 8자리여야 합니다.", { type: "warning" });
            return;
        }

        if (phone.length < 10) {
            showToast("유효한 전화번호를 입력해주세요.", { type: "warning" });
            return;
        }

        if (newPassword !== confirmPassword) {
            showToast("새 비밀번호가 일치하지 않습니다.", { type: "warning" });
            return;
        }

        if (newPassword.length < 6) {
            showToast("비밀번호는 최소 6자리 이상이어야 합니다.", { type: "warning" });
            return;
        }

        setLoading(true);
        try {
            // 속도 제한 확인
            await checkRateLimitOTP(studentId);

            // 비밀번호 재설정
            const result = await resetOwnPassword(studentId, name, phone, newPassword);
            showToast(result.message || "비밀번호가 성공적으로 변경되었습니다.", { type: "success" });
            navigate("/login");
        } catch (error) {
            console.error("Password Reset Error:", error);
            showToast(error.message || "비밀번호 재설정에 실패했습니다.", { type: "error" });
        } finally {
            setLoading(false);
        }
    };

    return (
        <div style={styles.container}>
            <div style={{ marginBottom: "20px" }}>
                <Link to="/login" style={{ textDecoration: "none", color: "#666", fontSize: "0.9em", fontWeight: "bold" }}>← 로그인으로 돌아가기</Link>
            </div>

            <h2 style={{ textAlign: "center", marginBottom: "15px" }}>🔑 비밀번호 재설정</h2>
            <p style={{ textAlign: "center", fontSize: "0.85em", color: "#666", marginBottom: "30px", lineHeight: "1.4" }}>
                가입 시 입력하신 정보를 대조하여<br />비밀번호를 재설정합니다.
            </p>

            <form onSubmit={handleSubmit} style={styles.form}>
                        <div style={styles.inputGroup}>
                            <label style={styles.label}>학번 (8자리)</label>
                            <input
                                name="studentId"
                                type="text"
                                inputMode="numeric"
                                placeholder="예: 21500000"
                                value={formData.studentId}
                                onChange={handleChange}
                                style={{
                                    ...styles.input,
                                    borderColor: errors.studentId ? '#e74c3c' : '#ddd'
                                }}
                                maxLength="8"
                                required
                            />
                            {errors.studentId && <span style={styles.errorText}>{errors.studentId}</span>}
                        </div>

                        <div style={styles.inputGroup}>
                            <label style={styles.label}>이름</label>
                            <input
                                name="name"
                                type="text"
                                placeholder="홍길동"
                                value={formData.name}
                                onChange={handleChange}
                                style={{
                                    ...styles.input,
                                    borderColor: errors.name ? '#e74c3c' : '#ddd'
                                }}
                                required
                            />
                            {errors.name && <span style={styles.errorText}>{errors.name}</span>}
                        </div>

                        <div style={styles.inputGroup}>
                            <label style={styles.label}>전화번호 (대시 없이)</label>
                            <input
                                name="phone"
                                type="text"
                                inputMode="numeric"
                                placeholder="01012345678"
                                value={formData.phone}
                                onChange={handleChange}
                                style={{
                                    ...styles.input,
                                    borderColor: errors.phone ? '#e74c3c' : '#ddd'
                                }}
                                maxLength="11"
                                required
                            />
                            {errors.phone && <span style={styles.errorText}>{errors.phone}</span>}
                        </div>

                        <hr style={{ border: "none", borderTop: "1px solid #eee", margin: "10px 0" }} />

                        <div style={styles.inputGroup}>
                            <label style={styles.label}>새 비밀번호</label>
                            <input
                                name="newPassword"
                                type="password"
                                placeholder="최소 6자리 이상"
                                value={formData.newPassword}
                                onChange={handleChange}
                                style={{
                                    ...styles.input,
                                    borderColor: errors.newPassword ? '#e74c3c' : '#ddd'
                                }}
                                required
                            />
                            {errors.newPassword && <span style={styles.errorText}>{errors.newPassword}</span>}
                        </div>

                        <div style={styles.inputGroup}>
                            <label style={styles.label}>비밀번호 확인</label>
                            <input
                                name="confirmPassword"
                                type="password"
                                placeholder="비밀번호 재입력"
                                value={formData.confirmPassword}
                                onChange={handleChange}
                                style={{
                                    ...styles.input,
                                    borderColor: errors.confirmPassword ? '#e74c3c' : '#ddd'
                                }}
                                required
                            />
                            {errors.confirmPassword && <span style={styles.errorText}>{errors.confirmPassword}</span>}
                        </div>

                <button type="submit" style={styles.button} disabled={loading}>
                    {loading ? "처리 중..." : "비밀번호 변경하기"}
                </button>
            </form>
        </div>
    );
}

const styles = {
    container: { maxWidth: "400px", margin: "60px auto", padding: "30px", border: "1px solid #ddd", borderRadius: "12px", backgroundColor: "#fff", boxShadow: "0 4px 6px rgba(0,0,0,0.05)" },
    form: { display: "flex", flexDirection: "column", gap: "18px" },
    inputGroup: { display: "flex", flexDirection: "column", gap: "6px" },
    label: { fontSize: "0.85em", fontWeight: "bold", color: "#555" },
    input: { padding: "12px", border: "1px solid #ddd", borderRadius: "6px", fontSize: "1em", outline: "none", transition: "border-color 0.2s" },
    button: { padding: "14px", backgroundColor: "#333", color: "white", border: "none", borderRadius: "6px", cursor: "pointer", fontWeight: "bold", fontSize: "1em", marginTop: "10px" },
    errorText: { fontSize: "0.75em", color: "#e74c3c", marginTop: "2px", display: "block" }
};

export default PasswordReset;
