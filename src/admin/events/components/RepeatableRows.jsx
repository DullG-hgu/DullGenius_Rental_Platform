// 반복 행 편집기 (일정/FAQ 등). value: 객체 배열, fields: [{key,label,placeholder,type?}]
import React, { useRef, useState } from 'react';
import ConfirmModal from '../../../components/ConfirmModal';

export default function RepeatableRows({ value = [], onChange, fields, addLabel = '+ 추가', emptyLabel = '항목 없음' }) {
  const rows = Array.isArray(value) ? value : [];
  const [deleteIdx, setDeleteIdx] = useState(null);

  // 행 객체 → 안정된 key. index 를 key 로 쓰면 순서를 바꿀 때 DOM 이 재사용돼
  // 폰에서 열려 있던 키보드/IME 조합 상태가 엉뚱한 행에 붙는다. 저장되는 데이터 형태는 그대로.
  const idsRef = useRef(new WeakMap());
  const seqRef = useRef(0);
  const keyOf = (row, idx) => {
    if (row === null || typeof row !== 'object') return `i${idx}`;
    let id = idsRef.current.get(row);
    if (!id) { id = `r${++seqRef.current}`; idsRef.current.set(row, id); }
    return id;
  };
  const carryId = (from, to) => {
    const id = idsRef.current.get(from);
    if (id) idsRef.current.set(to, id);
    return to;
  };

  const update = (idx, key, v) => {
    const next = rows.map((r, i) => (i === idx ? carryId(r, { ...r, [key]: v }) : r));
    onChange(next);
  };
  const add = () => {
    const blank = Object.fromEntries(fields.map((f) => [f.key, '']));
    onChange([...rows, blank]);
  };
  const remove = (idx) => onChange(rows.filter((_, i) => i !== idx));
  const hasContent = (row) => fields.some((f) => String(row?.[f.key] ?? '').trim() !== '');
  // 내용이 있는 행은 확인 후 삭제 (× 버튼이 ↑↓ 옆에 붙어 있어 오탭이 잦다)
  const requestRemove = (idx) => (hasContent(rows[idx]) ? setDeleteIdx(idx) : remove(idx));
  const move = (idx, dir) => {
    const j = idx + dir;
    if (j < 0 || j >= rows.length) return;
    const next = rows.slice();
    [next[idx], next[j]] = [next[j], next[idx]];
    onChange(next);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {rows.length === 0 && (
        <div style={{ color: 'var(--admin-text-sub)', fontSize: '0.85rem', padding: '8px 0' }}>{emptyLabel}</div>
      )}
      {rows.map((row, idx) => (
        <div key={keyOf(row, idx)} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          {fields.map((f) => (
            <div key={f.key} style={{ flex: f.flex || 1, minWidth: f.minWidth || 120 }}>
              {f.type === 'textarea' ? (
                <textarea
                  value={row[f.key] || ''}
                  onChange={(e) => update(idx, f.key, e.target.value)}
                  placeholder={f.placeholder || f.label}
                  rows={2}
                  style={inputStyle}
                />
              ) : (
                <input
                  type={f.type || 'text'}
                  value={row[f.key] || ''}
                  onChange={(e) => update(idx, f.key, e.target.value)}
                  placeholder={f.placeholder || f.label}
                  style={inputStyle}
                />
              )}
            </div>
          ))}
          <div style={{ display: 'flex', gap: 4 }}>
            <button type="button" onClick={() => move(idx, -1)} style={iconBtnStyle} disabled={idx === 0} title="위로" aria-label="위로">↑</button>
            <button type="button" onClick={() => move(idx, +1)} style={iconBtnStyle} disabled={idx === rows.length - 1} title="아래로" aria-label="아래로">↓</button>
            <button type="button" onClick={() => requestRemove(idx)} style={{ ...iconBtnStyle, color: 'var(--admin-danger)' }} title="삭제" aria-label="삭제">×</button>
          </div>
        </div>
      ))}
      <button type="button" onClick={add} style={addBtnStyle}>{addLabel}</button>

      <ConfirmModal
        isOpen={deleteIdx !== null}
        onClose={() => setDeleteIdx(null)}
        onConfirm={() => { if (deleteIdx !== null) remove(deleteIdx); }}
        title="🗑️ 항목 삭제"
        message="이 항목을 삭제할까요? 입력한 내용이 사라집니다."
        confirmText="삭제"
        cancelText="취소"
        type="danger"
      />
    </div>
  );
}

const inputStyle = {
  width: '100%',
  padding: '8px 10px',
  background: 'var(--admin-bg)',
  color: 'var(--admin-text-main)',
  border: '1px solid var(--admin-border)',
  borderRadius: 4,
  fontSize: '0.9rem',
  boxSizing: 'border-box',
};
const iconBtnStyle = {
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
const addBtnStyle = {
  alignSelf: 'flex-start',
  padding: '6px 14px',
  background: 'transparent',
  color: 'var(--admin-primary)',
  border: '1px dashed var(--admin-border)',
  borderRadius: 4,
  cursor: 'pointer',
  fontSize: '0.85rem',
};
