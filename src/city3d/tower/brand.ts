/**
 * FPT Retail (FRT) brand graphics for the floor-2 office.
 * Every logo / sign / poster / screensaver is drawn once into ONE 4096 px atlas (vector paths, so crisp at any zoom) and the
 * floor renders all its decals as a single merged mesh (1 draw call). The wordmark ("FPT Retail") is keyed out of the
 * reference PNG (public/brand/frt.png) once it has loaded; until then a font fallback is shown.
 */
import * as THREE from 'three';

export const BRAND = { blue: '#1668B1', orange: '#F37021', green: '#1AB04F', navy: '#0b2a6b', ink: '#16233f' };
const BASE = `${(import.meta as any).env?.BASE_URL ?? '/'}brand/`;
const FONT = '"Segoe UI", "Helvetica Neue", Arial, "DejaVu Sans", sans-serif';

export const ATLAS = 4096;
export let ATLAS_H = 4096;
interface Cell { x: number; y: number; w: number; h: number }
type Draw = (g: CanvasRenderingContext2D, w: number, h: number) => void;
interface Def { id: string; w: number; h: number; draw: Draw }

// ---------- primitives ----------
/** one slanted, rounded FRT panel: BL = bottom-left corner, TR = top-right corner */
function panel(g: CanvasRenderingContext2D, bx: number, by: number, tx: number, ty: number, fill: string) {
  const h = by - ty, k = 0.215, rb = 0.21 * h, rt = 0.24 * h;
  const xc = tx - k * h, xr = tx - k * (h - rb), xtl = bx + k * h, xl = bx + k * (h - rt);
  g.fillStyle = fill; g.beginPath();
  g.moveTo(bx, by); g.lineTo(xc - 1.2 * rb, by); g.quadraticCurveTo(xc, by, xr, by - rb); g.lineTo(tx, ty);
  g.lineTo(xtl + 1.2 * rt, ty); g.quadraticCurveTo(xtl, ty, xl, ty + rt); g.closePath(); g.fill();
}
/** the three-panel mark; (x,y) top-left, width w (aspect 610:377) */
function mark(g: CanvasRenderingContext2D, x: number, y: number, w: number) {
  const s = w / 610, ox = x - 390 * s, oy = y - 335 * s, P = (a: number, b: number) => [ox + a * s, oy + b * s] as const;
  const p = (b: readonly [number, number], t: readonly [number, number], c: string) => panel(g, b[0], b[1], t[0], t[1], c);
  p(P(390, 655), P(617, 393), BRAND.blue); p(P(567, 712), P(822, 335), BRAND.orange); p(P(771, 655), P(1000, 393), BRAND.green);
}
const MARK_AR = 377 / 610;

// wordmark keyed out of the reference PNG
let wordWhite: HTMLCanvasElement | null = null;
let wordInk: HTMLCanvasElement | null = null;
const WM = { sx: 1085, sy: 478, sw: 585, sh: 142 }; // region in the 2048x1072 original
function wordmark(g: CanvasRenderingContext2D, cx: number, cy: number, h: number, dark: boolean, anchor: 'l' | 'c' = 'l') {
  const src = dark ? wordInk : wordWhite, w = h * (WM.sw / WM.sh);
  if (src) { g.drawImage(src, anchor === 'c' ? cx - w / 2 : cx, cy - h / 2, w, h); return w; }
  g.fillStyle = dark ? BRAND.ink : '#fff'; g.font = `500 ${h * 0.78}px ${FONT}`; g.textBaseline = 'middle'; g.textAlign = anchor === 'c' ? 'center' : 'left';
  g.fillText('FPT Retail', cx, cy + h * 0.03); return w;
}
/** mark + wordmark lockup, left aligned in a box of height h (mark height = 0.62h) */
function lockup(g: CanvasRenderingContext2D, x: number, cy: number, h: number, dark: boolean) {
  const mh = h * 0.78, mw = mh / MARK_AR;
  mark(g, x, cy - mh / 2, mw);
  const wh = h * 0.5, wx = x + mw + h * 0.16;
  return wordmark(g, wx, cy + h * 0.1, wh, dark) + (wx - x);
}
/** centred lockup (total width = 3.48 * H) */
function lockupC(g: CanvasRenderingContext2D, w: number, cy: number, H: number, dark: boolean) { lockup(g, (w - 3.48 * H) / 2, cy, H, dark); }
function fit(g: CanvasRenderingContext2D, t: string, maxW: number, size: number, weight = 700) {
  let s = size; g.font = `${weight} ${s}px ${FONT}`;
  while (g.measureText(t).width > maxW && s > 8) { s -= 2; g.font = `${weight} ${s}px ${FONT}`; }
  return s;
}
function grad(g: CanvasRenderingContext2D, w: number, h: number, stops: [number, string][], ang = 0) {
  const gr = ang ? g.createLinearGradient(0, 0, w * 0.25, h) : g.createLinearGradient(0, 0, w, 0);
  stops.forEach(([o, c]) => gr.addColorStop(o, c)); g.fillStyle = gr; g.fillRect(0, 0, w, h);
}
const BRAND_GRAD: [number, string][] = [[0, '#0a2a9a'], [0.35, '#7a0f86'], [0.7, '#b50a4e'], [1, '#bd3126']];
function rrect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}
function stripes(g: CanvasRenderingContext2D, w: number, h: number, a = 1) {
  g.globalAlpha = a;
  [BRAND.blue, BRAND.orange, BRAND.green].forEach((c, i) => { g.fillStyle = c; g.beginPath(); const x = w * (0.0 + i * 0.34); g.moveTo(x + h * 0.2, 0); g.lineTo(x + w * 0.3 + h * 0.2, 0); g.lineTo(x + w * 0.3, h); g.lineTo(x, h); g.fill(); });
  g.globalAlpha = 1;
}

// ---------- cell definitions ----------
const sign = (text: string, sub?: string): Draw => (g, w, h) => {
  grad(g, w, h, [[0, '#0f3d8a'], [1, '#1668B1']]);
  g.fillStyle = BRAND.orange; g.fillRect(0, h - h * 0.07, w * 0.34, h * 0.07); g.fillStyle = BRAND.green; g.fillRect(w * 0.34, h - h * 0.07, w * 0.33, h * 0.07); g.fillStyle = '#fff'; g.fillRect(w * 0.67, h - h * 0.07, w * 0.33, h * 0.07);
  mark(g, h * 0.12, h * 0.2, h * 0.5 / MARK_AR * 1.0);
  const x0 = h * 0.12 + (h * 0.5) / MARK_AR + h * 0.14, mw = w - x0 - h * 0.1;
  g.fillStyle = '#fff'; g.textAlign = 'left'; g.textBaseline = 'middle';
  const s = fit(g, text, mw, h * (sub ? 0.36 : 0.44)); g.fillText(text, x0, sub ? h * 0.38 : h * 0.46);
  if (sub) { g.fillStyle = '#bcd6f5'; g.font = `500 ${s * 0.6}px ${FONT}`; fit(g, sub, mw, s * 0.6, 500); g.fillText(sub, x0, h * 0.7); }
};
const poster = (n: string, big: string, line1: string, line2: string, c: string): Draw => (g, w, h) => {
  g.fillStyle = '#fbf8f2'; g.fillRect(0, 0, w, h);
  g.fillStyle = c; g.fillRect(0, 0, w, h * 0.5);
  g.globalAlpha = 0.18; mark(g, w * 0.42, h * 0.04, w * 0.8); g.globalAlpha = 1;
  g.fillStyle = '#fff'; g.textAlign = 'left'; g.textBaseline = 'alphabetic';
  g.font = `800 ${h * 0.2}px ${FONT}`; g.fillText(n, w * 0.08, h * 0.2);
  const s = fit(g, big, w * 0.84, h * 0.1, 800); g.fillText(big, w * 0.08, h * 0.38);
  g.fillStyle = BRAND.ink; fit(g, line1, w * 0.84, h * 0.055, 700); g.fillText(line1, w * 0.08, h * 0.6);
  g.fillStyle = '#4a5568'; fit(g, line2, w * 0.84, h * 0.045, 500); g.fillText(line2, w * 0.08, h * 0.67);
  void s;
  mark(g, w * 0.08, h * 0.88, w * 0.16); wordmark(g, w * 0.28, h * 0.92, h * 0.045, true);
};
const screensaver = (v: number): Draw => (g, w, h) => {
  if (v === 0) { grad(g, w, h, [[0, '#0c2f86'], [0.55, '#5d1c8f'], [1, '#c23a2a']]); mark(g, w * 0.2, h * 0.32, w * 0.24); wordmark(g, w * 0.55, h * 0.5, h * 0.17, false); }
  else if (v === 1) { g.fillStyle = '#0d1630'; g.fillRect(0, 0, w, h); g.globalAlpha = 0.9; stripes(g, w, h, 0.12); g.globalAlpha = 1; mark(g, w * 0.36, h * 0.2, w * 0.28); wordmark(g, w * 0.5, h * 0.74, h * 0.16, false, 'c'); }
  else { grad(g, w, h, [[0, '#f4f7fb'], [1, '#dbe7f5']]); mark(g, w * 0.08, h * 0.09, w * 0.16); wordmark(g, w * 0.27, h * 0.15, h * 0.09, true); g.fillStyle = BRAND.blue; g.fillRect(0, h * 0.86, w, h * 0.14); g.fillStyle = BRAND.orange; g.fillRect(0, h * 0.86, w * 0.33, h * 0.14); g.fillStyle = BRAND.green; g.fillRect(w * 0.66, h * 0.86, w * 0.34, h * 0.14); }
};

const DEFS: Def[] = [
  { id: 'wall', w: 2048, h: 1072, draw: (g, w, h) => { grad(g, w, h, BRAND_GRAD); const mw = w * 0.31; mark(g, w * 0.195, h * 0.318, mw); wordmark(g, w * 0.53, h * 0.51, h * 0.1325, false); } },
  { id: 'glass', w: 1024, h: 384, draw: (g, w, h) => { g.fillStyle = 'rgba(255,255,255,0.92)'; rrect(g, 0, 0, w, h, 34); g.fill(); const mw = w * 0.2, mh = mw * MARK_AR; mark(g, w * 0.07, (h - mh) / 2, mw); wordmark(g, w * 0.31, h * 0.5, h * 0.34, true); stripes(g, w, h * 0.06, 0.9); } },
  { id: 'dark', w: 1024, h: 320, draw: (g, w, h) => { lockupC(g, w, h * 0.5, h * 0.8, true); } },
  { id: 'light', w: 1024, h: 320, draw: (g, w, h) => { lockupC(g, w, h * 0.5, h * 0.8, false); } },
  { id: 'slogan', w: 2048, h: 640, draw: (g, w, h) => { grad(g, w, h, BRAND_GRAD); g.globalAlpha = 0.14; mark(g, w * 0.66, h * 0.06, w * 0.38); g.globalAlpha = 1; mark(g, w * 0.05, h * 0.12, w * 0.13); wordmark(g, w * 0.05, h * 0.62, h * 0.13, false); g.fillStyle = '#fff'; g.textAlign = 'left'; g.textBaseline = 'alphabetic'; fit(g, 'Tận tâm phục vụ khách hàng', w * 0.66, h * 0.2, 800); g.fillText('Tận tâm phục vụ khách hàng', w * 0.22, h * 0.36); g.fillStyle = '#ffe0c2'; fit(g, 'Tin cậy  •  Chăm sóc  •  Đồng hành cùng bạn', w * 0.66, h * 0.1, 500); g.fillText('Tin cậy  •  Chăm sóc  •  Đồng hành cùng bạn', w * 0.22, h * 0.6); g.fillStyle = '#fff'; g.globalAlpha = 0.85; fit(g, 'FPT Retail — Mang công nghệ & sức khỏe đến mọi nhà', w * 0.66, h * 0.075, 500); g.fillText('FPT Retail — Mang công nghệ & sức khỏe đến mọi nhà', w * 0.22, h * 0.78); g.globalAlpha = 1; } },
  { id: 'mat', w: 1024, h: 512, draw: (g, w, h) => { g.fillStyle = '#243238'; rrect(g, 0, 0, w, h, 30); g.fill(); g.strokeStyle = '#46606a'; g.lineWidth = 8; rrect(g, 18, 18, w - 36, h - 36, 20); g.stroke(); const mw = w * 0.2; mark(g, w * 0.08, h * 0.22, mw); wordmark(g, w * 0.32, h * 0.34, h * 0.2, false); g.fillStyle = '#d7e6ea'; g.textAlign = 'left'; g.textBaseline = 'middle'; fit(g, 'CHÀO MỪNG • WELCOME', w * 0.6, h * 0.12, 700); g.fillText('CHÀO MỪNG • WELCOME', w * 0.32, h * 0.68); } },
  { id: 'manif', w: 512, h: 128, draw: (g, w, h) => { g.clearRect(0, 0, w, h); g.fillStyle = 'rgba(255,255,255,0.0)'; for (let i = 0; i < 4; i++) { const x = i * 128; [BRAND.blue, BRAND.orange, BRAND.green].forEach((c, k) => { g.fillStyle = c; g.beginPath(); const xx = x + 14 + k * 34; g.moveTo(xx + 22, h * 0.08); g.lineTo(xx + 50, h * 0.08); g.lineTo(xx + 28, h * 0.92); g.lineTo(xx, h * 0.92); g.fill(); }); } } },
  { id: 'badge', w: 256, h: 384, draw: (g, w, h) => { g.fillStyle = '#fff'; rrect(g, 0, 0, w, h, 24); g.fill(); g.fillStyle = BRAND.blue; g.fillRect(0, 0, w, h * 0.2); g.fillStyle = '#000'; g.globalAlpha = 0.25; rrect(g, w * 0.4, h * 0.05, w * 0.2, h * 0.05, 8); g.fill(); g.globalAlpha = 1; mark(g, w * 0.2, h * 0.3, w * 0.6); wordmark(g, w * 0.5, h * 0.62, h * 0.09, true, 'c'); g.fillStyle = '#cfd6df'; g.fillRect(w * 0.15, h * 0.74, w * 0.7, h * 0.05); g.fillRect(w * 0.15, h * 0.83, w * 0.45, h * 0.04); g.fillStyle = BRAND.orange; g.fillRect(0, h * 0.94, w, h * 0.06); } },
  { id: 'lanyard', w: 128, h: 64, draw: (g, w, h) => { g.fillStyle = BRAND.blue; g.fillRect(0, 0, w, h); g.fillStyle = '#fff'; for (let i = 0; i < 4; i++) { g.fillRect(i * 34 + 6, h * 0.3, 18, h * 0.4); } } },
  { id: 'scr0', w: 512, h: 320, draw: screensaver(0) },
  { id: 'scr1', w: 512, h: 320, draw: screensaver(1) },
  { id: 'scr2', w: 512, h: 320, draw: screensaver(2) },
  { id: 'poster0', w: 512, h: 768, draw: poster('01', 'TÔN TRỌNG', 'Tôn trọng cá nhân', 'Mỗi người một giá trị riêng', BRAND.blue) },
  { id: 'poster1', w: 512, h: 768, draw: poster('02', 'ĐỔI MỚI', 'Dám nghĩ, dám làm', 'Không ngừng cải tiến mỗi ngày', BRAND.orange) },
  { id: 'poster2', w: 512, h: 768, draw: poster('03', 'ĐỒNG ĐỘI', 'Cùng nhau thắng', 'Đoàn kết hỗ trợ đồng đội', BRAND.green) },
  { id: 'poster3', w: 512, h: 768, draw: poster('04', 'TIN CẬY', 'Chữ tín là nền tảng', 'Trung thực & nhận trách nhiệm', '#12408f') },
  { id: 'poster4', w: 512, h: 768, draw: poster('05', 'CHĂM SÓC', 'Khách hàng là trọng tâm', 'Tận tâm phục vụ mỗi ngày', '#c0392b') },
  { id: 'poster5', w: 512, h: 768, draw: poster('06', 'CHÍ • GƯƠNG • SÁNG', 'Chí - Gương - Sáng', 'Tinh thần người FPT', '#6a2a8f') },
  { id: 'hdr', w: 1024, h: 256, draw: (g, w, h) => { grad(g, w, h, [[0, '#f6f8fb'], [1, '#e4ebf4']]); lockupC(g, w, h * 0.5, h * 0.72, true); g.fillStyle = BRAND.orange; g.fillRect(0, h - 10, w, 10); } },
  { id: 'wb', w: 1024, h: 640, draw: (g, w, h) => { g.fillStyle = '#fbfcfd'; g.fillRect(0, 0, w, h); g.fillStyle = '#e9eef5'; g.fillRect(0, 0, w, h * 0.18); mark(g, w * 0.03, h * 0.025, w * 0.09); wordmark(g, w * 0.14, h * 0.09, h * 0.08, true); g.strokeStyle = '#dde5ee'; g.lineWidth = 3; for (let i = 0; i < 6; i++) { g.beginPath(); g.moveTo(w * 0.06, h * (0.3 + i * 0.12)); g.lineTo(w * 0.94, h * (0.3 + i * 0.12)); g.stroke(); } } },
];
const TEAM_NAMES = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'];
TEAM_NAMES.forEach((n, i) => DEFS.push({ id: `team${i}`, w: 512, h: 160, draw: sign(`FRT • TEAM ${n}`, 'Nhà thuốc Long Châu') }));
const PLATES: [string, string, string][] = [
  ['meet', 'PHÒNG HỌP', 'Meeting Room'], ['kho', 'KHO • LƯU TRỮ', 'Storage'], ['net', 'NETWORK', 'IT Room'], ['pantry', 'PANTRY', 'Cà phê • Giải lao'], ['lounge', 'LOUNGE', 'Góc thư giãn'],
  ['welcome', 'WELCOME', 'Chào mừng đến FPT Retail'], ['print', 'IN ẤN', 'Print corner'], ['sprint', 'SPRINT BOARD', 'FRT Squad'],
];
PLATES.forEach(([id, t, s]) => DEFS.push({ id: `pl_${id}`, w: 512, h: 160, draw: sign(t, s) }));

// ---------- atlas ----------
const GUT = 8;
export const CELLS: Record<string, Cell> = {};
(() => { let x = 0, y = 0, rowH = 0;
  for (const d of [...DEFS].sort((a, b) => b.h - a.h)) {
    if (x + d.w + GUT > ATLAS) { x = 0; y += rowH + GUT; rowH = 0; }
    CELLS[d.id] = { x, y, w: d.w, h: d.h }; x += d.w + GUT; rowH = Math.max(rowH, d.h);
  }
  ATLAS_H = Math.ceil((y + rowH + GUT) / 256) * 256; })();

let atlas: THREE.CanvasTexture | null = null;
let atlasCtx: CanvasRenderingContext2D | null = null;
function paint() {
  const g = atlasCtx!;
  for (const d of DEFS) {
    const c = CELLS[d.id]; g.save(); g.beginPath(); g.rect(c.x, c.y, c.w, c.h); g.clip(); g.translate(c.x, c.y); g.clearRect(0, 0, c.w, c.h);
    try { d.draw(g, c.w, c.h); } catch { /* never break the floor over a graphic */ }
    g.restore();
  }
  if (atlas) atlas.needsUpdate = true;
}
function loadWordmark() {
  if (typeof Image === 'undefined') return;
  const im = new Image(); im.crossOrigin = 'anonymous';
  im.onload = () => {
    try {
      const sc = im.naturalWidth / 2048, sx = WM.sx * sc, sy = WM.sy * sc, sw = WM.sw * sc, sh = WM.sh * sc;
      const c = document.createElement('canvas'); c.width = 1170; c.height = Math.round(1170 * WM.sh / WM.sw);
      const g = c.getContext('2d', { willReadFrequently: true })!; g.drawImage(im, sx, sy, sw, sh, 0, 0, c.width, c.height);
      const px = g.getImageData(0, 0, c.width, c.height), d = px.data;
      for (let i = 0; i < d.length; i += 4) { const m = Math.min(d[i], d[i + 1], d[i + 2]); d[i] = d[i + 1] = d[i + 2] = 255; d[i + 3] = Math.max(0, Math.min(255, ((m - 70) / 150) * 255)); }
      g.putImageData(px, 0, 0); wordWhite = c;
      const k = document.createElement('canvas'); k.width = c.width; k.height = c.height; const kg = k.getContext('2d')!;
      kg.drawImage(c, 0, 0); kg.globalCompositeOperation = 'source-in'; kg.fillStyle = BRAND.ink; kg.fillRect(0, 0, k.width, k.height); wordInk = k;
      paint();
    } catch { /* keep the font fallback */ }
  };
  im.src = `${BASE}frt.png`;
}
export function getBrandAtlas(): THREE.CanvasTexture {
  if (atlas) return atlas;
  const c = document.createElement('canvas'); c.width = ATLAS; c.height = ATLAS_H; atlasCtx = c.getContext('2d')!;
  atlas = new THREE.CanvasTexture(c); atlas.colorSpace = THREE.SRGBColorSpace; atlas.anisotropy = 8; atlas.generateMipmaps = true; atlas.minFilter = THREE.LinearMipmapLinearFilter;
  paint(); loadWordmark(); return atlas;
}
export const teamSignId = (i: number) => `team${i % TEAM_NAMES.length}`;

/** one decal: vertical (faces +z at rot 0, rotated about Y by rot) or flat on the floor (top = -z at rot 0) */
export interface Decal { id: string; x: number; y: number; z: number; w: number; h: number; rot: number; flat?: boolean; /** extra vertical tilt (rad) about the local x axis, for monitors */ tilt?: number; dim?: number }
