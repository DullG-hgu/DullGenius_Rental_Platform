// src/Signup.js
import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext'; // [NEW]
import { getAuthErrorMessage } from '../constants'; // [NEW]

function Signup() {
  const navigate = useNavigate();
  const { signup } = useAuth(); // restoreAccount 제거
  const { showToast } = useToast();
  const isMountedRef = React.useRef(true);

  React.useEffect(() => {
    return () => { isMountedRef.current = false; };
  }, []);

  const [formData, setFormData] = useState({
    // email 제거 (학번으로 자동 생성)
    name: '',
    studentId: '',
    password: '',
    phone: ''
  });
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  /* 
    [NOTE] Rename & Archive 전략으로 변경됨에 따라 복구 로직 제거.
    탈퇴 시 학번/이메일이 변경되므로, 같은 학번으로 재가입 시 신규 가입으로 처리됨.
    따라서 '이미 가입된 학번' 에러는 정말 중복된 경우에만 발생함.
  */

  const handleSubmit = async (e) => {
    e.preventDefault();
    const { name, studentId, password, phone } = formData;

    if (!name || !studentId || !password || !phone) {
      return showToast("모든 정보를 입력해주세요.", { type: "warning" });
    }

    if (studentId.length !== 8) {
      return showToast("학번은 정확히 8자리여야 합니다.", { type: "warning" });
    }

    setLoading(true);
    try {
      // [Magic] 학번 -> 이메일 자동 변환
      const email = `${studentId}@handong.ac.kr`;

      await signup(email, password, {
        name,
        student_id: studentId,
        phone
      });

      showToast("가입 성공! 환영합니다.", { type: "success" });
      navigate("/");
    } catch (error) {
      console.error("Signup Error:", error);
      showToast(getAuthErrorMessage(error), { type: "error" });
    } finally {
      if (isMountedRef.current) setLoading(false);
    }
  };

  return (
    <div style={styles.container}>
      <div style={{ marginBottom: "20px" }}>
        <Link to="/" style={{ textDecoration: "none", color: "#666", fontSize: "0.9em", fontWeight: "bold" }}>← 메인으로 돌아가기</Link>
      </div>
      <h2 style={{ textAlign: "center", marginBottom: "30px" }}>📝 회원가입</h2>
      <form onSubmit={handleSubmit} style={styles.form}>
        {/* 이메일 입력 칸 제거 */}
        <input name="name" placeholder="이름" value={formData.name} onChange={handleChange} style={styles.input} required />
        <input
          name="studentId"
          type="text"
          inputMode="numeric"
          placeholder="학번 (8자리)"
          value={formData.studentId}
          onChange={(e) => {
            const val = e.target.value.replace(/[^0-9]/g, '');
            if (val.length <= 8) {
              setFormData(prev => ({ ...prev, studentId: val }));
            }
          }}
          style={styles.input}
          required
        />
        <div>
          <label style={styles.label}>비밀번호</label>
          <div style={styles.passwordWrapper}>
            <input
              name="password"
              type={showPassword ? "text" : "password"}
              placeholder="비밀번호"
              value={formData.password}
              onChange={handleChange}
              style={{ ...styles.input, flex: 1 }}
              required
            />
            <button
              type="button"
              onClick={() => setShowPassword(p => !p)}
              style={styles.toggleBtn}
              tabIndex="-1"
            >
              {showPassword ? "숨기기" : "보기"}
            </button>
          </div>
        </div>
        <div>
          <label style={styles.label}>전화번호 (예: 01012345678)</label>
          <input
            name="phone"
            type="text"
            inputMode="numeric"
            placeholder="전화번호"
            value={formData.phone}
            onChange={(e) => {
              const val = e.target.value.replace(/[^0-9]/g, '');
              setFormData(prev => ({ ...prev, phone: val }));
            }}
            style={styles.input}
            required
          />
        </div>

        <button type="submit" style={styles.button} disabled={loading}>
          {loading ? "가입 처리 중..." : "가입하기"}
        </button>
      </form>
    </div>
  );
}

const styles = {
  container: { maxWidth: "400px", margin: "100px auto", padding: "30px", border: "1px solid #ddd", borderRadius: "10px", backgroundColor: "#fff" },
  form: { display: "flex", flexDirection: "column", gap: "15px" },
  input: { padding: "12px", border: "1px solid #ddd", borderRadius: "5px", fontSize: "1em", width: "100%", boxSizing: "border-box" },
  button: { padding: "12px", backgroundColor: "#3498db", color: "white", border: "none", borderRadius: "5px", cursor: "pointer", fontWeight: "bold", fontSize: "1em" },
  label: { display: "block", fontSize: "0.8em", color: "#888", marginBottom: "4px" },
  passwordWrapper: { display: "flex", alignItems: "stretch", gap: "6px" },
  toggleBtn: { padding: "0 12px", border: "1px solid #ddd", borderRadius: "5px", background: "#f5f5f5", cursor: "pointer", fontSize: "0.85em", color: "#555", whiteSpace: "nowrap", flexShrink: 0 }
};

export default Signup;
