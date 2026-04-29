// 컬러 피커 + 헥스 입력 콤비
import React from 'react';

export default function ColorField({ label, value, onChange, hint }) {
  const v = value || '#1a1a2e';
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: '0.85rem', color: 'var(--admin-text-sub)' }}>{label}</span>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <input type="color" value={v} onChange={(e) => onChange(e.target.value)} style={{ width: 40, height: 32, border: '1px solid var(--admin-border)', borderRadius: 4, background: 'transparent', cursor: 'pointer' }} />
        <input
          value={v}
          onChange={(e) => onChange(e.target.value)}
          maxLength={7}
          style={{
            width: 90,
            padding: '6px 8px',
            background: 'var(--admin-bg)',
            color: 'var(--admin-text-main)',
            border: '1px solid var(--admin-border)',
            borderRadius: 4,
            fontFamily: 'monospace',
            fontSize: '0.85rem',
          }}
        />
        {hint && <span style={{ fontSize: '0.75rem', color: 'var(--admin-text-sub)' }}>{hint}</span>}
      </div>
    </label>
  );
}
