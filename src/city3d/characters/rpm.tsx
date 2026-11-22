/**
 * NPC bodies from the public hmthanh/3d-human-model repo (Ready Player Me style avatars, Mixamo-named skeleton).
 * - Quaternius UAL clips are retargeted onto the Mixamo skeleton once per body (hip height scaled by leg length, root motion removed,
 *   seated clips pinned to the chair seat height, standing clips grounded from sampled foot heights).
 * - Seated 'type' pose: analytic two-bone arm IK puts the hands on the keyboard (clip hands are only gesturing).
 * - Materials: skin tinted per appearance (texture-mean normalised so seams between head/body match), hair + clothes + shoes tinted with a
 *   luminance-preserving shader (fabric detail kept), normal/roughness maps kept, glossy eyes, optional procedural glasses.
 */
import React, { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
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
/** Seated placement in character-local metres (origin = chair centre on the floor, +z = towards the desk). */
export const SEAT = { hipY: 0.575, hipZ: 0.03 };
/** Keyboard centre (character-local) for the 'type' IK, and hand spread. */
const KEYS = { y: 0.8, z: 0.45, dx: 0.15 };

const hash = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
export const rpmKindFor = (a: CharacterAppearance): RpmKind => {
  const seed = hash(`${a.skin}${a.hair}${a.top}${a.bottom}${a.hairStyle}`);
  const female = a.hairStyle === 'long' || a.hairStyle === 'bun' ? true : (seed & 1) === 1;
  return female ? 'rpm_f' : 'rpm_m';
};
const firstSkinned = (o: THREE.Object3D): THREE.SkinnedMesh | null => { let r: THREE.SkinnedMesh | null = null; o.traverse((c) => { if (!r && (c as THREE.SkinnedMesh).isSkinnedMesh) r = c as THREE.SkinnedMesh; }); return r as THREE.SkinnedMesh | null; };
const bone = (o: THREE.Object3D, n: string) => o.getObjectByName(n) as THREE.Bone | undefined;

// ---------------------------------------------------------------- GLTF loading (keeps normal / roughness maps, unlike the shared loader)
const loader = new GLTFLoader();
const gcache = new Map<string, { p: Promise<THREE.Group>; v?: THREE.Group; e?: unknown }>();
function readRpm(url: string): THREE.Group {
  let c = gcache.get(url);
  if (!c) {
    const p = loader.loadAsync(url).then((g) => { c!.v = g.scene; return g.scene; }, (e) => { c!.e = e ?? new Error('load failed'); throw c!.e; });
    p.catch(() => undefined); c = { p }; gcache.set(url, c);
  }
  if (c.e) throw c.e;
  if (c.v) return c.v;
  throw c.p;
}

// ---------------------------------------------------------------- texture statistics + tint shader
const lum = (c: string) => { const k = new THREE.Color(c); return 0.2126 * k.r + 0.7152 * k.g + 0.0722 * k.b; };
const statCache = new WeakMap<THREE.Texture, { r: number; g: number; b: number; l: number }>();
/** mean linear colour of a texture (opaque texels, 32x32 sample) */
function texStats(t: THREE.Texture | null) {
  const dflt = { r: 0.4, g: 0.4, b: 0.4, l: 0.4 };
  if (!t || !t.image) return dflt;
  const hit = statCache.get(t); if (hit) return hit;
  let v = dflt;
  try {
    const c = document.createElement('canvas'); c.width = c.height = 32; const g = c.getContext('2d', { willReadFrequently: true })!;
    g.drawImage(t.image as CanvasImageSource, 0, 0, 32, 32); const d = g.getImageData(0, 0, 32, 32).data; let r = 0, gg = 0, b = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 200) { r += Math.pow(d[i] / 255, 2.2); gg += Math.pow(d[i + 1] / 255, 2.2); b += Math.pow(d[i + 2] / 255, 2.2); n++; }
    if (n) v = { r: Math.max(0.02, r / n), g: Math.max(0.02, gg / n), b: Math.max(0.02, b / n), l: Math.max(0.03, 0.2126 * r / n + 0.7152 * gg / n + 0.0722 * b / n) };
  } catch { /* keep default */ }
  statCache.set(t, v); return v;
}
function tintable(m: THREE.MeshStandardMaterial) {
  const tint = { value: new THREE.Color('#ffffff') }, ref = { value: texStats(m.map).l };
  m.userData.tint = tint; m.customProgramCacheKey = () => 'city3d-rpm-tint-v1';
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTint = tint; sh.uniforms.uRef = ref;
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform vec3 uTint; uniform float uRef;')
      .replace('#include <map_fragment>', '#include <map_fragment>\n#ifdef USE_MAP\n diffuseColor.rgb = uTint * clamp(dot(diffuseColor.rgb, vec3(0.2126,0.7152,0.0722)) / uRef, 0.3, 1.8);\n#endif');
  };
  return m;
}
/** Realistic skin range: keeps hue, pulls extreme lightness / saturation back into human values. */
const hsl = { h: 0, s: 0, l: 0 };
export function realisticSkin(hex: string): THREE.Color {
  const c = new THREE.Color(hex); c.getHSL(hsl);
  hsl.l = Math.min(0.78, Math.max(0.2, hsl.l)); hsl.s = Math.min(0.55, Math.max(0.2, hsl.s));
  if (hsl.h > 0.12 || hsl.h < 0.0) hsl.h = Math.min(0.1, Math.max(0.02, hsl.h > 0.5 ? 0.04 : hsl.h)); // skin hues live between red-orange and yellow-orange
  return new THREE.Color().setHSL(hsl.h, hsl.s, hsl.l);
}

// ---------------------------------------------------------------- clips
interface Prepared { clip: THREE.AnimationClip }
const clipCache = new Map<string, Prepared>();
const SEATED = new Set<string>(['sit', 'type', 'drive']);
let srcRestY: number | null = null;
function sourceHipY(sm: THREE.SkinnedMesh) {
  if (srcRestY === null) { sm.skeleton.pose(); sm.skeleton.bones[0].updateWorldMatrix(true, true); const p = sm.skeleton.bones.find((b) => b.name === 'pelvis'); srcRestY = p ? new THREE.Vector3().setFromMatrixPosition(p.matrixWorld).y : 1; }
  return srcRestY || 1;
}
function clipFor(kind: RpmKind, obj: THREE.Object3D, mesh: THREE.SkinnedMesh, ual: { scene: THREE.Object3D; animations: THREE.AnimationClip[] }, pose: CharacterPose): THREE.AnimationClip | undefined {
  const name = CLIP[pose], k = `${kind}|${name}`; let c = clipCache.get(k);
  if (c) return c.clip;
  const src = ual.animations.find((a) => a.name === name) ?? ual.animations.find((a) => a.name === 'Idle_Loop'), sm = firstSkinned(ual.scene);
  if (!src || !sm) return undefined;
  const hipsB = bone(obj, 'Hips'); if (!hipsB) return undefined;
  const sy = sourceHipY(sm);
  mesh.skeleton.pose(); obj.updateMatrixWorld(true);
  const ty = new THREE.Vector3().setFromMatrixPosition(hipsB.matrixWorld).y;
  // the two rigs have different bind poses (leg spread, arm angle): retarget world-rotation *deltas* (Wt = Ws * Ws_rest^-1 * Wt_rest)
  sm.skeleton.pose(); ual.scene.updateMatrixWorld(true);
  const localOffsets: Record<string, THREE.Matrix4> = {}, qs = new THREE.Quaternion(), qt = new THREE.Quaternion();
  for (const [tn, sn] of Object.entries(MIXAMO_TO_UE)) {
    const tb = bone(obj, tn), sb = sm.skeleton.getBoneByName(sn); if (!tb || !sb) continue;
    sb.getWorldQuaternion(qs); tb.getWorldQuaternion(qt);
    // target frame re-aimed so its limb axis matches the source's rest limb axis (UAL rests in a T-pose, RPM in an A-pose), keeping its own twist
    const ys = new THREE.Vector3(0, 1, 0).applyQuaternion(qs), yt = new THREE.Vector3(0, 1, 0).applyQuaternion(qt);
    const adj = new THREE.Quaternion().setFromUnitVectors(yt, ys).multiply(qt);
    localOffsets[tn] = new THREE.Matrix4().makeRotationFromQuaternion(qs.clone().invert().multiply(adj));
  }
  const clip = retargetClip(mesh, sm, src, { names: MIXAMO_TO_UE, hip: 'pelvis', scale: ty / sy, preserveBoneMatrix: true, useFirstFramePosition: false, localOffsets } as any);
  const tr = clip.tracks.find((t) => t.name === '.bones[Hips].position');
  if (tr) {
    const v = tr.values, n = v.length / 3; let mx = 0, my = 0, mz = 0;
    for (let i = 0; i < n; i++) { mx += v[i * 3]; my += v[i * 3 + 1]; mz += v[i * 3 + 2]; }
    mx /= n; my /= n; mz /= n;
    let dy = 0, dz = 0;
    if (SEATED.has(pose)) { dy = SEAT.hipY / OBJ_SCALE.get(obj)! - my; dz = SEAT.hipZ / OBJ_SCALE.get(obj)!; }
    else {
      // ground the clip: sample the lowest ankle over the cycle and shift the hips so it sits at the rest ankle height
      mesh.skeleton.pose(); obj.updateMatrixWorld(true);
      const la = bone(obj, 'LeftFoot')!, ra = bone(obj, 'RightFoot')!, rest = Math.min(new THREE.Vector3().setFromMatrixPosition(la.matrixWorld).y, new THREE.Vector3().setFromMatrixPosition(ra.matrixWorld).y);
      for (let i = 0; i < n; i++) { v[i * 3] -= mx; v[i * 3 + 2] -= mz; }
      const mixer = new THREE.AnimationMixer(obj), act = mixer.clipAction(clip, mesh).play();
      let low = 1e9; const N = 16, tmp = new THREE.Vector3();
      for (let i = 0; i < N; i++) {
        act.time = (clip.duration * i) / N; act.paused = true; mixer.update(0); obj.updateMatrixWorld(true);
        low = Math.min(low, tmp.setFromMatrixPosition(la.matrixWorld).y, tmp.setFromMatrixPosition(ra.matrixWorld).y);
      }
      mixer.stopAllAction(); mixer.uncacheRoot(obj); mesh.skeleton.pose();
      dy = rest - low; mx = 0; mz = 0; // x/z already centred
    }
    for (let i = 0; i < n; i++) { v[i * 3] -= mx; v[i * 3 + 1] += dy; v[i * 3 + 2] -= mz; v[i * 3 + 2] += dz; }
  }
  c = { clip }; clipCache.set(k, c); return clip;
}
const OBJ_SCALE = new WeakMap<THREE.Object3D, number>();

// ---------------------------------------------------------------- two-bone arm IK (keyboard)
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _pq = new THREE.Quaternion();
function aim(b: THREE.Bone, child: THREE.Object3D, to: THREE.Vector3, w: number) {
  // rotate bone `b` (world) so that the direction b->child points at `to` (world point), blended by w
  b.updateWorldMatrix(true, false); child.updateWorldMatrix(true, false);
  _a.setFromMatrixPosition(b.matrixWorld); _b.setFromMatrixPosition(child.matrixWorld);
  _c.copy(_b).sub(_a).normalize(); _d.copy(to).sub(_a).normalize();
  _q.setFromUnitVectors(_c, _d);
  b.matrixWorld.decompose(_a, _q2, _b);
  _q2.premultiply(_q); // new world rotation
  b.parent!.getWorldQuaternion(_pq).invert();
  _q2.premultiply(_pq); // to local
  b.quaternion.slerp(_q2, w);
  b.updateWorldMatrix(false, true);
}
const S = new THREE.Vector3(), E = new THREE.Vector3(), W = new THREE.Vector3(), Eg = new THREE.Vector3(), dir = new THREE.Vector3(), pol = new THREE.Vector3();
function solveArm(upper: THREE.Bone, fore: THREE.Bone, hand: THREE.Bone, target: THREE.Vector3, pole: THREE.Vector3, w: number) {
  upper.updateWorldMatrix(true, true);
  S.setFromMatrixPosition(upper.matrixWorld); E.setFromMatrixPosition(fore.matrixWorld); W.setFromMatrixPosition(hand.matrixWorld);
  const l1 = S.distanceTo(E), l2 = E.distanceTo(W);
  dir.copy(target).sub(S); let d = dir.length(); dir.multiplyScalar(1 / d);
  d = Math.min(l1 + l2 - 1e-3, Math.max(Math.abs(l1 - l2) + 1e-3, d));
  const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d), h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  pol.copy(pole).addScaledVector(dir, -pole.dot(dir)).normalize();
  Eg.copy(S).addScaledVector(dir, a).addScaledVector(pol, h);
  aim(upper, fore, Eg, w);
  aim(fore, hand, target, w);
}

// ---------------------------------------------------------------- component
interface Props { appearance: CharacterAppearance; pose: CharacterPose; height: number; castShadow: boolean; onReady?: () => void; speed?: number; kind: RpmKind }
export const RpmCharacter: React.FC<Props> = ({ appearance, pose, height, castShadow, onReady, speed, kind }) => {
  const body = readRpm(`${DIR}${kind}.glb`);
  const ual = readGltf(RIG_URL);
  const top = useMemo(() => safeTop(appearance.top, appearance.skin), [appearance.top, appearance.skin]);
  const seed = useMemo(() => hash(`${appearance.skin}${appearance.hair}${appearance.top}${appearance.bottom}${appearance.shoes}`), [appearance]);
  const wantGlasses = appearance.accessory === 'glasses' || (appearance.accessory !== 'none' && seed % 5 === 0);
  const { obj, scale, mats, skinned, glasses } = useMemo(() => {
    const o = skeletonClone(body) as THREE.Object3D;
    const mats = { top: [] as THREE.MeshStandardMaterial[], bottom: [] as THREE.MeshStandardMaterial[], shoes: [] as THREE.MeshStandardMaterial[], hair: [] as THREE.MeshStandardMaterial[], skin: [] as { m: THREE.MeshStandardMaterial; ref: { r: number; g: number; b: number } }[] };
    o.traverse((c) => {
      const m = c as THREE.SkinnedMesh; if (!m.isSkinnedMesh) return;
      const n = m.name.toLowerCase();
      m.frustumCulled = false; m.castShadow = castShadow && !n.includes('teeth') && !n.includes('eye'); m.receiveShadow = false;
      if (n.includes('glasses')) { m.visible = false; return; } // asset has a reindeer-nose/antler texture; replaced by procedural glasses
      const mm = (m.material as THREE.MeshStandardMaterial).clone(); mm.envMapIntensity = 0.9; mm.metalness = 0; mm.metalnessMap = null; m.material = mm;
      if (n.includes('outfit_top')) { mm.roughness = 0.9; mats.top.push(tintable(mm)); }
      else if (n.includes('outfit_bottom')) { mm.roughness = 0.9; mats.bottom.push(tintable(mm)); }
      else if (n.includes('footwear')) { mm.roughness = 0.65; mats.shoes.push(tintable(mm)); }
      else if (n.includes('hair')) { mm.roughness = 0.55; mats.hair.push(tintable(mm)); }
      else if (n.includes('eye')) { mm.roughness = 0.12; mm.envMapIntensity = 1.4; }
      else if (n.includes('teeth')) { mm.roughness = 0.35; }
      else if (n.includes('head') || n.includes('body')) { mm.roughness = 0.62; mm.normalScale?.set(0.8, 0.8); const st = texStats(mm.map); mats.skin.push({ m: mm, ref: st }); }
      if (n.includes('hair')) m.visible = appearance.hairStyle !== 'bald';
    });
    const bb = new THREE.Box3().setFromObject(o);
    const scale = height / Math.max(0.5, bb.max.y - bb.min.y);
    OBJ_SCALE.set(o, scale);
    // procedural glasses parented to the Head bone, built in a rest-pose world-aligned frame
    let glasses: THREE.Group | null = null;
    const head = bone(o, 'Head'), le = bone(o, 'LeftEye'), re = bone(o, 'RightEye');
    if (head && le && re) {
      o.updateMatrixWorld(true);
      const pl = new THREE.Vector3().setFromMatrixPosition(le.matrixWorld), pr = new THREE.Vector3().setFromMatrixPosition(re.matrixWorld);
      const mid = pl.clone().add(pr).multiplyScalar(0.5), sep = Math.abs(pl.x - pr.x) / 2;
      const hq = new THREE.Quaternion(); head.getWorldQuaternion(hq);
      const g = new THREE.Group(); g.quaternion.copy(hq).invert(); g.position.copy(head.worldToLocal(mid.clone().add(new THREE.Vector3(0, 0.002, 0.026))));
      const frame = new THREE.MeshStandardMaterial({ color: '#15171a', roughness: 0.35, metalness: 0.4 });
      const lens = new THREE.MeshStandardMaterial({ color: '#cfe6f2', roughness: 0.05, metalness: 0, transparent: true, opacity: 0.16, depthWrite: false });
      const R = 0.0235;
      for (const sx of [-1, 1]) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(R, 0.0021, 6, 22), frame); ring.position.set(sx * sep, 0, 0); g.add(ring);
        const gl = new THREE.Mesh(new THREE.CircleGeometry(R, 16), lens); gl.position.set(sx * sep, 0, 0); g.add(gl);
        const len = 0.1, arm = new THREE.Mesh(new THREE.BoxGeometry(0.003, 0.003, len), frame); arm.position.set(sx * (sep + R + 0.004), 0.004, -len / 2); arm.rotation.y = sx * 0.07; g.add(arm);
      }
      const br = new THREE.Mesh(new THREE.BoxGeometry(2 * sep - 2 * R + 0.006, 0.003, 0.003), frame); br.position.set(0, 0.006, 0); g.add(br);
      g.visible = wantGlasses; head.add(g); glasses = g;
    }
    return { obj: o, scale, mats, skinned: firstSkinned(o)!, glasses };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [body, height, castShadow]);
  useLayoutEffect(() => { if (glasses) glasses.visible = wantGlasses; }, [glasses, wantGlasses]);
  useLayoutEffect(() => {
    const t = new THREE.Color(top); if (lum(top) > 0.12) t.lerp(new THREE.Color('#ffffff'), 0.2); mats.top.forEach((m) => m.userData.tint.value.copy(t));
    const b = new THREE.Color(appearance.bottom); mats.bottom.forEach((m) => m.userData.tint.value.copy(b));
    const sh = new THREE.Color(appearance.shoes); mats.shoes.forEach((m) => m.userData.tint.value.copy(sh).lerp(new THREE.Color('#ffffff'), 0.06));
    const hr = new THREE.Color(appearance.hair); mats.hair.forEach((m) => m.userData.tint.value.copy(hr));
    const sk = realisticSkin(appearance.skin);
    mats.skin.forEach(({ m, ref }) => {
      // tint so the mean texel lands on the target skin colour (head and body textures are normalised separately => no neck seam)
      m.color.setRGB(Math.min(1.9, sk.r / ref.r), Math.min(1.9, sk.g / ref.g), Math.min(1.9, sk.b / ref.b)).lerp(new THREE.Color('#ffffff'), 0.1);
      m.emissive.copy(sk).multiplyScalar(0.05); // faint warm fill instead of flat grey shadow side
    });
  }, [mats, top, appearance.bottom, appearance.shoes, appearance.hair, appearance.skin]);

  // subtle body variety (shoulder width / thickness), hips are placed by the clip itself
  const wScale = useMemo(() => 0.96 + ((seed >>> 8) % 100) / 100 * 0.08, [seed]);
  const group = useRef<THREE.Group>(null);
  const mixer = useMemo(() => new THREE.AnimationMixer(obj), [obj]);
  const cur = useRef<THREE.AnimationAction | null>(null), first = useRef(true);
  useEffect(() => () => { mixer.stopAllAction(); mixer.uncacheRoot(obj); }, [mixer, obj]);
  useEffect(() => {
    const clip = clipFor(kind, obj, skinned, ual, pose); if (!clip) return;
    const next = mixer.clipAction(clip, skinned);
    if (next === cur.current) return;
    next.reset().setLoop(THREE.LoopRepeat, Infinity);
    if (first.current) { next.play(); mixer.update(Math.random() * clip.duration); first.current = false; }
    else { next.play(); if (cur.current) cur.current.crossFadeTo(next, 0.25, false); else next.fadeIn(0.25); }
    cur.current = next;
  }, [pose, mixer, kind, skinned, ual, obj]);
  useEffect(() => { onReady?.(); }, [onReady]);
  const ik = useMemo(() => {
    const g = (n: string) => bone(obj, n)!;
    return { lu: g('LeftArm'), lf: g('LeftForeArm'), lh: g('LeftHand'), ru: g('RightArm'), rf: g('RightForeArm'), rh: g('RightHand'), w: 0, t: Math.random() * 6 };
  }, [obj]);
  const tgt = useMemo(() => ({ l: new THREE.Vector3(), r: new THREE.Vector3(), pl: new THREE.Vector3(), pr: new THREE.Vector3() }), []);
  useFrame((_, dt) => {
    const g = group.current; if (!g) return;
    g.updateWorldMatrix(true, false); const e = g.matrixWorld.elements;
    if (!inView(e[12], e[13] + 0.9, e[14])) return;
    const rate = speed && pose === 'walk' ? Math.max(0.7, Math.min(1.6, speed / 1.4)) : 1;
    const step = Math.min(dt, 0.1);
    mixer.update(step * rate);
    // arm IK for typing (blend in/out)
    const want = pose === 'type' ? 1 : 0;
    ik.w += (want - ik.w) * Math.min(1, step * 6);
    if (ik.w > 0.01 && ik.lu && ik.ru) {
      ik.t += step;
      const t = ik.t, bl = Math.sin(t * 13) * 0.006, br = Math.sin(t * 11 + 2) * 0.006, sx = Math.sin(t * 0.7) * 0.015;
      g.localToWorld(tgt.l.set(-KEYS.dx + sx, KEYS.y + Math.max(0, bl), KEYS.z));
      g.localToWorld(tgt.r.set(KEYS.dx + sx, KEYS.y + Math.max(0, br), KEYS.z));
      // elbows hang down and slightly outwards / back
      tgt.pl.set(-0.55, -1, -0.45).transformDirection(g.matrixWorld);
      tgt.pr.set(0.55, -1, -0.45).transformDirection(g.matrixWorld);
      solveArm(ik.lu, ik.lf, ik.lh, tgt.l, tgt.pl, ik.w);
      solveArm(ik.ru, ik.rf, ik.rh, tgt.r, tgt.pr, ik.w);
    }
  });
  return <group ref={group} scale={scale}><group scale={[wScale, 1, wScale]}><primitive object={obj} /></group></group>;
};
