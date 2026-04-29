// 반복 행 편집기 (일정/FAQ 등). value: 객체 배열, fields: [{key,label,placeholder,type?}]
import React from 'react';

export default function RepeatableRows({ value = [], onChange, fields, addLabel = '+ 추가', emptyLabel = '항목 없음' }) {
  const rows = Array.isArray(value) ? value : [];

  const update = (idx, key, v) => {
    const next = rows.map((r, i) => (i === idx ? { ...r, [key]: v } : r));
    onChange(next);
  };
  const add = () => {
    const blank = Object.fromEntries(fields.map((f) => [f.key, '']));
    onChange([...rows, blank]);
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {rows.length === 0 && (
        <div style={{ color: 'var(--admin-text-sub)', fontSize: '0.85rem', padding: '8px 0' }}>{emptyLabel}</div>
      )}
      {rows.map((row, idx) => (
        <div key={idx} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', flexWrap: 'wrap' }}>
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
            <button type="button" onClick={() => move(idx, -1)} style={iconBtnStyle} disabled={idx === 0} title="위로">↑</button>
            <button type="button" onClick={() => move(idx, +1)} style={iconBtnStyle} disabled={idx === rows.length - 1} title="아래로">↓</button>
            <button type="button" onClick={() => remove(idx)} style={{ ...iconBtnStyle, color: 'var(--admin-danger)' }} title="삭제">×</button>
          </div>
        </div>
      ))}
      <button type="button" onClick={add} style={addBtnStyle}>{addLabel}</button>
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
};
const iconBtnStyle = {
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
