import * as THREE from 'three';
import { FLOOR_H, CITY_SEED, mulberry32, PITCH, SIDEWALK_W, BLOCK_SIZE } from '../shared';
import type { Quality } from '../shared';
import { GeoBuilder } from './builder';
import { buildings, CityBuilding, DIRS, busStops, benches, PARK_BLOCK, PLAZA, POND, ringPath, PATH_HW, stones } from './layout';
import { SIGN_CELLS } from './materials';

const grey = (v: number) => [v, v, v];

function roof(g: GeoBuilder, b: CityBuilding, q: Quality) {
  const rr = mulberry32(b.seed * 7 + 1);
  const t = b.tiers[b.tiers.length - 1], y = t.y1;
  const nAC = q === 'low' ? (rr() < 0.5 ? 1 : 0) : q === 'medium' ? 1 + Math.floor(rr() * 3) : 2 + Math.floor(rr() * 5);
  const pick = () => [(rr() - 0.5) * (t.w - 4), (rr() - 0.5) * (t.d - 4)];
  const items: (() => void)[] = [];
  for (let k = 0; k < nAC; k++) {
    const [ox, oz] = pick(); const w = 1.2 + rr() * 1.6, d = 1 + rr() * 1.4, h = 0.8 + rr() * 0.8, v = 0.5 + rr() * 0.2;
    items.push(() => g.box(t.cx + ox, y, t.cz + oz, w, h, d, grey(v)));
  }
  const tank = rr() < 0.45 && b.floors < 30, ant = rr() < (b.floors >= 25 ? 0.85 : 0.3), stair = rr() < 0.6;
  const [sx, sz] = pick(), [tx, tz] = pick(), [ax, az] = pick();
  const antH = 6 + rr() * 12;
  if (q !== 'low' && stair) g.box(t.cx + sx, y, t.cz + sz, 3.2, 2.8, 3, grey(0.6));
  items.forEach((f) => f());
  if (tank && q !== 'low') {
    const m = new THREE.Matrix4().makeTranslation(t.cx + tx, y + 2.6, t.cz + tz);
    const cg = new THREE.CylinderGeometry(1.4, 1.4, 2.2, 10, 1); g.geo(cg, m, [0.45, 0.32, 0.22]); cg.dispose();
    for (const [lx, lz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) g.box(t.cx + tx + lx, y, t.cz + tz + lz, 0.2, 1.5, 0.2, grey(0.3));
  }
  if (ant) {
    g.box(t.cx + ax, y, t.cz + az, 0.3, antH, 0.3, grey(0.4));
    if (b.floors >= 25) g.box(t.cx + ax, y + antH, t.cz + az, 0.5, 0.5, 0.5, [1, 0.1, 0.1], 0, 4);
  }
  const e1 = rr(), e2 = rr(), e3 = rr();
  if (q !== 'low') {
    if (b.floors >= 30 && e1 < 0.55) { // setback crown with LED band
      const cw = t.w * 0.7, cd = t.d * 0.7;
      g.box(t.cx, y, t.cz, cw, 3, cd, grey(0.62), b.seed, 0);
      g.box(t.cx, y + 3, t.cz, cw + 0.3, 0.35, cd + 0.3, e2 < 0.5 ? [0.3, 0.9, 1] : [1, 0.85, 0.5], 0, 4);
    } else if (b.floors >= 35 && e1 < 0.8 && Math.min(t.w, t.d) > 12) { // helipad
      const hr = Math.min(t.w, t.d) * 0.36;
      const c1 = new THREE.CylinderGeometry(hr, hr, 0.25, 20); g.geo(c1, new THREE.Matrix4().makeTranslation(t.cx, y + 0.12, t.cz), [0.25, 0.27, 0.3]); c1.dispose();
      const c2 = new THREE.CylinderGeometry(hr * 0.85, hr * 0.85, 0.05, 20); g.geo(c2, new THREE.Matrix4().makeTranslation(t.cx, y + 0.27, t.cz), [0.85, 0.85, 0.85]); c2.dispose();
      const c3 = new THREE.CylinderGeometry(hr * 0.78, hr * 0.78, 0.05, 20); g.geo(c3, new THREE.Matrix4().makeTranslation(t.cx, y + 0.3, t.cz), [0.2, 0.22, 0.25]); c3.dispose();
      for (const [dx, dz, w, d] of [[-hr * 0.22, 0, 0.5, hr * 0.7], [hr * 0.22, 0, 0.5, hr * 0.7], [0, 0, hr * 0.45, 0.5]]) g.box(t.cx + dx, y + 0.3, t.cz + dz, w, 0.06, d, [0.95, 0.95, 0.95]);
    } else if (b.floors < 22 && e1 < 0.3) { // rooftop garden
      g.box(t.cx, y, t.cz, t.w - 2, 0.3, t.d - 2, [0.2, 0.46, 0.2]);
      for (let k = 0; k < 5; k++) {
        const gx = t.cx + (rr() - 0.5) * (t.w - 5), gz = t.cz + (rr() - 0.5) * (t.d - 5);
        g.box(gx, y + 0.3, gz, 0.2, 1.2, 0.2, [0.4, 0.28, 0.18]);
        const sp = new THREE.IcosahedronGeometry(0.9 + rr() * 0.5, 0); g.geo(sp, new THREE.Matrix4().makeTranslation(gx, y + 1.7, gz), [0.15 + rr() * 0.1, 0.5 + rr() * 0.15, 0.15]); sp.dispose();
      }
    } else if (b.floors < 26 && e1 < 0.55) { // solar panels
      const pg = new THREE.BoxGeometry(2, 0.08, 1.1);
      const nx = 2 + Math.floor(e3 * 2);
      for (let a = 0; a < nx; a++) for (let c = 0; c < 2; c++) {
        const m = new THREE.Matrix4().makeRotationX(-0.4).setPosition(t.cx - t.w * 0.25 + a * 2.3, y + 0.7, t.cz - t.d * 0.2 + c * 1.8);
        g.geo(pg, m, [0.1, 0.16, 0.35]);
      }
      pg.dispose();
    }
  }
  if (q === 'high') {
    const p = 0.9, c = grey(0.5);
    g.box(t.cx, y, t.cz + t.d / 2 - 0.15, t.w, p, 0.3, c); g.box(t.cx, y, t.cz - t.d / 2 + 0.15, t.w, p, 0.3, c);
    g.box(t.cx + t.w / 2 - 0.15, y, t.cz, 0.3, p, t.d - 0.6, c); g.box(t.cx - t.w / 2 + 0.15, y, t.cz, 0.3, p, t.d - 0.6, c);
  }
}

export function buildBlockGeometry(list: CityBuilding[], q: Quality, detail = true): THREE.BufferGeometry {
  const g = new GeoBuilder();
  for (const b of list) {
    b.tiers.forEach((t, k) => {
      const c = b.color.map((v) => Math.min(1, v * (1 + k * 0.06)));
      g.box(t.cx, t.y0, t.cz, t.w, t.y1 - t.y0, t.d, c, b.seed, b.style);
    });
    if (detail && b.floors >= 14 && q !== 'low') { const t0 = b.tiers[0]; g.box(t0.cx, FLOOR_H * 1, t0.cz, t0.w + 0.5, 0.3, t0.d + 0.5, grey(0.35)); }
    if (b.kind === 'shop') {
      const AW: number[][] = [[0.85, 0.15, 0.15], [0.1, 0.5, 0.25], [0.15, 0.35, 0.75], [0.95, 0.55, 0.1], [0.95, 0.95, 0.9], [0.5, 0.15, 0.55]];
      const oz = b.face === 2 ? 1 : -1, ac = AW[b.seed % AW.length];
      g.box(b.cx, 2.9, b.cz + oz * (b.d / 2 + 0.7), b.w, 0.12, 1.5, ac);
      g.box(b.cx, 2.75, b.cz + oz * (b.d / 2 + 1.42), b.w, 0.2, 0.06, [ac[0] * 0.8 + 0.2, ac[1] * 0.8 + 0.2, ac[2] * 0.8 + 0.2]);
    }
    if (detail) roof(g, b, q);
    if (b.kind !== 'normal') {
      const pharm = b.kind === 'pharmacy';
      const [ox] = DIRS[b.face];
      const c = pharm ? [0.0, 0.62, 0.3] : [1, 0.45, 0.05], c2 = pharm ? [0.1, 0.35, 0.85] : [1, 0.8, 0.5];
      const x = b.cx + ox * (b.w / 2 + 0.9);
      g.box(x, 3.6, b.cz, 1.8, 0.35, b.d * 0.95, c);
      g.box(b.cx + ox * (b.w / 2 + 1.75), 3.5, b.cz, 0.1, 0.18, b.d * 0.95, c2, 0, 4);
    }
  }
  return g.build();
}

export interface SignItem { cx: number; cy: number; cz: number; w: number; h: number; rotY: number; cell: number }

export function buildProps(q: Quality): { geo: THREE.BufferGeometry; signs: THREE.BufferGeometry } {
  const g = new GeoBuilder();
  const signs: SignItem[] = [];
  // bus stops
  for (const s of busStops) {
    g.setXform(s.x, s.z, s.rot);
    g.box(0, 2.5, 0, 4, 0.12, 1.8, grey(0.3));
    g.box(-1.9, 0, -0.8, 0.1, 2.5, 0.1, grey(0.25)); g.box(1.9, 0, -0.8, 0.1, 2.5, 0.1, grey(0.25));
    g.box(0, 0.4, -0.85, 3.8, 2.1, 0.05, [0.5, 0.65, 0.75]);
    g.box(0, 0, -0.4, 2.4, 0.5, 0.4, [0.35, 0.25, 0.15]);
    g.box(0, 2.42, 0.8, 3.6, 0.05, 0.12, [1, 0.9, 0.6], 0, 4);
    g.clearXform();
  }
  // benches
  const pcx = PARK_BLOCK[0] * PITCH, pcz = PARK_BLOCK[1] * PITCH;
  for (const b of benches) {
    g.setXform(b.x, b.z, b.rot);
    g.box(0, 0.45, 0, 1.8, 0.08, 0.5, [0.4, 0.27, 0.15]); g.box(0, 0.5, -0.25, 1.8, 0.45, 0.06, [0.4, 0.27, 0.15]);
    g.box(-0.8, 0, 0, 0.08, 0.45, 0.45, grey(0.2)); g.box(0.8, 0, 0, 0.08, 0.45, 0.45, grey(0.2));
    g.clearXform();
  }
  // park paths + pond rim
  const sand = [0.62, 0.55, 0.42], pad = 0.2;
  g.box(pcx, pad, pcz, 3.2, 0.03, 46, sand); g.box(pcx, pad, pcz, 46, 0.03, 3.2, sand);
  g.box(pcx, pad, pcz, 9, 0.04, 9, [0.7, 0.66, 0.58]);
  const ring = new THREE.CylinderGeometry(POND.r + 0.6, POND.r + 0.6, 0.12, 24);
  g.geo(ring, new THREE.Matrix4().makeTranslation(POND.x, 0.25, POND.z), [0.6, 0.58, 0.55]); ring.dispose();
  // curved paved path loop around the tower
  const pc = [0.66, 0.62, 0.55], N = ringPath.length;
  for (let k = 0; k < N; k++) {
    const [x0, z0] = ringPath[k], [x1, z1] = ringPath[(k + 1) % N];
    const [xp, zp] = ringPath[(k + N - 1) % N], [xn, zn] = ringPath[(k + 2) % N];
    const off = (xa: number, za: number, xb: number, zb: number, px: number, pz: number, s: number): number[] => {
      const dx = xb - xa, dz = zb - za, l = Math.hypot(dx, dz) || 1; return [px - (dz / l) * PATH_HW * s, 0.215, pz + (dx / l) * PATH_HW * s];
    };
    const a0 = off(xp, zp, x1, z1, x0, z0, 1), b0 = off(xp, zp, x1, z1, x0, z0, -1);
    const a1 = off(x0, z0, xn, zn, x1, z1, 1), b1 = off(x0, z0, xn, zn, x1, z1, -1);
    g.quad([a0, a1, b1, b0], [0, 1, 0], pc, [[0, 0], [0, 0], [0, 0], [0, 0]], 0, 0);
  }
  // stepping stones
  const stoneG = new THREE.CylinderGeometry(1, 1, 0.08, 7);
  for (const st of stones) {
    g.geo(stoneG, new THREE.Matrix4().makeRotationY(st.a).setPosition(st.x, 0.22, st.z).multiply(new THREE.Matrix4().makeScale(st.r * 1.3, 1, st.r)), [0.55, 0.54, 0.5]);
  }
  stoneG.dispose();
  // tower front plaza: paved forecourt + drop-off lay-by + crosswalk approach
  const P = PLAZA;
  g.box((P.x0 + P.x1) / 2, 0.19, (P.z0 + P.z1) / 2, P.x1 - P.x0, 0.03, P.z1 - P.z0 + SIDEWALK_W, [0.72, 0.7, 0.66]);
  const dz = (P.dropOff.z0 + P.dropOff.z1) / 2;
  g.box(0, 0.02, dz, P.dropOff.x1 - P.dropOff.x0, 0.02, P.dropOff.z1 - P.dropOff.z0, [0.3, 0.3, 0.33]);
  g.box(0, 0.035, P.dropOff.z1, P.dropOff.x1 - P.dropOff.x0, 0.02, 0.2, [0.95, 0.95, 0.9]);
  for (let x = -10; x <= 10; x += 10) g.box(x, 0, 25.5, 0.4, 1, 0.4, grey(0.25)); // bollards
  for (const x of [-9, 9]) g.box(x, 0.2, 26.6, 6, 0.5, 1.2, [0.3, 0.45, 0.25]); // planters
  // landmark/ billboard frames + wall signs
  const sr = mulberry32(CITY_SEED ^ 0xabcdef);
  const pWall = q === 'low' ? 0.12 : q === 'medium' ? 0.3 : 0.45, pBoard = q === 'low' ? 0.08 : q === 'medium' ? 0.18 : 0.28;
  for (const b of buildings) {
    const r1 = sr(), r2 = sr(), r3 = sr(), r4 = sr(), r5 = sr();
    if (b.kind === 'shop') {
      if (r1 < 0.75) {
        const [, oz] = DIRS[b.face]; const w = Math.min(b.w * 0.85, 4);
        signs.push({ cx: b.cx, cy: 4.5 + r2 * 1.0, cz: b.cz + oz * (b.d / 2 + 0.3), w, h: w / 2, rotY: Math.atan2(0, oz), cell: 2 + Math.floor(r4 * (SIGN_CELLS - 2)) });
      }
      continue;
    }
    if (b.kind !== 'normal') {
      const [ox, oz] = DIRS[b.face];
      signs.push({ cx: b.cx + ox * (b.w / 2 + 0.35), cy: 9.8, cz: b.cz + oz * (b.d / 2 + 0.35), w: 12, h: 6, rotY: Math.atan2(ox, oz), cell: b.kind === 'pharmacy' ? 0 : 1 });
      continue;
    }
    if (b.face >= 0 && b.floors <= 30 && r1 < pWall) {
      const [ox, oz] = DIRS[b.face]; const len = ox ? b.d : b.w; const w = Math.min(6, len * 0.7);
      const off = (r2 - 0.5) * (len - w - 2);
      signs.push({ cx: b.cx + ox * (b.w / 2 + 0.3) + (ox ? 0 : off), cy: 6 + r3 * 4, cz: b.cz + oz * (b.d / 2 + 0.3) + (oz ? 0 : off), w, h: w / 2, rotY: Math.atan2(ox, oz), cell: 2 + Math.floor(r4 * (SIGN_CELLS - 2)) });
    }
    if (b.floors <= 22 && r5 < pBoard) {
      const t = b.tiers[b.tiers.length - 1]; const [ox, oz] = DIRS[Math.floor(r3 * 4)];
      const bw = t.w >= 16 && t.d >= 16 ? 12 : 8; const th = t.y1;
      const x = t.cx + ox * (t.w / 2 - 1.2), z = t.cz + oz * (t.d / 2 - 1.2);
      g.setXform(x, z, Math.atan2(ox, oz));
      g.box(-bw / 3, th, 0, 0.4, 3.5, 0.4, grey(0.3)); g.box(bw / 3, th, 0, 0.4, 3.5, 0.4, grey(0.3));
      g.box(0, th + 3.4, 0, bw + 0.6, bw / 2 + 0.6, 0.3, grey(0.15));
      g.clearXform();
      const cell = 2 + Math.floor(r4 * (SIGN_CELLS - 2));
      signs.push({ cx: x + ox * 0.2, cy: th + 3.4 + bw / 4 + 0.3, cz: z + oz * 0.2, w: bw, h: bw / 2, rotY: Math.atan2(ox, oz), cell });
      signs.push({ cx: x - ox * 0.2, cy: th + 3.4 + bw / 4 + 0.3, cz: z - oz * 0.2, w: bw, h: bw / 2, rotY: Math.atan2(ox, oz) + Math.PI, cell: 2 + Math.floor(r2 * (SIGN_CELLS - 2)) });
    }
  }
  void BLOCK_SIZE;
  return { geo: g.build(), signs: signGeometry(signs) };
}

function signGeometry(items: SignItem[]): THREE.BufferGeometry {
  const pos: number[] = [], nor: number[] = [], uv: number[] = [], idx: number[] = [];
  items.forEach((s, n) => {
    const c = Math.cos(s.rotY), sn = Math.sin(s.rotY);
    const col = s.cell % 4, row = Math.floor(s.cell / 4);
    const u0 = col / 4, u1 = (col + 1) / 4, v1 = 1 - row / 4, v0 = 1 - (row + 1) / 4;
    const corners: [number, number, number, number][] = [[-1, -1, u0, v0], [1, -1, u1, v0], [1, 1, u1, v1], [-1, 1, u0, v1]];
    for (const [lx, ly, u, v] of corners) {
      const X = lx * s.w / 2;
      pos.push(s.cx + X * c, s.cy + ly * s.h / 2, s.cz - X * sn); nor.push(sn, 0, c); uv.push(u, v);
    }
    idx.push(n * 4, n * 4 + 1, n * 4 + 2, n * 4, n * 4 + 2, n * 4 + 3);
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}
