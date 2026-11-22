/**
 * Meshy human figures: rigged to the Quaternius skeleton and animated with the UAL1 clips (AnimationMixer per figure),
 * with small behaviours on top of the nav/agent system (receptionist, greeter, trainer).
 * Fallbacks: rigged GLB missing/failing -> static GLB (home position, no animation) -> nothing.
 */
import React, { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { Html, useGLTF } from '@react-three/drei';
import { clone as skeletonClone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { FLOOR_H, live, cityStore, type Quality } from '../shared';
import { FT } from './furn';
import { FIGURES, moveFigure, findPath, type FigureSpot } from './nav';
import { figWalk, nearestAgentDist } from './agents';
import { RIG_URL, readGltf, inView } from '../characters/rigged';

const ROOT = `${(import.meta as any).env?.BASE_URL ?? '/'}models/meshy/`;
/** Original, untouched Meshy exports (static pose). The auto-rig stretched skirts/hems, so rigging is off by default. */
const USE_RIG = false;
const ORIGINAL = `${ROOT}original/`;
const exists = new Map<string, Promise<boolean>>();
const check = (url: string) => {
  let p = exists.get(url);
  if (!p) { p = fetch(url, { method: 'HEAD' }).then((r) => r.ok && !(r.headers.get('content-type') ?? '').includes('text/html')).catch(() => false); exists.set(url, p); }
  return p;
};
function useExists(url: string): boolean | null {
  const [v, setV] = useState<boolean | null>(null);
  useEffect(() => { let alive = true; check(url).then((r) => alive && setV(r)); return () => { alive = false; }; }, [url]);
  return v;
}
class Boundary extends React.Component<{ children: React.ReactNode; fallback?: React.ReactNode }, { err: boolean }> {
  state = { err: false };
  static getDerivedStateFromError() { return { err: true }; }
  componentDidCatch() { /* fall back silently */ }
  render() { return this.state.err ? (this.props.fallback ?? null) : this.props.children; }
}

interface Api { play: (clip: string, once: boolean) => void; onFinished: (() => void) | null }

const prep = (o: THREE.Object3D, shadow: boolean) => o.traverse((m) => {
  const me = m as THREE.Mesh; if (!me.isMesh) return;
  me.castShadow = shadow; me.receiveShadow = true; me.frustumCulled = false; // skinned bounds are unreliable
  const mat = me.material as THREE.MeshStandardMaterial; if (mat) { mat.envMapIntensity = 0.35; mat.needsUpdate = true; }
});

/** static fallback (no skeleton) */
const StaticModel: React.FC<{ url: string; height: number; shadow: boolean }> = ({ url, height, shadow }) => {
  const gltf = useGLTF(url, false, false) as unknown as { scene: THREE.Object3D };
  const obj = useMemo(() => {
    const o = gltf.scene.clone(true);
    const box = new THREE.Box3().setFromObject(o), size = new THREE.Vector3(), c = new THREE.Vector3();
    box.getSize(size); box.getCenter(c);
    const wrap = new THREE.Group(); o.position.set(-c.x, -box.min.y, -c.z); wrap.add(o); wrap.scale.setScalar(size.y > 1e-4 ? height / size.y : 1);
    prep(o, shadow); return wrap;
  }, [gltf, height, shadow]);
  return <primitive object={obj} />;
};

/** rigged model + mixer playing UAL1 clips by bone name */
const RigModel: React.FC<{ url: string; height: number; shadow: boolean; api: React.MutableRefObject<Api> }> = ({ url, height, shadow, api }) => {
  const gltf = useGLTF(url, false, false) as unknown as { scene: THREE.Object3D };
  const ual = readGltf(RIG_URL); // throws a promise while loading (Suspense) or the error (-> static fallback)
  const { wrap, mixer } = useMemo(() => {
    const o = skeletonClone(gltf.scene);
    const wrap = new THREE.Group(); wrap.add(o); wrap.scale.setScalar(height / 1.82);
    prep(o, shadow);
    return { wrap, mixer: new THREE.AnimationMixer(o) };
  }, [gltf, height, shadow]);
  const cur = useRef<THREE.AnimationAction | null>(null);
  const once = useRef(false);
  useEffect(() => {
    const onFin = (e: { action: THREE.AnimationAction }) => { if (once.current && e.action === cur.current) { once.current = false; api.current.onFinished?.(); } };
    mixer.addEventListener('finished', onFin as never);
    api.current.play = (name, o) => {
      const clip = THREE.AnimationClip.findByName(ual.animations, name) ?? THREE.AnimationClip.findByName(ual.animations, 'Idle_Loop');
      if (!clip) return;
      const next = mixer.clipAction(clip);
      if (next === cur.current && !o) return;
      next.reset().setLoop(o ? THREE.LoopOnce : THREE.LoopRepeat, o ? 1 : Infinity); next.clampWhenFinished = o; once.current = o;
      next.play(); if (cur.current && cur.current !== next) cur.current.crossFadeTo(next, 0.25, false); else next.fadeIn(0.25);
      cur.current = next;
    };
    api.current.play('Idle_Loop', false); mixer.update(Math.random() * 3);
    return () => { mixer.removeEventListener('finished', onFin as never); mixer.stopAllAction(); mixer.uncacheRoot(wrap.children[0]); api.current.play = () => {}; };
  }, [mixer, ual, wrap, api]);
  useFrame((state, dt) => {
    wrap.updateWorldMatrix(true, false);
    const e = wrap.matrixWorld.elements;
    if (!inView(e[12], e[13] + 0.9, e[14])) return; // freeze when off-screen
    mixer.update(Math.min(dt, 0.1));
  });
  return <primitive object={wrap} />;
};

const rnd = (a: number, b: number) => a + Math.random() * (b - a);
type Mode = 'idle' | 'walk' | 'act';
interface Beh {
  mode: Mode; path: Float32Array | null; pi: number; legs: [number, number][]; leg: number; pause: number;
  tExcursion: number; tAct: number; cooldown: number; yaw: number; x: number; z: number; clip: string;
}

/** per-figure excursion legs (world coords on the figure's floor) */
const LEGS: Record<string, [number, number][]> = {
  open_arms: [[6.4, 19.0], [11, 18.4], [0.4, 15.5]],
  professional: [[14.5, 18.4]],
  teacher: [[9.3, 10.4]],
};

const Figure: React.FC<{ f: FigureSpot; quality: Quality }> = ({ f, quality }) => {
  const rigUrl = `${ROOT}rigged/${f.file}_rigged.glb`, staticUrl = USE_RIG ? `${ROOT}${f.file}.glb` : `${ORIGINAL}${f.file}.glb`;
  const rigExists = useExists(rigUrl), staticOk = useExists(staticUrl); const rigOk = USE_RIG ? rigExists : false;
  const g = useRef<THREE.Group>(null!);
  const api = useRef<Api>({ play: () => {}, onFinished: null });
  const [chip, setChip] = useState(false);
  const hover = useRef(false), shown = useRef(false);
  const b = useRef<Beh>({ mode: 'idle', path: null, pi: 0, legs: [], leg: 0, pause: 0, tExcursion: rnd(10, 25), tAct: rnd(6, 14), cooldown: 0, yaw: f.yaw, x: f.hx, z: f.hz, clip: '' });
  const y0 = f.floor * FLOOR_H + FT;
  const setClip = (c: string, once = false) => { if (b.current.clip !== c || once) { b.current.clip = c; api.current.play(c, once); } };
  useEffect(() => { api.current.onFinished = () => { b.current.mode = 'idle'; b.current.clip = ''; }; return () => { figWalk.delete(f.id); moveFigure(f, f.hx, f.hz); }; }, [f]);

  const startLeg = (x: number, z: number): boolean => {
    const s = b.current, p = findPath(f.floor, s.x, s.z, x, z);
    if (!p || p.length < 4) return false;
    s.path = p; s.pi = 1; s.mode = 'walk'; return true;
  };
  const startExcursion = () => {
    const s = b.current; s.legs = [...(LEGS[f.id] ?? []), [f.hx, f.hz]]; s.leg = 0;
    if (!startLeg(s.legs[0][0], s.legs[0][1])) { s.legs = []; s.tExcursion = rnd(20, 40); }
  };

  const lod = useRef({ shadow: true, shown: true });
  const shadowOn = quality !== 'low';
  useFrame((state, dt0) => {
    const s = b.current, dt = Math.min(dt0, 0.1);
    const pd = live.playerFloor === f.floor ? Math.hypot(live.player.x - s.x, live.player.z - s.z) : 99;
    const want = pd < 4 || hover.current;
    if (want !== shown.current) { shown.current = want; setChip(want); }
    s.cooldown -= dt;
    if (!USE_RIG) { // static original model: face the player when greeting, gentle breathing sway, no walking
      let ty = f.yaw; if (f.id === 'open_arms' && pd < 3) ty = Math.atan2(live.player.x - s.x, live.player.z - s.z);
      let dy = ty - s.yaw; dy -= Math.PI * 2 * Math.round(dy / (Math.PI * 2)); s.yaw += dy * Math.min(1, dt * 3);
      const t = state.clock.elapsedTime;
      if (g.current) {
        g.current.position.set(s.x, y0 + Math.sin(t * 1.6 + f.hx) * 0.006, s.z); g.current.rotation.set(0, s.yaw, Math.sin(t * 0.8 + f.hz) * 0.006);
        const cam = state.camera.position, dd = Math.hypot(cam.x - s.x, cam.y - (y0 + 1), cam.z - s.z);
        const above = cityStore.get().cameraMode === 'cutaway' && cam.y > y0 + FLOOR_H + 1; // looking down onto a lower floor's ceiling slab
        const vis = !above && (dd < 3 || inView(s.x, y0 + 0.9, s.z)); if (vis !== lod.current.shown) { lod.current.shown = vis; g.current.visible = vis; }
        const sh = dd < 10; if (sh !== lod.current.shadow && shadowOn) { lod.current.shadow = sh; g.current.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = sh; }); }
      }
      return;
    }
    if (s.mode === 'walk' && s.path) {
      const p = s.path, n = p.length >> 1, dx = p[s.pi * 2] - s.x, dz = p[s.pi * 2 + 1] - s.z, d = Math.hypot(dx, dz), last = s.pi === n - 1;
      if (d < (last ? 0.08 : 0.25)) {
        if (!last) s.pi++;
        else { // leg finished: pause, then the next leg (or home)
          s.path = null; s.leg++; s.mode = 'idle'; s.pause = s.leg < s.legs.length ? rnd(1.5, 3) : 0;
          if (s.leg >= s.legs.length) { s.legs = []; s.x = f.hx; s.z = f.hz; }
        }
      } else {
        const des = Math.atan2(dx, dz); let diff = des - s.yaw; diff -= Math.PI * 2 * Math.round(diff / (Math.PI * 2));
        s.yaw += Math.abs(diff) < 7 * dt ? diff : Math.sign(diff) * 7 * dt;
        const step = Math.min(d, 1.0 * (1 - Math.min(0.6, Math.abs(diff) / 1.8)) * dt);
        s.x += (dx / d) * step; s.z += (dz / d) * step;
        setClip('Walk_Loop');
      }
    } else {
      if (s.mode === 'idle') setClip('Idle_Loop');
      let targetYaw = f.yaw;
      if (s.legs.length === 0) { // at home
        if (f.id === 'open_arms' && pd < 3) { // greeter turns to the player and gestures once
          targetYaw = Math.atan2(live.player.x - s.x, live.player.z - s.z);
          if (s.mode === 'idle' && s.cooldown <= 0) { s.mode = 'act'; s.cooldown = 14; setClip('Interact', true); }
        }
        s.tExcursion -= dt;
        const react = f.id === 'professional' && s.cooldown <= 0 && (pd < 4 || nearestAgentDist(f.floor, s.x, s.z) < 4) && s.tExcursion < 20;
        if (s.mode === 'idle' && (s.tExcursion <= 0 || react)) {
          if (react) s.cooldown = 25;
          if (!(f.id === 'open_arms' && pd < 3)) { startExcursion(); s.tExcursion = f.id === 'teacher' ? rnd(60, 90) : f.id === 'open_arms' ? rnd(20, 40) : rnd(30, 60); }
        }
        if (f.id === 'teacher') { s.tAct -= dt; if (s.mode === 'idle' && s.tAct <= 0) { s.mode = 'act'; s.tAct = rnd(15, 25); setClip('Interact', true); } }
      } else if (s.mode === 'idle') { // pause between legs
        s.pause -= dt; if (s.pause <= 0 && s.leg < s.legs.length && !startLeg(s.legs[s.leg][0], s.legs[s.leg][1])) { s.legs = []; s.x = f.hx; s.z = f.hz; }
      }
      let diff = targetYaw - s.yaw; diff -= Math.PI * 2 * Math.round(diff / (Math.PI * 2)); s.yaw += diff * Math.min(1, dt * 4);
    }
    figWalk.set(f.id, s.mode === 'walk' ? 1 : 0);
    if (g.current) {
      g.current.position.set(s.x, y0, s.z); g.current.rotation.y = s.yaw;
      // perf LOD: skinned bounds are unreliable (frustumCulled=false) so cull by hand, and drop the shadow pass when far from the camera
      const cam = state.camera.position, dd = Math.hypot(cam.x - s.x, cam.y - (y0 + 1), cam.z - s.z);
      const vis = dd < 3 || inView(s.x, y0 + 0.9, s.z);
      const sh = dd < 24;
      if (vis !== lod.current.shown) { lod.current.shown = vis; g.current.visible = vis; }
      if (sh !== lod.current.shadow && shadowOn) { lod.current.shadow = sh; g.current.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = sh; }); }
    }
    if (s.x !== f.x || s.z !== f.z) moveFigure(f, s.x, s.z);
  });

  if (rigOk === null || staticOk === null) return null;
  const shadow = quality !== 'low';
  const staticFb = staticOk ? <Boundary><Suspense fallback={null}><StaticModel url={staticUrl} height={f.height} shadow={shadow} /></Suspense></Boundary> : null;
  return (
    <group ref={g} position={[f.hx, y0, f.hz]} rotation={[0, f.yaw, 0]}
      onPointerOver={(e) => { e.stopPropagation(); hover.current = true; }} onPointerOut={() => { hover.current = false; }}>
      {rigOk ? <Boundary fallback={staticFb}><Suspense fallback={null}><RigModel url={rigUrl} height={f.height} shadow={shadow} api={api} /></Suspense></Boundary> : staticFb}
      {chip && (
        <Html position={[0, f.height + 0.3, 0]} center distanceFactor={9} zIndexRange={[20, 0]} style={{ pointerEvents: 'none' }}>
          <div style={{ padding: '2px 8px', borderRadius: 8, background: 'rgba(12,28,26,0.88)', color: '#fff', font: '600 11px system-ui', whiteSpace: 'nowrap' }}>{f.label}</div>
        </Html>
      )}
    </group>
  );
};

/** Mount only figures on visible/near floors; hidden on low quality. Unmounted = frozen (no mixer cost). */
export const FiguresLayer: React.FC<{ sel: number | null; quality: Quality; near: boolean }> = ({ sel, quality, near }) => {
  // the original models are heavy (~450k tris, 4x2048 textures each): only mount a figure while the camera is within MOUNT_IN metres
  const [close, setClose] = useState<Set<string>>(() => new Set());
  const acc = useRef(0);
  useFrame((state, dt) => {
    acc.current += dt; if (acc.current < 0.4) return; acc.current = 0;
    const c = state.camera.position; const next = new Set<string>();
    for (const f of FIGURES) { const d = Math.hypot(c.x - f.x, c.y - (f.floor * FLOOR_H + FT), c.z - f.z); if (d < (close.has(f.id) ? MOUNT_OUT : MOUNT_IN)) next.add(f.id); }
    if (next.size !== close.size || [...next].some((k) => !close.has(k))) setClose(next);
  });
  if (quality === 'low') return null;
  return <>{FIGURES.filter((f) => (USE_RIG || close.has(f.id)) && (sel === null || sel >= f.floor) && (sel === f.floor || near)).map((f) => <Figure key={f.id} f={f} quality={quality} />)}</>;
};
const MOUNT_IN = 42, MOUNT_OUT = 55;
