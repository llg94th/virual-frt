/**
 * Kenney CC0 GLB loader for the city world (Nature Kit + Retro Urban Kit) - see public/models/CREDITS.md.
 * Each GLB is merged into ONE BufferGeometry (material colours baked to vertex colours, bottom-centre origin) and shared by
 * every instance. Texture requests are stubbed (the urban kit's textures are not shipped; colours come from material names).
 * If a model fails the store reports 'failed' and callers keep the procedural meshes.
 */
import { useSyncExternalStore } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export interface ModelGeo { geo: THREE.BufferGeometry; w: number; h: number; d: number }
const ROOT = `${(import.meta as any).env?.BASE_URL ?? '/'}models/kenney/`;
const PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const store = new Map<string, ModelGeo | 'fail' | 'loading'>();
const listeners = new Set<() => void>();
let version = 0;
const bump = () => { version++; listeners.forEach((l) => l()); };
let loader: GLTFLoader | null = null;

const NAME_COLORS: [RegExp, [number, number, number]][] = [
  [/planks|wood/i, [0.5, 0.33, 0.18]], [/metal/i, [0.33, 0.36, 0.4]], [/roof/i, [0.3, 0.32, 0.34]], [/wall/i, [0.18, 0.4, 0.28]],
];

function build(scene: THREE.Object3D): ModelGeo {
  scene.updateMatrixWorld(true);
  const parts: THREE.BufferGeometry[] = [];
  scene.traverse((o) => {
    const m = o as THREE.Mesh; if (!m.isMesh) return;
    let g = m.geometry.clone(); g.applyMatrix4(m.matrixWorld);
    if (g.index) g = g.toNonIndexed();
    const mat = (Array.isArray(m.material) ? m.material[0] : m.material) as THREE.MeshStandardMaterial;
    let col = new THREE.Color(0.6, 0.6, 0.6);
    const hasFactor = mat.color && !(mat.color.r === 1 && mat.color.g === 1 && mat.color.b === 1);
    if (hasFactor) col = mat.color.clone();
    else { const hit = NAME_COLORS.find(([re]) => re.test(mat.name)); if (hit) col.setRGB(...hit[1]); }
    const n = g.attributes.position.count, c = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { c[i * 3] = col.r; c[i * 3 + 1] = col.g; c[i * 3 + 2] = col.b; }
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
    if (!g.attributes.normal) g.computeVertexNormals();
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    parts.push(g);
  });
  const geo = mergeGeometries(parts, false)!;
  geo.computeBoundingBox(); const b = geo.boundingBox!;
  geo.translate(-(b.min.x + b.max.x) / 2, -b.min.y, -(b.min.z + b.max.z) / 2);
  geo.computeBoundingBox(); geo.computeBoundingSphere();
  const s = new THREE.Vector3(); geo.boundingBox!.getSize(s);
  return { geo, w: s.x, h: s.y, d: s.z };
}

/** keys are `nature/tree_oak` or `urban/detail-bench`. */
export function requestModels(keys: string[]) {
  for (const k of keys) {
    if (store.has(k)) continue;
    store.set(k, 'loading');
    if (!loader) {
      const mgr = new THREE.LoadingManager(); mgr.setURLModifier((u) => (/\/Textures\//.test(u) ? PIXEL : u));
      loader = new GLTFLoader(mgr);
    }
    loader.load(`${ROOT}${k}.glb`, (g) => { try { store.set(k, build(g.scene)); } catch { store.set(k, 'fail'); } bump(); }, undefined, () => { store.set(k, 'fail'); bump(); });
  }
}
export const getModel = (k: string): ModelGeo | null => { const v = store.get(k); return v && v !== 'fail' && v !== 'loading' ? v : null; };
/** 'ready' once every requested model loaded; a single failure => 'failed' (callers keep procedural meshes). */
export function useModels(keys: string[], enabled: boolean): 'ready' | 'pending' | 'failed' | 'off' {
  useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => version);
  if (!enabled) return 'off';
  requestModels(keys);
  let pending = false;
  for (const k of keys) { const v = store.get(k); if (v === 'fail') return 'failed'; if (!v || v === 'loading') pending = true; }
  return pending ? 'pending' : 'ready';
}
