// src/Login.js
import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext'; // [NEW] Context 사용
import { useToast } from '../contexts/ToastContext'; // [NEW]
import { getAuthErrorMessage } from '../constants'; // [NEW] 에러 메시지 헬퍼
import { takePendingRoute } from '../lib/pendingRoute'; // 보호 경로에서 튕겨온 경우 복귀용

function Login() {
  const navigate = useNavigate();
  const { login } = useAuth();
  const { showToast } = useToast(); // [NEW]

  const [studentId, setStudentId] = useState(""); // [CHANGE] 이메일 -> 학번
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!studentId || !password) return showToast("학번과 비밀번호를 입력해주세요.", { type: "warning" });

    setLoading(true);
    try {
      // [Magic] 학번을 이메일 형식으로 변환하여 로그인
      const email = `${studentId}@handong.ac.kr`;
      await login(email, password);

      showToast(`환영합니다!`, { type: "success" });
      navigate(takePendingRoute() || "/");

    } catch (error) {
      console.error("Login Error:", error);

      // 여기 있던 "탈퇴 계정 복구" 분기는 제거했다 (2026-08-02).
      //
      // error.code === 'WITHDRAWN_USER' 를 검사했지만 그 코드를 던지는 곳이
      // 코드베이스 어디에도 없어 도달할 수 없는 분기였고, 그 안에서 호출하던
      // restoreAccount 는 AuthContext 가 제공하지도 않는 함수였다.
      //
      // 계정 복구를 실제로 붙이려면 탈퇴 모델부터 정리해야 한다.
      // 현재 withdraw_user() 는 profiles 행을 DELETE 하지만 auth.users 는 남겨두고,
      // 그와 별개로 profiles.status='withdrawn' 인 레코드도 존재해 두 방식이 섞여 있다.
      showToast(getAuthErrorMessage(error), { type: "error" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.container}>
      <div style={{ marginBottom: "20px" }}>
        <Link to="/" style={{ textDecoration: "none", color: "#666", fontSize: "0.9em", fontWeight: "bold" }}>← 메인으로 돌아가기</Link>
      </div>
      <h2 style={{ textAlign: "center", marginBottom: "30px" }}>🔐 로그인</h2>
      <form onSubmit={handleSubmit} style={styles.form}>
        <input
          type="text"
          inputMode="numeric"
          placeholder="학번 (예: 21500000)"
          value={studentId}
          onChange={(e) => setStudentId(e.target.value)}
          style={styles.input}
          required
        />
        <input
          type="password"
          placeholder="비밀번호"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          style={styles.input}
          required
        />
        <button type="submit" style={styles.button} disabled={loading}>
          {loading ? "로그인 중..." : "로그인"}
        </button>
      </form>
      <div style={{ textAlign: "center", marginTop: "20px", fontSize: "0.9em", display: "flex", flexDirection: "column", gap: "10px" }}>
        <div>
          계정이 없으신가요? <Link to="/signup" style={{ color: "#3498db" }}>회원가입</Link>
        </div>
        <div style={{ marginTop: "5px" }}>
          <Link to="/reset-password" style={{ color: "#7f8c8d", fontSize: "0.9em", textDecoration: "none" }}>비밀번호를 잊으셨나요?</Link>
        </div>
      </div>
    </div>
  );
}

const styles = {
  container: { maxWidth: "400px", margin: "100px auto", padding: "30px", border: "1px solid #ddd", borderRadius: "10px", backgroundColor: "#fff" },
  form: { display: "flex", flexDirection: "column", gap: "15px" },
  input: { padding: "12px", border: "1px solid #ddd", borderRadius: "5px", fontSize: "1em" },
  button: { padding: "12px", backgroundColor: "#333", color: "white", border: "none", borderRadius: "5px", cursor: "pointer", fontWeight: "bold", fontSize: "1em" }
};

export default Login;
