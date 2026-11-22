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
const SEAT_DROP = 0.42;
const hash = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
export const rpmKindFor = (a: CharacterAppearance): RpmKind => {
  const seed = hash(`${a.skin}${a.hair}${a.top}${a.bottom}${a.hairStyle}`);
  const female = a.hairStyle === 'long' || a.hairStyle === 'bun' ? true : (seed & 1) === 1;
  return female ? 'rpm_f' : 'rpm_m';
};
const firstSkinned = (o: THREE.Object3D) => { let r: THREE.SkinnedMesh | null = null; o.traverse((c) => { if (!r && (c as THREE.SkinnedMesh).isSkinnedMesh) r = c as THREE.SkinnedMesh; }); return r; };
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
      const mm = (m.material as THREE.MeshStandardMaterial).clone(); mm.envMapIntensity = 0.5; mm.metalness = 0; mm.roughness = Math.max(mm.roughness, 0.8); m.material = mm;
      if (n.includes('outfit_top')) { mm.map = null; mats.top.push(mm); }
      else if (n.includes('outfit_bottom')) { mm.map = null; mats.bottom.push(mm); }
    });
    const bb = new THREE.Box3().setFromObject(o);
    return { obj: o, scale: height / Math.max(0.5, bb.max.y - bb.min.y), mats, skinned: firstSkinned(o)! };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [body, height, castShadow]);
  useLayoutEffect(() => {
    const t = new THREE.Color(top); mats.top.forEach((m) => m.color.copy(t));
    const b = new THREE.Color(appearance.bottom); mats.bottom.forEach((m) => m.color.copy(b));
  }, [mats, top, appearance.bottom]);

  // useFirstFramePosition drops the seated hip drop, so lower the whole body for seated poses (metres)
  const drop = pose === 'sit' || pose === 'type' ? SEAT_DROP : pose === 'drive' ? SEAT_DROP : 0;
  useLayoutEffect(() => { obj.position.y = -drop / scale; }, [obj, drop, scale]);
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
