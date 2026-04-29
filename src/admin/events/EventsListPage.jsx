// /admin-secret/events — 행사 목록 + 새 행사 생성 모달 + 복제
import React, { useEffect, useState, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { listEvents, createEvent, cloneEvent, softDeleteEvent } from './api_events';
import EventTutorial from './EventTutorial';
import '../../Admin.css';

const STATUS_BADGE = {
  draft: { text: '초안', bg: '#7f8c8d' },
  recruiting: { text: '모집중', bg: '#27ae60' },
  closed: { text: '마감', bg: '#e67e22' },
  ongoing: { text: '진행중', bg: '#3498db' },
  finished: { text: '종료', bg: '#34495e' },
};

const fmt = (iso) => {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  } catch { return iso; }
};

export default function EventsListPage() {
  const navigate = useNavigate();
  const { hasRole, loading: authLoading } = useAuth();
  const { showToast } = useToast();
  const isAdmin = hasRole('admin') || hasRole('executive');

  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [cloneSourceId, setCloneSourceId] = useState(null);
  const [tutorialSection, setTutorialSection] = useState(null); // null = closed

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setEvents(await listEvents());
    } catch (e) {
      console.error(e);
      showToast('행사 목록 로딩 실패: ' + e.message, { type: 'error' });
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    if (!authLoading && isAdmin) load();
  }, [authLoading, isAdmin, load]);

  const handleDelete = async (ev) => {
    if (!confirm(`"${ev.title}"을(를) 삭제하시겠습니까? (soft delete — 복구 가능)`)) return;
    try {
      await softDeleteEvent(ev.id);
      showToast('삭제되었습니다.', { type: 'success' });
      load();
    } catch (e) {
      showToast('삭제 실패: ' + e.message, { type: 'error' });
    }
  };

  if (authLoading) return null;
  if (!isAdmin) return <div className="admin-container"><p>권한이 없습니다.</p></div>;

  return (
    <div className="admin-container">
      <div className="admin-header">
        <div>
          <Link to="/admin-secret" style={{ color: 'var(--admin-text-sub)', fontSize: '0.85rem', textDecoration: 'none' }}>← 관리자 홈</Link>
          <h2 style={{ margin: '4px 0 0' }}>🎪 행사 관리</h2>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => setTutorialSection('overview')} className="admin-btn" title="행사 시스템 사용법">📖 튜토리얼</button>
          <button onClick={() => setCreateOpen(true)} className="admin-btn" style={{ background: 'var(--admin-primary)', color: '#000' }}>+ 새 행사</button>
        </div>
      </div>

      <div className="admin-content">
        {loading ? (
          <p style={{ color: 'var(--admin-text-sub)' }}>로딩 중…</p>
        ) : events.length === 0 ? (
          <div style={empty}>
            <p style={{ margin: 0, fontSize: '1rem' }}>아직 등록된 행사가 없습니다.</p>
            <p style={{ margin: 0, fontSize: '0.85rem' }}>처음이라면 튜토리얼을 먼저 훑어보세요 — 5분이면 전체 흐름을 익힐 수 있어요.</p>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setTutorialSection('overview')} className="admin-btn">📖 튜토리얼 보기</button>
              <button onClick={() => setCreateOpen(true)} className="admin-btn" style={{ background: 'var(--admin-primary)', color: '#000' }}>첫 행사 만들기</button>
            </div>
          </div>
        ) : (
          <table style={table}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--admin-border)' }}>
                <th style={th}>행사명</th>
                <th style={th}>슬러그</th>
                <th style={th}>상태</th>
                <th style={th}>모집</th>
                <th style={th}>행사 시작</th>
                <th style={th}>정원</th>
                <th style={th}>액션</th>
              </tr>
            </thead>
            <tbody>
              {events.map((ev) => {
                const badge = STATUS_BADGE[ev.status] || { text: ev.status, bg: '#666' };
                return (
                  <tr key={ev.id} style={{ borderBottom: '1px solid var(--admin-border)' }}>
                    <td style={td}>
                      <Link to={`/admin-secret/events/${ev.id}`} style={{ color: 'var(--admin-text-main)', fontWeight: 600, textDecoration: 'none' }}>{ev.title}</Link>
                      {ev.subtitle && <div style={{ color: 'var(--admin-text-sub)', fontSize: '0.8rem' }}>{ev.subtitle}</div>}
                    </td>
                    <td style={td}><code style={{ color: 'var(--admin-text-sub)', fontSize: '0.8rem' }}>{ev.slug}</code></td>
                    <td style={td}>
                      <span style={{ background: badge.bg, color: '#fff', padding: '2px 8px', borderRadius: 12, fontSize: '0.75rem' }}>{badge.text}</span>
                    </td>
                    <td style={td}><span style={small}>{fmt(ev.recruit_start_at)}<br />~ {fmt(ev.recruit_end_at)}</span></td>
                    <td style={td}><span style={small}>{fmt(ev.event_start_at)}</span></td>
                    <td style={td}>{ev.capacity == null ? '∞' : `${ev.capacity}${ev.capacity_unit === 'team' ? '팀' : '명'}`}</td>
                    <td style={td}>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button onClick={() => navigate(`/admin-secret/events/${ev.id}`)} style={btn}>관리</button>
                        <a href={`/event/${ev.slug}`} target="_blank" rel="noopener noreferrer" style={{ ...btn, textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }} title="새 탭에서 공개 페이지 열기">보기 ↗</a>
                        <button onClick={() => setCloneSourceId(ev.id)} style={btn}>복제</button>
                        <button onClick={() => handleDelete(ev)} style={{ ...btn, color: 'var(--admin-danger)' }}>삭제</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {createOpen && (
        <CreateEventModal
          onClose={() => setCreateOpen(false)}
          onCreated={(ev) => { setCreateOpen(false); navigate(`/admin-secret/events/${ev.id}`); }}
        />
      )}
      {cloneSourceId && (
        <CloneEventModal
          sourceId={cloneSourceId}
          onClose={() => setCloneSourceId(null)}
          onCloned={(ev) => { setCloneSourceId(null); navigate(`/admin-secret/events/${ev.id}`); }}
        />
      )}
      {tutorialSection && (
        <EventTutorial initialSection={tutorialSection} onClose={() => setTutorialSection(null)} />
      )}
    </div>
  );
}

// --- 모달들 ---

function CreateEventModal({ onClose, onCreated }) {
  const { showToast } = useToast();
  const [title, setTitle] = useState('');
  const [slug, setSlug] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!title.trim() || !slug.trim()) return showToast('행사명과 슬러그는 필수입니다.', { type: 'error' });
    if (!/^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/.test(slug)) return showToast('슬러그는 3~64자, 영문 소문자/숫자/하이픈만 가능하고 양 끝은 영문/숫자여야 합니다.', { type: 'error' });
    setBusy(true);
    try {
      // 임시 일정: 지금 ~ +7일 모집, +14일 행사. 사용자가 정보 탭에서 곧바로 수정.
      const now = new Date();
      const plus = (d) => { const x = new Date(now); x.setDate(x.getDate() + d); return x.toISOString(); };
      const ev = await createEvent({
        slug: slug.trim(),
        title: title.trim(),
        status: 'draft',
        recruit_start_at: now.toISOString(),
        recruit_end_at: plus(7),
        event_start_at: plus(14),
        participation_mode: 'individual',
        pricing: { base: { paid_member: 0, non_member: 0, walk_in: 0 } },
      });
      showToast('초안 생성됨 — 정보 탭에서 세부 사항을 채워주세요.', { type: 'success' });
      onCreated(ev);
    } catch (e) {
      const msg = e.message || '';
      if (msg.includes('duplicate key') || msg.includes('events_slug_unique')) showToast('이미 사용 중인 슬러그입니다.', { type: 'error' });
      else showToast('생성 실패: ' + msg, { type: 'error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal onClose={onClose} title="새 행사 만들기">
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <label style={modalField}>
          <span>행사명</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="할리갈리 학부 대항전" style={modalInput} autoFocus />
        </label>
        <label style={modalField}>
          <span>슬러그 (URL용)</span>
          <input value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase())} placeholder="halligalli-2026" style={modalInput} />
        </label>
        <p style={{ fontSize: '0.8rem', color: 'var(--admin-text-sub)', margin: 0 }}>
          초안 상태로 만들어집니다. 일정·가격·콘텐츠 등은 다음 화면에서 채울 수 있어요.
        </p>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" onClick={onClose} style={btnSecondary}>취소</button>
          <button type="submit" disabled={busy} style={btnPrimary}>{busy ? '생성 중…' : '만들기'}</button>
        </div>
      </form>
    </Modal>
  );
}

function CloneEventModal({ sourceId, onClose, onCloned }) {
  const { showToast } = useToast();
  const [slug, setSlug] = useState('');
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!slug.trim()) return showToast('슬러그는 필수입니다.', { type: 'error' });
    if (!/^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/.test(slug)) return showToast('슬러그는 3~64자, 영문 소문자/숫자/하이픈만 가능하고 양 끝은 영문/숫자여야 합니다.', { type: 'error' });
    setBusy(true);
    try {
      const ev = await cloneEvent(sourceId, { newSlug: slug.trim(), newTitle: title.trim() || undefined });
      showToast('복제 완료 — 일정·세부 사항을 수정해주세요.', { type: 'success' });
      onCloned(ev);
    } catch (e) {
      const msg = e.message || '';
      if (msg.includes('duplicate key') || msg.includes('events_slug_unique')) showToast('이미 사용 중인 슬러그입니다.', { type: 'error' });
      else showToast('복제 실패: ' + msg, { type: 'error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal onClose={onClose} title="행사 복제">
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <p style={{ fontSize: '0.85rem', color: 'var(--admin-text-sub)', margin: 0 }}>
          콘텐츠·디자인·가격·결제 안내는 그대로 복사됩니다. 일정과 신청자는 비워집니다.
        </p>
        <label style={modalField}>
          <span>새 슬러그</span>
          <input value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase())} placeholder="halligalli-2027" style={modalInput} autoFocus />
        </label>
        <label style={modalField}>
          <span>새 행사명 (비우면 "(복제)" 접미사)</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="할리갈리 학부 대항전 2027" style={modalInput} />
        </label>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" onClick={onClose} style={btnSecondary}>취소</button>
          <button type="submit" disabled={busy} style={btnPrimary}>{busy ? '복제 중…' : '복제'}</button>
        </div>
      </form>
    </Modal>
  );
}

function Modal({ title, onClose, children }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: 'var(--admin-card-bg)', border: '1px solid var(--admin-border)', borderRadius: 8, padding: 24, width: '100%', maxWidth: 480, color: 'var(--admin-text-main)' }}>
        <h3 style={{ margin: '0 0 16px' }}>{title}</h3>
        {children}
      </div>
    </div>
  );
}

// --- styles ---
const empty = { textAlign: 'center', padding: 60, background: 'var(--admin-card-bg)', border: '1px dashed var(--admin-border)', borderRadius: 8, color: 'var(--admin-text-sub)', display: 'flex', flexDirection: 'column', gap: 14, alignItems: 'center' };
const table = { width: '100%', borderCollapse: 'collapse', background: 'var(--admin-card-bg)', borderRadius: 8 };
const th = { padding: '12px', textAlign: 'left', color: 'var(--admin-text-sub)', fontSize: '0.85rem', fontWeight: 600 };
const td = { padding: '12px', color: 'var(--admin-text-main)', fontSize: '0.9rem', verticalAlign: 'top' };
const small = { fontSize: '0.8rem', color: 'var(--admin-text-sub)' };
const btn = { padding: '4px 10px', background: 'transparent', color: 'var(--admin-text-main)', border: '1px solid var(--admin-border)', borderRadius: 4, cursor: 'pointer', fontSize: '0.8rem' };
const btnPrimary = { padding: '8px 16px', background: 'var(--admin-primary)', color: '#000', border: 'none', borderRadius: 4, cursor: 'pointer', fontWeight: 600 };
const btnSecondary = { padding: '8px 16px', background: 'transparent', color: 'var(--admin-text-main)', border: '1px solid var(--admin-border)', borderRadius: 4, cursor: 'pointer' };
const modalField = { display: 'flex', flexDirection: 'column', gap: 4, color: 'var(--admin-text-sub)', fontSize: '0.85rem' };
const modalInput = { padding: '8px 10px', background: 'var(--admin-bg)', color: 'var(--admin-text-main)', border: '1px solid var(--admin-border)', borderRadius: 4, fontSize: '0.9rem' };
