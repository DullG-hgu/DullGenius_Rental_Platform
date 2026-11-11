// src/components/Signup.jsx
import React, { useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { takePendingRoute, getSafeReturnPath } from '../lib/pendingRoute';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { getAuthErrorMessage } from '../constants';
import { LINKS } from '../infoData';
import InfoModal from './InfoModal';
import './Auth.css';

function Signup() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const rawRedirect = searchParams.get('redirect');
  const returnPath = getSafeReturnPath(rawRedirect);
  const returnQuery = rawRedirect ? `?redirect=${encodeURIComponent(rawRedirect)}` : '';
  const { signup } = useAuth();
  const { showToast } = useToast();

  const [formData, setFormData] = useState({
    // 이메일은 받지 않는다 (학번으로 자동 생성)
    name: '',
    studentId: '',
    password: '',
    phone: ''
  });
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [studentIdTouched, setStudentIdTouched] = useState(false);
  const [showTerms, setShowTerms] = useState(false);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  // 탈퇴 시 학번·이메일이 바뀌므로(Rename & Archive) 같은 학번 재가입은 신규 가입이다.
  // '이미 가입된 학번' 오류는 정말 중복일 때만 난다.

  const studentIdShort = formData.studentId.length > 0 && formData.studentId.length !== 8;
  const showStudentIdError = studentIdTouched && studentIdShort;

  const handleSubmit = async (e) => {
    e.preventDefault();
    const { name, studentId, password, phone } = formData;

    if (!name || !studentId || !password || !phone) {
      return showToast("모든 정보를 입력해주세요.", { type: "warning" });
    }

    if (studentId.length !== 8) {
      setStudentIdTouched(true);
      return showToast("학번은 정확히 8자리여야 합니다.", { type: "warning" });
    }

    setLoading(true);
    try {
      // 학번 -> 이메일 자동 변환
      const email = `${studentId}@handong.ac.kr`;

      await signup(email, password, {
        name,
        student_id: studentId,
        phone
      });

      showToast("가입 성공! 환영합니다.", { type: "success" });
      // 행사·팀 링크처럼 가려던 곳이 있으면 그리로 돌려보낸다 (가입 목적이 그 페이지다).
      // 없으면 홈으로 — 이용법 버튼 위치를 1회 알려준다 (Home: ?welcome=1)
      const destination = takePendingRoute(returnPath);
      navigate(destination && destination !== "/" ? destination : "/?welcome=1", { replace: true });
    } catch (error) {
      console.error("Signup Error:", error);
      showToast(getAuthErrorMessage(error), { type: "error" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-inner">
        <Link to="/" className="auth-back">← 메인으로 돌아가기</Link>
        <h2 className="auth-title">회원가입</h2>
        <p className="auth-lead">덜지니어스 부원이 보드게임을 빌릴 때 쓰는 계정이에요. 한동대 학번으로 가입해요.</p>

        <form onSubmit={handleSubmit} className="auth-form" noValidate>
          <div className="auth-field">
            <label htmlFor="signup-name">이름</label>
            <input id="signup-name" name="name" autoComplete="name" value={formData.name} onChange={handleChange} required />
          </div>
          <div className="auth-field">
            <label htmlFor="signup-student-id">학번</label>
            <input
              id="signup-student-id"
              name="studentId"
              type="text"
              inputMode="numeric"
              autoComplete="username"
              value={formData.studentId}
              onChange={(e) => {
                const val = e.target.value.replace(/[^0-9]/g, '');
                if (val.length <= 8) {
                  setFormData(prev => ({ ...prev, studentId: val }));
                }
              }}
              onBlur={() => setStudentIdTouched(true)}
              aria-invalid={showStudentIdError}
              aria-describedby="signup-student-id-hint"
              required
            />
            <p id="signup-student-id-hint" className={`auth-hint${showStudentIdError ? ' is-error' : ''}`}>
              {showStudentIdError ? `학번은 숫자 8자리예요. 지금 ${formData.studentId.length}자리예요.` : '숫자 8자리 (예: 21500000). 로그인할 때 아이디로 써요.'}
            </p>
          </div>
          <div className="auth-field">
            <label htmlFor="signup-password">비밀번호</label>
            <div className="auth-password">
              <input
                id="signup-password"
                name="password"
                type={showPassword ? "text" : "password"}
                autoComplete="new-password"
                value={formData.password}
                onChange={handleChange}
                required
              />
              <button type="button" onClick={() => setShowPassword(p => !p)} className="auth-toggle" aria-pressed={showPassword}>
                {showPassword ? "숨기기" : "보기"}
              </button>
            </div>
          </div>
          <div className="auth-field">
            <label htmlFor="signup-phone">전화번호</label>
            <input
              id="signup-phone"
              name="phone"
              type="text"
              inputMode="numeric"
              autoComplete="tel-national"
              value={formData.phone}
              onChange={(e) => {
                // 숫자만 추출 후 국가코드(+82) 입력 시 0으로 정규화
                let val = e.target.value.replace(/[^0-9]/g, '');
                if (val.startsWith('82') && val.length > 2) val = '0' + val.slice(2);
                setFormData(prev => ({ ...prev, phone: val }));
              }}
              aria-describedby="signup-phone-hint"
              required
            />
            <p id="signup-phone-hint" className="auth-hint">숫자만 (예: 01012345678)</p>
          </div>

          <button type="submit" className="auth-submit" disabled={loading}>
            {loading ? "가입 처리 중..." : "가입하기"}
          </button>
        </form>

        <div className="auth-foot">
          <span>이미 계정이 있나요?</span>
          <Link to={`/login${returnQuery}`} className="auth-link">로그인</Link>
          <button type="button" className="auth-linkbtn" onClick={() => setShowTerms(true)}>동아리 이용 약관</button>
        </div>

        <div className="auth-aside">
          <strong>덜지니어스 부원이 아니라면</strong>
          <span>이 계정만으로는 평소에 빌릴 수 없어요. 아래 방법을 이용해 주세요.</span>
          <div className="auth-aside-links">
            <a href={LINKS.recruit} target="_blank" rel="noopener noreferrer" className="auth-link">입부 신청</a>
            <Link to="/org-rental" className="auth-link">행사·단체 대여</Link>
          </div>
        </div>
      </div>
      <InfoModal isOpen={showTerms} onClose={() => setShowTerms(false)} initialTab="terms" />
    </div>
  );
}

export default Signup;
