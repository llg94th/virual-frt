/** Deterministic placements of Kenney model instances (trees, park ring, street furniture). */
import { CITY_SEED, mulberry32, TOWER_FOOTPRINT, PITCH, GRID_HALF } from '../shared';
import { trees, PARK_BLOCK, POND, waterRects, DIRS, PATH_A } from './layout';

export interface Place { key: string; x: number; y: number; z: number; rot: number; h: number; tint?: [number, number, number] }
const N = (n: string) => `nature/${n}`, U = (n: string) => `urban/${n}`;

const TREES = ['tree_default', 'tree_oak', 'tree_fat', 'tree_thin', 'tree_simple'];
const PALMS = ['tree_palm', 'tree_palmTall', 'tree_palmShort', 'tree_palmBend'];
const PALM_H: Record<string, number> = { tree_palm: 9, tree_palmTall: 11, tree_palmShort: 6.5, tree_palmBend: 8.5 };
const TREE_H: Record<string, number> = { tree_default: 7.5, tree_oak: 6, tree_fat: 5.5, tree_thin: 7, tree_simple: 7.5 };
const BUSH = ['plant_bush', 'plant_bushLarge', 'plant_bushDetailed', 'plant_bushSmall'];
const FLOWERS = ['flower_redA', 'flower_purpleA', 'flower_yellowA', 'flower_redB', 'flower_purpleB', 'flower_yellowB'];
const ROCKS = ['rock_smallA', 'rock_smallB', 'rock_smallC', 'rock_largeA', 'rock_largeB'];

export const MODEL_KEYS: string[] = [
  // trees / palms / bushes / flowers are drawn by ./trees.tsx (procedural leaf-card vegetation), so their Kenney models are not loaded
  ...[...ROCKS, 'lily_large', 'lily_small', 'path_stone', 'bridge_wood', 'fence_simple', 'fence_planks'].map(N),
  U('detail-bench'), U('detail-dumpster-closed'),
];

let cache: Place[] | null = null;
export function buildPlacements(): Place[] {
  if (cache) return cache;
  const out: Place[] = [];
  const r = mulberry32(CITY_SEED ^ 0xd3c0);
  const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
  const green = (): [number, number, number] => [0.62 + r() * 0.2, 0.8 + r() * 0.15, 0.35 + r() * 0.15];
  // trees (replace procedural): ~35% palms, more along the central main roads
  trees.forEach((t) => {
    if (t.s < 0.5) { // lawn bushes
      out.push({ key: N(pick(BUSH)), x: t.x, y: 0.18, z: t.z, rot: r() * 6.28, h: 0.9 + r() * 0.5, tint: green() });
      return;
    }
    const central = Math.min(Math.abs(t.x), Math.abs(t.z)) < 120;
    const palm = r() < (central ? 0.5 : 0.22);
    const name = palm ? pick(PALMS) : pick(TREES);
    const sc = Math.min(t.s, 1.5) / 0.95;
    out.push({ key: N(name), x: t.x, y: 0.18, z: t.z, rot: r() * 6.28, h: (palm ? PALM_H[name] : TREE_H[name]) * sc, tint: green() });
  });
  // tower ring: flower patches on the lawn strip, benches facing the path
  const hw = TOWER_FOOTPRINT.w / 2;
  for (let t = -hw + 5.2; t <= hw - 3; t += 4.5) for (const [ox, oz] of DIRS) {
    const x = ox ? ox * (hw + 1.15) : t, z = oz ? oz * (hw + 1.15) : t;
    if (oz === 1 && Math.abs(x) < 15) continue;
    if (oz === -1 && Math.abs(x) < hw * 0.275 + 1) continue;
    for (let k = 0; k < 3; k++) out.push({ key: N(pick(FLOWERS)), x: x + (ox ? 0 : (k - 1) * 0.35), z: z + (oz ? 0 : (k - 1) * 0.35), y: 0.2, rot: r() * 6.28, h: 0.6 + r() * 0.2 });
  }
  const canal = waterRects[0];
  out.push({ key: N('bridge_wood'), x: 9, y: 0.2, z: canal.z, rot: 0, h: 0.5 });
  for (const [x, z] of [[-PATH_A - 1.2, -PATH_A - 1.2], [PATH_A + 1.2, -PATH_A - 1.2]]) out.push({ key: N('tree_palmTall'), x, y: 0.18, z, rot: r() * 6.28, h: 10, tint: green() });
  // park block
  const px = PARK_BLOCK[0] * PITCH, pz = PARK_BLOCK[1] * PITCH;
  for (let k = 0; k < 9; k++) {
    const a = r() * 6.28, d = 8 + r() * 14;
    const x = px + Math.cos(a) * d, z = pz + Math.sin(a) * d;
    if (Math.abs(x - px) < 3 || Math.abs(z - pz) < 3 || Math.hypot(x - POND.x, z - POND.z) < POND.r + 3) continue;
    const nm = pick(PALMS); out.push({ key: N(nm), x, y: 0.2, z, rot: r() * 6.28, h: PALM_H[nm] * (0.9 + r() * 0.3), tint: green() });
  }
  for (let k = 0; k < 22; k++) {
    const x = px + (r() * 2 - 1) * 23, z = pz + (r() * 2 - 1) * 23;
    if (Math.abs(x - px) < 2.6 || Math.abs(z - pz) < 2.6 || Math.hypot(x - POND.x, z - POND.z) < POND.r + 1.5) continue;
    out.push({ key: N(pick(BUSH)), x, y: 0.2, z, rot: r() * 6.28, h: 1.1 + r() * 0.8, tint: green() });
  }
  for (let k = 0; k < 14; k++) { // flower patches
    const cx = px + (r() * 2 - 1) * 22, cz = pz + (r() * 2 - 1) * 22;
    if (Math.abs(cx - px) < 3 || Math.abs(cz - pz) < 3 || Math.hypot(cx - POND.x, cz - POND.z) < POND.r + 1.5) continue;
    const f = k % 3 === 0 ? FLOWERS.slice(0, 2) : FLOWERS;
    for (let q = 0; q < 6; q++) out.push({ key: N(pick(f)), x: cx + (r() - 0.5) * 2.2, z: cz + (r() - 0.5) * 2.2, y: 0.2, rot: r() * 6.28, h: 0.6 + r() * 0.3 });
  }
  for (let k = 0; k < 16; k++) { // rocks around the pond
    const a = (k / 16) * 6.28 + r() * 0.3, d = POND.r + 0.3 + r() * 0.6, nm = pick(ROCKS);
    out.push({ key: N(nm), x: POND.x + Math.cos(a) * d, z: POND.z + Math.sin(a) * d, y: 0.2, rot: r() * 6.28, h: nm.includes('large') ? 0.9 : 0.5 });
  }
  for (let k = 0; k < 9; k++) { // lily pads
    const a = r() * 6.28, d = Math.sqrt(r()) * (POND.r - 1.2);
    out.push({ key: N(k % 3 ? 'lily_large' : 'lily_small'), x: POND.x + Math.cos(a) * d, z: POND.z + Math.sin(a) * d, y: 0.33, rot: r() * 6.28, h: 0.3 });
  }
  for (let k = 0; k < 9; k++) out.push({ key: N('path_stone'), x: px - 8 + Math.sin(k) * 0.5, z: pz - 6 - k * 1.5, y: 0.21, rot: Math.PI / 2 + (r() - 0.5) * 0.4, h: 0.05 });
  // park fence segments along the inner edge (gaps at path entrances)
  for (let t = -23; t <= 23; t += 2) for (const [ox, oz] of DIRS) {
    if (Math.abs(t) < 3.5) continue;
    out.push({ key: N(t % 4 === 1 ? 'fence_planks' : 'fence_simple'), x: px + (ox ? ox * 24.6 : t), z: pz + (oz ? oz * 24.6 : t), y: 0.2, rot: ox ? Math.PI / 2 : 0, h: 0.8 });
  }
  // urban: benches on sidewalks near tower + park, dumpsters in a few city blocks
  const side = (bx: number, bz: number, ts: number[], bench: boolean, only = -1) => {
    for (const t of ts) for (const [ox, oz] of DIRS.filter((_, di) => only < 0 || di === only)) {
      if (bench && bx === 0 && bz === 0 && oz === 1) continue;
      const x = bx + (ox ? ox * 26.8 : t), z = bz + (oz ? oz * 26.8 : t);
      out.push({ key: U(bench ? 'detail-bench' : 'detail-dumpster-closed'), x, y: 0.18, z, rot: Math.atan2(ox, oz) + Math.PI, h: bench ? 0.9 : 1.6 });
    }
  };
  side(0, 0, [-3, 3], true); side(px, pz, [-3.5, 3.5], true);
  for (let k = 0; k < 7; k++) {
    const i = Math.floor(r() * (GRID_HALF * 2 + 1)) - GRID_HALF, j = Math.floor(r() * (GRID_HALF * 2 + 1)) - GRID_HALF;
    if ((i === 0 && j === 0) || (i === PARK_BLOCK[0] && j === PARK_BLOCK[1])) continue;
    side(i * PITCH, j * PITCH, [r() < 0.5 ? -20 : 20], false, Math.floor(r() * 4));
  }
  return (cache = out);
}
