/**
 * NPC bodies from the public hmthanh/3d-human-model repo (Ready Player Me style avatars, Mixamo-named skeleton).
 * Quaternius UAL clips are retargeted onto the Mixamo skeleton once per body, clothes are tinted per material.
 */
import React, { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { clone as skeletonClone, retargetClip } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { CharacterAppearance, CharacterPose } from '../shared';
import { safeTop } from './color';
import { CLIP, RIG_URL, readGltf, inView } from './rigged';

const DIR = `${(import.meta as any).env?.BASE_URL ?? '/'}models/meshy/npc/`;
export type RpmKind = 'rpm_m' | 'rpm_f';
export const rpmUrls = [`${DIR}rpm_m.glb`, `${DIR}rpm_f.glb`];
const MIXAMO_TO_UE: Record<string, string> = {
  Hips: 'pelvis', Spine: 'spine_01', Spine1: 'spine_02', Spine2: 'spine_03', Neck: 'neck_01', Head: 'Head',
  LeftShoulder: 'clavicle_l', LeftArm: 'upperarm_l', LeftForeArm: 'lowerarm_l', LeftHand: 'hand_l',
  RightShoulder: 'clavicle_r', RightArm: 'upperarm_r', RightForeArm: 'lowerarm_r', RightHand: 'hand_r',
  LeftUpLeg: 'thigh_l', LeftLeg: 'calf_l', LeftFoot: 'foot_l', LeftToeBase: 'ball_l',
  RightUpLeg: 'thigh_r', RightLeg: 'calf_r', RightFoot: 'foot_r', RightToeBase: 'ball_r',
};
const SEAT_DROP = 0.42, SEAT_BACK = 0.14;
const hash = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
export const rpmKindFor = (a: CharacterAppearance): RpmKind => {
  const seed = hash(`${a.skin}${a.hair}${a.top}${a.bottom}${a.hairStyle}`);
  const female = a.hairStyle === 'long' || a.hairStyle === 'bun' ? true : (seed & 1) === 1;
  return female ? 'rpm_f' : 'rpm_m';
};
const firstSkinned = (o: THREE.Object3D) => { let r: THREE.SkinnedMesh | null = null; o.traverse((c) => { if (!r && (c as THREE.SkinnedMesh).isSkinnedMesh) r = c as THREE.SkinnedMesh; }); return r; };

const lum = (c: string) => { const k = new THREE.Color(c); return 0.2126 * k.r + 0.7152 * k.g + 0.0722 * k.b; };
const refCache = new WeakMap<THREE.Texture, number>();
/** mean luminance of a texture (sampled on a 24x24 canvas) so the tint keeps the fabric's own shading */
function meanLum(t: THREE.Texture | null): number {
  if (!t || !t.image) return 0.4;
  const hit = refCache.get(t); if (hit) return hit;
  let v = 0.4;
  try {
    const c = document.createElement('canvas'); c.width = c.height = 24; const g = c.getContext('2d')!;
    g.drawImage(t.image as CanvasImageSource, 0, 0, 24, 24); const d = g.getImageData(0, 0, 24, 24).data; let s = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 200) { s += (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255; n++; }
    if (n) v = Math.max(0.05, s / n);
  } catch { /* keep default */ }
  v = Math.pow(v, 2.2); refCache.set(t, v); return v;
}
function tintable(m: THREE.MeshStandardMaterial) {
  const tint = { value: new THREE.Color('#ffffff') }, ref = { value: meanLum(m.map) };
  m.userData.tint = tint; m.customProgramCacheKey = () => 'city3d-rpm-tint-v1';
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTint = tint; sh.uniforms.uRef = ref;
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform vec3 uTint; uniform float uRef;')
      .replace('#include <map_fragment>', '#include <map_fragment>\n#ifdef USE_MAP\n diffuseColor.rgb = uTint * clamp(dot(diffuseColor.rgb, vec3(0.2126,0.7152,0.0722)) / uRef, 0.3, 1.8);\n#endif');
  };
  return m;
}
const clipCache = new Map<string, THREE.AnimationClip>();
function clipFor(kind: RpmKind, mesh: THREE.SkinnedMesh, ual: { scene: THREE.Object3D; animations: THREE.AnimationClip[] }, name: string) {
  const k = `${kind}|${name}`; let c = clipCache.get(k);
  if (!c) {
    const src = ual.animations.find((a) => a.name === name) ?? ual.animations.find((a) => a.name === 'Idle_Loop'), sm = firstSkinned(ual.scene);
    if (!src || !sm) return undefined;
    c = retargetClip(mesh, sm, src, { names: MIXAMO_TO_UE, hip: 'Hips', preserveBoneMatrix: true, useFirstFramePosition: true });
    clipCache.set(k, c);
  }
  return c;
}

interface Props { appearance: CharacterAppearance; pose: CharacterPose; height: number; castShadow: boolean; onReady?: () => void; speed?: number; kind: RpmKind }
export const RpmCharacter: React.FC<Props> = ({ appearance, pose, height, castShadow, onReady, speed, kind }) => {
  const body = readGltf(`${DIR}${kind}.glb`);
  const ual = readGltf(RIG_URL);
  const top = useMemo(() => safeTop(appearance.top, appearance.skin), [appearance.top, appearance.skin]);
  const { obj, scale, mats, skinned } = useMemo(() => {
    const o = skeletonClone(body.scene) as THREE.Object3D;
    const mats: { top: THREE.MeshStandardMaterial[]; bottom: THREE.MeshStandardMaterial[] } = { top: [], bottom: [] };
    o.traverse((c) => {
      const m = c as THREE.SkinnedMesh; if (!m.isSkinnedMesh) return;
      const n = m.name.toLowerCase();
      m.frustumCulled = false; m.castShadow = castShadow && !n.includes('teeth') && !n.includes('eye'); m.receiveShadow = false;
      if (n.includes('glasses')) { m.visible = false; return; }
      const mm = (m.material as THREE.MeshStandardMaterial).clone(); mm.envMapIntensity = 0.9; mm.metalness = 0; mm.roughness = Math.max(Math.min(mm.roughness, 0.9), 0.6); m.material = mm;
      if (n.includes('outfit_top')) mats.top.push(tintable(mm));
      else if (n.includes('outfit_bottom')) mats.bottom.push(tintable(mm));
    });
    const bb = new THREE.Box3().setFromObject(o);
    return { obj: o, scale: height / Math.max(0.5, bb.max.y - bb.min.y), mats, skinned: firstSkinned(o)! };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [body, height, castShadow]);
  useLayoutEffect(() => {
    const t = new THREE.Color(top); if (lum(top) > 0.12) t.lerp(new THREE.Color('#ffffff'), 0.2); mats.top.forEach((m) => m.userData.tint.value.copy(t));
    const b = new THREE.Color(appearance.bottom); mats.bottom.forEach((m) => m.userData.tint.value.copy(b));
  }, [mats, top, appearance.bottom]);

  // useFirstFramePosition drops the seated hip drop, so lower the whole body for seated poses (metres)
  const drop = pose === 'sit' || pose === 'type' ? SEAT_DROP : pose === 'drive' ? SEAT_DROP : 0;
  useLayoutEffect(() => { obj.position.y = -drop / scale; obj.position.z = drop ? -SEAT_BACK / scale : 0; }, [obj, drop, scale]);
  const group = useRef<THREE.Group>(null);
  const mixer = useMemo(() => new THREE.AnimationMixer(obj), [obj]);
  const cur = useRef<THREE.AnimationAction | null>(null), first = useRef(true);
  useEffect(() => () => { mixer.stopAllAction(); mixer.uncacheRoot(obj); }, [mixer, obj]);
  useEffect(() => {
    const clip = clipFor(kind, skinned, ual, CLIP[pose]); if (!clip) return;
    const next = mixer.clipAction(clip, skinned);
    if (next === cur.current) return;
    next.reset().setLoop(THREE.LoopRepeat, Infinity);
    if (first.current) { next.play(); mixer.update(Math.random() * clip.duration); first.current = false; }
    else { next.play(); if (cur.current) cur.current.crossFadeTo(next, 0.25, false); else next.fadeIn(0.25); }
    cur.current = next;
  }, [pose, mixer, kind, skinned, ual]);
  useEffect(() => { onReady?.(); }, [onReady]);
  useFrame((_, dt) => {
    const g = group.current; if (!g) return;
    g.updateWorldMatrix(true, false); const e = g.matrixWorld.elements;
    if (!inView(e[12], e[13] + 0.9, e[14])) return;
    const rate = speed && pose === 'walk' ? Math.max(0.7, Math.min(1.6, speed / 1.4)) : 1;
    mixer.update(Math.min(dt, 0.1) * rate);
  });
  return <group ref={group} scale={scale}><primitive object={obj} /></group>;
};
