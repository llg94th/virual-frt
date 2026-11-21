/**
 * Per-floor walkable grid + A* for the tower interior, and the collider list exposed through `interior`.
 * Everything is derived from the same Furn layout data that is instanced (no hand-copied furniture numbers).
 */
import { FLOOR_DEPARTMENTS, type Rect2 } from '../shared';
import { getFloor, HX, HZ, K, COURTYARDS, CORE, FT, type Box } from './furn';

export const CELL = 0.5;
export const GW = Math.ceil((2 * HX) / CELL);
export const GD = Math.ceil((2 * HZ) / CELL);
const N = GW * GD;
export const GLAZE_INSET = 0.9; // glazing line distance from slab edge
export const AGENT_R = 0.28;
/** F1 main entrance on the south (+z) side */
export const DOOR = { x: 5, halfW: 1.6 };
export const ENTRANCE = { outside: [DOOR.x, HZ + 2.6] as [number, number], inside: [DOOR.x, HZ - 2.4] as [number, number] };
export const LIFT_PAD = { x: CORE.x, z: CORE.z + CORE.d / 2 + 1.3, r: 1.6 };

/** Static Meshy human figures (rendered by figures.tsx); also circular obstacles for the Player and the agents' nav grids. */
const commonFloors = FLOOR_DEPARTMENTS.filter((d) => d.role === 'COMMON').map((d) => d.floor).sort((a, b) => a - b);
export const FIGURE_R = 0.35;
export interface FigureSpot { id: string; file: string; floor: number; x: number; z: number; yaw: number; height: number; label: string; hx: number; hz: number; rect: Rect2 }
const mk = (id: string, floor: number, x: number, z: number, yaw: number, height: number, label: string): FigureSpot => ({ id, file: id, floor, x, z, yaw, height, label, hx: x, hz: z, rect: { minX: x - FIGURE_R, maxX: x + FIGURE_R, minZ: z - FIGURE_R, maxZ: z + FIGURE_R } });
export const FIGURES: FigureSpot[] = [
  mk('open_arms', commonFloors[0], 2.6, 16.8, 0.5, 1.72, 'Chào mừng!'),
  mk('professional', commonFloors[0], 14.5, 14.9, 0, 1.78, 'Lễ tân'),
  mk('teacher', commonFloors[1], 16 * K, 11.9 * K, 0, 1.78, 'Giảng viên'),
];
/** Move a figure and keep its (shared, mutable) collider rectangle in sync so the Player and agents see it. */
export function moveFigure(fg: FigureSpot, x: number, z: number) {
  fg.x = x; fg.z = z; const r = fg.rect; r.minX = x - FIGURE_R; r.maxX = x + FIGURE_R; r.minZ = z - FIGURE_R; r.maxZ = z + FIGURE_R;
}
const figureRects = new Set<Rect2>(FIGURES.map((g) => g.rect));
const collCache = new Map<number, Rect2[]>();
function addBoxes(out: Rect2[], list: Box[], k: number, glass: boolean) {
  for (const b of list) {
    if (b.rx !== 0) continue;
    const bottom = b.p[1] - FT - b.s[1] / 2, top = bottom + b.s[1];
    if (bottom > 0.9 || top < (glass ? 1.0 : 0.6)) continue;
    if (Math.max(b.s[0], b.s[2]) < 0.12) continue;
    const c = Math.abs(Math.cos(b.r)), s = Math.abs(Math.sin(b.r));
    const hw = ((b.s[0] * c + b.s[2] * s) / 2) * k, hd = ((b.s[0] * s + b.s[2] * c) / 2) * k;
    out.push({ minX: b.p[0] * k - hw, maxX: b.p[0] * k + hw, minZ: b.p[2] * k - hd, maxZ: b.p[2] * k + hd });
  }
}
/** World x/z blocking rectangles for a floor. */
export function collidersFor(f: number): Rect2[] {
  const hit = collCache.get(f); if (hit) return hit;
  const out: Rect2[] = [];
  const i = GLAZE_INSET, far = 8;
  // exterior wall ring (everything between the glazing line and beyond the slab edge)
  out.push({ minX: -HX - far, maxX: HX + far, minZ: -HZ - far, maxZ: -HZ + i });
  out.push({ minX: -HX - far, maxX: -HX + i, minZ: -HZ - far, maxZ: HZ + far });
  out.push({ minX: HX - i, maxX: HX + far, minZ: -HZ - far, maxZ: HZ + far });
  if (f === 0) { // F1 main entrance: 3.2 m door gap on the south side
    out.push({ minX: -HX - far, maxX: DOOR.x - DOOR.halfW, minZ: HZ - i, maxZ: HZ + far });
    out.push({ minX: DOOR.x + DOOR.halfW, maxX: HX + far, minZ: HZ - i, maxZ: HZ + far });
  } else out.push({ minX: -HX - far, maxX: HX + far, minZ: HZ - i, maxZ: HZ + far });
  if (f >= 0) for (const c of COURTYARDS) out.push({ minX: c.x - c.w / 2 - 0.6, maxX: c.x + c.w / 2 + 0.6, minZ: c.z - c.d / 2 - 0.6, maxZ: c.z + c.d / 2 + 0.6 });
  out.push({ minX: CORE.x - CORE.w / 2, maxX: CORE.x + CORE.w / 2, minZ: CORE.z - CORE.d / 2, maxZ: CORE.z + CORE.d / 2 });
  if (f <= 6) {
    const d = getFloor(f);
    addBoxes(out, d.str.boxes, 1, false); addBoxes(out, d.str.altBoxes, 1, false); addBoxes(out, d.str.glass, 1, true);
    addBoxes(out, d.lay.boxes, K, false); addBoxes(out, d.lay.altBoxes, K, false); addBoxes(out, d.lay.glass, K, true);
  }
  for (const fg of FIGURES) if (fg.floor === f) out.push(fg.rect); // live rect: updated in place when the figure walks
  collCache.set(f, out);
  return out;
}

const gridCache = new Map<number, Uint8Array>();
export function gridFor(f: number): Uint8Array {
  const hit = gridCache.get(f); if (hit) return hit;
  const g = new Uint8Array(N);
  for (const r of collidersFor(f)) {
    if (figureRects.has(r)) continue; // moving figures are handled by separation, not baked into the grid
    const x0 = Math.max(0, Math.floor((r.minX - AGENT_R + HX) / CELL)), x1 = Math.min(GW - 1, Math.floor((r.maxX + AGENT_R + HX) / CELL));
    const z0 = Math.max(0, Math.floor((r.minZ - AGENT_R + HZ) / CELL)), z1 = Math.min(GD - 1, Math.floor((r.maxZ + AGENT_R + HZ) / CELL));
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
      const cx = -HX + (x + 0.5) * CELL, cz = -HZ + (z + 0.5) * CELL;
      if (cx > r.minX - AGENT_R && cx < r.maxX + AGENT_R && cz > r.minZ - AGENT_R && cz < r.maxZ + AGENT_R) g[z * GW + x] = 1;
    }
  }
  gridCache.set(f, g);
  return g;
}
export const cellX = (x: number) => Math.min(GW - 1, Math.max(0, Math.floor((x + HX) / CELL)));
export const cellZ = (z: number) => Math.min(GD - 1, Math.max(0, Math.floor((z + HZ) / CELL)));
const cx2w = (c: number) => -HX + (c + 0.5) * CELL;
const cz2w = (c: number) => -HZ + (c + 0.5) * CELL;

/** nearest unblocked cell index (spiral search), -1 if none */
export function nearestFree(f: number, x: number, z: number, maxR = 10): number {
  const g = gridFor(f), ix = cellX(x), iz = cellZ(z);
  if (!g[iz * GW + ix]) return iz * GW + ix;
  for (let r = 1; r <= maxR; r++) {
    let best = -1, bd = 1e9;
    for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
      const cx = ix + dx, cz = iz + dz; if (cx < 0 || cz < 0 || cx >= GW || cz >= GD || g[cz * GW + cx]) continue;
      const d = dx * dx + dz * dz; if (d < bd) { bd = d; best = cz * GW + cx; }
    }
    if (best >= 0) return best;
  }
  return -1;
}
export const freePoint = (f: number, x: number, z: number, out: [number, number]): boolean => {
  const c = nearestFree(f, x, z); if (c < 0) return false;
  out[0] = cx2w(c % GW); out[1] = cz2w((c / GW) | 0); return true;
};

// ---- A* with preallocated buffers (no per-search allocation except the returned path) ----
const gS = new Float32Array(N), fS = new Float32Array(N), par = new Int32Array(N), stamp = new Uint32Array(N), closed = new Uint32Array(N);
const heap = new Int32Array(N + 8); let heapN = 0, runId = 0;
const tmpCells = new Int32Array(N);
const hpush = (n: number) => { let i = heapN++; heap[i] = n; while (i > 0) { const p = (i - 1) >> 1; if (fS[heap[p]] <= fS[heap[i]]) break; const t = heap[p]; heap[p] = heap[i]; heap[i] = t; i = p; } };
const hpop = () => { const top = heap[0]; heap[0] = heap[--heapN]; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heapN && fS[heap[l]] < fS[heap[m]]) m = l; if (r < heapN && fS[heap[r]] < fS[heap[m]]) m = r; if (m === i) break; const t = heap[m]; heap[m] = heap[i]; heap[i] = t; i = m; } return top; };
const lineClear = (g: Uint8Array, x0: number, z0: number, x1: number, z1: number) => {
  const d = Math.hypot(x1 - x0, z1 - z0), n = Math.ceil(d / 0.2);
  for (let i = 1; i < n; i++) { const t = i / n; if (g[cellZ(z0 + (z1 - z0) * t) * GW + cellX(x0 + (x1 - x0) * t)]) return false; }
  return true;
};
const pathCache = new Map<string, Float32Array | null>();
/** Path as [x0,z0,x1,z1,...] starting at the exact start point and ending at the exact goal point. null if unreachable. */
export function findPath(f: number, sx: number, sz: number, gx: number, gz: number): Float32Array | null {
  const g = gridFor(f);
  const s = nearestFree(f, sx, sz), e = nearestFree(f, gx, gz);
  if (s < 0 || e < 0) return null;
  const key = `${f}|${s}|${e}|${(sx * 4) | 0}|${(sz * 4) | 0}|${(gx * 4) | 0}|${(gz * 4) | 0}`;
  if (pathCache.has(key)) return pathCache.get(key)!;
  runId++; heapN = 0;
  gS[s] = 0; fS[s] = 0; par[s] = -1; stamp[s] = runId; hpush(s);
  let found = false;
  const ex = e % GW, ez = (e / GW) | 0;
  while (heapN > 0) {
    const cur = hpop();
    if (cur === e) { found = true; break; }
    if (closed[cur] === runId) continue; closed[cur] = runId;
    const cx = cur % GW, cz = (cur / GW) | 0;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dz) continue;
      const nx = cx + dx, nz = cz + dz; if (nx < 0 || nz < 0 || nx >= GW || nz >= GD) continue;
      const ni = nz * GW + nx; if (g[ni] || closed[ni] === runId) continue;
      if (dx && dz && (g[cz * GW + nx] || g[nz * GW + cx])) continue;
      const ng = gS[cur] + (dx && dz ? 1.414 : 1);
      if (stamp[ni] !== runId || ng < gS[ni]) {
        stamp[ni] = runId; gS[ni] = ng; par[ni] = cur;
        const hx = Math.abs(nx - ex), hz = Math.abs(nz - ez); fS[ni] = ng + (hx + hz) + (1.414 - 2) * Math.min(hx, hz);
        hpush(ni);
      }
    }
  }
  let res: Float32Array | null = null;
  if (found) {
    let n = 0; for (let c = e; c !== -1; c = par[c]) tmpCells[n++] = c; // reversed: goal..start
    // string pulling over cell centres, exact endpoints
    const out: number[] = [sx, sz];
    let ax = sx, az = sz, i = n - 1;
    while (i > 0) {
      let j = i - 1; // furthest visible
      for (let k = 0; k <= i - 1; k++) { const c = tmpCells[k]; if (lineClear(g, ax, az, cx2w(c % GW), cz2w((c / GW) | 0))) { j = k; break; } }
      const c = tmpCells[j]; ax = cx2w(c % GW); az = cz2w((c / GW) | 0); out.push(ax, az); i = j;
      if (j === 0) break;
    }
    out.push(gx, gz);
    res = Float32Array.from(out);
  }
  if (pathCache.size > 400) pathCache.clear();
  pathCache.set(key, res);
  return res;
}
