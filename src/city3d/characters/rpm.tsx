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
import { useFrame, useThree } from '@react-three/fiber';
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
/**
 * Office chair ('chairDesk' Kenney mesh, 1.5x as placed by furn.ts `chair()`): measured from the GLB (flat up-facing layers):
 * pink cushion top y = 0.33 * 1.5 = 0.495 m (armrest rim 0.525 m), seat spans z -0.19..+0.11 (chair centre = 0), backrest top 0.91 m.
 * The RPM legs are long (knee ~0.6 m with feet flat on the floor), so the Hips bone is pinned at 0.55 m: thigh slopes up ~12 deg from the cushion to the knee (checked in side-view screenshots + window.__rpmDbg). Desk: top 0.75 m, front edge 0.25 m in front of the chair centre; keyboard centre z 0.46, top 0.78 m.
 */
export const OFFICE_SEAT = { top: 0.525, hipY: 0.55, hipZ: 0.03 };
const DESK = { kbY: 0.80, kbZ: 0.43, kbDx: 0.14, mouseX: -0.34, mouseZ: 0.48, cup: [-0.44, 0.79, 0.62] as [number, number, number] };
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
  const tint = { value: new THREE.Color('#ffffff') }, ref = { value: texStats(m.map).l }, detail = { value: 1 };
  m.userData.tint = tint; m.userData.detail = detail; m.customProgramCacheKey = () => 'city3d-rpm-tint-v2';
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTint = tint; sh.uniforms.uRef = ref; sh.uniforms.uDetail = detail;
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform vec3 uTint; uniform float uRef; uniform float uDetail;')
      .replace('#include <map_fragment>', '#include <map_fragment>\n#ifdef USE_MAP\n diffuseColor.rgb = uTint * mix(1.0, clamp(dot(diffuseColor.rgb, vec3(0.2126,0.7152,0.0722)) / uRef, 0.3, 1.8), uDetail);\n#endif');
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
function clipFor(kind: RpmKind, obj: THREE.Object3D, mesh: THREE.SkinnedMesh, ual: { scene: THREE.Object3D; animations: THREE.AnimationClip[] }, pose: CharacterPose, seat: { hipY: number; hipZ: number } = SEAT): THREE.AnimationClip | undefined {
  const name = CLIP[pose], k = `${kind}|${name}|${seat.hipY}`; let c = clipCache.get(k);
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
    if (SEATED.has(pose)) { dy = seat.hipY / OBJ_SCALE.get(obj)! - my; dz = seat.hipZ / OBJ_SCALE.get(obj)!; }
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
interface Props { appearance: CharacterAppearance; pose: CharacterPose; height: number; castShadow: boolean; onReady?: () => void; speed?: number; kind: RpmKind; /** desk worker on the real office chair: measured seat, leg/arm IK, lanyard, headset, micro-motions */ office?: boolean }
export const RpmCharacter: React.FC<Props> = ({ appearance, pose, height, castShadow, onReady, speed, kind, office }) => {
  const gl = useThree((st) => st.gl);
  const seatCfg = office ? OFFICE_SEAT : SEAT;
  const body = readRpm(`${DIR}${kind}.glb`);
  const ual = readGltf(RIG_URL);
  const top = useMemo(() => safeTop(appearance.top, appearance.skin), [appearance.top, appearance.skin]);
  const seed = useMemo(() => hash(`${appearance.skin}${appearance.hair}${appearance.top}${appearance.bottom}${appearance.shoes}`), [appearance]);
  const wantGlasses = appearance.accessory === 'glasses' || (appearance.accessory !== 'none' && seed % 5 === 0);
  const { obj, scale, mats, skinned, glasses, rig } = useMemo(() => {
    const o = skeletonClone(body) as THREE.Object3D;
    const mats = { top: [] as THREE.MeshStandardMaterial[], bottom: [] as THREE.MeshStandardMaterial[], shoes: [] as THREE.MeshStandardMaterial[], hair: [] as THREE.MeshStandardMaterial[], skin: [] as { m: THREE.MeshStandardMaterial; ref: { r: number; g: number; b: number } }[] };
    o.traverse((c) => {
      const m = c as THREE.SkinnedMesh; if (!m.isSkinnedMesh) return;
      const n = m.name.toLowerCase();
      m.frustumCulled = false; m.castShadow = castShadow && !n.includes('teeth') && !n.includes('eye'); m.receiveShadow = !!office && castShadow;
      if (n.includes('glasses')) { m.visible = false; return; } // asset has a reindeer-nose/antler texture; replaced by procedural glasses
      const mm = (m.material as THREE.MeshStandardMaterial).clone(); mm.envMapIntensity = 0.9; mm.metalness = 0; mm.metalnessMap = null; m.material = mm;
      if (office) { const an = gl.capabilities.getMaxAnisotropy(); for (const tx of [mm.map, mm.normalMap, mm.roughnessMap, mm.aoMap]) if (tx && tx.anisotropy < an) { tx.anisotropy = an; tx.needsUpdate = true; } }
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
    const rig = office ? buildOfficeRig(o, scale, bb.min.y, seed, appearance.accessory === 'headset') : null;
    return { obj: o, scale, mats, skinned: firstSkinned(o)!, glasses, rig };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [body, height, castShadow, office]);
  useLayoutEffect(() => { if (glasses) glasses.visible = wantGlasses; }, [glasses, wantGlasses]);
  useLayoutEffect(() => {
    const t = new THREE.Color(top); if (lum(top) > 0.12) t.lerp(new THREE.Color('#ffffff'), 0.2); mats.top.forEach((m) => { m.userData.tint.value.copy(t); if (office) m.userData.detail.value = 0.3; }); // office shirts: plain fabric, the sneaker-brand print on the RPM tee is flattened
    const b = new THREE.Color(appearance.bottom); mats.bottom.forEach((m) => m.userData.tint.value.copy(b));
    const sh = new THREE.Color(appearance.shoes); mats.shoes.forEach((m) => m.userData.tint.value.copy(sh).lerp(new THREE.Color('#ffffff'), 0.06));
    const hr = new THREE.Color(appearance.hair); mats.hair.forEach((m) => m.userData.tint.value.copy(hr));
    const sk = realisticSkin(appearance.skin);
    mats.skin.forEach(({ m, ref }) => {
      // tint so the mean texel lands on the target skin colour (head and body textures are normalised separately => no neck seam)
      m.color.setRGB(Math.min(1.9, sk.r / ref.r), Math.min(1.9, sk.g / ref.g), Math.min(1.9, sk.b / ref.b)).lerp(new THREE.Color('#ffffff'), 0.1);
      m.emissive.copy(sk).multiplyScalar(0.05); // faint warm fill instead of flat grey shadow side
    });
  }, [mats, office, top, appearance.bottom, appearance.shoes, appearance.hair, appearance.skin]);

  // subtle body variety (shoulder width / thickness), hips are placed by the clip itself
  const wScale = useMemo(() => 0.96 + ((seed >>> 8) % 100) / 100 * 0.08, [seed]);
  const group = useRef<THREE.Group>(null);
  const mixer = useMemo(() => new THREE.AnimationMixer(obj), [obj]);
  const cur = useRef<THREE.AnimationAction | null>(null), first = useRef(true), lastPose = useRef<CharacterPose>(pose);
  useEffect(() => () => { mixer.stopAllAction(); mixer.uncacheRoot(obj); }, [mixer, obj]);
  useEffect(() => {
    const clip = clipFor(kind, obj, skinned, ual, pose, seatCfg); if (!clip) return;
    const next = mixer.clipAction(clip, skinned);
    if (next === cur.current) return;
    next.reset().setLoop(THREE.LoopRepeat, Infinity);
    const fade = office && SEATED.has(pose) !== SEATED.has(lastPose.current) ? 0.55 : 0.25; lastPose.current = pose;
    if (first.current) { next.play(); mixer.update(Math.random() * clip.duration); first.current = false; }
    else { next.play(); if (cur.current) cur.current.crossFadeTo(next, fade, false); else next.fadeIn(fade); }
    cur.current = next;
  }, [pose, mixer, kind, skinned, ual, obj, seatCfg, office]);
  useEffect(() => { onReady?.(); }, [onReady]);
  const ik = useMemo(() => {
    const g = (n: string) => bone(obj, n)!;
    return { lu: g('LeftArm'), lf: g('LeftForeArm'), lh: g('LeftHand'), ru: g('RightArm'), rf: g('RightForeArm'), rh: g('RightHand'), w: 0, t: Math.random() * 6,
      luL: g('LeftUpLeg'), llL: g('LeftLeg'), lfL: g('LeftFoot'), ruL: g('RightUpLeg'), rlL: g('RightLeg'), rfL: g('RightFoot'), hips: g('Hips'), lMid: g('LeftHandMiddle1'), lThumb: g('LeftHandThumb1'), rMid: g('RightHandMiddle1'), rThumb: g('RightHandThumb1'), head: g('Head'), neck: g('Neck'), spine: g('Spine1'),
      legW: 0, hw: 0, yaw: 0, pitch: 0, lean: 0, ph: Math.random() * 100,
      m: { kind: 'none' as MicroKind, t: 0, dur: 1, next: 3 + Math.random() * 8, dir: 1, cupOn: false } };
  }, [obj]);
  const tgt = useMemo(() => ({ l: new THREE.Vector3(), r: new THREE.Vector3(), pl: new THREE.Vector3(), pr: new THREE.Vector3() }), []);
  const anchor = useRef<THREE.Group>(null), cup = useRef<THREE.Group>(null);
  const cupMesh = useMemo(() => (office ? buildCup() : null), [office]);
  useFrame((_, dt) => {
    const g = group.current, an = anchor.current; if (!g || !an) return;
    g.updateWorldMatrix(true, false); const e = g.matrixWorld.elements;
    if (!inView(e[12], e[13] + 0.9, e[14])) return;
    const rate = speed && pose === 'walk' ? Math.max(0.7, Math.min(1.6, speed / 1.4)) : 1;
    const step = Math.min(dt, 0.1);
    mixer.update(step * rate);
    ik.t += step;
    if (!office) {
      // legacy NPC path: arm IK for typing only
      const want = pose === 'type' ? 1 : 0;
      ik.w += (want - ik.w) * Math.min(1, step * 6);
      if (ik.w > 0.01 && ik.lu && ik.ru) {
        const t = ik.t, bl = Math.sin(t * 13) * 0.006, br = Math.sin(t * 11 + 2) * 0.006, sx = Math.sin(t * 0.7) * 0.015;
        g.localToWorld(tgt.l.set(-KEYS.dx + sx, KEYS.y + Math.max(0, bl), KEYS.z));
        g.localToWorld(tgt.r.set(KEYS.dx + sx, KEYS.y + Math.max(0, br), KEYS.z));
        tgt.pl.set(-0.55, -1, -0.45).transformDirection(g.matrixWorld);
        tgt.pr.set(0.55, -1, -0.45).transformDirection(g.matrixWorld);
        solveArm(ik.lu, ik.lf, ik.lh, tgt.l, tgt.pl, ik.w);
        solveArm(ik.ru, ik.rf, ik.rh, tgt.r, tgt.pr, ik.w);
      }
      return;
    }
    // ---- office desk worker. Anchor frame = chair centre on the floor, metres, +z towards the desk, the character's left hand is +x.
    an.updateWorldMatrix(true, false); ik.lh.userData.anchor = an; ik.rh.userData.anchor = an;
    const seated = pose === 'sit' || pose === 'type';
    ik.w += ((seated ? 1 : 0) - ik.w) * Math.min(1, step * 5);
    ik.legW += ((seated ? 1 : 0) - ik.legW) * Math.min(1, step * 8);
    ik.hw += ((seated ? 1 : 0) - ik.hw) * Math.min(1, step * 4);
    const cg = cup.current;
    if (ik.w < 0.01 && ik.legW < 0.01) { if (cg) cg.visible = false; return; }
    const m = ik.m, t = ik.t, R = rig!;
    // micro-motion scheduler (drink / stretch / look around / lean back)
    if (seated) {
      m.next -= step;
      if (m.kind === 'none' && m.next <= 0) {
        const r = Math.random(); m.kind = r < 0.4 ? 'look' : r < 0.7 ? 'drink' : r < 0.85 ? 'stretch' : 'lean'; m.t = 0; m.dir = Math.random() < 0.5 ? -1 : 1;
        if (m.kind === 'drink' && !R.hasCup) m.kind = 'look';
        m.dur = m.kind === 'drink' ? 6 : m.kind === 'stretch' ? 4.5 : m.kind === 'look' ? 4 : 3.5;
      }
      if (m.kind !== 'none') { m.t += step; if (m.t >= m.dur) { m.kind = 'none'; m.cupOn = false; m.next = 6 + Math.random() * 14; } }
    } else { m.kind = 'none'; m.cupOn = false; }
    const mp = m.kind === 'none' ? 0 : m.t / m.dur;
    const env = Math.sin(Math.PI * Math.min(1, mp)), se = env * env * (3 - 2 * env); // smooth 0-1-0
    // hands: typing = both on the keyboard; idle ('sit') = right on the mouse, left resting on the keyboard edge
    const typing = pose === 'type';
    const bl = typing ? Math.max(0, Math.sin(t * 13)) * 0.008 : 0, br = typing ? Math.max(0, Math.sin(t * 11 + 2)) * 0.008 : 0, sx = typing ? Math.sin(t * 0.7) * 0.015 : 0;
    tgt.l.set(DESK.kbDx + sx, DESK.kbY + bl, DESK.kbZ + (typing ? 0 : -0.05));
    if (typing) tgt.r.set(-DESK.kbDx + sx, DESK.kbY + br, DESK.kbZ);
    else tgt.r.set(DESK.mouseX + Math.sin(t * 0.5) * 0.02, DESK.kbY - 0.01, DESK.mouseZ + Math.sin(t * 0.37) * 0.015);
    let lean = typing ? 0.07 : 0, yawT = Math.sin(t * 0.23 + ik.ph) * 0.07 * Math.max(0, Math.sin(t * 0.11 + ik.ph)), pitchT = 0.13 + Math.sin(t * 0.31 + ik.ph) * 0.03; // eyes on the monitor
    if (m.kind === 'drink') {
      const c = DESK.cup, hold = V0.copy(tgt.r), ph = mp, mx = -0.03, my = R.mouthY - 0.045, mz = R.mouthZ;
      const cx = c[0], cy = c[1] + 0.05, cz = c[2];
      let ax = hold.x, ay = hold.y, az = hold.z, bx = cx, by = cy, bz = cz, a: number;
      if (ph < 0.18) { a = sm(ph / 0.18); }
      else if (ph < 0.42) { a = sm((ph - 0.18) / 0.24); ax = cx; ay = cy; az = cz; bx = mx; by = my; bz = mz; }
      else if (ph < 0.66) { a = 0; ax = mx; ay = my + (ph > 0.5 && ph < 0.58 ? 0.02 : 0); az = mz; bx = ax; by = ay; bz = az; }
      else if (ph < 0.86) { a = sm((ph - 0.66) / 0.2); ax = mx; ay = my; az = mz; }
      else { a = sm((ph - 0.86) / 0.14); ax = cx; ay = cy; az = cz; bx = hold.x; by = hold.y; bz = hold.z; }
      tgt.r.set(ax + (bx - ax) * a, ay + (by - ay) * a, az + (bz - az) * a);
      m.cupOn = ph > 0.12 && ph < 0.9; if (ph > 0.42 && ph < 0.66) pitchT -= 0.1;
    } else if (m.kind === 'stretch') {
      tgt.l.lerp(V1.set(0.24, 1.8, -0.08), se); tgt.r.lerp(V1.set(-0.24, 1.8, -0.08), se);
      lean = -0.16 * se; pitchT -= 0.2 * se;
    } else if (m.kind === 'look') { yawT = m.dir * 0.75 * se; pitchT = 0.03 + 0.05 * se; if (mp > 0.3 && mp < 0.7) yawT += Math.sin(t * 2.2) * 0.04; }
    else if (m.kind === 'lean') { lean = -0.1 * se; pitchT += 0.08 * se; }
    const k4 = Math.min(1, step * 4);
    ik.yaw += (yawT - ik.yaw) * k4; ik.pitch += (pitchT - ik.pitch) * k4; ik.lean += (lean - ik.lean) * Math.min(1, step * 3);
    // pin the pelvis exactly on the measured chair seat (the retargeted clip's hip track is only approximately right), weighted so stand-up / sit-down blend
    if (ik.legW > 0.01) {
      const hb = ik.hips, par = hb.parent!; par.updateWorldMatrix(true, false); hb.updateWorldMatrix(false, false);
      V2.setFromMatrixPosition(hb.matrixWorld); an.worldToLocal(V2);
      V3.set(0, 0, 0); V3.x = 0; const dy = (OFFICE_SEAT.hipY - V2.y) * ik.legW, dz = (OFFICE_SEAT.hipZ - V2.z) * ik.legW;
      V2.set(0, dy, dz); V2.applyQuaternion(an.getWorldQuaternion(Q1)); // world-space delta (anchor is only yawed)
      hb.getWorldPosition(V3); const l0 = par.worldToLocal(V3.clone()), l1 = par.worldToLocal(V3.add(V2));
      hb.position.add(l1.sub(l0)); hb.updateWorldMatrix(false, true);
    }
    // legs: knees forward over the seat edge, shins vertical, feet flat on the floor under the desk
    if (ik.legW > 0.01) {
      for (const sd of [1, -1] as const) {
        const up = sd > 0 ? ik.luL : ik.ruL, lo = sd > 0 ? ik.llL : ik.rlL, ft = sd > 0 ? ik.lfL : ik.rfL;
        an.localToWorld(V2.set(sd * R.hipX * 1.08, R.ankleH, OFFICE_SEAT.hipZ + R.thigh * 0.95));
        V3.set(sd * 0.12, 0.25, 1).transformDirection(an.matrixWorld);
        solveArm(up, lo, ft, V2, V3, ik.legW);
      }
    }
    if (Math.abs(ik.lean) > 0.001) { ik.spine.quaternion.multiply(Q1.setFromAxisAngle(AX, ik.lean)); ik.spine.updateWorldMatrix(false, true); }
    an.localToWorld(tgt.l); an.localToWorld(tgt.r);
    tgt.pl.set(0.6, -1, -0.5).transformDirection(an.matrixWorld);
    tgt.pr.set(-0.6, -1, -0.5).transformDirection(an.matrixWorld);
    solveArm(ik.lu, ik.lf, ik.lh, tgt.l, tgt.pl, ik.w);
    solveArm(ik.ru, ik.rf, ik.rh, tgt.r, tgt.pr, ik.w);
    { // wrists: fingers forward over the keys, palms down
      const free = m.kind === 'stretch' ? 1 - se : m.kind === 'drink' ? 0.35 : 1;
      orientHand(ik.lh, ik.lMid, ik.lThumb, 1, ik.w * free); orientHand(ik.rh, ik.rMid, ik.rThumb, -1, ik.w * free);
    }
    // head + neck turn toward the monitor and look around
    Q1.setFromEuler(E1.set(ik.pitch * 0.5 * ik.hw, ik.yaw * 0.4 * ik.hw, 0)); ik.neck.quaternion.multiply(Q1);
    Q1.setFromEuler(E1.set(ik.pitch * 0.5 * ik.hw, ik.yaw * 0.6 * ik.hw, 0)); ik.head.quaternion.multiply(Q1);
    ik.head.updateWorldMatrix(false, true);
    if (import.meta.env?.DEV && seated) { // QA numbers: anchor-local metres (hips, knees, ankles, hands), read via window.__rpmDbg
      const w = window as unknown as { __rpmDbg?: Record<string, number[]> }; w.__rpmDbg ??= {};
      const loc = (b: THREE.Object3D) => { b.getWorldPosition(V2); an.worldToLocal(V2); return [+V2.x.toFixed(3), +V2.y.toFixed(3), +V2.z.toFixed(3)]; };
      (window as unknown as { __rpmInfo?: unknown }).__rpmInfo = gl.info; const wp = an.getWorldPosition(V3); w.__rpmDbg[`${wp.x.toFixed(1)},${wp.z.toFixed(1)}`] = [...loc(ik.hips), ...loc(ik.llL), ...loc(ik.lfL), ...loc(ik.lh), ...loc(ik.head)];
    }
    // the paper cup sits on the desk and follows the right hand while it is held
    if (cg && cupMesh) {
      cg.visible = true;
      if (m.cupOn) { ik.rh.getWorldPosition(V2); an.worldToLocal(V2); cg.position.set(V2.x, V2.y - 0.05, V2.z + 0.01); }
      else cg.position.set(DESK.cup[0], DESK.cup[1] - 0.04, DESK.cup[2]);
    }
  });
  return (
    <group ref={anchor}>
      <group ref={group} scale={scale}><group scale={[wScale, 1, wScale]}><primitive object={obj} /></group></group>
      {office && rig?.hasCup && <group ref={cup} visible={false}>{cupMesh && <primitive object={cupMesh} />}</group>}
    </group>
  );
};

// ---------------------------------------------------------------- office extras
const HP = new THREE.Vector3(), HF = new THREE.Vector3(), HT = new THREE.Vector3(), HD = new THREE.Vector3(), HQ = new THREE.Quaternion(), HQ2 = new THREE.Quaternion(), HQP = new THREE.Quaternion();
/** Point the hand's finger axis forward (+z, slightly down) and twist it so the thumb points to the body centre (palm down). Anchor frame is yaw-only, so world == anchor up to yaw. */
function orientHand(hand: THREE.Bone, mid: THREE.Bone | undefined, thumb: THREE.Bone | undefined, side: 1 | -1, w: number) {
  if (!mid || !thumb || w < 0.01) return;
  const an = hand.userData.anchor as THREE.Object3D | undefined; if (!an) return;
  an.getWorldQuaternion(HQ2);
  HD.set(0, -0.12, 1).applyQuaternion(HQ2);
  hand.updateWorldMatrix(true, true); HP.setFromMatrixPosition(hand.matrixWorld);
  HF.setFromMatrixPosition(mid.matrixWorld).sub(HP).normalize();
  HQ.setFromUnitVectors(HF, HD.normalize()); // swing
  hand.matrixWorld.decompose(HP, HQP, HT); HQP.premultiply(HQ); // new world rotation
  // twist about the new finger axis: thumb (rotated with the swing) -> inward
  HT.setFromMatrixPosition(thumb.matrixWorld).sub(HP).applyQuaternion(HQ);
  HT.addScaledVector(HD, -HT.dot(HD)).normalize();
  HF.set(-side, 0.1, 0).applyQuaternion(HQ2); HF.addScaledVector(HD, -HF.dot(HD)).normalize();
  const ang = Math.atan2(HD.dot(HT.clone().cross(HF)), HT.dot(HF));
  HQP.premultiply(HQ.setFromAxisAngle(HD, ang));
  hand.parent!.getWorldQuaternion(HQ).invert(); HQP.premultiply(HQ);
  hand.quaternion.slerp(HQP, w); hand.updateWorldMatrix(false, true);
}
type MicroKind = 'none' | 'look' | 'drink' | 'stretch' | 'lean';
const sm = (x: number) => { const c = Math.min(1, Math.max(0, x)); return c * c * (3 - 2 * c); };
const V0 = new THREE.Vector3(), V1 = new THREE.Vector3(), V2 = new THREE.Vector3(), V3 = new THREE.Vector3(), Q1 = new THREE.Quaternion(), E1 = new THREE.Euler(), AX = new THREE.Vector3(1, 0, 0);
interface OfficeRig { hipX: number; ankleH: number; thigh: number; mouthY: number; mouthZ: number; hasCup: boolean }
function buildCup() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.037, 0.032, 0.09, 16), new THREE.MeshStandardMaterial({ color: '#f4f1ea', roughness: 0.35 }));
  body.position.y = 0.045; body.castShadow = true;
  const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.039, 0.039, 0.008, 16), new THREE.MeshStandardMaterial({ color: '#2b3137', roughness: 0.5 }));
  lid.position.y = 0.094;
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.0375, 0.0345, 0.03, 16), new THREE.MeshStandardMaterial({ color: '#2e8f8a', roughness: 0.5 })); band.position.y = 0.045;
  g.add(body, lid, band);
  return g;
}
/** Lanyard + badge on the chest (Spine2), optional headset on the head, and the rest-pose leg numbers the seated IK needs (metres). */
function buildOfficeRig(o: THREE.Object3D, scale: number, minY: number, seed: number, headset: boolean): OfficeRig {
  o.updateMatrixWorld(true);
  const wp = (n: string) => new THREE.Vector3().setFromMatrixPosition(bone(o, n)!.matrixWorld);
  const lUp = wp('LeftUpLeg'), lKn = wp('LeftLeg'), lFt = wp('LeftFoot'), nk = wp('Neck'), hd = wp('Head'), hp = wp('Hips');
  const rig: OfficeRig = {
    hipX: Math.abs(lUp.x) * scale, ankleH: (lFt.y - minY) * scale, thigh: lUp.distanceTo(lKn) * scale,
    mouthY: OFFICE_SEAT.hipY + (hd.y - hp.y) * scale + 0.02, mouthZ: 0.2, hasCup: (seed >>> 4) % 3 !== 0,
  };
  let top: THREE.SkinnedMesh | null = null; o.traverse((c) => { const m = c as THREE.SkinnedMesh; if (m.isSkinnedMesh && /outfit_top/i.test(m.name)) top = m; });
  const spine2 = bone(o, 'Spine2'), head = bone(o, 'Head');
  if (top && spine2) {
    const tm = top as THREE.SkinnedMesh, pos = tm.geometry.attributes.position, v = new THREE.Vector3();
    const frontZ = (y: number) => { let z = -1e9; for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i).applyMatrix4(tm.matrixWorld); if (Math.abs(v.x - nk.x) < 0.045 && Math.abs(v.y - y) < 0.015 && v.z > z) z = v.z; } return z > -1e8 ? z : nk.z + 0.09; };
    const k = 1 / scale;
    const y0 = nk.y - 0.035 * k, y1 = nk.y - 0.3 * k, z0 = frontZ(y0), z1 = frontZ(y1);
    const colors = ['#1d4ed8', '#be123c', '#0f766e', '#111827', '#7c3aed'], lc = colors[(seed >>> 7) % colors.length];
    const strapM = new THREE.MeshStandardMaterial({ color: lc, roughness: 0.6 });
    const lg = new THREE.Group();
    for (const sx of [-1, 1]) {
      const a = new THREE.Vector3(nk.x + sx * 0.062 * k, y0, z0 + 0.004 * k), b = new THREE.Vector3(nk.x, y1, z1 + 0.006 * k);
      const strap = new THREE.Mesh(new THREE.BoxGeometry(0.013 * k, a.distanceTo(b), 0.003 * k), strapM);
      strap.position.copy(a).add(b).multiplyScalar(0.5); strap.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
      lg.add(strap);
    }
    const badge = new THREE.Group(); badge.position.set(nk.x, y1 - 0.045 * k, frontZ(y1 - 0.045 * k) + 0.007 * k);
    const card = new THREE.Mesh(new THREE.BoxGeometry(0.056 * k, 0.082 * k, 0.003 * k), new THREE.MeshStandardMaterial({ color: '#f8fafc', roughness: 0.4 }));
    const band = new THREE.Mesh(new THREE.BoxGeometry(0.056 * k, 0.02 * k, 0.0035 * k), new THREE.MeshStandardMaterial({ color: '#1d4ed8', roughness: 0.4 })); band.position.y = 0.03 * k;
    const photo = new THREE.Mesh(new THREE.BoxGeometry(0.022 * k, 0.026 * k, 0.0036 * k), new THREE.MeshStandardMaterial({ color: '#94a3b8', roughness: 0.6 })); photo.position.y = -0.006 * k;
    badge.add(card, band, photo); badge.rotation.x = -0.12; lg.add(badge);
    lg.applyMatrix4(new THREE.Matrix4().copy(spine2.matrixWorld).invert()); spine2.add(lg);
  }
  if (headset && head) {
    const le = bone(o, 'LeftEye'), re = bone(o, 'RightEye');
    if (le && re) {
      const mid = new THREE.Vector3().setFromMatrixPosition(le.matrixWorld).add(new THREE.Vector3().setFromMatrixPosition(re.matrixWorld)).multiplyScalar(0.5);
      const g = new THREE.Group(), mat = new THREE.MeshStandardMaterial({ color: '#1b1f24', roughness: 0.45, metalness: 0.3 });
      const R = 0.092, c = mid.clone().add(new THREE.Vector3(0, -0.012, -0.075));
      const arc = new THREE.Mesh(new THREE.TorusGeometry(R, 0.0042, 8, 28, Math.PI), mat); arc.position.copy(c); g.add(arc);
      for (const sx of [-1, 1]) { const cp = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.02, 16), mat); cp.rotation.z = Math.PI / 2; cp.position.set(c.x + sx * (R + 0.004), c.y, c.z); g.add(cp); }
      const boom = new THREE.Mesh(new THREE.BoxGeometry(0.0032, 0.0032, 0.1), mat); boom.position.set(c.x + R + 0.004, c.y - 0.05, c.z + 0.085); boom.rotation.set(0.18, -0.55, 0); g.add(boom);
      g.applyMatrix4(new THREE.Matrix4().copy(head.matrixWorld).invert()); head.add(g);
    }
  }
  return rig;
}
