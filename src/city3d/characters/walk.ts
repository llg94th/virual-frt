/** Collision helpers for the Player: circle-vs-AABB resolver + coarse grid bucketing for many rects. */
export type Rect = { minX: number; maxX: number; minZ: number; maxZ: number };

/** Push circle (x,z,r) out of one rect; returns updated [x,z] via out. */
export function pushOut(r: Rect, R: number, p: { x: number; z: number }) {
  if (p.x < r.minX - R || p.x > r.maxX + R || p.z < r.minZ - R || p.z > r.maxZ + R) return;
  const cx = Math.max(r.minX, Math.min(p.x, r.maxX)), cz = Math.max(r.minZ, Math.min(p.z, r.maxZ));
  const dx = p.x - cx, dz = p.z - cz, d2 = dx * dx + dz * dz;
  if (d2 >= R * R) return;
  if (d2 > 1e-8) { const d = Math.sqrt(d2), k = (R - d) / d; p.x += dx * k; p.z += dz * k; return; }
  const l = p.x - r.minX, rr = r.maxX - p.x, t = p.z - r.minZ, b = r.maxZ - p.z, m = Math.min(l, rr, t, b);
  if (m === l) p.x = r.minX - R; else if (m === rr) p.x = r.maxX + R; else if (m === t) p.z = r.minZ - R; else p.z = r.maxZ + R;
}

const ORIGIN = -30, CELL = 2, N = 30;
export interface Grid { cells: Map<number, Rect[]>; all: Rect[] }
export function buildGrid(rects: Rect[], pad = 0.45): Grid {
  const cells = new Map<number, Rect[]>();
  const ci = (v: number) => Math.max(0, Math.min(N - 1, Math.floor((v - ORIGIN) / CELL)));
  for (const r of rects) {
    if (!(r.maxX > r.minX) || !(r.maxZ > r.minZ)) continue;
    const x0 = ci(r.minX - pad), x1 = ci(r.maxX + pad), z0 = ci(r.minZ - pad), z1 = ci(r.maxZ + pad);
    for (let i = x0; i <= x1; i++) for (let j = z0; j <= z1; j++) {
      const k = i * 64 + j; let a = cells.get(k); if (!a) { a = []; cells.set(k, a); } a.push(r);
    }
  }
  return { cells, all: rects };
}
export function resolveGrid(g: Grid, R: number, p: { x: number; z: number }) {
  for (let it = 0; it < 3; it++) {
    const i = Math.floor((p.x - ORIGIN) / CELL), j = Math.floor((p.z - ORIGIN) / CELL);
    if (i < 0 || j < 0 || i >= N || j >= N) return;
    const a = g.cells.get(i * 64 + j); if (!a) return;
    for (const r of a) pushOut(r, R, p);
  }
}
