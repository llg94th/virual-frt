/**
 * Kenney furniture GLB loader: each model is merged into ONE BufferGeometry (material colours baked to vertex colours,
 * so no textures are needed), normalised to bottom-centre origin with its front on +z, and shared by every instance.
 * If a model fails to load the store reports 'failed' and callers keep the procedural fallback.
 */
import { useSyncExternalStore } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export interface PropGeo { main: THREE.BufferGeometry; glow: THREE.BufferGeometry | null }
const BASE = `${(import.meta as any).env?.BASE_URL ?? '/'}models/kenney/furniture/`;
const store = new Map<string, PropGeo | 'fail' | 'loading'>();
const listeners = new Set<() => void>();
let version = 0;
const bump = () => { version++; listeners.forEach((l) => l()); };
let loader: GLTFLoader | null = null;

function build(name: string, scene: THREE.Object3D): PropGeo {
  scene.updateMatrixWorld(true);
  const main: THREE.BufferGeometry[] = [], glow: THREE.BufferGeometry[] = [];
  scene.traverse((o) => {
    const m = o as THREE.Mesh; if (!m.isMesh) return;
    let g = m.geometry.clone(); g.applyMatrix4(m.matrixWorld);
    if (g.index) g = g.toNonIndexed();
    const mat = (Array.isArray(m.material) ? m.material[0] : m.material) as THREE.MeshStandardMaterial;
    const col = mat.color ?? new THREE.Color('#cccccc'), n = g.attributes.position.count, c = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { c[i * 3] = col.r; c[i * 3 + 1] = col.g; c[i * 3 + 2] = col.b; }
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
    if (!g.attributes.normal) g.computeVertexNormals();
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    // the screen's display face is the lone 2-triangle primitive: rendered separately as an emissive instance
    ((name === 'computerScreen' && n <= 6) ? glow : main).push(g);
  });
  const all = new THREE.Box3(); [...main, ...glow].forEach((g) => { g.computeBoundingBox(); all.union(g.boundingBox!); });
  const dx = -(all.min.x + all.max.x) / 2, dy = -all.min.y, dz = -(all.min.z + all.max.z) / 2;
  const fin = (list: THREE.BufferGeometry[]) => { if (!list.length) return null; const g = mergeGeometries(list, false)!; g.translate(dx, dy, dz); return g; };
  return { main: fin(main)!, glow: fin(glow) };
}
export function requestProps(names: string[]) {
  for (const n of names) {
    if (store.has(n)) continue;
    store.set(n, 'loading');
    loader ??= new GLTFLoader();
    loader.load(`${BASE}${n}.glb`, (g) => { try { store.set(n, build(n, g.scene)); } catch { store.set(n, 'fail'); } bump(); }, undefined, () => { store.set(n, 'fail'); bump(); });
  }
}
export function getProp(name: string): PropGeo | null { const v = store.get(name); return v && v !== 'fail' && v !== 'loading' ? v : null; }
/** 'ready' only when every requested model loaded; 'pending' while loading; 'failed' if any failed */
export function usePropsState(names: string[], enabled: boolean): 'ready' | 'pending' | 'failed' | 'off' {
  useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => version);
  if (!enabled || !names.length) return 'off';
  requestProps(names);
  let pending = false;
  for (const n of names) { const v = store.get(n); if (v === 'fail') return 'failed'; if (!v || v === 'loading') pending = true; }
  return pending ? 'pending' : 'ready';
}
