/**
 * Rigged (Quaternius UAL1 mannequin) character path. Used by Character3D for nearby characters and always for the Player.
 * Falls back silently to the procedural character when the asset is missing or fails.
 */
import React, { useEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as skeletonClone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { CharacterAppearance, CharacterPose } from '../shared';
import { safeTop } from './color';

export const RIG_URL = `${(import.meta as any).env?.BASE_URL ?? '/'}models/quaternius/UAL1_Standard.glb`;
export const RIG_RADIUS = 26; // metres: rigged only inside this distance
export const RIG_RADIUS_OUT = 31; // hysteresis
export const RIG_MAX = 18;
const FADE = 0.25;

export const CLIP: Record<CharacterPose, string> = {
  idle: 'Idle_Loop', walk: 'Walk_Loop', run: 'Jog_Fwd_Loop', sit: 'Sitting_Idle_Loop',
  type: 'Sitting_Talking_Loop', wave: 'Interact', drive: 'Driving_Loop',
};

// ---------------------------------------------------------------- asset status (never preload if 404)
type Status = 'idle' | 'checking' | 'ready' | 'failed';
let status: Status = 'idle';
const subs = new Set<() => void>();
const setStatus = (s: Status) => { status = s; subs.forEach((f) => f()); };
export function ensureRigAsset() {
  if (status !== 'idle') return;
  setStatus('checking');
  fetch(RIG_URL, { method: 'HEAD' })
    .then((r) => {
      const type = r.headers.get('content-type') || '';
      if (!r.ok || type.includes('text/html')) throw new Error('missing');
      preloadAll();
      setStatus('ready');
    })
    .catch(() => setStatus('failed'));
}
export const failRigAsset = () => { if (status !== 'failed') setStatus('failed'); };
export const useRigStatus = (): Status =>
  useSyncExternalStore((l) => { subs.add(l); return () => { subs.delete(l); }; }, () => status);

export class RigBoundary extends React.Component<{ children: React.ReactNode; onError?: () => void; fallback?: React.ReactNode; fatal?: boolean }, { bad: boolean }> {
  state = { bad: false };
  static getDerivedStateFromError() { return { bad: true }; }
  componentDidCatch() { if (this.props.fatal) failRigAsset(); this.props.onError?.(); }
  render() { return this.state.bad ? (this.props.fallback ?? null) : this.props.children; }
}

// ---------------------------------------------------------------- suspense-friendly GLTF cache (skips heavy normal/roughness/body maps)
const BLANK = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
const manager = new THREE.LoadingManager();
manager.setURLModifier((u) => (/Normal|Roughness|T_Superhero|_Dark/.test(u) ? BLANK : u));
const loader = new GLTFLoader(manager);
type G = { scene: THREE.Group; animations: THREE.AnimationClip[] };
const gcache = new Map<string, { p: Promise<G>; v?: G; e?: unknown }>();
export function loadGltf(url: string) {
  let c = gcache.get(url);
  if (!c) {
    const p = loader.loadAsync(url).then((g) => {
      g.scene.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
        if (m && (m as any).isMeshStandardMaterial) { m.normalMap = null; m.roughnessMap = null; m.metalnessMap = null; }
      });
      c!.v = g as unknown as G; return c!.v;
    }, (e) => { c!.e = e ?? new Error('load failed'); throw c!.e; });
    p.catch(() => undefined);
    c = { p };
    gcache.set(url, c);
  }
  return c;
}
/** Throws a promise while loading (Suspense) or the error (boundary). */
export function readGltf(url: string): G {
  const c = loadGltf(url);
  if (c.e) throw c.e;
  if (c.v) return c.v;
  throw c.p;
}
export const BASE_DIR = `${(import.meta as any).env?.BASE_URL ?? '/'}models/quaternius/base/`;
function preloadAll() {
  loadGltf(RIG_URL);
  loadGltf(`${BASE_DIR}Superhero_Male_FullBody.gltf`);
  loadGltf(`${BASE_DIR}Superhero_Female_FullBody.gltf`);
  for (const k of ['open_arms', 'professional']) loadGltf(`${NPC_DIR}${k}.glb`);
}


// ---------------------------------------------------------------- arbiter: closest <= RIG_MAX within radius get rigged
export interface RigEntry { dist: number; priority: boolean; allowed: boolean }
const entries = new Set<RigEntry>();
let lastArb = 0, lastFrame = -1;
const frustum = new THREE.Frustum(), pv = new THREE.Matrix4(), sph = new THREE.Sphere();
export const registerRig = (e: RigEntry) => { entries.add(e); return () => { entries.delete(e); }; };
/** Called from characters' useFrame; cheap, only does work once per frame / 0.25s. */
export function rigTick(camera: THREE.Camera, frame: number, nowMs: number) {
  if (frame !== lastFrame) {
    lastFrame = frame;
    pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(pv);
  }
  if (nowMs - lastArb < 250) return;
  lastArb = nowMs;
  const list = [...entries].filter((e) => e.priority || e.dist < (e.allowed ? RIG_RADIUS_OUT : RIG_RADIUS));
  list.sort((a, b) => (a.priority === b.priority ? a.dist - b.dist : a.priority ? -1 : 1));
  const win = new Set(list.slice(0, RIG_MAX));
  for (const e of entries) e.allowed = win.has(e);
}
export const inView = (x: number, y: number, z: number) => { sph.center.set(x, y, z); sph.radius = 1.3; return frustum.intersectsSphere(sph); };


// ---------------------------------------------------------------- region-coloured material (shared program)
// Regions are classified ONCE per geometry from the dominant skin-bone of each vertex (head/neck/hands = skin,
// spine/clavicle/arms = top, pelvis/legs = bottom, feet = shoes) and stored in the 'aReg' one-hot attribute.
// The shader colours from that attribute only; bind-pose position is used just for decorative accents.
const REGION_KEY = 'city3d-office-regions-v3';
interface Look { skin: string; top: string; bottom: string; shoes: string; tie?: string; badge?: string }
interface Ext { armEnd: number; waist: number; neck: number }
const extCache = new WeakMap<THREE.BufferGeometry, Ext>();
function boneRegion(name: string): number {
  const n = name.toLowerCase();
  if (/^(head|neck)/.test(n) || /^(hand|index|middle|ring|pinky|thumb)/.test(n)) return 2;
  if (/^(foot|ball)/.test(n)) return 3;
  if (/^(pelvis|thigh|calf|root)/.test(n)) return 1;
  return 0; // spine_*, clavicle_*, upperarm_*, lowerarm_*
}
export function ensureRegions(mesh: THREE.SkinnedMesh): Ext {
  const g = mesh.geometry;
  const hit = extCache.get(g); if (hit) return hit;
  const pos = g.getAttribute('position'), si = g.getAttribute('skinIndex'), sw = g.getAttribute('skinWeight');
  const names = mesh.skeleton.bones.map((b) => boneRegion(b.name));
  const reg = new Float32Array(pos.count * 4);
  const ext: Ext = { armEnd: 0.7, waist: 0.95, neck: 1.5 };
  let armEnd = 0, waist = -1e9, neck = 1e9;
  const acc = [0, 0, 0, 0];
  for (let v = 0; v < pos.count; v++) {
    acc[0] = acc[1] = acc[2] = acc[3] = 0;
    for (let k = 0; k < 4; k++) { const w = sw.getComponent(v, k); if (w > 0) acc[names[si.getComponent(v, k)] ?? 0] += w; }
    let best = 0; for (let r = 1; r < 4; r++) if (acc[r] > acc[best]) best = r;
    reg[v * 4 + best] = 1;
    const y = pos.getY(v), ax = Math.abs(pos.getX(v));
    if (best === 0 && ax > armEnd && y > 1.1) armEnd = ax;
    if (best === 1 && y > waist && ax < 0.3) waist = y;
    if (best === 2 && y > 1.3 && ax < 0.2 && y < neck) neck = y;
  }
  g.setAttribute('aReg', new THREE.BufferAttribute(reg, 4));
  if (armEnd > 0.3) ext.armEnd = armEnd;
  if (waist > 0) ext.waist = waist;
  if (neck < 1e8) ext.neck = neck;
  extCache.set(g, ext);
  return ext;
}
function regionMaterial(src: THREE.Material, a: Look, ext: Ext) {
  const m = (src as THREE.MeshStandardMaterial).clone() as THREE.MeshStandardMaterial;
  m.map = null; m.normalMap = null; m.roughnessMap = null; m.metalnessMap = null; m.color.set('#ffffff'); m.roughness = 0.85; m.metalness = 0.0;
  const u = {
    uSkin: { value: new THREE.Color(a.skin) }, uTop: { value: new THREE.Color(a.top) },
    uBottom: { value: new THREE.Color(a.bottom) }, uShoes: { value: new THREE.Color(a.shoes) },
    uTie: { value: new THREE.Color(a.tie ?? '#000000') }, uTieOn: { value: a.tie ? 1 : 0 },
    uBadge: { value: new THREE.Color(a.badge ?? '#000000') }, uBadgeOn: { value: a.badge ? 1 : 0 },
    uArmEnd: { value: ext.armEnd }, uWaist: { value: ext.waist }, uNeck: { value: ext.neck },
  };
  m.userData.regions = u;
  m.customProgramCacheKey = () => REGION_KEY;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aReg; varying vec4 vReg; varying vec3 vRegion;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRegion = position; vReg = aReg;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec4 vReg; varying vec3 vRegion;\nuniform vec3 uSkin; uniform vec3 uTop; uniform vec3 uBottom; uniform vec3 uShoes; uniform vec3 uTie; uniform vec3 uBadge; uniform float uTieOn; uniform float uBadgeOn; uniform float uArmEnd; uniform float uWaist; uniform float uNeck;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          float y = vRegion.y, ax = abs(vRegion.x), z = vRegion.z;
          float mx = max(max(vReg.x, vReg.y), max(vReg.z, vReg.w));
          vec3 c = uTop;
          if (vReg.x >= mx) {
            // shirt: long sleeves to the wrist, darker cuffs, lighter collar band, placket
            if (ax > uArmEnd - 0.07) c *= 0.82;
            if (y > uNeck - 0.05 && ax < 0.2) c = mix(c, vec3(1.0), 0.3);
            if (z > 0.04 && ax < 0.008 && y < uNeck - 0.05 && y > uWaist) c *= 0.8;
            if (y < uWaist + 0.04) c *= 0.88;
          } else if (vReg.y >= mx) {
            c = uBottom;
            if (y > uWaist - 0.045) c = uBottom * 0.45 + vec3(0.02); // belt
          } else if (vReg.z >= mx) {
            c = uSkin;
          } else {
            c = uShoes;
            if (y < 0.03) c *= 0.55; // soles
          }
          if (vReg.x >= mx && z > 0.04 && ax < 0.74) {
            if (uTieOn > 0.5) {
              if (ax < 0.085 && y > uNeck - 0.1 && y < uNeck + 0.02) c = vec3(0.95);   // white collar
              if (ax < 0.03 && y > uWaist + 0.1 && y < uNeck) c = uTie;                // tie
            }
            if (uBadgeOn > 0.5 && y > uWaist + 0.15 && y < uNeck) {
              float vy = uNeck - 0.25;
              if (abs(ax - (y - vy) * 0.32) < 0.007 && y > vy) c = uBadge;             // lanyard
              if (ax < 0.04 && y > vy - 0.1 && y < vy) c = (y > vy - 0.03) ? uBadge : vec3(0.95); // card
            }
          }
          diffuseColor.rgb = c;
        }`);
  };
  return m;
}
function setUniforms(m: THREE.Material, a: Look) {
  const u = m.userData.regions; if (!u) return;
  u.uSkin.value.set(a.skin); u.uTop.value.set(a.top); u.uBottom.value.set(a.bottom); u.uShoes.value.set(a.shoes);
  u.uTie.value.set(a.tie ?? '#000000'); u.uTieOn.value = a.tie ? 1 : 0;
  u.uBadge.value.set(a.badge ?? '#000000'); u.uBadgeOn.value = a.badge ? 1 : 0;
}

// ---------------------------------------------------------------- shared playback
function useRigPlayback(obj: THREE.Object3D, clips: THREE.AnimationClip[], pose: CharacterPose, speed: number | undefined, onReady?: () => void) {
  const group = useRef<THREE.Group>(null);
  const mixer = useMemo(() => new THREE.AnimationMixer(obj), [obj]);
  const cur = useRef<THREE.AnimationAction | null>(null);
  const first = useRef(true);
  useEffect(() => () => { mixer.stopAllAction(); mixer.uncacheRoot(obj); }, [mixer, obj]);
  useEffect(() => {
    const clip = THREE.AnimationClip.findByName(clips, CLIP[pose]) ?? THREE.AnimationClip.findByName(clips, 'Idle_Loop');
    if (!clip) return;
    const next = mixer.clipAction(clip);
    if (next === cur.current) return;
    next.reset().setLoop(THREE.LoopRepeat, Infinity);
    if (first.current) { next.play(); mixer.update(Math.random() * clip.duration); first.current = false; }
    else { next.play(); if (cur.current) cur.current.crossFadeTo(next, FADE, false); else next.fadeIn(FADE); }
    cur.current = next;
  }, [pose, mixer, clips]);
  useEffect(() => { onReady?.(); }, [onReady]);
  useFrame((_, dt) => {
    const g = group.current; if (!g) return;
    g.updateWorldMatrix(true, false);
    const e = g.matrixWorld.elements;
    if (!inView(e[12], e[13] + 0.9, e[14])) return; // freeze when off-screen
    const rate = speed && pose === 'walk' ? Math.max(0.7, Math.min(1.6, speed / 1.4)) : 1;
    mixer.update(Math.min(dt, 0.1) * rate);
  });
  return group;
}

export interface RigProps { appearance: CharacterAppearance; pose: CharacterPose; height: number; castShadow: boolean; onReady?: () => void; speed?: number }

// ---------------------------------------------------------------- Mannequin (fallback)
export const RiggedCharacter: React.FC<RigProps> = ({ appearance, pose, height, castShadow, onReady, speed }) => {
  const gltf = readGltf(RIG_URL);
  const { obj, scale, mats } = useMemo(() => {
    const o = skeletonClone(gltf.scene) as THREE.Object3D;
    const mats: THREE.Material[] = [];
    o.traverse((c) => {
      const m = c as THREE.SkinnedMesh;
      if (m.isMesh) {
        const mm = regionMaterial(m.material as THREE.Material, { ...appearance, top: safeTop(appearance.top, appearance.skin) }, ensureRegions(m)); mats.push(mm);
        m.material = mm; m.frustumCulled = false; m.castShadow = castShadow; m.receiveShadow = false;
      }
    });
    const bb = new THREE.Box3().setFromObject(o);
    return { obj: o, scale: height / Math.max(0.5, bb.max.y - Math.max(0, bb.min.y)), mats };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gltf, height, castShadow]);
  useLayoutEffect(() => { for (const m of mats) setUniforms(m, { ...appearance, top: safeTop(appearance.top, appearance.skin) }); }, [mats, appearance]);
  const group = useRigPlayback(obj, gltf.animations, pose, speed, onReady);
  return <group ref={group} scale={scale}><primitive object={obj} /></group>;
};

// ---------------------------------------------------------------- Meshy NPC bodies (textured, auto-rigged to the Quaternius skeleton, clothes tinted by region)
export const NPC_DIR = `${(import.meta as any).env?.BASE_URL ?? '/'}models/meshy/npc/`;
export type NpcKind = 'open_arms' | 'professional' | 'teacher';
export const npcKindFor = (a: CharacterAppearance): NpcKind => {
  // No skirt body (stretches when seated, looked bad): everyone uses the two trouser bodies.
  const seed = hashStr(`${a.skin}${a.hair}${a.top}${a.bottom}${a.hairStyle}`);
  return ((seed >>> 7) & 1) === 1 ? 'professional' : 'open_arms';
};
interface Ref { top: number; bottom: number }
const refCache = new WeakMap<THREE.BufferGeometry, Ref>();
const toLin = (v: number) => Math.pow(v / 255, 2.2);
/** mean linear luminance of the baseColor texture under the top / bottom regions (so a tint keeps the cloth's own shading) */
export function sampleRef(mesh: THREE.SkinnedMesh): Ref {
  const g = mesh.geometry, hit = refCache.get(g); if (hit) return hit;
  const out: Ref = { top: 0.5, bottom: 0.3 };
  try {
    const tex = (mesh.material as THREE.MeshStandardMaterial).map; const img = tex?.image as ImageBitmap | HTMLImageElement | undefined;
    if (img) {
      const w = 256, h = 256, cv = document.createElement('canvas'); cv.width = w; cv.height = h;
      const cx = cv.getContext('2d', { willReadFrequently: true })!; cx.drawImage(img as CanvasImageSource, 0, 0, w, h);
      const px = cx.getImageData(0, 0, w, h).data, uv = g.getAttribute('uv'), reg = g.getAttribute('aReg');
      const sum = [0, 0, 0, 0], n = [0, 0, 0, 0];
      for (let v = 0; v < uv.count; v += 1) {
        let r = 0; for (let k = 1; k < 4; k++) if (reg.getComponent(v, k) > reg.getComponent(v, r)) r = k;
        const x = Math.min(w - 1, Math.max(0, Math.floor(uv.getX(v) * w))), y = Math.min(h - 1, Math.max(0, Math.floor((tex!.flipY ? 1 - uv.getY(v) : uv.getY(v)) * h))), i = (y * w + x) * 4;
        sum[r] += 0.299 * toLin(px[i]) + 0.587 * toLin(px[i + 1]) + 0.114 * toLin(px[i + 2]); n[r]++;
      }
      if (n[0]) out.top = Math.max(0.02, sum[0] / n[0]);
      if (n[1]) out.bottom = Math.max(0.02, sum[1] / n[1]);
    }
  } catch { /* keep defaults */ }
  refCache.set(g, out); return out;
}
function npcMaterial(src: THREE.Material, look: { top: string; bottom: string }, ref: Ref, tintBottom: boolean) {
  const m = (src as THREE.MeshStandardMaterial).clone() as THREE.MeshStandardMaterial;
  m.normalMap = null; m.roughnessMap = null; m.metalnessMap = null; m.metalness = 0; m.roughness = 0.85; m.envMapIntensity = 0.5;
  const u = { uTop: { value: new THREE.Color(look.top) }, uBottom: { value: new THREE.Color(look.bottom) }, uRefTop: { value: ref.top }, uRefBottom: { value: ref.bottom }, uBottomOn: { value: tintBottom ? 1 : 0 } };
  m.userData.npc = u;
  m.customProgramCacheKey = () => 'city3d-npc-tint-v1';
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec4 aReg; varying vec4 vReg;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvReg = aReg;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec4 vReg; uniform vec3 uTop; uniform vec3 uBottom; uniform float uRefTop; uniform float uRefBottom; uniform float uBottomOn;')
      .replace('#include <map_fragment>', `#include <map_fragment>
        {
          float mx = max(max(vReg.x, vReg.y), max(vReg.z, vReg.w));
          float L = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
          if (vReg.x >= mx) diffuseColor.rgb = uTop * clamp(L / uRefTop, 0.25, 1.7);
          else if (vReg.y >= mx && uBottomOn > 0.5) diffuseColor.rgb = uBottom * clamp(L / uRefBottom, 0.25, 1.7);
        }`);
  };
  return m;
}
export const MeshyCharacter: React.FC<RigProps & { kind: NpcKind }> = ({ appearance, pose, height, castShadow, onReady, speed, kind }) => {
  const body = readGltf(`${NPC_DIR}${kind}.glb`);
  const anim = readGltf(RIG_URL);
  // lift the tint towards a clean office palette (white shirts keep their shading; dark roles stay dark)
  const look = useMemo(() => { const t = new THREE.Color(safeTop(appearance.top, appearance.skin)); if (lum(appearance.top) > 0.12) t.lerp(new THREE.Color('#ffffff'), 0.22); return { top: '#' + t.getHexString(), bottom: appearance.bottom }; }, [appearance.top, appearance.skin, appearance.bottom]);
  const { obj, scale, mats } = useMemo(() => {
    const o = skeletonClone(body.scene) as THREE.Object3D;
    const mats: THREE.Material[] = []; let bb: THREE.Box3 | null = null;
    o.traverse((c) => {
      const m = c as THREE.SkinnedMesh; if (!m.isSkinnedMesh) return;
      ensureRegions(m);
      const mm = npcMaterial(m.material as THREE.Material, look, sampleRef(m), kind !== 'teacher'); mats.push(mm);
      m.material = mm; m.frustumCulled = false; m.castShadow = castShadow; m.receiveShadow = false;
      m.geometry.computeBoundingBox(); bb = m.geometry.boundingBox;
    });
    const b = bb as THREE.Box3 | null; if (!b) throw new Error('no npc mesh');
    return { obj: o, scale: height / Math.max(0.5, b.max.y - b.min.y), mats };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [body, height, castShadow]);
  useLayoutEffect(() => { for (const m of mats) { const u = m.userData.npc; u.uTop.value.set(look.top); u.uBottom.value.set(look.bottom); } }, [mats, look.top, look.bottom]); // eslint-disable-line react-hooks/exhaustive-deps
  const group = useRigPlayback(obj, anim.animations, pose, speed, onReady);
  return <group ref={group} scale={scale}><primitive object={obj} /></group>;
};

// ---------------------------------------------------------------- Office worker (Quaternius base character + hair + UAL clips)
function hashStr(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
const lum = (c: string) => { const k = new THREE.Color(c); return 0.2126 * k.r + 0.7152 * k.g + 0.0722 * k.b; };

function hairFile(a: CharacterAppearance, female: boolean, seedBit: boolean): string | null {
  switch (a.hairStyle) {
    case 'long': return 'Hair_Long';
    case 'bun': return 'Hair_Buns';
    case 'bald': return female ? 'Hair_Buns' : 'Hair_Buzzed';
    case 'cap': return female ? 'Hair_Buns' : 'Hair_SimpleParted';
    default: return female ? ((seedBit) ? 'Hair_Long' : 'Hair_Buns') : 'Hair_SimpleParted';
  }
}
// shared head accessory geometry/material (model space: head centre ~ (0, 1.70, 0.03), facing +z)
const accMat = new THREE.MeshStandardMaterial({ color: '#15151a', roughness: 0.5, metalness: 0.2 });
const accGeo = {
  ring: new THREE.TorusGeometry(0.026, 0.0035, 6, 14),
  bridge: new THREE.BoxGeometry(0.02, 0.004, 0.004),
  arc: new THREE.TorusGeometry(0.108, 0.006, 6, 16, Math.PI),
  cup: new THREE.CylinderGeometry(0.022, 0.022, 0.016, 10),
  mic: new THREE.BoxGeometry(0.004, 0.004, 0.07),
};
function buildAccessory(kind: 'glasses' | 'headset'): THREE.Group {
  const g = new THREE.Group();
  const add = (geo: THREE.BufferGeometry, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) => {
    const m = new THREE.Mesh(geo, accMat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); m.castShadow = false; g.add(m);
  };
  if (kind === 'glasses') {
    add(accGeo.ring, 0.032, 1.708, 0.103); add(accGeo.ring, -0.032, 1.708, 0.103); add(accGeo.bridge, 0, 1.712, 0.103);
  } else {
    add(accGeo.arc, 0, 1.70, 0.02); add(accGeo.cup, 0.108, 1.70, 0.02, 0, 0, Math.PI / 2); add(accGeo.cup, -0.108, 1.70, 0.02, 0, 0, Math.PI / 2);
    add(accGeo.mic, 0.085, 1.65, 0.07, 0, -0.5, 0);
  }
  return g;
}

export const OfficeCharacter: React.FC<RigProps> = ({ appearance, pose, height, castShadow, onReady, speed }) => {
  const seed = hashStr(`${appearance.skin}${appearance.hair}${appearance.top}${appearance.bottom}${appearance.hairStyle}`);
  const female = appearance.hairStyle === 'long' || appearance.hairStyle === 'bun' ? true : (seed & 1) === 1;
  const beard = !female && appearance.hairStyle !== 'cap' && (seed >>> 3) % 5 === 0;
  const hf = hairFile(appearance, female, ((seed >>> 5) & 1) === 1);
  const base = readGltf(`${BASE_DIR}Superhero_${female ? 'Female' : 'Male'}_FullBody.gltf`);
  const hair = hf ? readGltf(`${BASE_DIR}hair/${hf}.gltf`) : null;
  const beardG = beard ? readGltf(`${BASE_DIR}hair/Hair_Beard.gltf`) : null;
  const anim = readGltf(RIG_URL);
  const h = Math.max(1.6, Math.min(1.82, height)) * (female ? 0.97 : 1);
  const dark = lum(safeTop(appearance.top, appearance.skin)) < 0.22;
  const look: Look = {
    skin: appearance.skin, top: safeTop(appearance.top, appearance.skin), bottom: appearance.bottom, shoes: appearance.shoes,
    tie: appearance.accessory === 'badge' && dark ? '#b91c1c' : undefined,
    badge: appearance.accessory === 'badge' ? (dark ? '#2563eb' : '#f97316') : undefined,
  };
  const { obj, scale, mats, tints } = useMemo(() => {
    const o = skeletonClone(base.scene) as THREE.Object3D;
    o.updateMatrixWorld(true);
    const mats: THREE.Material[] = [], tints: THREE.MeshStandardMaterial[] = [];
    let body: THREE.SkinnedMesh | null = null;
    const skinned: THREE.SkinnedMesh[] = [];
    o.traverse((c) => { if ((c as THREE.SkinnedMesh).isSkinnedMesh) skinned.push(c as THREE.SkinnedMesh); });
    for (const m of skinned) {
      m.frustumCulled = false; m.receiveShadow = false;
      const n = m.name.toLowerCase();
      if (n.includes('eyebrow')) {
        const mm = (m.material as THREE.MeshStandardMaterial).clone(); mm.color.set(appearance.hair); m.material = mm; tints.push(mm); m.castShadow = false;
      } else if (n.includes('eye')) {
        const mm = (m.material as THREE.MeshStandardMaterial).clone(); mm.normalMap = null; m.material = mm; m.castShadow = false;
      } else {
        body = m; const mm = regionMaterial(m.material as THREE.Material, look, ensureRegions(m)); mats.push(mm); m.material = mm; m.castShadow = castShadow;
      }
    }
    if (!body) throw new Error('no body mesh');
    const bones = new Map<string, THREE.Bone>();
    body.skeleton.bones.forEach((b) => bones.set(b.name, b));
    const parent = body.parent ?? o;
    const attach = (g: G) => {
      let src: THREE.SkinnedMesh | null = null;
      g.scene.traverse((c) => { if (!src && (c as THREE.SkinnedMesh).isSkinnedMesh) src = c as THREE.SkinnedMesh; });
      if (!src) return;
      const s = src as THREE.SkinnedMesh;
      const sb = s.skeleton.bones.map((b) => bones.get(b.name));
      if (sb.some((b) => !b)) return;
      const mm = (s.material as THREE.MeshStandardMaterial).clone(); mm.color.set(appearance.hair); mm.normalMap = null;
      const hm = new THREE.SkinnedMesh(s.geometry, mm);
      hm.name = s.name; hm.frustumCulled = false; hm.castShadow = false;
      hm.bind(new THREE.Skeleton(sb as THREE.Bone[], s.skeleton.boneInverses), (body as THREE.SkinnedMesh).bindMatrix);
      parent.add(hm); tints.push(mm);
    };
    if (hair) attach(hair);
    if (beardG) attach(beardG);
    // accessories on the head bone, placed in bind pose model space
    const headBone = bones.get('Head');
    if (headBone && (appearance.accessory === 'glasses' || appearance.accessory === 'headset')) {
      const acc = buildAccessory(appearance.accessory);
      headBone.updateWorldMatrix(true, false);
      const inv = new THREE.Matrix4().copy(headBone.matrixWorld).invert();
      acc.applyMatrix4(inv);
      headBone.add(acc);
    }
    const gb = body.geometry.boundingBox ?? (body.geometry.computeBoundingBox(), body.geometry.boundingBox!);
    return { obj: o, scale: h / Math.max(0.5, gb.max.y - gb.min.y), mats, tints };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, hair, beardG, h, castShadow, appearance.accessory, appearance.hairStyle]);
  useLayoutEffect(() => {
    for (const m of mats) setUniforms(m, look);
    for (const t of tints) t.color.set(appearance.hair);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mats, tints, appearance.skin, appearance.top, appearance.bottom, appearance.shoes, appearance.hair, look.tie, look.badge]);
  const group = useRigPlayback(obj, anim.animations, pose, speed, onReady);
  return <group ref={group} scale={scale}><primitive object={obj} /></group>;
};
