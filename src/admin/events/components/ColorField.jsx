// 컬러 피커 + 헥스 입력 콤비
import React from 'react';

export default function ColorField({ label, value, onChange, hint }) {
  const v = value || '#1a1a2e';
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
      <span style={{ fontSize: '0.85rem', color: 'var(--admin-text-sub)' }}>{label}</span>
      {/* 좁은 그리드 셀에서도 옆 칸을 침범하지 않게 — 스와치는 고정, hex 입력은 줄어들고 필요하면 줄바꿈 */}
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', minWidth: 0 }}>
        <input type="color" value={v} onChange={(e) => onChange(e.target.value)} style={{ width: 40, height: 32, flexShrink: 0, border: '1px solid var(--admin-border)', borderRadius: 4, background: 'transparent', cursor: 'pointer', padding: 2 }} />
        <input
          value={v}
          onChange={(e) => onChange(e.target.value)}
          maxLength={7}
          style={{
            flex: '1 1 90px',
            minWidth: 0,
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
