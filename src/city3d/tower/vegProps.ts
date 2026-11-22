/**
 * Textured vegetation props for the tower (`v:` names in Furn.prop):
 *  - procedural, synchronous:  v:tree_0..2  v:palm_0..2  v:bush_0..1  v:flower_0  v:grass_0   (leaf-card models from ../world/vegetation)
 *  - Poly Haven CC0 scans (public/models/plants/*.glb, decimated + WebP, see public/models/CREDITS.md), async:
 *    v:ficus  v:alocasia  v:haworthia  v:pachira  v:calathea  v:fern
 * Models are normalised to a bottom-centre origin and keep their own (textured) materials.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { getVeg, vegMaterial, type VegKind } from '../world/vegetation';
import type { PropGeo } from './props';

const ROOT = `${(import.meta as any).env?.BASE_URL ?? '/'}models/plants/`;
/** file, uniform scale, and an added planter for the scans that come without a pot */
const FILES: Record<string, { f: string; s?: number; pot?: string }> = {
  ficus: { f: 'ficus' }, alocasia: { f: 'alocasia' }, haworthia: { f: 'haworthia' },
  pachira: { f: 'pachira', s: 0.66, pot: '#ece9df' }, calathea: { f: 'calathea', s: 1.1, pot: '#3d4349' }, fern: { f: 'fern', s: 1.25, pot: '#b0644a' },
};
let loader: GLTFLoader | null = null;

function proc(name: string): PropGeo | null {
  const m = /^v:(tree|palm|bush|flower|grass)_(\d+)$/.exec(name); if (!m) return null;
  const kind = ({ tree: 'broad', palm: 'palm', bush: 'bush', flower: 'flower', grass: 'grass' } as Record<string, VegKind>)[m[1]];
  return { main: getVeg(kind, +m[2]).geos[0], glow: null, mat: vegMaterial() };
}

/** fresh geometry with plain Float32 position / normal / uv (+ Uint32 index): GLB attributes may be interleaved / quantised, which mergeGeometries rejects */
function plain(src: THREE.BufferGeometry): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry(), n = src.attributes.position.count;
  for (const [k, sz] of [['position', 3], ['normal', 3], ['uv', 2]] as const) {
    const a = src.attributes[k], out = new Float32Array(n * sz);
    if (a) for (let i = 0; i < n; i++) { out[i * sz] = a.getX(i); out[i * sz + 1] = a.getY(i); if (sz === 3) out[i * sz + 2] = a.getZ(i); }
    g.setAttribute(k, new THREE.BufferAttribute(out, sz));
  }
  if (src.index) g.setIndex(new THREE.BufferAttribute(Uint32Array.from(src.index.array as ArrayLike<number>), 1)); else { const ix = new Uint32Array(n); for (let i = 0; i < n; i++) ix[i] = i; g.setIndex(new THREE.BufferAttribute(ix, 1)); }
  if (!src.attributes.normal) g.computeVertexNormals();
  return g;
}

function fromScene(scene: THREE.Object3D, spec: { s?: number; pot?: string }): PropGeo {
  scene.updateMatrixWorld(true);
  const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
  scene.traverse((o) => {
    const me = o as THREE.Mesh; if (!me.isMesh) return;
    const g = plain(me.geometry); g.applyMatrix4(me.matrixWorld);
    if (spec.s) g.scale(spec.s, spec.s, spec.s);
    const mat = (Array.isArray(me.material) ? me.material[0] : me.material) as THREE.Material;
    (byMat.get(mat) ?? byMat.set(mat, []).get(mat)!).push(g);
  });
  const mats: THREE.Material[] = [], parts: THREE.BufferGeometry[] = [];
  byMat.forEach((list, m) => {
    const sm = (m as THREE.MeshStandardMaterial).clone(); sm.side = THREE.DoubleSide; sm.metalness = 0; sm.roughness = Math.max(0.7, sm.roughness ?? 0.8);
    mats.push(sm); parts.push(list.length > 1 ? mergeGeometries(list, false)! : list[0]);
  });
  let geo = parts.length > 1 ? mergeGeometries(parts, true)! : parts[0];
  geo.computeBoundingBox(); const b = geo.boundingBox!;
  geo.translate(-(b.min.x + b.max.x) / 2, -b.min.y, -(b.min.z + b.max.z) / 2);
  if (spec.pot) { // planter: plant sits on soil inside a tapered ceramic pot (uv-less -> flat colour material)
    const ph = 0.3, pg = new THREE.CylinderGeometry(0.24, 0.17, ph, 16, 1, false).translate(0, ph / 2, 0);
    for (const k of Object.keys(pg.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') pg.deleteAttribute(k);
    geo.translate(0, ph - 0.02, 0);
    geo = mergeGeometries([...parts.length > 1 ? splitGroups(geo, parts.length) : [geo], pg], true)!;
    mats.push(new THREE.MeshStandardMaterial({ color: spec.pot, roughness: 0.45, metalness: 0.05 }));
  }
  geo.computeBoundingBox(); geo.computeBoundingSphere();
  return { main: geo, glow: null, mat: mats.length > 1 ? mats : mats[0] };
}

/** re-expand a merged geometry back into one geometry per material group (so it can be merged again with an extra part) */
function splitGroups(g: THREE.BufferGeometry, n: number): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  for (let i = 0; i < n; i++) {
    const gr = g.groups.find((x) => x.materialIndex === i); if (!gr) continue;
    const c = g.clone(); c.clearGroups(); c.setIndex(Array.from(g.index!.array.slice(gr.start, gr.start + gr.count))); out.push(c);
  }
  return out;
}

/** returns the model right away for procedural names, or null while a GLB loads (cb is called once it is ready; on error a bush stands in) */
export function loadVegProp(name: string, cb: (g: PropGeo | null) => void): PropGeo | null {
  const p = proc(name); if (p) return p;
  const spec = FILES[name.slice(2)];
  if (!spec) { return proc('v:bush_0'); }
  loader ??= new GLTFLoader();
  loader.load(`${ROOT}${spec.f}.glb`, (g) => { try { cb(fromScene(g.scene, spec)); } catch { cb(proc('v:bush_0')); } }, undefined, () => cb(proc('v:bush_0')));
  return null;
}
