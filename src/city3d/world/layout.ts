/** Deterministic city layout (independent of quality). Shared with crowd/traffic modules. */
import {
  PITCH, BLOCK_SIZE, TOWER_FOOTPRINT, TOWER_FLOORS, GRID_HALF, FLOOR_H, ROAD_W, SIDEWALK_W, CITY_SEED, CITY_EXTENT, mulberry32, roadLine,
} from '../shared';

export type BlockKind = 'tower' | 'park' | 'city';
export const PARK_BLOCK: [number, number] = [-1, 1];
export const blockKind = (i: number, j: number): BlockKind =>
  i === 0 && j === 0 ? 'tower' : i === PARK_BLOCK[0] && j === PARK_BLOCK[1] ? 'park' : 'city';

export interface Tier { cx: number; cz: number; w: number; d: number; y0: number; y1: number }
/** Outward direction index: 0 +x, 1 -x, 2 +z, 3 -z. */
export const DIRS: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
export interface CityBuilding {
  id: number; block: [number, number]; cx: number; cz: number; w: number; d: number;
  floors: number; h: number; style: 1 | 2 | 3 | 5 | 6 | 7; color: [number, number, number];
  tiers: Tier[]; seed: number; kind: 'normal' | 'pharmacy' | 'fpt' | 'shop'; face: number;
}
export interface Footprint { cx: number; cz: number; w: number; d: number; h: number }

const HALF_INNER = (BLOCK_SIZE - 2 * SIDEWALK_W) / 2; // 25
const USABLE = HALF_INNER * 2 - 1.5;
const GAP = 2.5;

export const buildings: CityBuilding[] = [];
const rndRange = (r: () => number, a: number, b: number) => a + (b - a) * r();

function makeTiers(r: () => number, cx: number, cz: number, w: number, d: number, floors: number): Tier[] {
  const mk = (par: Tier | { cx: number; cz: number; w: number; d: number }, s: number, f0: number, f1: number): Tier => {
    const nw = par.w * s, nd = par.d * s;
    const jx = (par.w - nw) / 2 * 0.7 * (r() * 2 - 1), jz = (par.d - nd) / 2 * 0.7 * (r() * 2 - 1);
    return { cx: par.cx + jx, cz: par.cz + jz, w: nw, d: nd, y0: f0 * FLOOR_H, y1: f1 * FLOOR_H };
  };
  const base = { cx, cz, w, d };
  if (floors < 14) return [{ ...base, y0: 0, y1: floors * FLOOR_H }];
  if (floors < 30) {
    const f = Math.round(floors * 0.6);
    const t0: Tier = { ...base, y0: 0, y1: f * FLOOR_H };
    return [t0, mk(t0, rndRange(r, 0.7, 0.85), f, floors)];
  }
  const f1 = Math.round(floors * 0.4), f2 = Math.round(floors * 0.72);
  const t0: Tier = { ...base, y0: 0, y1: f1 * FLOOR_H };
  const t1 = mk(t0, rndRange(r, 0.78, 0.88), f1, f2);
  return [t0, t1, mk(t1, rndRange(r, 0.6, 0.75), f2, floors)];
}

(function generate() {
  let id = 0;
  for (let i = -GRID_HALF; i <= GRID_HALF; i++) {
    for (let j = -GRID_HALF; j <= GRID_HALF; j++) {
      if (blockKind(i, j) !== 'city') continue;
      const r = mulberry32(CITY_SEED + (i + 9) * 131 + (j + 9) * 7919);
      const dist = Math.max(Math.abs(i), Math.abs(j));
      const rr = Math.hypot(i, j);
      let nx = 2, nz = 2;
      if (dist === 3) { nx = 3; nz = 3; }
      else if (dist === 2) { const q = r(); if (q < 0.45) { nx = 2; nz = 2; } else if (q < 0.72) { nx = 3; nz = 2; } else { nx = 2; nz = 3; } }
      const lotW = (USABLE - GAP * (nx - 1)) / nx, lotD = (USABLE - GAP * (nz - 1)) / nz;
      const bx = i * PITCH, bz = j * PITCH;
      for (let ix = 0; ix < nx; ix++) {
        for (let iz = 0; iz < nz; iz++) {
          const lcx = bx - USABLE / 2 + lotW * (ix + 0.5) + GAP * ix;
          const lcz = bz - USABLE / 2 + lotD * (iz + 0.5) + GAP * iz;
          const skipRoll = r();
          const w = Math.max(10, lotW - r() * 3), d = Math.max(10, lotD - r() * 3);
          const ox = (lotW - w) * (r() - 0.5), oz = (lotD - d) * (r() - 0.5);
          const t = Math.exp(-(((rr - 4.2) / 1.5) ** 2)); // downtown peaks away from F-Town 3 (Hi-Tech Park is low-rise)
          let floors = Math.round(8 + 52 * t * (0.4 + 0.6 * Math.pow(r(), 0.7)) + Math.floor(r() * 5));
          if (rr < 2.2) floors = Math.min(floors, 4 + Math.floor(r() * 2)); // keep the F-Town 3 surroundings low so the tower stays visible
          else if (rr < 3.2) floors = Math.min(floors, 12 + Math.floor(r() * 6));
          if (lotW < 18) floors = Math.min(floors, 26);
          floors = Math.max(rr < 2.2 ? 3 : 8, Math.min(60, floors));
          const sr = r();
          type St = CityBuilding['style'];
          const pickStyle = (tbl: [number, St][]): St => { let acc = 0; for (const [p, st] of tbl) { acc += p; if (sr < acc) return st; } return tbl[tbl.length - 1][1]; };
          let style: St;
          if (floors > 30) style = pickStyle([[0.4, 7], [0.25, 1], [0.2, 6], [0.15, 2]]);
          else if (floors > 16) style = pickStyle([[0.2, 7], [0.15, 1], [0.2, 6], [0.25, 5], [0.1, 2], [0.1, 3]]);
          else style = pickStyle([[0.35, 5], [0.2, 2], [0.15, 6], [0.2, 3], [0.1, 1]]);
          const cr = r();
          const PASTEL: [number, number, number][] = ([[0.95, 0.84, 0.42], [0.95, 0.6, 0.66], [0.6, 0.86, 0.7], [0.62, 0.76, 0.92], [0.96, 0.76, 0.56], [0.85, 0.7, 0.9]] as [number, number, number][]).map((c) => [c[0] * 0.5, c[1] * 0.5, c[2] * 0.5] as [number, number, number]);
          let color: [number, number, number];
          if (style === 1) color = [0.42 + cr * 0.15, 0.52 + cr * 0.15, 0.62 + cr * 0.12];
          else if (style === 7) color = [0.18 + cr * 0.12, 0.42 + cr * 0.15, 0.5 + cr * 0.15];
          else if (style === 2) color = [0.55 + cr * 0.18, 0.53 + cr * 0.16, 0.5 + cr * 0.12];
          else if (style === 6) color = [0.5 + cr * 0.06, 0.48 + cr * 0.06, 0.43 + cr * 0.06];
          else if (style === 5) color = PASTEL[Math.floor(cr * PASTEL.length) % PASTEL.length];
          else color = [0.5 + cr * 0.15, 0.24 + cr * 0.08, 0.18 + cr * 0.06];
          // outward face from block edge
          const edges: number[] = [];
          if (ix === 0) edges.push(1); if (ix === nx - 1) edges.push(0);
          if (iz === 0) edges.push(3); if (iz === nz - 1) edges.push(2);
          const face = edges.length ? edges[Math.floor(r() * edges.length)] : -1;
          let kind: CityBuilding['kind'] = 'normal';
          let cx = lcx + ox, cz = lcz + oz, bw = w, bd = d;
          if (i === 1 && j === 0 && ix === 0 && iz === 0) { kind = 'pharmacy'; floors = 4; style = 2; color = [0.6, 0.64, 0.62]; cx = lcx; cz = lcz; bw = lotW; bd = lotD; }
          else if (i === -1 && j === 0 && ix === 1 && iz === 0) { kind = 'fpt'; floors = 4; style = 2; color = [0.58, 0.55, 0.52]; cx = lcx; cz = lcz; bw = lotW; bd = lotD; }
          else if (dist >= 2 && skipRoll < 0.05) continue;
          else if (rr < 2.2 && (iz === 0 || iz === nz - 1)) { // colourful shophouse row facing the street
            const n = Math.max(2, Math.round(lotW / 5)), sw = lotW / n, front = iz === 0 ? 3 : 2;
            const bd2 = Math.max(12, lotD - 3 - r() * 3);
            for (let k = 0; k < n; k++) {
              const fl = 3 + Math.floor(r() * 3), pc = PASTEL[Math.floor(r() * PASTEL.length)];
              const ccz = iz === 0 ? lcz - lotD / 2 + bd2 / 2 : lcz + lotD / 2 - bd2 / 2;
              const seedS = id + 1, trS = mulberry32(CITY_SEED ^ Math.imul(seedS, 2654435761));
              const wS = sw - 0.25, cxS = lcx - lotW / 2 + sw * (k + 0.5);
              buildings.push({ id: id++, block: [i, j], cx: cxS, cz: ccz, w: wS, d: bd2, floors: fl, h: fl * FLOOR_H, style: r() < 0.8 ? 5 : 2,
                color: pc, tiers: [{ cx: cxS, cz: ccz, w: wS, d: bd2, y0: 0, y1: fl * FLOOR_H }], seed: seedS, kind: 'shop', face: front });
              void trS;
            }
            continue;
          }
          const seed = id + 1;
          const tr = mulberry32(CITY_SEED ^ Math.imul(seed, 2654435761));
          buildings.push({
            id: id++, block: [i, j], cx, cz, w: bw, d: bd, floors, h: floors * FLOOR_H, style, color,
            tiers: makeTiers(tr, cx, cz, bw, bd, floors), seed, kind,
            face: kind === 'pharmacy' ? 1 : kind === 'fpt' ? 0 : face,
          });
        }
      }
    }
  }
})();

export const TOWER_FP: Footprint = { cx: 0, cz: 0, w: TOWER_FOOTPRINT.w, d: TOWER_FOOTPRINT.d, h: TOWER_FLOORS * FLOOR_H };
/** All collidable buildings including the F-Town 3 tower (index 0). */
export const buildingFootprints: Footprint[] = [TOWER_FP, ...buildings.map((b) => ({ cx: b.cx, cz: b.cz, w: b.w, d: b.d, h: b.h }))];
/** South (+z) front plaza of the tower: paved forecourt + drop-off lay-by + mid-block crosswalk at x=0. */
export const PLAZA = { x0: -14, x1: 14, z0: 26, z1: 28, dropOff: { x0: -12, x1: 12, z0: 28, z1: 31 }, crosswalkZ: roadLine(0) };

// ---------- roads ----------
const HALF_ROAD = ROAD_W / 2;
const nearRoad = (c: number) => {
  const k = Math.max(-GRID_HALF - 1, Math.min(GRID_HALF, Math.round((c - PITCH / 2) / PITCH)));
  return Math.abs(c - roadLine(k)) <= HALF_ROAD;
};
/** True when (x,z) lies on asphalt (road or intersection). */
export const isOnRoad = (x: number, z: number): boolean =>
  Math.abs(x) <= CITY_EXTENT + HALF_ROAD && Math.abs(z) <= CITY_EXTENT + HALF_ROAD && (nearRoad(x) || nearRoad(z));

// ---------- street furniture (positions) ----------
export interface Lamp { x: number; z: number; ox: number; oz: number }
export interface TreeP { x: number; z: number; s: number; c: [number, number, number]; lod: 0 | 1 }
export interface BusStop { x: number; z: number; rot: number }
export interface Bench { x: number; z: number; rot: number }
export const lamps: Lamp[] = [];
export const trees: TreeP[] = [];
export const busStops: BusStop[] = [];
export const benches: Bench[] = [];
/** Tower-ring path: superellipse loop (exponent 8) hugging the tower; half-extent PATH_A. */
export const PATH_A = TOWER_FOOTPRINT.w / 2 + 2.2;
export const PATH_HW = 0.75;
export const ringPath: [number, number][] = Array.from({ length: 112 }, (_, k) => {
  const th = (k / 112) * Math.PI * 2, c = Math.cos(th), sn = Math.sin(th);
  const f = Math.pow(Math.pow(Math.abs(c), 8) + Math.pow(Math.abs(sn), 8), -1 / 8);
  return [c * f * PATH_A, sn * f * PATH_A] as [number, number];
});
export interface GardenLight { x: number; z: number }
export const gardenLights: GardenLight[] = [];
export interface Stone { x: number; z: number; r: number; a: number }
export const stones: Stone[] = [];
/** Water features: round pools / canal in the tower ring, plus the park pond. */
export const waterRects: { x: number; z: number; w: number; d: number }[] = [{ x: 0, z: -(TOWER_FOOTPRINT.d / 2 + 0.9), w: TOWER_FOOTPRINT.w * 0.55, d: 0.9 }];
export const waterRounds: { x: number; z: number; r: number }[] = [{ x: -17.5, z: 25.6, r: 1.8 }, { x: 17.5, z: 25.6, r: 1.8 }];
export interface Bike { x: number; z: number; rot: number; c: [number, number, number] }
export interface CafeSet { x: number; z: number; c: [number, number, number] }
export interface Cart { x: number; z: number; rot: number; c: [number, number, number] }
export interface Banner { x: number; z: number; ox: number; oz: number; cell: number }
export const bikes: Bike[] = [];
export const cafes: CafeSet[] = [];
export const carts: Cart[] = [];
export const banners: Banner[] = [];
/** Cable bundles between consecutive poles: [x1,z1,x2,z2]. */
export const cableLinks: [number, number, number, number][] = [];
export const POND = { x: PARK_BLOCK[0] * PITCH + 9, z: PARK_BLOCK[1] * PITCH - 8, r: 8 };

(function furniture() {
  const R = HALF_INNER + SIDEWALK_W / 2 - 0.2; // 26.3
  const r = mulberry32(CITY_SEED ^ 0x5eed);
  const green = (): [number, number, number] => [0.12 + r() * 0.12, 0.35 + r() * 0.2, 0.1 + r() * 0.1];
  for (let i = -GRID_HALF; i <= GRID_HALF; i++) {
    for (let j = -GRID_HALF; j <= GRID_HALF; j++) {
      const bx = i * PITCH, bz = j * PITCH;
      const L = HALF_INNER + SIDEWALK_W - 0.8;
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        const n = Math.SQRT1_2;
        lamps.push({ x: bx + sx * L, z: bz + sz * L, ox: sx * n, oz: sz * n });
      }
      DIRS.forEach(([ox, oz], s) => {
        lamps.push({ x: bx + ox * L, z: bz + oz * L, ox, oz });
        {
          const axx = s < 2 ? 0 : 1, azz = s < 2 ? 1 : 0;
          const pt = (t: number): [number, number] => [bx + ox * L + axx * t, bz + oz * L + azz * t];
          if (r() < 0.45) { const [a1, a2] = pt(-L), [b1, b2] = pt(0), [c1, c2] = pt(L); cableLinks.push([a1, a2, b1, b2], [b1, b2, c1, c2]); }
          if (Math.hypot(bx, bz) < 170 && (i + j + s) % 2 === 0 && !(i === 0 && j === 0 && s === 2)) banners.push({ x: bx + ox * L, z: bz + oz * L, ox, oz, cell: (banners.length * 3 + s) % 6 });
        }
        const ax = s < 2 ? 0 : 1, az = s < 2 ? 1 : 0;
        const isTower = i === 0 && j === 0;
        const ts = isTower ? [-24, -18, -12, 12, 18, 24, -6, 6] : [-8, 8, -17, 17];
        for (const t of ts) {
          if (isTower && s === 2 && Math.abs(t) < 14) continue; // keep south forecourt open

          trees.push({ x: bx + ox * R + ax * t, z: bz + oz * R + az * t, s: 0.8 + r() * 0.35, c: green(), lod: Math.abs(t) === 8 || (isTower && Math.abs(t) % 12 === 0) ? 0 : 1 });
        }
        if (!(isTower && s === 2) && r() < 0.2) busStops.push({ x: bx + ox * R + ax * 12.5, z: bz + oz * R + az * 12.5, rot: Math.atan2(ox, oz) });
      });
    }
  }
  // street life: parked motorbikes in front of shophouses, cafe sets + vendor carts near the tower plaza
  const bikeCol = (): [number, number, number] => { const c = [[0.1, 0.1, 0.12], [0.75, 0.1, 0.1], [0.9, 0.9, 0.92], [0.15, 0.3, 0.7], [0.8, 0.6, 0.1]][Math.floor(r() * 5)]; return c as [number, number, number]; };
  for (const b of buildings) {
    if (b.kind !== 'shop') continue;
    const oz = b.face === 2 ? 1 : -1, n = 2 + Math.floor(r() * 3), bz = b.block[1] * PITCH, bx = b.block[0] * PITCH;
    for (let k = 0; k < n; k++) {
      const x = b.cx - b.w / 2 + 0.8 + ((b.w - 1.6) * (k + 0.5)) / n, z = bz + oz * 25.9;
      if (trees.some((t) => t.s >= 0.5 && Math.abs(t.z - z) < 2 && Math.abs(t.x - x) < 1.6)) continue;
      if (bx === 0 && bz === 0) continue;
      bikes.push({ x, z, rot: Math.PI / 2 + (r() - 0.5) * 0.2, c: bikeCol() });
    }
  }
  for (const [x, z] of [[-21, 27.2], [-24, 27.2], [21, 27.2], [24, 27.2], [27.2, -9], [27.2, 9], [-27.2, -9], [-27.2, 9]]) cafes.push({ x, z, c: [[0.9, 0.2, 0.2], [0.95, 0.75, 0.15], [0.2, 0.55, 0.85], [0.2, 0.7, 0.4]][Math.floor(r() * 4)] as [number, number, number] });
  for (const [x, z, rot] of [[-27.4, -15, 0], [27.4, 15, Math.PI], [-12, 27.5, 0.2], [12, 27.5, -0.2], [PARK_BLOCK[0] * PITCH + 27.2, PARK_BLOCK[1] * PITCH - 12, Math.PI / 2], [PARK_BLOCK[0] * PITCH - 12, PARK_BLOCK[1] * PITCH + 27.2, 0]]) carts.push({ x, z, rot, c: [[0.9, 0.5, 0.1], [0.2, 0.6, 0.3], [0.8, 0.2, 0.25]][Math.floor(r() * 3)] as [number, number, number] });
  // tower ring: bushes between wall and path, benches, garden lights, stepping stones
  const hw = TOWER_FOOTPRINT.w / 2;
  for (let t = -hw + 3; t <= hw - 3; t += 4.5) for (const [ox, oz] of DIRS) {
    const x = ox ? ox * (hw + 0.7) : t, z = oz ? oz * (hw + 0.7) : t;
    if (oz === 1 && Math.abs(x) < 15) continue; // south forecourt
    if (oz === -1 && Math.abs(x) < hw * 0.55 / 2 + 1) continue; // canal
    trees.push({ x, z, s: 0.3 + r() * 0.12, c: green(), lod: 1 });
  }
  for (const t of [-14, 0, 14]) for (const [ox, oz] of DIRS) {
    if (oz === 1) continue;
    benches.push({ x: ox ? ox * (PATH_A + 1.35) : t, z: oz ? oz * (PATH_A + 1.35) : t, rot: Math.atan2(-ox, -oz) });
  }
  ringPath.forEach(([x, z], k) => {
    if (k % 7 !== 3 || (z > 14 && Math.abs(x) < 15)) return;
    const n = Math.hypot(x, z); gardenLights.push({ x: x + (x / n) * (PATH_HW + 0.35), z: z + (z / n) * (PATH_HW + 0.35) });
  });
  // park
  const px = PARK_BLOCK[0] * PITCH, pz = PARK_BLOCK[1] * PITCH;
  let k = 0;
  for (let tries = 0; tries < 400 && k < 42; tries++) {
    const x = px + (r() * 2 - 1) * 23, z = pz + (r() * 2 - 1) * 23;
    if (Math.abs(x - px) < 2.5 || Math.abs(z - pz) < 2.5) continue; // paths
    if (Math.hypot(x - POND.x, z - POND.z) < POND.r + 2) continue;
    trees.push({ x, z, s: 1.3 + r() * 0.9, c: green(), lod: (k++ % 2) as 0 | 1 });
  }
  for (const [dx, dz, rot] of [[5, 1.9, Math.PI], [-5, 1.9, Math.PI], [5, -1.9, 0], [-5, -1.9, 0], [1.9, 8, -Math.PI / 2], [-1.9, 8, Math.PI / 2], [1.9, -8, -Math.PI / 2], [-1.9, -14, Math.PI / 2]] as [number, number, number][]) {
    benches.push({ x: px + dx, z: pz + dz, rot });
  }
  for (let k = 0; k < 14; k++) stones.push({ x: px + 6 + k * 0.9, z: pz + 3.5 + Math.sin(k * 0.7) * 1.2 + k * 0.55, r: 0.4, a: k });
  for (const [dx, dz] of [[4, 4], [-4, 4], [4, -4], [-4, -4]]) lamps.push({ x: px + dx * 3, z: pz + dz * 3, ox: 0, oz: 0 });
})();
