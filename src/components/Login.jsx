// src/Login.js
import React, { useState } from 'react';
import { useNavigate, useSearchParams, useLocation, Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext'; // [NEW] Context 사용
import { useToast } from '../contexts/ToastContext'; // [NEW]
import { getAuthErrorMessage } from '../constants'; // [NEW] 에러 메시지 헬퍼
import { takePendingRoute, getSafeReturnPath } from '../lib/pendingRoute';
import './Auth.css';

function Login() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const returnPath = getSafeReturnPath(searchParams.get('redirect')) || getSafeReturnPath(location.state?.from);
  const returnQuery = returnPath ? `?redirect=${encodeURIComponent(returnPath)}` : '';
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
      navigate(takePendingRoute(returnPath) || "/", { replace: true });

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
    <div className="auth-page">
      <div className="auth-inner">
        <Link to="/" className="auth-back">← 메인으로 돌아가기</Link>
        <h2 className="auth-title">로그인</h2>
        <p className="auth-lead">덜지니어스 부원 계정으로 로그인해요.</p>

        <form onSubmit={handleSubmit} className="auth-form">
          <div className="auth-field">
            <label htmlFor="login-student-id">학번</label>
            <input
              id="login-student-id"
              type="text"
              inputMode="numeric"
              placeholder="예: 21500000"
              autoComplete="username"
              value={studentId}
              onChange={(e) => setStudentId(e.target.value)}
              required
            />
          </div>
          <div className="auth-field">
            <label htmlFor="login-password">비밀번호</label>
            <input
              id="login-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          <button type="submit" className="auth-submit" disabled={loading}>
            {loading ? "로그인 중..." : "로그인"}
          </button>
        </form>

        <div className="auth-foot">
          <span>계정이 없으신가요?</span>
          <Link to={`/signup${returnQuery}`} className="auth-link">회원가입</Link>
        </div>
        <div className="auth-foot">
          <Link to={`/reset-password${returnQuery}`} className="auth-link">비밀번호를 잊으셨나요?</Link>
        </div>
      </div>
    </div>
  );
}

export default Login;
