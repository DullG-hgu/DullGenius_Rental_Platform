import { useState, useEffect } from 'react';
import { TEXTS, getAuthErrorMessage } from '../constants'; // [UPDATED]
import { useAuth } from '../contexts/AuthContext'; // [NEW]
import { useToast } from '../contexts/ToastContext';

function LoginModal({ isOpen, onClose, onConfirm, gameName, currentUser, sessionUser, setSessionUser, setUser }) {
  const { login, signup } = useAuth(); // [NEW]
  const { showToast } = useToast();
  // 공통상태
  const [isLoading, setIsLoading] = useState(false);

  // 게스트(비로그인) 전용 입력 상태
  const [guestName, setGuestName] = useState("");
  const [guestId, setGuestId] = useState("");
  const [guestPhone, setGuestPhone] = useState("");
  const [guestPw, setGuestPw] = useState("");

  // 모달 초기화
  useEffect(() => {
    if (isOpen) {
      setIsLoading(false);
      // 게스트 폼 리셋
      setGuestName("");
      setGuestId("");
      setGuestPhone("");
      setGuestPw("");

      // 편의성: 로컬스토리지에 남은 정보가 있다면 채워줌 (비로그인 상태라도)
      if (!currentUser) {
        try {
          const saved = localStorage.getItem('user');
          if (saved) {
            const u = JSON.parse(saved);
            setGuestName(u.name || "");
            setGuestId(u.studentId || "");
          }
        } catch (e) { }
      }
    }
  }, [isOpen, currentUser]);

  /**
   * [Mode 1] 로그인 유저: Frictionless Rental
   * - 추가 입력 없이 확인만 하고 즉시 대여 요청
   * - 비밀번호가 없는 세션(구버전 등)일 경우, 복잡한 처리 대신 재로그인 유도 (깔끔한 흐름 유지)
   */
  const handleMemberRent = async () => {
    // 방어코드: currentUser가 없는데 이 함수가 호출될 리 없지만 혹시 모를 대비
    if (!currentUser) return;

    if (!currentUser.password) {
      // GameDetail.js 에서도 처리하지만, 여기서도 한번 더 방어
      showToast("보안을 위해 다시 로그인이 필요합니다.\n(비밀번호 정보가 만료되었습니다)", { type: "warning" });
      onClose();
      return;
    }

    if (isLoading) return;
    setIsLoading(true);

    try {
      // 즉시 대여 요청
      await onConfirm({
        name: currentUser.name,
        studentId: currentUser.studentId || currentUser.student_id,
        phone: currentUser.phone,
        password: currentUser.password
      });
      // 성공하면 부모가 모달을 닫음
    } catch (e) {
      showToast(getAuthErrorMessage(e) || TEXTS.ALERT_AUTH_ERROR, { type: "error" });
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * [Mode 2] 비로그인 유저: Sign-up/Login & Rent
   * - 폼 입력 -> 가입/로그인 -> 대여 -> (성공 시) 앱 상태 업데이트
   */
  const handleGuestRent = async () => {
    // 유효성 검사
    if (!guestId || !guestPw) {
      return showToast(TEXTS.ALERT_PASSWORD_REQUIRED, { type: "warning" });
    }

    if (isLoading) return;
    setIsLoading(true);

    try {
      let userObj;
      const email = `${guestId}@handong.ac.kr`;

      // 이름/폰 유무에 따라 로그인 vs 회원가입 분기
      if (!guestName || !guestPhone) {
        // [LOGIN]
        const { user } = await login(email, guestPw);
        userObj = user;
      } else {
        // [SIGNUP]
        const { user } = await signup(email, guestPw, {
          name: guestName,
          student_id: guestId,
          phone: guestPhone
        });
        userObj = user;
      }

      // 로그인/가입 성공. 대여 요청 준비
      // Supabase user 객체에서 메타데이터 추출 혹은 입력값 사용
      const md = userObj?.user_metadata || {};

      const userToSave = {
        name: md.name || guestName,
        studentId: md.student_id || guestId,
        phone: md.phone || guestPhone,
        password: guestPw // 편의성 로컬 저장용
      };

      // 1. 대여 요청 먼저 수행 (실패하면 상태 업데이트 안 함)
      await onConfirm({
        name: userToSave.name,
        studentId: userToSave.studentId,
        phone: userToSave.phone,
        password: userToSave.password
      });

      // 2. 대여 성공 시에만 앱 상태 업데이트 (로그인 유지)
      localStorage.setItem("user", JSON.stringify(userToSave));
      if (setUser) setUser(userToSave);

    } catch (e) {
      showToast(getAuthErrorMessage(e), { type: "error" });
    } finally {
      setIsLoading(false);
    }
  };


  if (!isOpen) return null;

  // ------------------------------------------------------------------
  // 렌더링 분기: 로그인 상태 여부에 따라 완전히 다른 UI 리턴
  // ------------------------------------------------------------------

  // [VIEW 1] Member Mode (로그인 상태)
  if (currentUser) {
    return (
      <div style={styles.overlay}>
        <div style={styles.modal}>
          <h3>{TEXTS.USER_MODAL_TITLE}</h3>
          <p style={{ color: "#666", fontSize: "0.9em", marginBottom: "20px" }}
            dangerouslySetInnerHTML={{ __html: TEXTS.USER_MODAL_DESC.replace("{gameName}", gameName) }}
          />

          <div style={{ background: "#f0f9ff", padding: "20px", borderRadius: "10px", marginBottom: "20px" }}>
            <div style={{ fontSize: "1.2em", fontWeight: "bold", color: "#2c3e50" }}>{currentUser.name} 님</div>
            <div style={{ color: "#7f8c8d", fontSize: "0.9em", marginTop: "5px" }}>{currentUser.studentId || currentUser.student_id}</div>

            <p style={{ color: "#3498db", fontSize: "0.85em", marginTop: "15px" }}
              dangerouslySetInnerHTML={{ __html: TEXTS.USER_MODAL_LOGGED_IN_DESC }}
            />
          </div>

          <div style={{ marginTop: "20px", display: "flex", gap: "10px" }}>
            <button
              onClick={onClose}
              style={styles.cancelBtn}
              disabled={isLoading}
              onMouseEnter={(e) => !isLoading && (e.target.style.backgroundColor = 'rgba(108, 117, 125, 1)', e.target.style.transform = 'translateY(-1px)')}
              onMouseLeave={(e) => !isLoading && (e.target.style.backgroundColor = 'rgba(108, 117, 125, 0.9)', e.target.style.transform = 'translateY(0)')}
            >
              ✕ {TEXTS.BTN_CANCEL}
            </button>
            <button
              onClick={handleMemberRent}
              style={{ ...styles.confirmBtn, opacity: isLoading ? 0.7 : 1 }}
              disabled={isLoading}
              onMouseEnter={(e) => !isLoading && (e.target.style.backgroundColor = 'rgba(52, 152, 219, 1)', e.target.style.transform = 'translateY(-1px)', e.target.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.25)')}
              onMouseLeave={(e) => !isLoading && (e.target.style.backgroundColor = 'rgba(52, 152, 219, 0.95)', e.target.style.transform = 'translateY(0)', e.target.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.15)')}
            >
              ✓ {isLoading ? TEXTS.BTN_RENT_LOADING : TEXTS.BTN_RENT_NOW}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // [VIEW 2] Guest Mode (비로그인 상태)
  return (
    <div style={styles.overlay}>
      <div style={styles.modal}>
        <h3>{TEXTS.USER_MODAL_TITLE}</h3>
        <p style={{ color: "#666", fontSize: "0.9em", marginBottom: "20px" }}
          dangerouslySetInnerHTML={{ __html: TEXTS.USER_MODAL_DESC.replace("{gameName}", gameName) }}
        />

        <form style={{ display: "flex", flexDirection: "column", gap: "10px" }} onSubmit={(e) => { e.preventDefault(); handleGuestRent(); }}>
          <input
            placeholder="이름 (예: 홍길동)"
            value={guestName}
            onChange={(e) => setGuestName(e.target.value)}
            style={styles.input}
            autoComplete="name"
          />
          <input
            placeholder="학번 (예: 22400001)"
            value={guestId}
            onChange={(e) => {
              const val = e.target.value;
              if (/^\d{0,8}$/.test(val)) setGuestId(val);
            }}
            style={styles.input}
            type="text"
            inputMode="numeric"
            maxLength={8}
            autoComplete="username"
          />
          <input
            placeholder="연락처 (010-0000-0000)"
            value={guestPhone}
            onChange={(e) => setGuestPhone(e.target.value)}
            style={styles.input}
            autoComplete="tel"
          />

          <input
            type="password"
            placeholder="비밀번호 입력 (필수)"
            value={guestPw}
            onChange={(e) => setGuestPw(e.target.value)}
            style={styles.input}
            autoComplete="current-password"
          />

          <div style={{ fontSize: "0.85em", color: "#888", marginTop: "5px", lineHeight: "1.4", background: "#f9f9f9", padding: "10px", borderRadius: "8px" }}>
            <span dangerouslySetInnerHTML={{ __html: TEXTS.MODAL_SIGNUP_PROMO }} />
          </div>

          <div style={{ marginTop: "20px", display: "flex", gap: "10px" }}>
            <button
              type="button"
              onClick={onClose}
              style={styles.cancelBtn}
              disabled={isLoading}
              onMouseEnter={(e) => !isLoading && (e.target.style.backgroundColor = 'rgba(108, 117, 125, 1)', e.target.style.transform = 'translateY(-1px)')}
              onMouseLeave={(e) => !isLoading && (e.target.style.backgroundColor = 'rgba(108, 117, 125, 0.9)', e.target.style.transform = 'translateY(0)')}
            >
              ✕ {TEXTS.BTN_CANCEL}
            </button>
            <button
              type="submit"
              style={{ ...styles.confirmBtn, opacity: isLoading ? 0.7 : 1 }}
              disabled={isLoading}
              onMouseEnter={(e) => !isLoading && (e.target.style.backgroundColor = 'rgba(52, 152, 219, 1)', e.target.style.transform = 'translateY(-1px)', e.target.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.25)')}
              onMouseLeave={(e) => !isLoading && (e.target.style.backgroundColor = 'rgba(52, 152, 219, 0.95)', e.target.style.transform = 'translateY(0)', e.target.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.15)')}
            >
              ✓ {isLoading ? TEXTS.BTN_RENT_LOADING : TEXTS.BTN_RENT_LOGIN_REQUIRED}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

const styles = {
  overlay: { position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.5)", display: "flex", justifyContent: "center", alignItems: "center", zIndex: 1000 },
  modal: { background: "white", padding: "25px", borderRadius: "15px", width: "90%", maxWidth: "350px", textAlign: "center", boxShadow: "0 4px 15px rgba(0,0,0,0.2)" },
  input: { width: "100%", padding: "12px", borderRadius: "8px", border: "1px solid #ddd", boxSizing: "border-box", fontSize: "1rem" },
  label: { display: "block", textAlign: "left", fontSize: "0.85em", color: "#666", marginBottom: "5px" },
  checkboxContainer: { display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", padding: "5px 0" },
  resetBtn: { background: "none", border: "none", color: "#999", textDecoration: "underline", fontSize: "0.8em", marginTop: "10px", cursor: "pointer" },
  cancelBtn: { flex: 1, padding: "12px", borderRadius: "8px", border: "1px solid rgba(255, 255, 255, 0.2)", background: "rgba(108, 117, 125, 0.9)", color: "white", fontWeight: "600", cursor: "pointer", transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)", boxShadow: "0 2px 8px rgba(0, 0, 0, 0.15)" },
  confirmBtn: { flex: 2, padding: "12px", borderRadius: "8px", border: "1px solid rgba(255, 255, 255, 0.2)", background: "rgba(52, 152, 219, 0.95)", color: "white", fontWeight: "600", cursor: "pointer", transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)", boxShadow: "0 2px 8px rgba(0, 0, 0, 0.15)" }
};

export default LoginModal;
