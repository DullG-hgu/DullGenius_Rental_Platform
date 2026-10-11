// 대여자별 처리 — 「오늘의 할 일」의 「대여자별 처리」로 여는 모달.
// 게임 카드 대신 "사람" 기준으로 찜·대여를 모아, 폰에서도 이름 검색 한 번으로 수령·반납·연장까지 끝내게 한다.
// 실제 처리는 DashboardTab 의 핸들러(rental_id 지정 경로)를 그대로 쓴다 — 확인 모달·토스트·재조회가 같다.
// (10/12 사용자 피드백: 대여 현황 본문에 크게 깔리면 게임 관리가 밀려 불필요 → 모달로, 사람별 묶음은 기본 접힘)
import { useEffect, useMemo, useState } from 'react';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock.jsx';
import { useFocusTrap } from '../../hooks/useFocusTrap.jsx';
import { choseongStartsWith } from '../../lib/hangul';
import { holdOverdueDays, rentalDDayLabel, rentalDueDays } from '../../lib/rentalDue';
import HoldOverdueBadge from './HoldOverdueBadge';

// renter_name 이 이름이 아닌 자리표시자로 저장되는 경로가 있다 (웹 대여 '회원', 관리자 처리 '관리자')
const PLACEHOLDER_NAMES = new Set(['회원', '관리자', 'Unknown']);

const clean = (s) => String(s || '').replace(/\s+/g, '').toLowerCase();

// 연체 판정은 rentalDue.js 한 곳. 회원 대여는 마감 시각을 넘기면 연체 1일, 단체 대여(HOLD)는 기한 다음 날부터
const overdueDaysOf = (rental, now) => {
  if (!rental.due_date) return 0;
  if (rental.type === 'HOLD') return holdOverdueDays(rental.due_date, now);
  if (rental.type !== 'RENT') return 0;
  const due = rentalDueDays(rental.due_date, now);
  return due?.overdue ? Math.max(1, -due.days) : 0;
};

/** games[].rentals 를 사람 단위로 묶는다. 회원은 user_id, 비회원 수기는 이름으로. */
export function groupRentalsByPerson(games, users = [], now = new Date()) {
  const usersById = new Map((users || []).map((u) => [u.id, u]));
  const people = new Map();

  for (const game of games || []) {
    for (const rental of game.rentals || []) {
      if (rental.returned_at) continue;
      if (!['DIBS', 'RENT', 'HOLD'].includes(rental.type)) continue;

      const user = rental.user_id ? usersById.get(rental.user_id) : null;
      const rawName = (rental.renter_name || '').trim();
      const name = user?.name || rental.profiles?.name
        || (rawName && !PLACEHOLDER_NAMES.has(rawName) ? rawName : '') || rawName || '이름 없음';
      // 비회원은 이름으로 묶는다. 이름이 자리표시자뿐이면 누군지 모르니 건별로 둔다 (서로 다른 사람이 한 카드로 합쳐지지 않게)
      const unnamed = !rental.user_id && (!rawName || PLACEHOLDER_NAMES.has(rawName)) && !rental.profiles?.name;
      const key = rental.user_id ? `u:${rental.user_id}` : unnamed ? `r:${rental.rental_id}` : `n:${clean(name)}`;

      if (!people.has(key)) {
        people.set(key, {
          key, name,
          studentId: user?.student_id || null,
          phone: user?.phone || null,
          isMember: !!rental.user_id,
          rows: [], dibs: 0, rents: 0, overdue: 0, maxOverdue: 0,
        });
      }
      const person = people.get(key);
      const overdueDays = overdueDaysOf(rental, now);
      person.rows.push({ game, rental, overdueDays });
      if (rental.type === 'DIBS') person.dibs += 1;
      if (rental.type === 'RENT') person.rents += 1;
      if (overdueDays > 0) {
        person.overdue += 1;
        person.maxOverdue = Math.max(person.maxOverdue, overdueDays);
      }
    }
  }

  const list = [...people.values()];
  for (const p of list) {
    // 사람 안에서는 찜(수령 대기) → 연체 → 나머지 대여 → 외부 대여 순
    const rank = (r) => (r.rental.type === 'DIBS' ? 0 : r.overdueDays > 0 ? 1 : r.rental.type === 'RENT' ? 2 : 3);
    p.rows.sort((a, b) => rank(a) - rank(b) || b.overdueDays - a.overdueDays);
  }
  // 사람 순서: 찜 있는 사람 → 연체 긴 사람 → 이름
  list.sort((a, b) => (b.dibs > 0) - (a.dibs > 0) || b.maxOverdue - a.maxOverdue || a.name.localeCompare(b.name, 'ko'));
  return list;
}

export const needsAction = (p) => p.dibs > 0 || p.overdue > 0;

export function matchesPerson(person, query) {
  const q = clean(query);
  if (!q) return true;
  // choseongStartsWith 는 일반 글자도 초성으로 바꿔 비교한다('김철'→'ㄱㅊ'이 '구창민'에 맞음). 초성만 친 경우에만 쓴다
  return clean(person.name).includes(q)
    || (/^[ㄱ-ㅎ]+$/.test(q) && choseongStartsWith(person.name, q))
    || (person.studentId && String(person.studentId).includes(q));
}

export const VIEWS = [
  { key: 'overdue', label: '연체', test: (p) => p.overdue > 0, empty: '연체 없음' },
  { key: 'dibs', label: '찜 수령', test: (p) => p.dibs > 0, empty: '수령 대기 찜 없음' },
  { key: 'all', label: '전체', test: () => true, empty: '진행 중인 대여 없음' },
];

// onReturnHold(game, rental): 단체 대여 반납(신청 단위). 넘기지 않으면 HOLD 행은 안내만 — 반납 RPC 연결 전까지 빈 버튼을 두지 않는다
function RenterWorkList({ games, users, initialView = 'overdue', onReceive, onCancelDibs, onReturn, onExtend, onMarkLost, onReturnHold }) {
  const [query, setQuery] = useState('');
  const [view, setView] = useState(initialView);
  // 펼친 사람 key. 처리 후 재조회로 games 가 바뀌어도 key(user_id/이름)가 같으면 그대로 펼쳐져 있다
  const [openKeys, setOpenKeys] = useState(() => new Set());

  const people = useMemo(() => groupRentalsByPerson(games, users), [games, users]);
  const counts = useMemo(
    () => Object.fromEntries(VIEWS.map((v) => [v.key, people.filter(v.test).length])),
    [people],
  );

  const searching = query.trim() !== '';
  const current = VIEWS.find((v) => v.key === view) || VIEWS[0];
  // 검색 중에는 칩과 관계없이 이름이 맞는 사람을 모두 보여준다
  const visible = people.filter((p) => (searching ? matchesPerson(p, query) : current.test(p)));
  // 검색 결과가 한 명이 되면 그 사람을 펼친다 — 이름을 쳤으면 그 사람 건을 처리하려는 것.
  // openKeys 에 한 번 넣을 뿐이라 다시 접을 수 있다
  const soleKey = searching && visible.length === 1 ? visible[0].key : null;
  useEffect(() => {
    if (soleKey) setOpenKeys((prev) => (prev.has(soleKey) ? prev : new Set(prev).add(soleKey)));
  }, [soleKey]);
  const isOpen = (key) => openKeys.has(key);

  const toggle = (key) => setOpenKeys((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  return (
    <div className="admin-worklist">
      <input
        type="search"
        className="admin-input admin-worklist-search"
        placeholder="대여자 이름·초성·학번"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="대여자 검색"
        enterKeyHint="search"
      />

      {!searching && (
        <div className="admin-btn-row" role="group" aria-label="목록 범위">
          {VIEWS.map((v) => (
            <button
              key={v.key}
              type="button"
              className={`admin-chip ${view === v.key ? 'active' : ''}`}
              aria-pressed={view === v.key}
              onClick={() => setView(v.key)}
            >
              {v.label} {counts[v.key]}
            </button>
          ))}
        </div>
      )}

      {visible.length === 0 ? (
        <div className="admin-worklist-empty">{searching ? '일치하는 대여자 없음' : current.empty}</div>
      ) : (
        <div className="admin-worklist-people">
          {visible.map((p) => {
            const open = isOpen(p.key);
            const panelId = `worklist-${p.key}`;
            return (
              <article key={p.key} className={`admin-worklist-person ${open ? 'is-open' : ''}`}>
                <button
                  type="button"
                  className="admin-worklist-toggle"
                  aria-expanded={open}
                  aria-controls={panelId}
                  onClick={() => toggle(p.key)}
                >
                  <span className="admin-worklist-toggle-name">
                    <strong>{p.name}</strong>
                    {!p.isMember && <span className="admin-worklist-sub"> · 비회원 수기</span>}
                  </span>
                  <span className="admin-worklist-toggle-counts">
                    {p.rents > 0 && <span className="admin-worklist-badge">대여 {p.rents}</span>}
                    {p.overdue > 0 && <span className="admin-worklist-badge is-overdue">연체 {p.overdue}</span>}
                    {p.dibs > 0 && <span className="admin-worklist-badge is-dibs">찜 {p.dibs}</span>}
                    <span className="admin-worklist-chevron" aria-hidden="true">{open ? '▲' : '▼'}</span>
                  </span>
                </button>

                {open && (
                  <div id={panelId} className="admin-worklist-panel">
                    {(p.studentId || p.phone) && (
                      <div className="admin-worklist-person-meta">
                        {p.studentId && <span className="admin-worklist-sub">학번 {p.studentId}</span>}
                        {p.phone && (
                          <a className="admin-worklist-tel admin-tel-link" href={`tel:${p.phone}`} aria-label={`${p.name} 전화 ${p.phone}`}>📞 {p.phone}</a>
                        )}
                      </div>
                    )}
                    <ul className="admin-worklist-rows">
                      {p.rows.map(({ game, rental, overdueDays }) => (
                        <li key={rental.rental_id} className={`admin-worklist-row ${overdueDays > 0 ? 'is-overdue' : ''}`}>
                          <div className="admin-worklist-row-info">
                            <span className="admin-worklist-game">{game.name}</span>
                            <span className="admin-worklist-sub">
                              {rental.type === 'DIBS' && '찜 · 수령 대기'}
                              {rental.type === 'RENT' && (rental.due_date ? rentalDDayLabel(rental.due_date) : '대여 중')}
                              {rental.type === 'HOLD' && (onReturnHold ? '외부 대여 · 반납은 신청 단위' : '외부 대여 예약 · 외부 대여 신청 탭에서 관리')}
                            </span>
                            {rental.type === 'HOLD' && <HoldOverdueBadge dueDate={rental.due_date} />}
                          </div>
                          {rental.type === 'HOLD' && onReturnHold && (
                            <div className="admin-btn-row admin-worklist-actions">
                              <button type="button" className="admin-worklist-btn is-success" onClick={() => onReturnHold(game, rental)}>↩️ 단체 반납</button>
                            </div>
                          )}
                          {rental.type === 'DIBS' && (
                            <div className="admin-btn-row admin-worklist-actions">
                              <button type="button" className="admin-worklist-btn is-primary" onClick={() => onReceive(game, rental.rental_id)}>🤝 수령</button>
                              <button type="button" className="admin-worklist-btn is-ghost-danger" onClick={() => onCancelDibs(game, rental.rental_id)}>찜 취소</button>
                            </div>
                          )}
                          {rental.type === 'RENT' && (
                            <div className="admin-btn-row admin-worklist-actions">
                              <button type="button" className="admin-worklist-btn is-success" onClick={() => onReturn(game, rental.rental_id)}>↩️ 반납</button>
                              <button type="button" className="admin-worklist-btn is-purple" onClick={() => onExtend(game, rental.rental_id)}>📅 연장</button>
                              <button type="button" className="admin-worklist-btn is-ghost" onClick={() => onMarkLost(game, rental.rental_id)}>분실</button>
                            </div>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * 대여자별 처리 모달. 닫으면 내용이 언마운트돼 다음에 열 때 initialView 칩으로 다시 시작한다.
 * 열려 있는 동안 처리 → 재조회가 일어나도 언마운트하지 않으므로 검색어·펼침 상태가 유지된다.
 * 확인·입력 모달(z-index 10000)이 이 위에 뜬다.
 */
export function RenterWorkListModal({ isOpen, onClose, ...listProps }) {
  useBodyScrollLock(isOpen);

  // 포커스 트랩 + ESC 닫기. 위에 확인/입력 모달(.modal-overlay)이 떠 있으면 ESC 는 그쪽 몫이다 —
  // 트랩이 document 리스너라 막지 않으면 확인 모달과 이 모달이 한 번에 같이 닫힌다.
  // (확인 모달이 닫히는 DOM 반영은 리스너가 다 돈 뒤라, 어느 리스너가 먼저 돌아도 이 검사에 걸린다)
  const containerRef = useFocusTrap({
    active: isOpen,
    onEscape: () => { if (!document.querySelector('.modal-overlay')) onClose(); },
    initialFocus: 'first', // 닫기 버튼 — 검색칸에 바로 포커스를 주면 폰에서 키보드가 화면을 가린다
  });

  if (!isOpen) return null;
  return (
    <div
      className="admin-worklist-overlay"
      onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        ref={containerRef}
        className="admin-worklist-modal admin-modal-scroll"
        role="dialog"
        aria-modal="true"
        aria-labelledby="admin-worklist-title"
      >
        <div className="admin-worklist-modal-head">
          <div>
            <h3 id="admin-worklist-title" style={{ margin: 0 }}>🧾 대여자별 처리</h3>
            <span className="admin-worklist-sub">연체 연락·반납·연장, 찜 수령</span>
          </div>
          <button type="button" className="admin-worklist-close" onClick={onClose} aria-label="닫기">✕</button>
        </div>
        <RenterWorkList {...listProps} />
      </div>
    </div>
  );
}

export default RenterWorkList;
