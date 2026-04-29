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

import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchGames, fetchConfig, fetchOfficeStatus } from './api';
import { useAuth } from './contexts/AuthContext'; // [SECURITY] Supabase 권한 기반 인증
import { useToast } from './contexts/ToastContext';
import './Admin.css'; // [NEW] 다크 모드 스타일 임포트

// 분리된 컴포넌트 임포트 (admin 폴더 생성 필요)
import DashboardTab from './admin/DashboardTab';
import AddGameTab from './admin/AddGameTab';
import ConfigTab from './admin/ConfigTab';
import PointsTab from './admin/PointsTab';
import MembersTab from './admin/MembersTab'; // [NEW]
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
  const [loading, setLoading] = useState(false);
  const [officeStatus, setOfficeStatus] = useState(null);

  // 오피스아워 진행 중 이동/로그아웃 시 확인용 모달
  const [exitConfirm, setExitConfirm] = useState({ isOpen: false, action: null, target: null });

  // --- 데이터 로딩 (SWR 패턴 적용) ---
  const loadData = useCallback(async () => {
    // 1. (배경) 로딩 표시 시작
    setLoading(true);
    try {
      const [gamesData, configData] = await Promise.all([fetchGames(), fetchConfig()]);

      // [FIX] gamesData가 배열인지 확인 (에러 객체 반환 가능성 대응)
      let validGames = [];
      if (Array.isArray(gamesData)) {
        validGames = gamesData;
      } else if (gamesData?.error) {
        showToast(gamesData.message, { type: "error" });
        return; // 에러 시 중단
      }

      // 정렬 로직 (우선순위: 예약됨 > 대여중 > 일부대여중 > 대여가능 > 분실)
      // [FIX] 반납/수령 처리를 위해 '예약됨(찜)', '대여중'을 상위로 이동
      const priority = { "예약됨": 1, "대여중": 2, "일부대여중": 3, "대여가능": 4, "분실": 5, "수리중": 6 };

      const sortedGames = validGames.sort((a, b) => {
        // 1. 상태 우선순위 비교 (관리자용 adminStatus 기준)
        const priorityA = priority[a.adminStatus] || 99;
        const priorityB = priority[b.adminStatus] || 99;
        if (priorityA !== priorityB) return priorityA - priorityB;

        // 2. 같은 상태면 이름순 정렬
        return a.name.localeCompare(b.name, 'ko');
      });

      setGames(sortedGames);
      if (configData?.length) setConfig(configData);

      // ⭐ [핵심] 최신 데이터를 받으면 로컬 스토리지도 갱신한다! (타임스탬프 포함)
      localStorage.setItem('games_cache', JSON.stringify({
        data: sortedGames,
        timestamp: Date.now()
      }));

    } catch (e) {
      console.error('[Admin] 초기 데이터 로딩 실패:', e);
      showToast("데이터 로딩 실패 (인터넷 연결 확인)", { type: "error" });
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  // 오피스아워 상태 로드
  const loadOfficeStatus = useCallback(async () => {
    const status = await fetchOfficeStatus();
    setOfficeStatus(status);
  }, []);

  // 인증 성공 시 데이터 최초 로드
  useEffect(() => {
    if (user && isAdmin) {
      // 캐시가 있으면 먼저 보여준다! (0초 로딩)
      const cachedGames = localStorage.getItem('games_cache');
      if (cachedGames) {
        try {
          const parsedCache = JSON.parse(cachedGames);
          // [FIX] 변경된 캐시 구조 ({ data, timestamp }) 대응
          if (parsedCache.data && Array.isArray(parsedCache.data)) {
            setGames(parsedCache.data);
          } else if (Array.isArray(parsedCache)) {
            // 구버전 캐시 대응 (혹시 모를 하위 호환성)
            setGames(parsedCache);
          }
        } catch (e) {
          console.warn("캐시 파싱 실패");
        }
      }
      loadData();
      loadOfficeStatus();
    }
  }, [user?.id, isAdmin, loadData, loadOfficeStatus]);


  // --- 3. 로딩 및 권한 체크 ---

  // 오피스아워 상태
  const isOfficeOpen = officeStatus?.open &&
    (!officeStatus.auto_close_at || new Date() < new Date(officeStatus.auto_close_at));

  const handleOfficeOpen = async () => {
    try {
      await setOfficeOpen();
      await loadOfficeStatus();
      showToast("🟢 출근 완료! 오피스아워가 시작되었습니다.", { type: "success" });
    } catch (e) {
      console.error('[Admin] 출근 처리 실패:', e);
      showToast("오류: " + e.message, { type: "error" });
    }
  };

  const handleOfficeClosed = async () => {
    try {
      await setOfficeClosed();
      await loadOfficeStatus();
      showToast("퇴근 완료! 오피스아워가 종료되었습니다.", { type: "success" });
    } catch (e) {
      console.error('[Admin] 퇴근 처리 실패:', e);
      showToast("오류: " + e.message, { type: "error" });
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
    await handleOfficeClosed();
    if (action === 'navigate') {
      navigate(target);
    } else if (action === 'logout') {
      logout();
    }
  };

  // --- 4. 렌더링: 관리자 메인 화면 ---
  return (
    <div className="admin-container">
      {/* 상단 헤더 */}
      <div className="admin-header">
        <h2>🔓 관리자 페이지</h2>
        <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
          {/* 오피스아워 빠른 토글 */}
          <div style={{ display: "flex", alignItems: "center", gap: "8px", padding: "6px 12px", background: "var(--admin-card-bg)", borderRadius: "8px", border: "1px solid var(--admin-border)" }}>
            <span style={{ fontSize: "0.85rem", color: isOfficeOpen ? "#27ae60" : "var(--admin-text-sub)", fontWeight: "bold" }}>
              {isOfficeOpen ? "🟢 운영중" : "⭕ 오프라인"}
            </span>
            {isOfficeOpen ? (
              <button onClick={handleOfficeClosed} className="admin-btn" style={{ background: "#e74c3c", padding: "4px 12px", fontSize: "0.85rem" }}>퇴근</button>
            ) : (
              <button onClick={handleOfficeOpen} className="admin-btn" style={{ background: "#27ae60", padding: "4px 12px", fontSize: "0.85rem" }}>출근</button>
            )}
          </div>
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
          hint="회비 검사 on/off, 학기 초기화, 오피스아워 설정" />
        <TabButton label="👥 회원 관리" id="members" activeTab={activeTab} onClick={setActiveTab}
          hint="회원 목록, 회비 납부 상태, 비밀번호 초기화, 권한 변경" />
        <TabButton label="💰 포인트 시스템" id="points" activeTab={activeTab} onClick={setActiveTab}
          hint="회원별 포인트 잔액과 적립/차감 이력 관리" />
        <TabButton label="🎨 홈페이지 설정" id="config" activeTab={activeTab} onClick={setActiveTab}
          hint="홈 화면에 노출되는 배너/문구/색상 등을 수정" />
        <TabButton label="📊 통계" id="stats" activeTab={activeTab} onClick={setActiveTab}
          hint="대여 건수, 인기 게임, 회원 활동 통계" />
      </div>

      {/* 탭 컨텐츠 영역 */}
      <div className="admin-content">
        {activeTab === "dashboard" && (
          <>
            <AdminOverviewCard
              games={games}
              isOfficeOpen={isOfficeOpen}
              onGoReports={() => setActiveTab('reports')}
            />
            <DashboardTab
              games={games}
              loading={loading}
              onReload={loadData}
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
          <SystemTab />
        )}

        {activeTab === "points" && (
          <PointsTab />
        )}

        {activeTab === "members" && ( // [NEW]
          <MembersTab />
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