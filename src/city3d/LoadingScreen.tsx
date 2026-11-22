import React from 'react';

/** Dependency-free loading overlay (no three/drei imports so App.tsx can use it in the main bundle). */
export interface LoadingScreenProps {
  /** 0..100, or null for the indeterminate phase (code chunk still downloading) */
  progress: number | null;
  label?: string;
  /** fades out when true */
  done?: boolean;
}
const TIPS = [
  'Kéo chuột để xoay, lăn chuột để phóng to / thu nhỏ.',
  'Chọn tầng ở bảng điều khiển để cắt lớp tòa nhà.',
  'Bấm “Đi bộ” trong bảng điều khiển để điều khiển nhân vật.',
  'Phím G để quay về văn phòng 2D.',
];
export const LoadingScreen: React.FC<LoadingScreenProps> = ({ progress, label, done }) => {
  const [tip] = React.useState(() => TIPS[Math.floor(Math.random() * TIPS.length)]);
  const pct = progress == null ? null : Math.max(0, Math.min(100, Math.round(progress)));
  return (
    <div
      aria-live="polite"
      style={{
        position: 'fixed', inset: 0, zIndex: 60, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 18,
        background: 'radial-gradient(ellipse at 50% 40%, #12304f 0%, #07111f 70%)', color: '#e8f1fb',
        transition: 'opacity .6s ease', opacity: done ? 0 : 1, pointerEvents: done ? 'none' : 'auto', fontFamily: 'system-ui, sans-serif',
      }}
    >
      <style>{`@keyframes c3dSlide{0%{transform:translateX(-100%)}100%{transform:translateX(250%)}}`}</style>
      <div style={{ fontSize: 13, letterSpacing: 6, color: '#f59e0b', fontWeight: 800 }}>FPT SOFTWARE</div>
      <div style={{ fontSize: 40, fontWeight: 900, letterSpacing: 2 }}>F-TOWN 3</div>
      <div style={{ width: 'min(360px, 70vw)', height: 6, borderRadius: 3, background: 'rgba(255,255,255,.12)', overflow: 'hidden' }}>
        <div
          style={pct == null
            ? { width: '40%', height: '100%', background: '#f59e0b', animation: 'c3dSlide 1.1s ease-in-out infinite' }
            : { width: `${pct}%`, height: '100%', background: '#f59e0b', transition: 'width .25s ease' }}
        />
      </div>
      <div style={{ fontSize: 12, color: '#9db4cc', minHeight: 16, fontVariantNumeric: 'tabular-nums' }}>
        {pct == null ? 'Đang tải mô-đun 3D…' : `${label ? label + ' · ' : ''}${pct}%`}
      </div>
      <div style={{ position: 'absolute', bottom: 28, fontSize: 12, color: '#7f97b0', maxWidth: '80vw', textAlign: 'center' }}>{tip}</div>
    </div>
  );
};
