// 신청 폼 추가 질문 편집기
// value: [{ key, label, type: 'text'|'select'|'checkbox', required: bool, options?: ['a','b'] }]
import React from 'react';

const TYPES = [
  { v: 'text', label: '단답' },
  { v: 'textarea', label: '여러 줄' },
  { v: 'select', label: '선택' },
  { v: 'checkbox', label: '체크박스' },
];

export default function ExtraQuestionsEditor({ value = [], onChange }) {
  const rows = Array.isArray(value) ? value : [];

  const update = (idx, patch) => {
    onChange(rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  };
  const add = () => {
    onChange([...rows, { key: `q${rows.length + 1}`, label: '', type: 'text', required: false }]);
  };
  const remove = (idx) => onChange(rows.filter((_, i) => i !== idx));
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
        <div key={idx} style={card}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              value={row.key || ''}
              onChange={(e) => update(idx, { key: e.target.value.replace(/[^a-zA-Z0-9_]/g, '') })}
              placeholder="key (영문)"
              style={{ ...input, width: 140 }}
            />
            <input
              value={row.label || ''}
              onChange={(e) => update(idx, { label: e.target.value })}
              placeholder="질문 라벨 (사용자에게 보임)"
              style={{ ...input, flex: 1, minWidth: 200 }}
            />
            <select value={row.type || 'text'} onChange={(e) => update(idx, { type: e.target.value })} style={input}>
              {TYPES.map((t) => <option key={t.v} value={t.v}>{t.label}</option>)}
            </select>
            <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.85rem', color: 'var(--admin-text-sub)' }}>
              <input type="checkbox" checked={!!row.required} onChange={(e) => update(idx, { required: e.target.checked })} />
              필수
            </label>
            <div style={{ display: 'flex', gap: 4 }}>
              <button type="button" onClick={() => move(idx, -1)} style={iconBtn} disabled={idx === 0}>↑</button>
              <button type="button" onClick={() => move(idx, +1)} style={iconBtn} disabled={idx === rows.length - 1}>↓</button>
              <button type="button" onClick={() => remove(idx)} style={{ ...iconBtn, color: 'var(--admin-danger)' }}>×</button>
            </div>
          </div>
          {row.type === 'select' && (
            <input
              value={(row.options || []).join(', ')}
              onChange={(e) => update(idx, { options: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
              placeholder="선택지 (쉼표 구분, 예: 컴공, 전자, 기계)"
              style={{ ...input, marginTop: 8 }}
            />
          )}
        </div>
      ))}
      <button type="button" onClick={add} style={addBtn}>+ 질문 추가</button>
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
