/** Curved white slab fascia ribbons, rounded slab plate and corten planter walls (shared geometry, built once). */
import * as THREE from 'three';
import { FLOOR_H } from '../shared';
import { HX, HZ, COURTYARDS, FT, CLEAR } from './furn';

type P2 = [number, number];
export const R_OUT = 5, R_CT = 3;

/** Dense CCW sampling of a rounded rectangle */
function rrSample(cx: number, cz: number, hw: number, hd: number, r: number, step = 0.6): P2[] {
  const out: P2[] = [];
  const line = (a: P2, b: P2) => { const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step)); for (let i = 0; i < n; i++) out.push([a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n]); };
  const arc = (mx: number, mz: number, a0: number) => { for (let i = 0; i < 8; i++) { const a = a0 + (i / 8) * (Math.PI / 2); out.push([mx + Math.cos(a) * r, mz + Math.sin(a) * r]); } };
  line([cx - hw + r, cz - hd], [cx + hw - r, cz - hd]); arc(cx + hw - r, cz - hd + r, -Math.PI / 2);
  line([cx + hw, cz - hd + r], [cx + hw, cz + hd - r]); arc(cx + hw - r, cz + hd - r, 0);
  line([cx + hw - r, cz + hd], [cx - hw + r, cz + hd]); arc(cx - hw + r, cz + hd - r, Math.PI / 2);
  line([cx - hw, cz + hd - r], [cx - hw, cz - hd + r]); arc(cx - hw + r, cz - hd + r, Math.PI);
  return out;
}
function rrNormal(p: P2, cx: number, cz: number, hw: number, hd: number, r: number): P2 {
  const ix = Math.min(Math.max(p[0], cx - hw + r), cx + hw - r), iz = Math.min(Math.max(p[1], cz - hd + r), cz + hd - r);
  const dx = p[0] - ix, dz = p[1] - iz, l = Math.hypot(dx, dz) || 1; return [dx / l, dz / l];
}

/** Sweep a rectangular profile (thickness th, height h, bottom y0) along polylines. Merged into a single geometry. */
export function sweep(lines: { pts: P2[]; closed: boolean }[], y0: number, h: number, th: number, uvLen = 3): THREE.BufferGeometry {
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  for (const { pts, closed } of lines) {
    const n = pts.length, segs = closed ? n : n - 1;
    const nrm = pts.map((p, i): P2 => {
      const a = pts[(i - 1 + n) % n], b = pts[(i + 1) % n];
      const ta = closed || i > 0 ? a : p, tb = closed || i < n - 1 ? b : p;
      const dx = tb[0] - ta[0], dz = tb[1] - ta[1], l = Math.hypot(dx, dz) || 1; return [dz / l, -dx / l];
    });
    const cum: number[] = [0];
    for (let i = 1; i <= segs; i++) cum.push(cum[i - 1] + Math.hypot(pts[i % n][0] - pts[i - 1][0], pts[i % n][1] - pts[i - 1][1]));
    const corner = (i: number, side: number, up: number): [number, number, number] => [pts[i % n][0] + nrm[i % n][0] * side * th / 2, y0 + up * h, pts[i % n][1] + nrm[i % n][1] * side * th / 2];
    // 4 faces: outer(+1), inner(-1), top, bottom
    const faces: [number, number, number, number][] = [[1, 0, 1, 1], [-1, 0, -1, 1], [-1, 1, 1, 1], [-1, 0, 1, 0]];
    for (const [sa, ua, sb, ub] of faces) {
      for (let i = 0; i < segs; i++) {
        const base = pos.length / 3;
        const cs: [number, number, number][] = [corner(i, sa, ua), corner(i + 1, sa, ua), corner(i + 1, sb, ub), corner(i, sb, ub)];
        const us = [cum[i] / uvLen, cum[i + 1] / uvLen, cum[i + 1] / uvLen, cum[i] / uvLen], vs = [ua, ua, ub, ub];
        cs.forEach((c, j) => { pos.push(...c); uv.push(us[j], vs[j]); });
        idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}

const fasciaCache = new Map<number, THREE.BufferGeometry>();
/** Wavy white ribbon per floor: outer ring bulges outward, atrium rings bulge into the void; phase differs per floor. */
export function fasciaGeo(f: number): THREE.BufferGeometry {
  const hit = fasciaCache.get(f); if (hit) return hit;
  const phase = f * 1.35;
  const ring = (cx: number, cz: number, hw: number, hd: number, r: number, sign: number, k: number, amp: number) => {
    const base = rrSample(cx, cz, hw, hd, r);
    const pts = base.map((p, i): P2 => {
      const u = i / base.length, nrm = rrNormal(p, cx, cz, hw, hd, r);
      const d = sign * (0.4 + amp * (0.5 + 0.5 * Math.sin(u * Math.PI * 2 * k + phase) + 0.25 * Math.sin(u * Math.PI * 2 * k * 2.3 + phase * 2)));
      return [p[0] + nrm[0] * d, p[1] + nrm[1] * d];
    });
    return { pts, closed: true };
  };
  const lines = [ring(0, 0, HX, HZ, R_OUT, 1, 4, 0.9)];
  COURTYARDS.forEach((c, i) => lines.push(ring(c.x, c.z, c.w / 2, c.d / 2, R_CT, -1, 3, 0.6 + i * 0.1)));
  const g = sweep(lines, CLEAR - 0.8, FLOOR_H + FT - (CLEAR - 0.8), 0.7, 3.2);
  fasciaCache.set(f, g); return g;
}

let slabG: THREE.BufferGeometry | null = null;
/** Rounded slab with rounded atrium holes (one mesh per floor instead of five boxes). */
export function slabGeo(): THREE.BufferGeometry {
  if (slabG) return slabG;
  const rr = (p: THREE.Path, cx: number, cz: number, hw: number, hd: number, r: number) => {
    p.moveTo(cx - hw + r, cz - hd); p.lineTo(cx + hw - r, cz - hd); p.quadraticCurveTo(cx + hw, cz - hd, cx + hw, cz - hd + r);
    p.lineTo(cx + hw, cz + hd - r); p.quadraticCurveTo(cx + hw, cz + hd, cx + hw - r, cz + hd);
    p.lineTo(cx - hw + r, cz + hd); p.quadraticCurveTo(cx - hw, cz + hd, cx - hw, cz + hd - r);
    p.lineTo(cx - hw, cz - hd + r); p.quadraticCurveTo(cx - hw, cz - hd, cx - hw + r, cz - hd);
  };
  const shape = new THREE.Shape(); rr(shape, 0, 0, HX, HZ, R_OUT);
  for (const c of COURTYARDS) { const h = new THREE.Path(); rr(h, c.x, c.z, c.w / 2, c.d / 2, R_CT); shape.holes.push(h); }
  const g = new THREE.ExtrudeGeometry(shape, { depth: FT, bevelEnabled: false, curveSegments: 6 });
  g.rotateX(-Math.PI / 2);
  slabG = g; return g;
}

let cortenG: THREE.BufferGeometry | null = null;
/** Curving rust-red planter walls inside each atrium (ground level, group-local y). */
export function cortenGeo(): THREE.BufferGeometry {
  if (cortenG) return cortenG;
  const lines: { pts: P2[]; closed: boolean }[] = [];
  COURTYARDS.forEach((c, k) => {
    const sx = k === 0 ? -1 : 1, sz = k === 0 ? 1 : -1;
    const arc = (ox: number, oz: number, rad: number, a0: number, a1: number): P2[] => {
      const pts: P2[] = []; for (let i = 0; i <= 18; i++) { const a = a0 + ((a1 - a0) * i) / 18; pts.push([c.x + sx * (ox + Math.cos(a) * rad), c.z + sz * (oz + Math.sin(a) * rad)]); }
      return pts;
    };
    lines.push({ pts: arc(c.w / 2, c.d / 2, 6.4, Math.PI, Math.PI * 1.5), closed: false }); // sweeps round the pond corner
    lines.push({ pts: arc(c.w / 2, c.d / 2, 4.3, Math.PI * 1.02, Math.PI * 1.48), closed: false });
    lines.push({ pts: arc(-c.w / 2, -c.d / 2, 5.6, 0, Math.PI / 2), closed: false }); // opposite corner
  });
  cortenG = sweep(lines, 0.02, 1.15, 0.35, 2.5);
  return cortenG;
}

let carpetG: THREE.BufferGeometry | null = null;
/** Flat copy of the slab outline (with atrium holes) used as wall-to-wall carpet. */
export function carpetGeo(): THREE.BufferGeometry {
  if (carpetG) return carpetG;
  const rr = (p: THREE.Path, cx: number, cz: number, hw: number, hd: number, r: number) => {
    p.moveTo(cx - hw + r, cz - hd); p.lineTo(cx + hw - r, cz - hd); p.quadraticCurveTo(cx + hw, cz - hd, cx + hw, cz - hd + r);
    p.lineTo(cx + hw, cz + hd - r); p.quadraticCurveTo(cx + hw, cz + hd, cx + hw - r, cz + hd);
    p.lineTo(cx - hw + r, cz + hd); p.quadraticCurveTo(cx - hw, cz + hd, cx - hw, cz + hd - r);
    p.lineTo(cx - hw, cz - hd + r); p.quadraticCurveTo(cx - hw, cz - hd, cx - hw + r, cz - hd);
  };
  const shape = new THREE.Shape(); rr(shape, 0, 0, HX - 0.9, HZ - 0.9, R_OUT);
  for (const c of COURTYARDS) { const h = new THREE.Path(); rr(h, c.x, c.z, c.w / 2 + 0.6, c.d / 2 + 0.6, R_CT); shape.holes.push(h); }
  const g = new THREE.ShapeGeometry(shape, 6); g.rotateX(-Math.PI / 2); carpetG = g; return g;
}
