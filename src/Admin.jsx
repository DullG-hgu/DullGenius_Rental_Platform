// src/Admin.js
// 최종 수정일: 2026.01.30 (다크 모드 적용)
// 설명: 관리자 페이지 메인 (인증 및 탭 컨테이너)

/*
 * ============================================================
 * [GUIDE] Admin Page Dark Mode Strategy
 * ============================================================
 * This Admin Page is designed to be PERMANENTLY DARK.
 * When adding new components or features to this page:
 * 1. DO NOT use white backgrounds. Use var(--admin-bg) or var(--admin-card-bg).
 * 2. DO NOT use black text. Use var(--admin-text-main) or var(--admin-text-sub).
 * 3. Use the CSS variables defined below for consistency.
 * ============================================================
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchGames, fetchConfig, fetchOfficeStatus, fetchUsers } from './api';
import { useAuth } from './contexts/AuthContext'; // [SECURITY] Supabase 권한 기반 인증
import { useToast } from './contexts/ToastContext';
import './Admin.css'; // [NEW] 다크 모드 스타일 임포트

// 분리된 컴포넌트 임포트 (admin 폴더 생성 필요)
import DashboardTab from './admin/DashboardTab';
import AddGameTab from './admin/AddGameTab';
import ConfigTab from './admin/ConfigTab';
import PointsTab from './admin/PointsTab';
import MembersTab from './admin/MembersTab'; // [NEW]
import OfficeHoursTab from './admin/OfficeHoursTab';
import SystemTab from './admin/SystemTab'; // [NEW] 시스템 설정 탭
import ReportsTab from './admin/ReportsTab'; // [NEW] 신고/신청 관리 탭
import RentalRequestsTab from './admin/RentalRequestsTab';
import AdminOverviewCard from './admin/AdminOverviewCard'; // [NEW] 대시보드 상단 안내 카드
import ConfirmModal from './components/ConfirmModal';
const StatsTab = React.lazy(() => import('./admin/StatsTab'));
import { setOfficeOpen, setOfficeClosed } from './api_members';

function Admin() {
  const { user, hasRole, logout, loading: authLoading } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();

  // --- 1. 권한 체크: 관리자 권한이 있는지 확인 ---
  // [SECURITY] dev_admin_bypass는 개발 환경(vite dev server)에서만 동작.
  // 프로덕션 빌드에서는 import.meta.env.DEV가 false이므로 우회 불가.
  const isDevBypass = import.meta.env.DEV && sessionStorage.getItem('dev_admin_bypass') === 'true';
  const isAdmin = hasRole('admin') || hasRole('executive') || isDevBypass;



  // --- 2. 데이터 상태 관리 (하위 탭들과 공유) ---
  const [activeTab, setActiveTab] = useState("dashboard");
  const [games, setGames] = useState([]);
  const [config, setConfig] = useState([]);
  const [adminUsers, setAdminUsers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [officeStatus, setOfficeStatus] = useState(null);
  const scope = !authLoading && user && isAdmin ? user.id : null;
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const requests = useRef({ games: 0, users: 0, office: 0 });
  const [dataScope, setDataScope] = useState(null);
  const [officeError, setOfficeError] = useState(false);

  // 오피스아워 진행 중 이동/로그아웃 시 확인용 모달
  const [exitConfirm, setExitConfirm] = useState({ isOpen: false, action: null, target: null });

  // Keep privileged rental/member data in memory and discard superseded responses.
  const loadData = useCallback(async () => {
    if (!scope || scopeRef.current !== scope) return;
    const request = ++requests.current.games;
    setLoading(true);
    const [gamesResult, configResult] = await Promise.allSettled([fetchGames(), fetchConfig()]);
    if (scopeRef.current !== scope || requests.current.games !== request) return;
    if (gamesResult.status === 'fulfilled') {
      const priority = { "예약됨": 1, "대여중": 2, "일부대여중": 3, "대여가능": 4 };
      setGames([...gamesResult.value].sort((a, b) =>
        (priority[a.adminStatus] || 99) - (priority[b.adminStatus] || 99)
        || a.name.localeCompare(b.name, 'ko')));
    } else {
      showToast("게임 데이터 로딩 실패 (인터넷 연결 확인)", { type: "error" });
    }
    if (configResult.status === 'fulfilled') setConfig(configResult.value || []);
    else showToast("홈페이지 설정을 불러오지 못했습니다.", { type: "error" });
    setLoading(false);
  }, [scope, showToast]);

  const loadAdminUsers = useCallback(async ({ throwOnError = false } = {}) => {
    if (!scope || scopeRef.current !== scope) return [];
    const request = ++requests.current.users;
    try {
      const usersData = await fetchUsers();
      if (scopeRef.current !== scope || requests.current.users !== request) return [];
      const validUsers = Array.isArray(usersData) ? usersData : [];
      setAdminUsers(validUsers);
      return validUsers;
    } catch (error) {
      if (scopeRef.current !== scope || requests.current.users !== request) return [];
      if (throwOnError) throw error;
      showToast("회원 데이터 로딩 실패", { type: "error" });
      return [];
    }
  }, [scope, showToast]);

  const loadOfficeStatus = useCallback(async () => {
    if (!scope || scopeRef.current !== scope) return null;
    const request = ++requests.current.office;
    try {
      const status = await fetchOfficeStatus();
      if (scopeRef.current !== scope || requests.current.office !== request) return null;
      setOfficeStatus(status);
      setOfficeError(false);
      return status;
    } catch {
      if (scopeRef.current !== scope || requests.current.office !== request) return null;
      setOfficeStatus(null);
      setOfficeError(true);
      showToast("오피스아워 상태를 확인하지 못했습니다. 다시 조회해 주세요.", { type: "error" });
      return null;
    }
  }, [scope, showToast]);

  useEffect(() => {
    setDataScope(scope);
    setGames([]);
    setAdminUsers([]);
    setConfig([]);
    setOfficeStatus(null);
    setOfficeError(false);
    try { localStorage.removeItem('games_cache'); } catch { /* Storage may be unavailable. */ }
    if (scope) {
      loadData();
      loadAdminUsers();
      loadOfficeStatus();
    }
    return () => {
      requests.current.games += 1;
      requests.current.users += 1;
      requests.current.office += 1;
    };
  }, [scope, loadData, loadAdminUsers, loadOfficeStatus]);

  // --- 3. 로딩 및 권한 체크 ---

  // 오피스아워 상태
  const isOfficeOpen = officeStatus?.open &&
    (!officeStatus.auto_close_at || new Date() < new Date(officeStatus.auto_close_at));

  const handleOfficeOpen = async () => {
    try {
      await setOfficeOpen();
      if (!await loadOfficeStatus()) return false;
      showToast("🟢 출근 완료! 오피스아워가 시작되었습니다.", { type: "success" });
      return true;
    } catch (e) {
      console.error('[Admin] 출근 처리 실패:', e);
      showToast("오류: " + e.message, { type: "error" });
      return false;
    }
  };

  const handleOfficeClosed = async () => {
    try {
      await setOfficeClosed();
      if (!await loadOfficeStatus()) return false;
      showToast("퇴근 완료! 오피스아워가 종료되었습니다.", { type: "success" });
      return true;
    } catch (e) {
      console.error('[Admin] 퇴근 처리 실패:', e);
      showToast("오류: " + e.message, { type: "error" });
      return false;
    }
  };

  // 브라우저 닫기/새로고침 가드
  useEffect(() => {
    if (!isOfficeOpen) return;
    const handleBeforeUnload = (e) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isOfficeOpen]);

  // 앱 내 이동 가드: 퇴근 후 이동
  const guardedNavigate = (path) => {
    if (!isOfficeOpen) { navigate(path); return; }
    setExitConfirm({ isOpen: true, action: 'navigate', target: path });
  };

  const guardedLogout = () => {
    if (!isOfficeOpen) { logout(); return; }
    setExitConfirm({ isOpen: true, action: 'logout', target: null });
  };

  const handleExitConfirm = async () => {
    const { action, target } = exitConfirm;
    if (!await handleOfficeClosed()) return;
    if (action === 'navigate') {
      navigate(target);
    } else if (action === 'logout') {
      logout();
    }
  };

  if (authLoading || dataScope !== scope) return <div className="admin-container">불러오는 중...</div>;
  if (!scope) return <div className="admin-container">관리자 권한이 필요합니다.</div>;

  // --- 4. 렌더링: 관리자 메인 화면 ---
  return (
    <div className="admin-container">
      {/* 상단 헤더 */}
      <div className="admin-header">
        <h2>🔓 관리자 페이지</h2>
        <div className="admin-header-actions">
          <button onClick={guardedLogout} className="admin-btn admin-btn-logout">로그아웃</button>
          <button onClick={() => guardedNavigate('/')} className="admin-btn admin-btn-home">🏠 메인으로</button>
          <button onClick={() => guardedNavigate('/admin-secret/events')} className="admin-btn" style={{ background: "#bb86fc", color: "#000" }}>🎪 행사 관리</button>
          <button onClick={() => navigate('/kiosk')} className="admin-btn" style={{ background: "#667eea" }}>📱 키오스크</button>
        </div>
      </div>

      {/* 탭 버튼 영역 */}
      <div className="admin-tabs">
        <TabButton label="📋 대여 현황 / 태그" id="dashboard" activeTab={activeTab} onClick={setActiveTab}
          hint="게임 대여/반납 처리, 게임 정보 수정, 대여 이력 확인" />
        <TabButton label="📢 신고/신청 관리" id="reports" activeTab={activeTab} onClick={setActiveTab}
          hint="회원이 올린 파손 신고와 게임 신청을 확인·처리" />
        <TabButton label="📝 외부 대여 신청" id="rental_requests" activeTab={activeTab} onClick={setActiveTab}
          hint="Google Form으로 들어온 외부 단체 대여 신청 검토·승인" />
        <TabButton label="➕ 게임 추가" id="add" activeTab={activeTab} onClick={setActiveTab}
          hint="BGG에서 새 게임을 검색해 목록에 등록" />
        <TabButton label="⚙️ 시스템 설정" id="system" activeTab={activeTab} onClick={setActiveTab}
          hint="회원 회비 통계, 학기 초기화" />
        <TabButton label="🕒 오피스아워" id="office" activeTab={activeTab} onClick={setActiveTab}
          hint="1주차 무료 대여: 출근·퇴근, 전체 회원 대여 허용, 운영 안내 설정" />
        <TabButton label="👥 회원 관리" id="members" activeTab={activeTab} onClick={setActiveTab}
          hint="회원 목록, 회비 납부 상태, 비밀번호 초기화, 권한 변경" />
        <TabButton label="💰 포인트 시스템" id="points" activeTab={activeTab} onClick={setActiveTab}
          hint="회원별 포인트 잔액과 적립/차감 이력 관리" />
        <TabButton label="🎨 홈페이지 설정" id="config" activeTab={activeTab} onClick={setActiveTab}
          hint="홈 화면에 노출되는 배너/문구/색상 등을 수정" />
        <TabButton label="📊 통계" id="stats" activeTab={activeTab} onClick={setActiveTab}
          hint="기간·회원·게임·행동별 대여, 찜, 로그 분석" />
      </div>

      {/* 탭 컨텐츠 영역 */}
      <div className="admin-content">
        {activeTab === "dashboard" && (
          <>
            <AdminOverviewCard
              games={games}
              isOfficeOpen={isOfficeOpen}
              onGoOffice={() => setActiveTab('office')}
              onGoReports={() => setActiveTab('reports')}
              onGoRentalRequests={() => setActiveTab('rental_requests')}
            />
            <DashboardTab
              games={games}
              loading={loading}
              onReload={loadData}
              users={adminUsers}
            />
          </>
        )}

        {activeTab === "reports" && (
          <ReportsTab />
        )}

        {activeTab === "rental_requests" && (
          <RentalRequestsTab />
        )}

        {activeTab === "add" && (
          <AddGameTab
            onGameAdded={loadData} // 게임 추가 후 목록 갱신을 위해 전달
          />
        )}

        {activeTab === "config" && (
          <ConfigTab
            config={config}
            onReload={loadData} // 설정 저장 후 갱신을 위해 전달
          />
        )}

        {activeTab === "system" && ( // [NEW]
          <SystemTab users={adminUsers} onUsersReload={() => loadAdminUsers({ throwOnError: true })} />
        )}

        {activeTab === "office" && (
          <OfficeHoursTab isOfficeOpen={isOfficeOpen} statusKnown={officeStatus !== null}
            officeError={officeError} onReloadStatus={loadOfficeStatus}
            onOpen={handleOfficeOpen} onClose={handleOfficeClosed} />
        )}

        {activeTab === "points" && (
          <PointsTab />
        )}

        {activeTab === "members" && ( // [NEW]
          <MembersTab users={adminUsers} onUsersReload={loadAdminUsers} />
        )}

        {activeTab === "stats" && (
          <React.Suspense fallback={<div style={{ padding: '40px', textAlign: 'center', color: 'var(--admin-text-sub)' }}>로딩 중...</div>}>
            <StatsTab />
          </React.Suspense>
        )}
      </div>

      {/* 오피스아워 진행 중 이동/로그아웃 확인 */}
      <ConfirmModal
        isOpen={exitConfirm.isOpen}
        onClose={() => setExitConfirm({ isOpen: false, action: null, target: null })}
        onConfirm={handleExitConfirm}
        title="⚠️ 오피스아워 진행 중"
        message={
          exitConfirm.action === 'logout'
            ? '지금 로그아웃하면 자동으로 퇴근 처리됩니다.\n계속하시겠습니까?'
            : '지금 이동하면 자동으로 퇴근 처리됩니다.\n계속하시겠습니까?'
        }
        confirmText="퇴근하고 진행"
        cancelText="취소"
        type="warning"
      />
    </div>
  );
}

// --- 스타일 및 서브 컴포넌트 ---

// 탭 버튼 컴포넌트 (CSS 클래스 사용)
// hint: 마우스 호버 시 표시되는 한 줄 설명 (첫 방문자용 가이드)
const TabButton = ({ label, id, activeTab, onClick, hint }) => (
  <button
    onClick={() => onClick(id)}
    className={`admin-tab-btn ${activeTab === id ? 'active' : ''}`}
    title={hint}
    aria-label={hint ? `${label} — ${hint}` : label}
  >
    {label}
  </button>
);

export default Admin;
