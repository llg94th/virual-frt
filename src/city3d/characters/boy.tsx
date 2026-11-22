/**
 * The one human model of the project: public/models/mixamo/boy.glb (Meshy boy rigged on Mixamo, 65 bones, 16 native clips).
 * Its own clips are used directly (no retargeting). The model is 1.2 m tall; it is scaled to the requested height.
 * Seated clips were authored for hips ~0.30 m on a 1.2 m body: the hips are re-pinned onto the real chair / sofa / car seat
 * from the first-frame hip position of the clip.
 */
import React, { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import { clone as skeletonClone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { CharacterAppearance, CharacterPose } from '../shared';
import { inView } from './rigged';

export const BOY_URL = `${(import.meta as any).env?.BASE_URL ?? '/'}models/mixamo/boy.glb`;
export const BODY_H = 1.7;

export const POSE_CLIP: Record<CharacterPose, string> = {
  idle: 'Idle', walk: 'Walk', run: 'Walk', sit: 'SitIdle', type: 'Typing', wave: 'Waving', drive: 'SitIdle',
};
/** legacy Quaternius clip names used by the figure behaviours -> boy clips */
export const LEGACY_CLIP: Record<string, string> = {
  Idle_Loop: 'Idle', Walk_Loop: 'Walk', Jog_Fwd_Loop: 'Walk', Interact: 'Greeting', Mx_Greeting: 'Greeting', Mx_Waving: 'Waving',
  Mx_Drinking: 'Talking', Mx_Clapping: 'Waving', Sitting_Idle_Loop: 'SitIdle', Sitting_Talking_Loop: 'Talking', Driving_Loop: 'SitIdle',
};
export const SEATED = new Set(['SitIdle', 'Typing', 'SitDesk', 'Meeting', 'SitToType', 'TypeToSit']);
/** hip joint target (metres above the floor, towards the desk) for each kind of seat */
export const SEAT_AT = { office: { y: 0.58, z: 0.06 }, sofa: { y: 0.47, z: 0.0 }, car: { y: 0.5, z: 0.0 } };
export type SeatKind = keyof typeof SEAT_AT;

export interface BoyRig {
  wrap: THREE.Group; mixer: THREE.AnimationMixer; k: number; base: number;
  clips: Map<string, THREE.AnimationClip>; hips: Map<string, THREE.Vector3>;
}

/** Cloned, scaled boy + its mixer. Suspends while the GLB loads. */
export function useBoy(height: number, shadow: boolean): BoyRig {
  const gltf = useGLTF(BOY_URL, false, false) as unknown as { scene: THREE.Object3D; animations: THREE.AnimationClip[] };
  return useMemo(() => {
    const o = skeletonClone(gltf.scene) as THREE.Object3D;
    const bb = new THREE.Box3();
    o.traverse((c) => {
      const m = c as THREE.SkinnedMesh; if (!m.isSkinnedMesh) return;
      m.frustumCulled = false; m.castShadow = shadow; m.receiveShadow = true;
      const mat = (m.material as THREE.MeshStandardMaterial).clone();
      mat.envMapIntensity = 0.7; mat.metalness = 0; mat.roughness = Math.max(0.75, mat.roughness); m.material = mat;
      m.geometry.computeBoundingBox(); bb.union(m.geometry.boundingBox!);
    });
    const h = Math.max(0.3, bb.max.y - bb.min.y);
    const k = height / h;
    const wrap = new THREE.Group(); wrap.scale.setScalar(k); o.position.y = -bb.min.y; wrap.add(o);
    const clips = new Map<string, THREE.AnimationClip>(); const hips = new Map<string, THREE.Vector3>();
    for (const c of gltf.animations) {
      clips.set(c.name, c);
      const t = c.tracks.find((tr) => /Hips\.position$/.test(tr.name));
      if (t) hips.set(c.name, new THREE.Vector3(t.values[0], t.values[1], t.values[2]));
    }
    return { wrap, mixer: new THREE.AnimationMixer(o), k, base: -bb.min.y, clips, hips };
  }, [gltf, height, shadow]);
}
useGLTF.preload(BOY_URL);

/** where the character group must sit so the hips of `clip` land on the seat (character-local, unscaled metres) */
export function seatOffset(rig: BoyRig, clip: string, kind: SeatKind, out: THREE.Vector3): THREE.Vector3 {
  const hp = rig.hips.get(clip); if (!hp || !SEATED.has(clip)) return out.set(0, 0, 0);
  const t = SEAT_AT[kind];
  return out.set(-hp.x * rig.k, t.y - (hp.y + rig.base) * rig.k, t.z - hp.z * rig.k);
}

export function fadeTo(rig: BoyRig, cur: React.MutableRefObject<THREE.AnimationAction | null>, name: string, once = false, rate = 1, fade = 0.3) {
  const clip = rig.clips.get(name) ?? rig.clips.get('Idle'); if (!clip) return;
  const next = rig.mixer.clipAction(clip);
  next.timeScale = rate;
  if (next === cur.current) return;
  next.reset().setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, once ? 1 : Infinity); next.clampWhenFinished = once;
  next.play();
  if (cur.current) cur.current.crossFadeTo(next, fade, false); else next.fadeIn(fade);
  cur.current = next;
}

interface Props { appearance: CharacterAppearance; pose: CharacterPose; height: number; castShadow: boolean; onReady?: () => void; speed?: number; office?: boolean }

export const BoyCharacter: React.FC<Props> = ({ pose, height, castShadow, onReady, speed, office }) => {
  const rig = useBoy(height, castShadow);
  const cur = useRef<THREE.AnimationAction | null>(null);
  const holder = useRef<THREE.Group>(null);
  const goal = useMemo(() => new THREE.Vector3(), []);
  const tmp = useMemo(() => new THREE.Vector3(), []);
  const first = useRef(true);
  useEffect(() => { onReady?.(); return () => { rig.mixer.stopAllAction(); rig.mixer.uncacheRoot(rig.wrap.children[0]); cur.current = null; }; }, [rig]); // eslint-disable-line react-hooks/exhaustive-deps
  useFrame((state, dtRaw) => {
    const g = holder.current; if (!g) return;
    const dt = Math.min(dtRaw, 0.1);
    const clip = POSE_CLIP[pose] ?? 'Idle';
    const kind: SeatKind = pose === 'drive' ? 'car' : office ? 'office' : 'sofa';
    const rate = pose === 'run' ? Math.min(3, Math.max(1.6, (speed ?? 5) / 1.15)) : pose === 'walk' ? Math.min(2.2, Math.max(0.7, (speed ?? 1.4) / 1.15)) : 1;
    fadeTo(rig, cur, clip, false, rate, first.current ? 0 : 0.3);
    seatOffset(rig, clip, kind, goal);
    if (first.current) { g.position.copy(goal); first.current = false; } else g.position.lerp(goal, 1 - Math.exp(-dt * 8));
    g.getWorldPosition(tmp);
    if (!inView(tmp.x, tmp.y + 0.9, tmp.z)) return; // freeze when off-screen
    rig.mixer.update(dt);
  });
  return <group ref={holder}><primitive object={rig.wrap} /></group>;
};
