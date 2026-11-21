import * as THREE from 'three';

const SAFE = ['#2f5d9e', '#3b4a6b', '#2e7d6f', '#6a4c93', '#7b2d3b', '#4b5563', '#1f6f8b', '#566a3a'];
const a = new THREE.Color(), b = new THREE.Color(), ha = { h: 0, s: 0, l: 0 }, hb = { h: 0, s: 0, l: 0 };
function h32(s: string) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

/** Garment colours that read as bare skin (similar hue/saturation/lightness or near in RGB) are swapped for a clearly different one. */
export function safeTop(top: string, skin: string): string {
  a.set(top); b.set(skin); a.getHSL(ha); b.getHSL(hb);
  const dh = Math.min(Math.abs(ha.h - hb.h), 1 - Math.abs(ha.h - hb.h));
  const rgb = Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
  const near = rgb < 0.2 || (dh < 0.07 && Math.abs(ha.s - hb.s) < 0.3 && Math.abs(ha.l - hb.l) < 0.22);
  return near ? SAFE[h32(top + skin) % SAFE.length] : top;
}
