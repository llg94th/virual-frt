/**
 * Rigged (Quaternius UAL1 mannequin) character path. Used by Character3D for nearby characters and always for the Player.
 * Falls back silently to the procedural character when the asset is missing or fails.
 */
import React, { useEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import { clone as skeletonClone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { CharacterAppearance, CharacterPose } from '../shared';

export const RIG_URL = '/models/quaternius/UAL1_Standard.glb';
export const RIG_RADIUS = 35; // metres: rigged only inside this distance
export const RIG_RADIUS_OUT = 42; // hysteresis
export const RIG_MAX = 24;
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
      try { useGLTF.preload(RIG_URL); } catch { /* ignore */ }
      setStatus('ready');
    })
    .catch(() => setStatus('failed'));
}
export const failRigAsset = () => { if (status !== 'failed') setStatus('failed'); };
export const useRigStatus = (): Status =>
  useSyncExternalStore((l) => { subs.add(l); return () => { subs.delete(l); }; }, () => status);

export class RigBoundary extends React.Component<{ children: React.ReactNode; onError?: () => void }, { bad: boolean }> {
  state = { bad: false };
  static getDerivedStateFromError() { return { bad: true }; }
  componentDidCatch() { failRigAsset(); this.props.onError?.(); }
  render() { return this.state.bad ? null : this.props.children; }
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
const REGION_KEY = 'city3d-mannequin-regions-v1';
function regionMaterial(src: THREE.Material, a: CharacterAppearance) {
  const m = (src as THREE.MeshStandardMaterial).clone() as THREE.MeshStandardMaterial;
  m.map = null; m.color.set('#ffffff'); m.roughness = 0.8; m.metalness = 0.02;
  const u = {
    uSkin: { value: new THREE.Color(a.skin) }, uTop: { value: new THREE.Color(a.top) },
    uBottom: { value: new THREE.Color(a.bottom) }, uShoes: { value: new THREE.Color(a.shoes) },
  };
  m.userData.regions = u;
  m.customProgramCacheKey = () => REGION_KEY;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRegion;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRegion = position;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRegion;\nuniform vec3 uSkin; uniform vec3 uTop; uniform vec3 uBottom; uniform vec3 uShoes;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          float y = vRegion.y, ax = abs(vRegion.x);
          vec3 c = uTop;
          if (y > 1.56) c = uSkin;                       // head + neck
          else if (ax > 0.74 && y > 1.2) c = uSkin;      // hands
          else if (y < 0.93 && ax < 0.74) c = uBottom;   // legs
          if (y < 0.085) c = uShoes;                     // feet
          diffuseColor.rgb = c;
        }`);
  };
  return m;
}

// ---------------------------------------------------------------- RiggedCharacter
export const RiggedCharacter: React.FC<{ appearance: CharacterAppearance; pose: CharacterPose; height: number; castShadow: boolean; onReady?: () => void; speed?: number }> = ({ appearance, pose, height, castShadow, onReady, speed }) => {
  const gltf = useGLTF(RIG_URL) as unknown as { scene: THREE.Object3D; animations: THREE.AnimationClip[] };
  const group = useRef<THREE.Group>(null);
  const { obj, scale, mats } = useMemo(() => {
    const o = skeletonClone(gltf.scene) as THREE.Object3D;
    const mats: THREE.MeshStandardMaterial[] = [];
    o.traverse((c) => {
      const m = c as THREE.SkinnedMesh;
      if (m.isMesh) {
        const mm = regionMaterial(m.material as THREE.Material, appearance); mats.push(mm);
        m.material = mm; m.frustumCulled = false; m.castShadow = castShadow; m.receiveShadow = false;
      }
    });
    const bb = new THREE.Box3().setFromObject(o);
    const h = Math.max(0.5, bb.max.y - Math.max(0, bb.min.y));
    return { obj: o, scale: height / h, mats };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gltf, height, castShadow]);

  // live-update colours without rebuilding
  useLayoutEffect(() => {
    for (const m of mats) {
      const u = m.userData.regions;
      u.uSkin.value.set(appearance.skin); u.uTop.value.set(appearance.top);
      u.uBottom.value.set(appearance.bottom); u.uShoes.value.set(appearance.shoes);
    }
  }, [mats, appearance.skin, appearance.top, appearance.bottom, appearance.shoes]);

  const mixer = useMemo(() => new THREE.AnimationMixer(obj), [obj]);
  const cur = useRef<THREE.AnimationAction | null>(null);
  const first = useRef(true);
  useEffect(() => () => { mixer.stopAllAction(); mixer.uncacheRoot(obj); }, [mixer, obj]);

  useEffect(() => {
    const clip = THREE.AnimationClip.findByName(gltf.animations, CLIP[pose]) ?? THREE.AnimationClip.findByName(gltf.animations, 'Idle_Loop');
    if (!clip) return;
    const next = mixer.clipAction(clip);
    if (next === cur.current) return;
    next.reset().setLoop(THREE.LoopRepeat, Infinity);
    if (first.current) { next.play(); mixer.update(Math.random() * clip.duration); first.current = false; }
    else { next.play(); if (cur.current) cur.current.crossFadeTo(next, FADE, false); else next.fadeIn(FADE); }
    cur.current = next;
  }, [pose, mixer, gltf]);

  useEffect(() => { onReady?.(); }, [onReady]);

  const vis = useRef(true);
  useFrame((state, dt) => {
    const g = group.current; if (!g) return;
    g.updateWorldMatrix(true, false);
    const e = g.matrixWorld.elements;
    vis.current = inView(e[12], e[13] + 0.9, e[14]);
    if (!vis.current) return; // freeze when off-screen
    const rate = speed && pose === 'walk' ? Math.max(0.7, Math.min(1.6, speed / 1.4)) : 1;
    mixer.update(Math.min(dt, 0.1) * rate);
  });

  return (
    <group ref={group} scale={scale}>
      <primitive object={obj} />
    </group>
  );
};
