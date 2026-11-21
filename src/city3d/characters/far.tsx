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
import { inView, rigTick } from './rigged';

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
  [a.top, a.bottom, a.skin, a.hairStyle === 'bald' ? a.skin : a.hair, a.shoes].forEach((col, i) => { c.set(col); out[i * 3] = c.r; out[i * 3 + 1] = c.g; out[i * 3 + 2] = c.b; });
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
function makeBucket(pose: CharacterPose, shadow: boolean): Bucket {
  const g = buildPosed(pose).clone();
  const attrs = NAMES.map((n) => { const a = new THREE.InstancedBufferAttribute(new Float32Array(CAP * 3), 3); a.setUsage(THREE.DynamicDrawUsage); g.setAttribute(n, a); return a; });
  const mesh = new THREE.InstancedMesh(g, getMat(), CAP);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false; mesh.castShadow = shadow; mesh.count = 0;
  return { mesh, pose, shadow, attrs };
}

export const FarHost: React.FC = () => {
  const buckets = useMemo(() => {
    const m = new Map<string, Bucket>();
    for (const p of POSES) for (const s of [true, false]) m.set(`${p}${s ? 1 : 0}`, makeBucket(p, s));
    return m;
  }, []);
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

