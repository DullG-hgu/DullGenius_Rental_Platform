// /admin-secret/events/:id — 단일 행사 관리 (서브탭 컨테이너)
import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { getEvent, listRegistrations, listEventTeams } from './api_events';
import EventInfoForm from './EventInfoForm';
import EventRegistrationsView from './EventRegistrationsView';
import EventPaymentReconcile from './EventPaymentReconcile';
import EventCheckInView from './EventCheckInView';
import EventCsvExport from './EventCsvExport';
import EventTutorial from './EventTutorial';
import '../../Admin.css';

// 서브탭 → 튜토리얼 섹션 매핑
const TUTORIAL_FOR_SUBTAB = {
  info: 'info',
  registrations: 'registrations',
  payments: 'payments',
  checkin: 'checkin',
  export: 'export',
};

const SUBTABS = [
  { id: 'info', label: '정보' },
  { id: 'registrations', label: '신청자' },
  { id: 'payments', label: '입금' },
  { id: 'checkin', label: '출석' },
  { id: 'export', label: 'CSV' },
];

export default function EventDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { hasRole, loading: authLoading } = useAuth();
  const { showToast } = useToast();
  const isAdmin = hasRole('admin') || hasRole('executive');

  const [event, setEvent] = useState(null);
  const [registrations, setRegistrations] = useState([]);
  const [teams, setTeams] = useState([]);
  const [loadingEvent, setLoadingEvent] = useState(true);
  const [loadingRegs, setLoadingRegs] = useState(false);
  const [activeSub, setActiveSub] = useState('info');
  const [tutorialSection, setTutorialSection] = useState(null);

  const loadEvent = useCallback(async () => {
    setLoadingEvent(true);
    try {
      setEvent(await getEvent(id));
    } catch (e) {
      console.error(e);
      showToast('행사를 불러오지 못했습니다: ' + e.message, { type: 'error' });
    } finally {
      setLoadingEvent(false);
    }
  }, [id, showToast]);

  const loadRegs = useCallback(async () => {
    setLoadingRegs(true);
    try {
      const [regs, ts] = await Promise.all([listRegistrations(id), listEventTeams(id)]);
      setRegistrations(regs);
      setTeams(ts);
    } catch (e) {
      console.error(e);
      showToast('신청자를 불러오지 못했습니다: ' + e.message, { type: 'error' });
    } finally {
      setLoadingRegs(false);
    }
  }, [id, showToast]);

  useEffect(() => {
    if (!authLoading && isAdmin) loadEvent();
  }, [authLoading, isAdmin, loadEvent]);

  // 정보 탭 외에는 신청자 데이터도 필요
  useEffect(() => {
    if (!authLoading && isAdmin && activeSub !== 'info') loadRegs();
  }, [authLoading, isAdmin, activeSub, loadRegs]);

  if (authLoading) return null;
  if (!isAdmin) return <div className="admin-container"><p>권한이 없습니다.</p></div>;

  return (
    <div className="admin-container">
      <div className="admin-header">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <Link to="/admin-secret/events" style={{ color: 'var(--admin-text-sub)', fontSize: '0.85rem', textDecoration: 'none' }}>← 행사 목록</Link>
          <h2 style={{ margin: 0 }}>🎪 {event?.title || (loadingEvent ? '로딩 중…' : '행사')}</h2>
          {event?.slug && (
            <a
              href={`/event/${event.slug}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: 'var(--admin-primary)', fontSize: '0.85rem', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 }}
              title="새 탭에서 공개 페이지 열기"
            >
              <code style={{ color: 'inherit' }}>/event/{event.slug}</code>
              <span aria-hidden>↗</span>
            </a>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={() => setTutorialSection(TUTORIAL_FOR_SUBTAB[activeSub] || 'overview')}
            className="admin-btn"
            title="현재 탭의 사용법 보기"
          >
            ❓ 도움말
          </button>
          {event?.slug && (
            <a
              href={`/event/${event.slug}`}
              target="_blank"
              rel="noopener noreferrer"
              className="admin-btn"
              style={{ background: 'var(--admin-primary)', color: '#000', textDecoration: 'none' }}
            >
              👁️ 공개 페이지 보기
            </a>
          )}
          <button onClick={() => navigate('/admin-secret')} className="admin-btn admin-btn-home">관리자 홈</button>
        </div>
      </div>

      <div className="admin-tabs">
        {SUBTABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setActiveSub(t.id)}
            className={`admin-tab-btn ${activeSub === t.id ? 'active' : ''}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="admin-content">
        {loadingEvent && <p style={{ color: 'var(--admin-text-sub)' }}>로딩 중…</p>}

        {!loadingEvent && event && activeSub === 'info' && (
          <EventInfoForm event={event} onSaved={(saved) => setEvent(saved)} />
        )}

        {!loadingEvent && event && activeSub !== 'info' && loadingRegs && (
          <p style={{ color: 'var(--admin-text-sub)' }}>신청자 불러오는 중…</p>
        )}

        {!loadingEvent && event && activeSub === 'registrations' && !loadingRegs && (
          <EventRegistrationsView event={event} registrations={registrations} teams={teams} reload={loadRegs} />
        )}
        {!loadingEvent && event && activeSub === 'payments' && !loadingRegs && (
          <EventPaymentReconcile event={event} registrations={registrations} reload={loadRegs} />
        )}
        {!loadingEvent && event && activeSub === 'checkin' && !loadingRegs && (
          <EventCheckInView event={event} registrations={registrations} reload={loadRegs} />
        )}
        {!loadingEvent && event && activeSub === 'export' && !loadingRegs && (
          <EventCsvExport event={event} registrations={registrations} />
        )}
      </div>

      {tutorialSection && (
        <EventTutorial initialSection={tutorialSection} onClose={() => setTutorialSection(null)} />
      )}
    </div>
  );
}
