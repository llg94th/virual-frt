/**
 * Far-LOD renderer for Character3D: every character beyond FAR_IN metres (and not rigged) is drawn as ONE instance of a
 * pre-posed merged geometry (one InstancedMesh per pose x shadow flag), coloured per instance by region
 * (top/bottom/skin/hair/shoes) via instanced attributes and a patched MeshStandardMaterial (single shader program).
 *
 * Mesh count per seated procedural Character3D (measured by counting <mesh> nodes in the JSX, default hair/no accessory):
 *   before: 19-21 meshes (+ same again in the shadow pass)  ->  far: 0 own meshes; all far characters share <= 14
 *   InstancedMesh draws in total (7 poses x {shadow, no-shadow}), i.e. ~1460 draw calls with 30 staff -> ~1 per pose.
 */
import React, { useEffect, useMemo, useSyncExternalStore } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { CharacterPose } from '../shared';
import { J, HIP_Y, tgt, computeTarget } from './pose';
import { clone as skeletonClone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { inView, rigTick, readGltf, ensureRegions, sampleRef, NPC_DIR, RIG_URL, CLIP, RigBoundary } from './rigged';
import { safeTop } from './color';

export const FAR_IN = 20; // metres from camera: beyond -> far LOD (hysteresis handled by caller)
export const SHADOW_DIST = 60; // beyond: no shadow casting
const CAP = 400;
const POSES: CharacterPose[] = ['idle', 'walk', 'run', 'sit', 'type', 'wave', 'drive'];

export interface FarEntry {
  active: boolean; pose: CharacterPose; dist: number; k: number;
  m: Float32Array; // world matrix of the character group (without height scale)
  cols: Float32Array; // top,bottom,skin,hair,shoes (linear rgb) = 15 floats
}
export const farEntries = new Set<FarEntry>();
export const farUsers = new Set<object>();
const listeners = new Set<() => void>();
const sub = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const bump = () => listeners.forEach((l) => l());
export function joinFar(token: object) { farUsers.add(token); bump(); return () => { farUsers.delete(token); bump(); }; }
/** True for exactly one mounted character (the one that portals the FarHost into the scene). */
export const useFarLeader = (token: object) =>
  useSyncExternalStore(sub, () => farUsers.values().next().value === token);

export function makeFarColors(a: { top: string; bottom: string; skin: string; hair: string; shoes: string; hairStyle: string }, out: Float32Array) {
  const c = new THREE.Color();
  [safeTop(a.top, a.skin), a.bottom, a.skin, a.hairStyle === 'bald' ? a.skin : a.hair, a.shoes].forEach((col, i) => { c.set(col); out[i * 3] = c.r; out[i * 3 + 1] = c.g; out[i * 3 + 2] = c.b; });
}

// ---------------------------------------------------------------- pre-posed merged geometry
const geoCache = new Map<CharacterPose, THREE.BufferGeometry>();
const REGION = { top: 0, bottom: 1, skin: 2, hair: 3, shoes: 4 };
function buildPosed(pose: CharacterPose): THREE.BufferGeometry {
  const hit = geoCache.get(pose); if (hit) return hit;
  computeTarget(pose, 0.9, 0, 0);
  const t = tgt;
  const parts: THREE.BufferGeometry[] = [];
  const add = (g: THREE.BufferGeometry, region: number, m: THREE.Matrix4) => {
    const c = g.clone(); c.applyMatrix4(m);
    c.setAttribute('aRegion', new THREE.BufferAttribute(new Float32Array(c.attributes.position.count).fill(region), 1));
    parts.push(c);
  };
  const T = (x: number, y: number, z: number) => new THREE.Matrix4().makeTranslation(x, y, z);
  const Rx = (a: number) => new THREE.Matrix4().makeRotationX(a);
  const Ry = (a: number) => new THREE.Matrix4().makeRotationY(a);
  const Rz = (a: number) => new THREE.Matrix4().makeRotationZ(a);
  const S = (x: number, y: number, z: number) => new THREE.Matrix4().makeScale(x, y, z);
  const mul = (...ms: THREE.Matrix4[]) => ms.reduce((a, b) => a.clone().multiply(b));
  const seated = pose === 'sit' || pose === 'type' || pose === 'drive';
  const hips = T(0, t[J.HY], seated ? -0.08 : 0);
  const spine = mul(hips, Rx(t[J.SPX]));
  const capG = (r: number, l: number) => new THREE.CapsuleGeometry(r, l, 2, 6);
  add(capG(0.14, 0.3), REGION.top, mul(spine, T(0, 0.27, 0), S(1.15, 1, 0.78)));
  const head = mul(spine, T(0, 0.58, 0), Ry(t[J.HDY]), Rx(t[J.HDX]), T(0, 0.13, 0));
  add(new THREE.SphereGeometry(0.12, 8, 6), REGION.skin, mul(head, S(0.95, 1.05, 1)));
  add(new THREE.SphereGeometry(0.13, 8, 5, 0, Math.PI * 2, 0, Math.PI * 0.58), REGION.hair, mul(head, T(0, 0.005, -0.005)));
  for (const sd of [1, -1]) {
    const L = sd === 1;
    const sh = mul(spine, T(sd * 0.2, 0.5, 0), Rz(t[L ? J.LAZ : J.RAZ]), Rx(t[L ? J.LAX : J.RAX]));
    add(capG(0.05, 0.22), REGION.top, mul(sh, T(0, -0.15, 0)));
    const el = mul(sh, T(0, -0.3, 0), Rx(t[L ? J.LEL : J.REL]));
    add(capG(0.045, 0.2), REGION.top, mul(el, T(0, -0.13, 0)));
    add(new THREE.SphereGeometry(0.05, 6, 5), REGION.skin, mul(el, T(0, -0.29, 0)));
    const th = mul(hips, T(sd * 0.09, 0, 0), Rx(t[L ? J.LTH : J.RTH]));
    add(capG(0.07, 0.26), REGION.bottom, mul(th, T(0, -0.215, 0)));
    const kn = mul(th, T(0, -0.43, 0), Rx(t[L ? J.LKN : J.RKN]));
    add(capG(0.06, 0.26), REGION.bottom, mul(kn, T(0, -0.215, 0)));
    add(new THREE.BoxGeometry(0.1, 0.07, 0.2), REGION.shoes, mul(kn, T(0, -0.41, 0.04)));
  }
  const g = mergeGeometries(parts, false)!;
  parts.forEach((p) => p.dispose());
  void HIP_Y;
  geoCache.set(pose, g);
  return g;
}

// ---------------------------------------------------------------- Meshy far body: the rigged ~3k-tri NPC body baked per pose (clip frame -> static geometry)
const meshyGeo = new Map<CharacterPose, THREE.BufferGeometry>();
let meshyRef = { top: 0.5, bottom: 0.3 };
const lin = (v: number) => Math.pow(v / 255, 2.2);
function buildPosedMeshy(pose: CharacterPose): THREE.BufferGeometry {
  const hit = meshyGeo.get(pose); if (hit) return hit;
  const body = readGltf(`${NPC_DIR}far.glb`), anim = readGltf(RIG_URL);
  const o = skeletonClone(body.scene) as THREE.Object3D;
  let sm: THREE.SkinnedMesh | null = null; o.traverse((c) => { if (!sm && (c as THREE.SkinnedMesh).isSkinnedMesh) sm = c as THREE.SkinnedMesh; });
  const m = sm as THREE.SkinnedMesh | null; if (!m) throw new Error('far body has no mesh');
  ensureRegions(m); meshyRef = sampleRef(m);
  m.geometry.computeBoundingBox(); const bb = m.geometry.boundingBox!; const k0 = 1.75 / Math.max(0.5, bb.max.y - bb.min.y);
  // base colours from the texture
  const g0 = m.geometry, uv = g0.getAttribute('uv'), reg = g0.getAttribute('aReg'), n = uv.count;
  const tex = (m.material as THREE.MeshStandardMaterial).map; const base = new Float32Array(n * 3).fill(0.5);
  try {
    const img = tex?.image as CanvasImageSource | undefined;
    if (img) {
      const w = 256, cv = document.createElement('canvas'); cv.width = w; cv.height = w; const cx = cv.getContext('2d', { willReadFrequently: true })!; cx.drawImage(img, 0, 0, w, w);
      const px = cx.getImageData(0, 0, w, w).data;
      for (let v = 0; v < n; v++) {
        const x = Math.min(w - 1, Math.max(0, Math.floor(uv.getX(v) * w))), y = Math.min(w - 1, Math.max(0, Math.floor((tex!.flipY ? 1 - uv.getY(v) : uv.getY(v)) * w))), i = (y * w + x) * 4;
        base[v * 3] = lin(px[i]); base[v * 3 + 1] = lin(px[i + 1]); base[v * 3 + 2] = lin(px[i + 2]);
      }
    }
  } catch { /* grey fallback */ }
  const mixer = new THREE.AnimationMixer(o);
  const clip = THREE.AnimationClip.findByName(anim.animations, CLIP[pose]) ?? THREE.AnimationClip.findByName(anim.animations, 'Idle_Loop');
  if (clip) { mixer.clipAction(clip).play(); mixer.setTime(clip.duration * 0.25); }
  o.updateMatrixWorld(true); m.skeleton.update();
  const pos = new Float32Array(n * 3), regionAttr = new Float32Array(n), t = new THREE.Vector3();
  for (let v = 0; v < n; v++) {
    m.getVertexPosition(v, t); t.applyMatrix4(m.matrixWorld).multiplyScalar(k0);
    pos[v * 3] = t.x; pos[v * 3 + 1] = t.y; pos[v * 3 + 2] = t.z;
    let r = 0; for (let q = 1; q < 4; q++) if (reg.getComponent(v, q) > reg.getComponent(v, r)) r = q;
    regionAttr[v] = r === 0 ? 0 : r === 1 ? 1 : r === 2 ? 2 : 4;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aRegion', new THREE.BufferAttribute(regionAttr, 1)); g.setAttribute('aBase', new THREE.BufferAttribute(base, 3));
  if (g0.index) g.setIndex(g0.index.clone());
  g.computeVertexNormals();
  mixer.stopAllAction(); mixer.uncacheRoot(o);
  meshyGeo.set(pose, g);
  return g;
}
let meshyMat: THREE.MeshStandardMaterial | null = null;
function getMeshyMat() {
  if (meshyMat) return meshyMat;
  meshyMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.85, metalness: 0 });
  meshyMat.customProgramCacheKey = () => 'city3d-far-meshy-v1';
  meshyMat.onBeforeCompile = (sh) => {
    sh.uniforms.uRefTop = { value: meshyRef.top }; sh.uniforms.uRefBottom = { value: meshyRef.bottom };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aRegion; attribute vec3 aBase; attribute vec3 iTop; attribute vec3 iBottom; varying vec3 vInst; varying vec3 vBase; varying float vRegF;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvInst = aRegion < 0.5 ? iTop : iBottom; vBase = aBase; vRegF = aRegion;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vInst; varying vec3 vBase; varying float vRegF; uniform float uRefTop; uniform float uRefBottom;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        float fL = dot(vBase, vec3(0.299, 0.587, 0.114));
        if (vRegF < 0.5) diffuseColor.rgb = vInst * clamp(fL / uRefTop, 0.25, 1.7);
        else if (vRegF < 1.5) diffuseColor.rgb = vInst * clamp(fL / uRefBottom, 0.25, 1.7);
        else diffuseColor.rgb = vBase;`);
  };
  return meshyMat;
}

let farMat: THREE.MeshStandardMaterial | null = null;
function getMat() {
  if (farMat) return farMat;
  farMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.8, metalness: 0.02 });
  farMat.customProgramCacheKey = () => 'city3d-far-lod-v1';
  farMat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aRegion; attribute vec3 iTop; attribute vec3 iBottom; attribute vec3 iSkin; attribute vec3 iHair; attribute vec3 iShoes; varying vec3 vInst;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvInst = aRegion < 0.5 ? iTop : aRegion < 1.5 ? iBottom : aRegion < 2.5 ? iSkin : aRegion < 3.5 ? iHair : iShoes;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vInst;')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= vInst;');
  };
  return farMat;
}

const NAMES = ['iTop', 'iBottom', 'iSkin', 'iHair', 'iShoes'];
interface Bucket { mesh: THREE.InstancedMesh; pose: CharacterPose; shadow: boolean; attrs: THREE.InstancedBufferAttribute[] }
function makeBucket(pose: CharacterPose, shadow: boolean, meshy: boolean): Bucket {
  const g = (meshy ? buildPosedMeshy(pose) : buildPosed(pose)).clone();
  const attrs = NAMES.map((n) => { const a = new THREE.InstancedBufferAttribute(new Float32Array(CAP * 3), 3); a.setUsage(THREE.DynamicDrawUsage); g.setAttribute(n, a); return a; });
  const mesh = new THREE.InstancedMesh(g, meshy ? getMeshyMat() : getMat(), CAP);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false; mesh.castShadow = shadow; mesh.count = 0;
  return { mesh, pose, shadow, attrs };
}

export const FarHost: React.FC<{ meshy?: boolean }> = ({ meshy = false }) => {
  const buckets = useMemo(() => {
    const m = new Map<string, Bucket>();
    for (const p of POSES) for (const s of [true, false]) m.set(`${p}${s ? 1 : 0}`, makeBucket(p, s, meshy && p !== 'walk' && p !== 'run')); // moving figures use the Quaternius body (auto-rigged Meshy deforms badly in walk cycles)
    return m;
  }, [meshy]);
  useEffect(() => () => { buckets.forEach((b) => { b.mesh.geometry.dispose(); b.mesh.dispose(); }); }, [buckets]);
  const camera = useThree((s) => s.camera);
  useFrame((state) => {
    rigTick(camera, state.gl.info.render.frame, performance.now());
    const counts = new Map<Bucket, number>();
    for (const e of farEntries) {
      if (!e.active) continue;
      const b = buckets.get(`${e.pose}${e.dist < SHADOW_DIST ? 1 : 0}`)!;
      const i = counts.get(b) ?? 0;
      if (i >= CAP) continue;
      const m = e.m;
      if (!inView(m[12], m[13] + 0.9 * e.k, m[14])) continue; // off-screen: skip entirely
      const arr = b.mesh.instanceMatrix.array as Float32Array, o = i * 16, k = e.k;
      arr[o] = m[0] * k; arr[o + 1] = m[1] * k; arr[o + 2] = m[2] * k; arr[o + 3] = 0;
      arr[o + 4] = m[4] * k; arr[o + 5] = m[5] * k; arr[o + 6] = m[6] * k; arr[o + 7] = 0;
      arr[o + 8] = m[8] * k; arr[o + 9] = m[9] * k; arr[o + 10] = m[10] * k; arr[o + 11] = 0;
      arr[o + 12] = m[12]; arr[o + 13] = m[13]; arr[o + 14] = m[14]; arr[o + 15] = 1;
      for (let c = 0; c < 5; c++) { const a = b.attrs[c].array as Float32Array; a[i * 3] = e.cols[c * 3]; a[i * 3 + 1] = e.cols[c * 3 + 1]; a[i * 3 + 2] = e.cols[c * 3 + 2]; }
      counts.set(b, i + 1);
    }
    buckets.forEach((b) => {
      const n = counts.get(b) ?? 0;
      b.mesh.count = n;
      if (n || b.mesh.userData.had) {
        b.mesh.instanceMatrix.needsUpdate = true; b.attrs.forEach((a) => { a.needsUpdate = true; });
      }
      b.mesh.userData.had = n > 0;
      b.mesh.visible = n > 0;
    });
  });
  return <>{[...buckets.values()].map((b) => <primitive key={`${b.pose}${b.shadow}`} object={b.mesh} />)}</>;
};


/** Meshy-bodied far LOD with the procedural capsule host as fallback while loading / if the asset is missing. */
export const FarHostAuto: React.FC = () => (
  <RigBoundary fallback={<FarHost />}>
    <React.Suspense fallback={<FarHost />}><FarHost meshy /></React.Suspense>
  </RigBoundary>
);
