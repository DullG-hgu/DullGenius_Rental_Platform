// 신청 폼 추가 질문 편집기
// value: [{ key, label, type: 'text'|'select'|'checkbox', required: bool, options?: ['a','b'] }]
import React, { useRef, useState } from 'react';
import ConfirmModal from '../../../components/ConfirmModal';

const TYPES = [
  { v: 'text', label: '단답' },
  { v: 'textarea', label: '여러 줄' },
  { v: 'select', label: '선택' },
  { v: 'checkbox', label: '체크박스' },
];

const normalizeKey = (s) => (s || '').replace(/[^a-zA-Z0-9_]/g, '');

export default function ExtraQuestionsEditor({ value = [], onChange }) {
  const rows = Array.isArray(value) ? value : [];
  const [deleteIdx, setDeleteIdx] = useState(null);

  // 행 객체 → 안정된 key (index key 는 순서 이동 시 폰 키보드/IME 상태가 엉뚱한 행에 붙는다)
  const idsRef = useRef(new WeakMap());
  const seqRef = useRef(0);
  const keyOf = (row, idx) => {
    if (row === null || typeof row !== 'object') return `i${idx}`;
    let id = idsRef.current.get(row);
    if (!id) { id = `q${++seqRef.current}`; idsRef.current.set(row, id); }
    return id;
  };
  const carryId = (from, to) => {
    const id = idsRef.current.get(from);
    if (id) idsRef.current.set(to, id);
    return to;
  };

  const update = (idx, patch) => {
    onChange(rows.map((r, i) => (i === idx ? carryId(r, { ...r, ...patch }) : r)));
  };
  const add = () => {
    onChange([...rows, { key: `q${rows.length + 1}`, label: '', type: 'text', required: false }]);
  };
  const remove = (idx) => onChange(rows.filter((_, i) => i !== idx));
  const hasContent = (row) => !!(row?.label || '').trim() || (Array.isArray(row?.options) && row.options.length > 0);
  const requestRemove = (idx) => (hasContent(rows[idx]) ? setDeleteIdx(idx) : remove(idx));
  const move = (idx, dir) => {
    const j = idx + dir;
    if (j < 0 || j >= rows.length) return;
    const next = rows.slice();
    [next[idx], next[j]] = [next[j], next[idx]];
    onChange(next);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {rows.length === 0 && (
        <div style={{ color: 'var(--admin-text-sub)', fontSize: '0.85rem' }}>추가 질문 없음 — 학번/이름/연락처는 기본 수집됨</div>
      )}
      {rows.map((row, idx) => (
        <div key={keyOf(row, idx)} style={card}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            {/* key: 입력 중에는 그대로 두고 포커스가 빠질 때 정규화 — 타이핑마다 지우면 한글 IME 조합이 꼬인다 */}
            <input
              value={row.key || ''}
              onChange={(e) => update(idx, { key: e.target.value })}
              onBlur={(e) => {
                const n = normalizeKey(e.target.value);
                if (n !== e.target.value) update(idx, { key: n });
              }}
              placeholder="key (영문)"
              lang="en"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              style={{ ...input, flex: '0 1 140px', minWidth: 0 }}
            />
            <input
              value={row.label || ''}
              onChange={(e) => update(idx, { label: e.target.value })}
              placeholder="질문 라벨 (사용자에게 보임)"
              style={{ ...input, flex: '1 1 160px', minWidth: 0 }}
            />
            <select value={row.type || 'text'} onChange={(e) => update(idx, { type: e.target.value })} style={input}>
              {TYPES.map((t) => <option key={t.v} value={t.v}>{t.label}</option>)}
            </select>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 0', fontSize: '0.85rem', color: 'var(--admin-text-sub)' }}>
              <input type="checkbox" checked={!!row.required} onChange={(e) => update(idx, { required: e.target.checked })} />
              필수
            </label>
            <div style={{ display: 'flex', gap: 4 }}>
              <button type="button" onClick={() => move(idx, -1)} style={iconBtn} disabled={idx === 0} title="위로" aria-label="위로">↑</button>
              <button type="button" onClick={() => move(idx, +1)} style={iconBtn} disabled={idx === rows.length - 1} title="아래로" aria-label="아래로">↓</button>
              <button type="button" onClick={() => requestRemove(idx)} style={{ ...iconBtn, color: 'var(--admin-danger)' }} title="삭제" aria-label="삭제">×</button>
            </div>
          </div>
          {row.type === 'select' && (
            <input
              value={(row.options || []).join(', ')}
              onChange={(e) => update(idx, { options: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
              placeholder="선택지 (쉼표 구분, 예: 컴공, 전자, 기계)"
              style={{ ...input, marginTop: 8, width: '100%', boxSizing: 'border-box' }}
            />
          )}
        </div>
      ))}
      <button type="button" onClick={add} style={addBtn}>+ 질문 추가</button>

      <ConfirmModal
        isOpen={deleteIdx !== null}
        onClose={() => setDeleteIdx(null)}
        onConfirm={() => { if (deleteIdx !== null) remove(deleteIdx); }}
        title="🗑️ 질문 삭제"
        message={deleteIdx !== null ? `"${rows[deleteIdx]?.label || rows[deleteIdx]?.key || '이 질문'}" 을(를) 삭제할까요?` : ''}
        confirmText="삭제"
        cancelText="취소"
        type="danger"
      />
    </div>
  );
}

const card = {
  padding: 10,
  background: 'var(--admin-bg)',
  border: '1px solid var(--admin-border)',
  borderRadius: 4,
  display: 'flex',
  flexDirection: 'column',
};
const input = {
  padding: '8px 10px',
  background: 'var(--admin-card-bg)',
  color: 'var(--admin-text-main)',
  border: '1px solid var(--admin-border)',
  borderRadius: 4,
  fontSize: '0.9rem',
};
const iconBtn = {
  minWidth: 36,
  minHeight: 36,
  padding: '6px 10px',
  background: 'transparent',
  color: 'var(--admin-text-sub)',
  border: '1px solid var(--admin-border)',
  borderRadius: 4,
  cursor: 'pointer',
  fontSize: '0.9rem',
};
const addBtn = {
  alignSelf: 'flex-start',
  padding: '6px 14px',
  background: 'transparent',
  color: 'var(--admin-primary)',
  border: '1px dashed var(--admin-border)',
  borderRadius: 4,
  cursor: 'pointer',
  fontSize: '0.85rem',
};
