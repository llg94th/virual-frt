/**
 * City3D characters: procedural low-poly humanoids, instanced pedestrian crowd, third-person player.
 * No asset files. Geometries/materials are shared through module-level caches.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { createPortal, useFrame, useThree } from '@react-three/fiber';
import { Billboard, Text } from '@react-three/drei';
import {
  CITY_EXTENT, ROAD_LINES, ROAD_W, SIDEWALK_W, live, mulberry32, useCity,
} from '../shared';
import { cityStore, interior, TOWER_FLOORS, TOWER_FOOTPRINT } from '../shared';
import type { CharacterAppearance, CharacterPose } from '../shared';
import { safeTop } from './color';
import { buildGrid, pushOut, resolveGrid } from './walk';
import type { Grid } from './walk';
import { J, HIP_Y, tgt, computeTarget } from './pose';
import { FarHost, farEntries, joinFar, useFarLeader, makeFarColors, FAR_IN } from './far';
import type { FarEntry } from './far';
import { RpmCharacter, rpmKindFor } from './rpm';
import { OfficeCharacter, MeshyCharacter, npcKindFor, RiggedCharacter, RigBoundary, ensureRigAsset, useRigStatus, registerRig, rigTick } from './rigged';
import type { RigEntry } from './rigged';

export interface Character3DProps {
  appearance: CharacterAppearance; pose?: CharacterPose; position?: [number, number, number];
  rotationY?: number; scale?: number; label?: string;
  /** Internal: always use the rigged model when available (Player). */
  priority?: boolean;
}

// ---------------------------------------------------------------- caches
const geoCache = new Map<string, THREE.BufferGeometry>();
const geo = (key: string, make: () => THREE.BufferGeometry) => {
  let g = geoCache.get(key);
  if (!g) { g = make(); geoCache.set(key, g); }
  return g;
};
const sph = (r: number, w = 10, h = 8) => geo(`s${r}:${w}:${h}`, () => new THREE.SphereGeometry(r, w, h));
const box = (w: number, h: number, d: number) => geo(`b${w}:${h}:${d}`, () => new THREE.BoxGeometry(w, h, d));
const cyl = (rt: number, rb: number, h: number, seg = 10) => geo(`c${rt}:${rb}:${h}:${seg}`, () => new THREE.CylinderGeometry(rt, rb, h, seg));
const cone = (r: number, h: number, seg = 8) => geo(`n${r}:${h}:${seg}`, () => new THREE.ConeGeometry(r, h, seg));
const cap = (r: number, len: number) => geo(`p${r}:${len}`, () => new THREE.CapsuleGeometry(r, len, 3, 8));
const tor = (r: number, t: number, arc = Math.PI * 2) => geo(`t${r}:${t}:${arc}`, () => new THREE.TorusGeometry(r, t, 6, 14, arc));
const dome = (r: number, frac: number) => geo(`d${r}:${frac}`, () => new THREE.SphereGeometry(r, 10, 6, 0, Math.PI * 2, 0, Math.PI * frac));

const matCache = new Map<string, THREE.MeshStandardMaterial>();
const mat = (color: string, rough = 0.75) => {
  const k = color + rough;
  let m = matCache.get(k);
  if (!m) { m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0.02 }); matCache.set(k, m); }
  return m;
};

type V3 = [number, number, number];
interface MProps { g: THREE.BufferGeometry; c: string; p?: V3; s?: V3 | number; r?: V3; sh?: boolean; rough?: number }
const M: React.FC<MProps> = ({ g, c, p, s, r, sh, rough }) => (
  <mesh geometry={g} material={mat(c, rough)} position={p} scale={s as any} rotation={r} castShadow={sh} />
);

// ---------------------------------------------------------------- appearance
const SKINS = ['#f1c9a5', '#e0b090', '#c68a62', '#a8714a', '#8d5a3b', '#f7d8bd'];
const HAIRS = ['#1a1a1a', '#2b1d12', '#4a3020', '#6b4423', '#9a6b3a', '#c9a35a', '#7a7a7a', '#3a2a6a'];
const STYLES: CharacterAppearance['hairStyle'][] = ['short', 'short', 'long', 'bun', 'cap', 'bald', 'short', 'long'];
const CASUAL = ['#2a9d8f', '#4895ef', '#9d4edd', '#6c8ebf', '#3d7a5f', '#adb5bd', '#c0392b', '#2563eb', '#7c6fd6', '#d1d5db'];
const BOTTOMS = ['#1f2937', '#374151', '#1e3a8a', '#44403c', '#0f172a', '#6b7280', '#7c5a3a'];
const SHOES = ['#111111', '#f3f4f6', '#3b2a20', '#1f2937', '#b91c1c'];
const MASCOTS = ['longchau', 'doraemon', 'luffy', 'zoro', 'nami', 'sanji', 'chopper', 'usopp'] as const;

function hashStr(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

export const appearanceFor = (id: string, role?: string): CharacterAppearance => {
  const lower = id.toLowerCase();
  for (const m of MASCOTS) {
    if (lower === m || lower.includes(`mascot-${m}`) || lower.includes(`mascot_${m}`) || lower.endsWith(`:${m}`)) {
      return { skin: '#f1c9a5', hair: '#222', hairStyle: 'short', top: '#fff', bottom: '#333', shoes: '#111', mascot: m };
    }
  }
  const rnd = mulberry32(hashStr(id + '|' + (role ?? '')));
  const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)];
  const R = (role ?? '').toUpperCase();
  const a: CharacterAppearance = {
    skin: pick(SKINS), hair: pick(HAIRS), hairStyle: pick(STYLES), top: pick(CASUAL), bottom: pick(BOTTOMS),
    shoes: pick(SHOES), accessory: 'none', height: 1.6 + rnd() * 0.28,
  };
  if (R.includes('BACKEND')) { a.top = pick(['#1f2937', '#0f172a', '#334155']); a.accessory = 'headset'; }
  else if (R.includes('FRONTEND')) { a.top = pick(['#6d28d9', '#7c3aed', '#be185d']); a.accessory = rnd() < 0.5 ? 'glasses' : 'none'; }
  else if (R.includes('MOBILE')) { a.top = pick(['#0891b2', '#0e7490', '#059669']); a.accessory = 'headset'; }
  else if (R.includes('QA') || R.includes('DEVOPS')) { a.top = pick(['#f97316', '#facc15', '#fb923c']); a.accessory = 'badge'; }
  else if (R.includes('PM') || R.includes('BA')) { a.top = pick(['#1e3a5f', '#374151', '#4c1d3b']); a.bottom = '#111827'; a.shoes = '#111111'; a.accessory = 'badge'; }
  else if (R.includes('TECH') || R.includes('LEAD')) { a.top = pick(['#e5e7eb', '#bfdbfe', '#d1d5db']); a.accessory = 'glasses'; }
  a.top = safeTop(a.top, a.skin);
  return a;
};

// ---------------------------------------------------------------- resolved config (mascots)
interface Cfg extends CharacterAppearance {
  hand?: string; headScale: number; fat: number; noEyes?: boolean; hairHidden?: boolean; hatHeight: number;
}
function resolve(a: CharacterAppearance): Cfg {
  const base: Cfg = { ...a, headScale: 1, fat: 1, hatHeight: 0, height: a.height ?? 1.75, accessory: a.accessory ?? 'none' };
  switch (a.mascot) {
    case 'longchau': return { ...base, skin: '#f6d3b5', hair: '#222', hairStyle: 'short', top: '#ffffff', bottom: '#0052cc', shoes: '#0052cc', hairHidden: true, height: a.height ?? 1.7 };
    case 'doraemon': return { ...base, skin: '#0096d6', hand: '#ffffff', hair: '#0096d6', hairStyle: 'bald', top: '#0096d6', bottom: '#0096d6', shoes: '#ffffff', noEyes: true, headScale: 1.35, fat: 1.35, height: a.height ?? 1.3 };
    case 'luffy': return { ...base, skin: '#f0c090', hair: '#111', hairStyle: 'short', top: '#c0272d', bottom: '#2b5fb5', shoes: '#c8a165', height: a.height ?? 1.72 };
    case 'zoro': return { ...base, skin: '#e2b184', hair: '#3f9a2a', hairStyle: 'short', top: '#f2f2f2', bottom: '#1c1c1c', shoes: '#111', height: a.height ?? 1.82 };
    case 'nami': return { ...base, skin: '#f6d0ae', hair: '#ff8a1e', hairStyle: 'long', top: '#38bdf8', bottom: '#2563eb', shoes: '#8b5a2b', height: a.height ?? 1.68 };
    case 'sanji': return { ...base, skin: '#f1c9a5', hair: '#f5d76e', hairStyle: 'short', top: '#1b1b1b', bottom: '#1b1b1b', shoes: '#050505', height: a.height ?? 1.84 };
    case 'chopper': return { ...base, skin: '#a56a3a', hair: '#a56a3a', hairStyle: 'bald', top: '#a56a3a', bottom: '#2f6fb3', shoes: '#a56a3a', headScale: 1.55, fat: 1.2, hairHidden: true, height: a.height ?? 1.0 };
    case 'usopp': return { ...base, skin: '#b87a4b', hair: '#1c1c1c', hairStyle: 'short', top: '#e8e8e8', bottom: '#f59e0b', shoes: '#5b3a1e', height: a.height ?? 1.8 };
    default: return base;
  }
}

// ---------------------------------------------------------------- Character3D
const nodeRef = <T extends THREE.Object3D>() => React.createRef<T>();

const ProceduralCharacter: React.FC<Character3DProps> = ({ appearance, pose = 'idle', position, rotationY = 0, scale = 1, label }) => {
  const quality = useCity((s) => s.quality);
  const cfg = useMemo(() => resolve(appearance), [appearance]);
  const k = (cfg.height ?? 1.75) / 1.75 * scale;
  const shadow = quality !== 'low';
  const refs = useRef({
    root: nodeRef<THREE.Group>(), hips: nodeRef<THREE.Group>(), spine: nodeRef<THREE.Group>(), head: nodeRef<THREE.Group>(),
    lTh: nodeRef<THREE.Group>(), rTh: nodeRef<THREE.Group>(), lKn: nodeRef<THREE.Group>(), rKn: nodeRef<THREE.Group>(),
    lAr: nodeRef<THREE.Group>(), rAr: nodeRef<THREE.Group>(), lEl: nodeRef<THREE.Group>(), rEl: nodeRef<THREE.Group>(),
    chest: nodeRef<THREE.Group>(),
  }).current;
  const cur = useRef<Float32Array>(null as any);
  if (!cur.current) { cur.current = new Float32Array(J.N); cur.current[J.HY] = HIP_Y; }
  const st = useRef({ ph: 0, n: 0, acc: 0, off: Math.random() * 100, near: false, t: Math.random() * 50 });
  const [near, setNear] = useState(false);
  const poseRef = useRef(pose); poseRef.current = pose;
  const hasLabel = !!label;

  useFrame((state, dtRaw) => {
    const s = st.current, r = refs;
    const root = r.root.current; if (!root) return;
    const e = root.matrixWorld.elements;
    const dx = state.camera.position.x - e[12], dz = state.camera.position.z - e[14];
    const d2 = dx * dx + dz * dz;
    const far = d2 > 100 * 100;
    s.acc += dtRaw;
    if (far && (++s.n & 3) !== 0) return;
    const dt = Math.min(s.acc, 0.1); s.acc = 0;
    s.t += dt;
    if (hasLabel && (s.n++ & 7) === 0) { const nn = d2 < 40 * 40; if (nn !== s.near) { s.near = nn; setNear(nn); } }
    const p = poseRef.current;
    s.ph += dt * (p === 'run' ? 11 : p === 'walk' ? 7 : 0);
    computeTarget(p, s.ph, s.t, s.off);
    const c = cur.current, a = 1 - Math.exp(-dt * 12);
    for (let i = 0; i < J.N; i++) c[i] += (tgt[i] - c[i]) * a;
    const hips = r.hips.current!;
    hips.position.y = c[J.HY]; hips.position.z = p === 'sit' || p === 'type' || p === 'drive' ? -0.08 : 0; hips.rotation.z = c[J.HZ] * 0.3;
    r.spine.current!.rotation.x = c[J.SPX];
    r.chest.current!.scale.set(1 + c[J.BRE], 1 + c[J.BRE] * 1.5, 1 + c[J.BRE]);
    const hd = r.head.current!; hd.rotation.x = c[J.HDX]; hd.rotation.y = c[J.HDY];
    r.lTh.current!.rotation.x = c[J.LTH]; r.rTh.current!.rotation.x = c[J.RTH];
    r.lKn.current!.rotation.x = c[J.LKN]; r.rKn.current!.rotation.x = c[J.RKN];
    const la = r.lAr.current!, ra = r.rAr.current!;
    la.rotation.x = c[J.LAX]; ra.rotation.x = c[J.RAX]; la.rotation.z = c[J.LAZ]; ra.rotation.z = c[J.RAZ];
    r.lEl.current!.rotation.x = c[J.LEL]; r.rEl.current!.rotation.x = c[J.REL];
  });

  const fat = cfg.fat;
  const handC = cfg.hand ?? cfg.skin;
  const eyeY = 0.01;
  return (
    <group ref={refs.root} position={position} rotation-y={rotationY} scale={k}>
      <group ref={refs.hips} position={[0, HIP_Y, 0]}>
        {/* legs */}
        {([-1, 1] as const).map((sd) => {
          const left = sd === 1;
          return (
            <group key={sd} ref={left ? refs.lTh : refs.rTh} position={[sd * 0.09 * fat, 0, 0]}>
              <M g={cap(0.07 * (fat > 1 ? 1.15 : 1), 0.26)} c={cfg.bottom} p={[0, -0.215, 0]} sh={shadow} />
              <group ref={left ? refs.lKn : refs.rKn} position={[0, -0.43, 0]}>
                <M g={cap(0.06, 0.26)} c={cfg.mascot === 'doraemon' || cfg.mascot === 'chopper' ? cfg.bottom : cfg.bottom} p={[0, -0.215, 0]} sh={shadow} />
                <M g={box(0.1, 0.07, 0.2)} c={cfg.shoes} p={[0, -0.41, 0.04]} sh={shadow} />
              </group>
            </group>
          );
        })}
        {/* extras attached at hips (swords etc.) */}
        {cfg.mascot === 'zoro' && (
          <group position={[0.2, 0.04, 0.02]} rotation={[0.3, 0, 1.25]}>
            {[0, 1, 2].map((i) => (
              <group key={i} position={[0, 0, (i - 1) * 0.03]}>
                <M g={cyl(0.013, 0.013, 0.85, 6)} c="#1f1f1f" p={[0, -0.42, 0]} />
                <M g={cyl(0.016, 0.016, 0.14, 6)} c={i === 0 ? '#ffffff' : '#2e7d32'} p={[0, 0.07, 0]} />
              </group>
            ))}
          </group>
        )}
        <group ref={refs.spine}>
          <group ref={refs.chest}>
            <M g={cap(0.14, 0.3)} c={cfg.top} p={[0, 0.27, 0]} s={[1.15 * fat, 1, 0.78 * fat]} sh={shadow} />
          </group>
          <TorsoExtras c={cfg} />
          {/* head */}
          <group ref={refs.head} position={[0, 0.58, 0]}>
            <group position={[0, 0.13 * cfg.headScale, 0]} scale={cfg.headScale}>
              <M g={sph(0.12)} c={cfg.skin} s={[0.95, 1.05, 1]} sh={shadow} />
              {!cfg.noEyes && (
                <>
                  <M g={sph(0.014, 6, 5)} c="#111" p={[0.04, eyeY, 0.112]} />
                  <M g={sph(0.014, 6, 5)} c="#111" p={[-0.04, eyeY, 0.112]} />
                </>
              )}
              {!cfg.hairHidden && <Hair c={cfg} />}
              <Accessory c={cfg} />
              <HeadExtras c={cfg} />
            </group>
          </group>
          {/* arms */}
          {([-1, 1] as const).map((sd) => {
            const left = sd === 1;
            return (
              <group key={sd} ref={left ? refs.lAr : refs.rAr} position={[sd * 0.2 * fat, 0.5, 0]}>
                <M g={cap(0.05, 0.22)} c={cfg.top} p={[0, -0.15, 0]} sh={shadow} />
                <group ref={left ? refs.lEl : refs.rEl} position={[0, -0.3, 0]}>
                  <M g={cap(0.045, 0.2)} c={cfg.mascot === 'luffy' || cfg.mascot === 'nami' ? cfg.skin : cfg.top} p={[0, -0.13, 0]} sh={shadow} />
                  <M g={sph(0.05, 8, 6)} c={handC} p={[0, -0.29, 0]} />
                </group>
              </group>
            );
          })}
        </group>
      </group>
      {label && near && (
        <Billboard position={[0, 1.95, 0]}>
          <Text fontSize={0.16} color="#ffffff" outlineWidth={0.015} outlineColor="#000000" anchorY="bottom">{label}</Text>
        </Billboard>
      )}
    </group>
  );
};

// ---------------------------------------------------------------- Character3D (rigged when near, procedural otherwise)
export const Character3D: React.FC<Character3DProps> = (props) => {
  const { appearance, pose = 'idle', position, rotationY = 0, scale = 1, priority = false, label } = props;
  const quality = useCity((s) => s.quality);
  const rigStatus = useRigStatus();
  const eligible = !appearance.mascot || appearance.mascot === 'none';
  const want = eligible && (priority || quality !== 'low');
  useEffect(() => { if (want) ensureRigAsset(); }, [want]);
  const outer = useRef<THREE.Group>(null);
  const entry = useMemo<RigEntry>(() => ({ dist: 1e9, priority, allowed: priority }), [priority]);
  const [on, setOn] = useState(false);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => (want ? registerRig(entry) : undefined), [want, entry]);
  const tmp = useMemo(() => new THREE.Vector3(), []);
  // far LOD (shared instanced rendering, see far.tsx)
  const farOk = eligible; // mascots stay procedural
  const token = useMemo(() => ({}), []);
  const fe = useMemo<FarEntry>(() => ({ active: false, pose, dist: 0, k: 1, m: new Float32Array(16), cols: new Float32Array(15) }), []); // eslint-disable-line react-hooks/exhaustive-deps
  const { scene } = useThree();
  const leader = useFarLeader(token);
  const [isFar, setFar] = useState(false);
  const farRef = useRef(false);
  useEffect(() => { if (!farOk) return; farEntries.add(fe); const un = joinFar(token); return () => { farEntries.delete(fe); un(); }; }, [farOk, fe, token]);
  useEffect(() => { makeFarColors(appearance, fe.cols); }, [appearance, fe]);
  fe.pose = pose; fe.k = (appearance.height ?? 1.75) / 1.75;
  const rigShown = useRef(false);
  useFrame((state) => {
    const g = outer.current; if (!g) return;
    g.getWorldPosition(tmp);
    const dist = Math.hypot(state.camera.position.x - tmp.x, state.camera.position.z - tmp.z);
    if (farOk) {
      const wf = !priority && (farRef.current ? dist > FAR_IN - 3 : dist > FAR_IN);
      if (wf !== farRef.current) { farRef.current = wf; setFar(wf); }
      fe.dist = dist; fe.m.set(g.matrixWorld.elements);
      fe.active = wf && !rigShown.current;
    }
    if (!want || rigStatus !== 'ready') return;
    entry.dist = priority ? 0 : dist;
    rigTick(state.camera, state.gl.info.render.frame, performance.now());
    if (entry.allowed !== on) setOn(entry.allowed);
  });
  const useRig = want && rigStatus === 'ready' && on && !failed;
  useEffect(() => { if (!useRig) setReady(false); }, [useRig]);
  const showRig = useRig && ready;
  rigShown.current = showRig;
  const height = appearance.height ?? 1.75;
  const procProps = { appearance, pose, label, position: undefined, rotationY: 0, scale: 1 };
  return (
    <group ref={outer} position={position} rotation-y={rotationY} scale={scale}>
      {leader && farOk && createPortal(<FarHost />, scene)}
      {!showRig && !(isFar && farOk) && <ProceduralCharacter {...procProps} />}
      {useRig && (
        <RigBoundary fallback={
          <RigBoundary fatal onError={() => setFailed(true)}>
            <React.Suspense fallback={null}>
              <group visible={ready}>
                <RiggedCharacter appearance={appearance} pose={pose} height={height} castShadow={quality !== 'low' || priority}
                  onReady={() => setReady(true)} speed={priority ? live.player.speed : undefined} />
              </group>
            </React.Suspense>
          </RigBoundary>}>
          <React.Suspense fallback={null}>
            <group visible={ready}>
              {NPC_MESHY && !priority ? (
                <RigBoundary fallback={<OfficeCharacter appearance={appearance} pose={pose} height={height} castShadow={quality !== 'low'} onReady={() => setReady(true)} />}>
                  <RpmCharacter kind={rpmKindFor(appearance)} appearance={appearance} pose={pose} height={height} castShadow={quality !== 'low'} onReady={() => setReady(true)} />
                </RigBoundary>
              ) : (
                <OfficeCharacter appearance={appearance} pose={pose} height={height} castShadow={quality !== 'low' || priority}
                  onReady={() => setReady(true)} speed={priority ? live.player.speed : undefined} />
              )}
            </group>
          </React.Suspense>
        </RigBoundary>
      )}
    </group>
  );
};

// ---------------------------------------------------------------- Hair & accessories (head-centre local coords)
const Hair: React.FC<{ c: Cfg }> = ({ c }) => {
  switch (c.hairStyle) {
    case 'bald': return null;
    case 'long': return (<>
      <M g={dome(0.13, 0.6)} c={c.hair} p={[0, 0.005, -0.005]} />
      <M g={box(0.25, 0.34, 0.09)} c={c.hair} p={[0, -0.07, -0.085]} />
    </>);
    case 'bun': return (<>
      <M g={dome(0.13, 0.6)} c={c.hair} p={[0, 0.005, -0.005]} />
      <M g={sph(0.06, 8, 6)} c={c.hair} p={[0, 0.15, -0.06]} />
    </>);
    case 'cap': return (<>
      <M g={dome(0.135, 0.55)} c={c.hair} p={[0, 0.01, 0]} />
      <M g={box(0.2, 0.016, 0.12)} c={c.hair} p={[0, 0.03, 0.14]} />
    </>);
    default: return <M g={dome(0.13, 0.58)} c={c.hair} p={[0, 0.005, -0.005]} />;
  }
};

const Accessory: React.FC<{ c: Cfg }> = ({ c }) => {
  if (c.accessory === 'glasses') return (<>
    <M g={tor(0.028, 0.006)} c="#111" p={[0.045, 0.01, 0.118]} />
    <M g={tor(0.028, 0.006)} c="#111" p={[-0.045, 0.01, 0.118]} />
    <M g={box(0.03, 0.006, 0.006)} c="#111" p={[0, 0.015, 0.12]} />
  </>);
  if (c.accessory === 'headset') return (<>
    <M g={tor(0.13, 0.01, Math.PI)} c="#222" r={[0, 0, 0]} p={[0, 0, 0]} />
    <M g={cyl(0.035, 0.035, 0.03, 8)} c="#222" p={[0.13, 0, 0]} r={[0, 0, Math.PI / 2]} />
    <M g={cyl(0.035, 0.035, 0.03, 8)} c="#222" p={[-0.13, 0, 0]} r={[0, 0, Math.PI / 2]} />
    <M g={box(0.01, 0.01, 0.1)} c="#222" p={[0.1, -0.06, 0.07]} r={[0, -0.6, 0]} />
  </>);
  return null;
};

const HeadExtras: React.FC<{ c: Cfg }> = ({ c }) => {
  switch (c.mascot) {
    case 'longchau': return (<>
      <M g={cyl(0.125, 0.13, 0.07, 12)} c="#0052cc" p={[0, 0.115, 0]} />
      <M g={box(0.2, 0.014, 0.1)} c="#0052cc" p={[0, 0.085, 0.13]} />
      <M g={box(0.05, 0.016, 0.012)} c="#10b981" p={[0, 0.12, 0.128]} />
      <M g={box(0.016, 0.05, 0.012)} c="#10b981" p={[0, 0.12, 0.128]} />
    </>);
    case 'doraemon': return (<>
      <M g={sph(0.1, 12, 8)} c="#ffffff" p={[0, -0.015, 0.06]} s={[1, 0.95, 0.65]} />
      <M g={sph(0.03, 8, 6)} c="#fff" p={[0.032, 0.07, 0.1]} s={[1, 1.2, 0.5]} />
      <M g={sph(0.03, 8, 6)} c="#fff" p={[-0.032, 0.07, 0.1]} s={[1, 1.2, 0.5]} />
      <M g={sph(0.01, 6, 5)} c="#111" p={[0.025, 0.07, 0.12]} />
      <M g={sph(0.01, 6, 5)} c="#111" p={[-0.025, 0.07, 0.12]} />
      <M g={sph(0.022, 8, 6)} c="#e11d48" p={[0, 0.03, 0.125]} />
      <M g={box(0.005, 0.05, 0.004)} c="#111" p={[0, -0.01, 0.122]} />
      <M g={box(0.09, 0.005, 0.004)} c="#111" p={[0, -0.04, 0.118]} />
      {[-1, 1].map((sd) => [0.015, 0.0, -0.015].map((y, i) => (
        <M key={`${sd}${i}`} g={box(0.07, 0.003, 0.003)} c="#111" p={[sd * 0.085, 0.015 + y, 0.12]} r={[0, 0, sd * (y * 6)]} />
      )))}
      <M g={tor(0.095, 0.02)} c="#e11d48" p={[0, -0.12, 0]} r={[Math.PI / 2, 0, 0]} />
      <M g={sph(0.03, 8, 6)} c="#facc15" p={[0, -0.16, 0.095]} />
    </>);
    case 'chopper': return (<>
      <M g={sph(0.022, 8, 6)} c="#3b82f6" p={[0, -0.005, 0.12]} />
      <M g={sph(0.014, 6, 5)} c="#111" p={[0.04, 0.03, 0.11]} />
      <M g={sph(0.014, 6, 5)} c="#111" p={[-0.04, 0.03, 0.11]} />
      <M g={cyl(0.1, 0.125, 0.1, 12)} c="#ff7fa8" p={[0, 0.15, 0]} />
      <M g={box(0.05, 0.015, 0.01)} c="#fff" p={[0, 0.16, 0.115]} />
      <M g={box(0.015, 0.05, 0.01)} c="#fff" p={[0, 0.16, 0.115]} />
      <M g={cone(0.025, 0.14, 6)} c="#e6d3a3" p={[0.085, 0.24, 0]} r={[0, 0, -0.45]} />
      <M g={cone(0.025, 0.14, 6)} c="#e6d3a3" p={[-0.085, 0.24, 0]} r={[0, 0, 0.45]} />
    </>);
    case 'luffy': return (<>
      <M g={cyl(0.27, 0.27, 0.014, 16)} c="#f2cf5b" p={[0, 0.09, 0]} />
      <M g={dome(0.14, 0.5)} c="#f2cf5b" p={[0, 0.09, 0]} />
      <M g={cyl(0.143, 0.143, 0.035, 14)} c="#c0272d" p={[0, 0.105, 0]} />
      <M g={box(0.02, 0.006, 0.006)} c="#7a2a2a" p={[0.045, -0.035, 0.115]} />
    </>);
    case 'zoro': return (<>
      <M g={sph(0.009, 6, 5)} c="#facc15" p={[0.118, -0.02, 0]} />
      <M g={sph(0.009, 6, 5)} c="#facc15" p={[0.118, -0.045, 0]} />
      <M g={sph(0.009, 6, 5)} c="#facc15" p={[0.118, -0.07, 0]} />
      <M g={box(0.03, 0.006, 0.006)} c="#111" p={[0.04, 0.035, 0.115]} r={[0, 0, -0.3]} />
      <M g={box(0.03, 0.006, 0.006)} c="#111" p={[-0.04, 0.035, 0.115]} r={[0, 0, 0.3]} />
    </>);
    case 'nami': return (<>
      <M g={box(0.07, 0.1, 0.02)} c="#ff8a1e" p={[-0.04, 0.04, 0.115]} r={[0, 0, 0.2]} />
    </>);
    case 'sanji': return (<>
      <M g={box(0.075, 0.11, 0.02)} c="#f5d76e" p={[0.04, 0.03, 0.115]} r={[0, 0, -0.2]} />
      <M g={cyl(0.005, 0.005, 0.07, 5)} c="#f5f5f5" p={[-0.02, -0.06, 0.14]} r={[Math.PI / 2, 0, 0]} />
      <M g={sph(0.007, 5, 4)} c="#f97316" p={[-0.02, -0.06, 0.178]} />
    </>);
    case 'usopp': return (<>
      <M g={sph(0.14, 8, 6)} c="#1c1c1c" p={[0, 0.06, -0.05]} s={[1.1, 0.8, 1]} />
      <M g={sph(0.045, 7, 5)} c="#1c1c1c" p={[0.1, 0.1, -0.02]} />
      <M g={sph(0.045, 7, 5)} c="#1c1c1c" p={[-0.1, 0.1, -0.02]} />
      <M g={cone(0.02, 0.15, 7)} c={c.skin} p={[0, -0.01, 0.19]} r={[Math.PI / 2, 0, 0]} />
      <M g={cyl(0.128, 0.128, 0.022, 12)} c="#2a2a2a" p={[0, 0.075, 0]} />
      <M g={cyl(0.036, 0.036, 0.03, 10)} c="#facc15" p={[0.045, 0.085, 0.115]} r={[Math.PI / 2, 0, 0]} />
      <M g={cyl(0.036, 0.036, 0.03, 10)} c="#facc15" p={[-0.045, 0.085, 0.115]} r={[Math.PI / 2, 0, 0]} />
    </>);
    default: return null;
  }
};

const TorsoExtras: React.FC<{ c: Cfg }> = ({ c }) => {
  switch (c.mascot) {
    case 'longchau': return (<>
      <M g={box(0.05, 0.014, 0.012)} c="#10b981" p={[0.06, 0.38, 0.107]} />
      <M g={box(0.014, 0.05, 0.012)} c="#10b981" p={[0.06, 0.38, 0.107]} />
      <M g={box(0.02, 0.34, 0.012)} c="#14b8a6" p={[0, 0.27, 0.108]} />
    </>);
    case 'doraemon': return (<>
      <M g={sph(0.115, 10, 8)} c="#ffffff" p={[0, 0.2, 0.065]} s={[1, 1.1, 0.4]} />
      <M g={sph(0.03, 8, 6)} c="#e11d48" p={[0, 0.2, -0.17]} />
      <M g={tor(0.08, 0.016, Math.PI)} c="#e5e7eb" p={[0, 0.17, 0.11]} r={[0, 0, Math.PI]} />
    </>);
    case 'luffy': return (<>
      <M g={box(0.1, 0.3, 0.012)} c="#f0c090" p={[0, 0.28, 0.1]} />
      <M g={box(0.06, 0.01, 0.01)} c="#7a2a2a" p={[0.03, 0.36, 0.108]} r={[0, 0, 0.5]} />
    </>);
    case 'zoro': return (<>
      <M g={cyl(0.15, 0.15, 0.1, 12)} c="#2e7d32" p={[0, 0.07, 0]} s={[1.1, 1, 0.8]} />
    </>);
    case 'nami': return (<>
      <M g={cyl(0.135, 0.135, 0.16, 12)} c="#f6d0ae" p={[0, 0.05, 0]} s={[1.15, 1, 0.78]} />
    </>);
    case 'sanji': return (<>
      <M g={box(0.08, 0.28, 0.012)} c="#60a5fa" p={[0, 0.3, 0.1]} />
      <M g={box(0.02, 0.2, 0.012)} c="#050505" p={[0, 0.3, 0.108]} />
    </>);
    case 'usopp': return (<>
      <M g={box(0.03, 0.4, 0.012)} c="#6b3f1d" p={[0.03, 0.27, 0.105]} r={[0, 0, -0.6]} />
      <M g={box(0.2, 0.05, 0.1)} c="#7c4a21" p={[0.0, -0.04, -0.1]} />
    </>);
    case 'chopper': return (<>
      <M g={cyl(0.1, 0.1, 0.1, 8)} c="#ff7fa8" p={[0, 0.0, 0]} s={[1.2, 1, 0.9]} />
    </>);
    default:
      if (c.accessory === 'badge') return (<>
        <M g={box(0.02, 0.22, 0.01)} c="#2563eb" p={[0, 0.34, 0.1]} />
        <M g={box(0.07, 0.1, 0.01)} c="#ffffff" p={[0, 0.2, 0.11]} />
      </>);
      return null;
  }
};

// ---------------------------------------------------------------- Obstacles
export interface Obstacle { x: number; z: number; w: number; d: number }
type Rect = { minX: number; maxX: number; minZ: number; maxZ: number };
let obstacles: Rect[] = [];
/** Wire building footprints (centre x,z and size w,d; or {minX,maxX,minZ,maxZ}) into player collision. */
export function setObstacles(list: Array<Obstacle | Rect | any>) {
  obstacles = (list ?? []).map((o: any) => 'minX' in o
    ? { minX: o.minX, maxX: o.maxX, minZ: o.minZ, maxZ: o.maxZ }
    : { minX: o.x - o.w / 2, maxX: o.x + o.w / 2, minZ: o.z - o.d / 2, maxZ: o.z + o.d / 2 });
}
/** Camera orbit hint written by dragging the mouse while walking; CameraRig may read it. */
const NPC_MESHY = true; // NPCs use the Quaternius office worker (reliable animation, skin/hair/beard variants); Meshy bodies kept for named figures
export const playerLook = { yaw: 0, pitch: 0.35, dist: 6 };

// ---------------------------------------------------------------- Crowd
const OFF = ROAD_W / 2 + SIDEWALK_W / 2;
const NL = ROAD_LINES.length;
const SIG = 14; // crosswalk signal period (s)

interface Ped {
  i: number; j: number; sx: number; sy: number; // current node
  ni: number; nj: number; nsx: number; nsy: number; // target node
  cross: 0 | 1 | 2; // 0 sidewalk, 1 crossing along x, 2 along y
  t: number; len: number; speed: number; wait: number; lat: number; yaw: number;
  fx: number; fz: number; tx: number; tz: number; sc: number; off: number; run: boolean;
}

function nodePos(i: number, j: number, sx: number, sy: number, lat: number): [number, number] {
  return [ROAD_LINES[i] + sx * (OFF + lat), ROAD_LINES[j] + sy * (OFF + lat)];
}
function pickMove(p: Ped, rnd: () => number) {
  const opts: Array<{ ni: number; nj: number; nsx: number; nsy: number; cross: 0 | 1 | 2; w: number }> = [];
  const i2 = p.i + p.sx, j2 = p.j + p.sy;
  if (i2 >= 0 && i2 < NL) opts.push({ ni: i2, nj: p.j, nsx: -p.sx, nsy: p.sy, cross: 0, w: 4 });
  if (j2 >= 0 && j2 < NL) opts.push({ ni: p.i, nj: j2, nsx: p.sx, nsy: -p.sy, cross: 0, w: 4 });
  opts.push({ ni: p.i, nj: p.j, nsx: -p.sx, nsy: p.sy, cross: 1, w: 1.5 });
  opts.push({ ni: p.i, nj: p.j, nsx: p.sx, nsy: -p.sy, cross: 2, w: 1.5 });
  // avoid immediate reversal
  const pi = (p as any).pi as number | undefined, pj = (p as any).pj as number | undefined, psx = (p as any).psx, psy = (p as any).psy;
  const filtered = opts.filter((o) => !(o.ni === pi && o.nj === pj && o.nsx === psx && o.nsy === psy));
  const use = filtered.length ? filtered : opts;
  let tot = 0; for (const o of use) tot += o.w;
  let r = rnd() * tot;
  let ch = use[0];
  for (const o of use) { r -= o.w; if (r <= 0) { ch = o; break; } }
  (p as any).pi = p.i; (p as any).pj = p.j; (p as any).psx = p.sx; (p as any).psy = p.sy;
  p.ni = ch.ni; p.nj = ch.nj; p.nsx = ch.nsx; p.nsy = ch.nsy; p.cross = ch.cross;
  const [fx, fz] = nodePos(p.i, p.j, p.sx, p.sy, p.lat), [tx, tz] = nodePos(p.ni, p.nj, p.nsx, p.nsy, p.lat);
  p.fx = fx; p.fz = fz; p.tx = tx; p.tz = tz; p.t = 0;
  p.len = Math.max(0.5, Math.hypot(tx - fx, tz - fz));
}
const signalOk = (axis: 1 | 2, time: number) => (Math.floor(time / SIG) % 2 === 0) === (axis === 1);

const COUNT: Record<string, number> = { low: 40, medium: 120, high: 250 };

// instanced part definitions: [geometry, pivot(x,y,z), kind]
type PartKind = 'torso' | 'head' | 'hair' | 'legL' | 'legR' | 'armL' | 'armR' | 'shoeL' | 'shoeR';
const PART_GEOS = (): Record<PartKind, THREE.BufferGeometry> => {
  const t = (g: THREE.BufferGeometry, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1) => { const c = g.clone(); c.scale(sx, sy, sz); c.translate(x, y, z); return c; };
  return {
    torso: t(new THREE.CapsuleGeometry(0.14, 0.3, 2, 6), 0, 0.27, 0, 1.15, 1, 0.78),
    head: t(new THREE.SphereGeometry(0.12, 8, 6), 0, 0.13, 0, 0.95, 1.05, 1),
    hair: t(new THREE.SphereGeometry(0.13, 8, 5, 0, Math.PI * 2, 0, Math.PI * 0.58), 0, 0.135, -0.005),
    legL: t(new THREE.CapsuleGeometry(0.065, 0.66, 2, 5), 0, -0.4, 0),
    legR: t(new THREE.CapsuleGeometry(0.065, 0.66, 2, 5), 0, -0.4, 0),
    armL: t(new THREE.CapsuleGeometry(0.047, 0.5, 2, 5), 0, -0.3, 0),
    armR: t(new THREE.CapsuleGeometry(0.047, 0.5, 2, 5), 0, -0.3, 0),
    shoeL: t(new THREE.BoxGeometry(0.1, 0.07, 0.2), 0, -0.86, 0.04),
    shoeR: t(new THREE.BoxGeometry(0.1, 0.07, 0.2), 0, -0.86, 0.04),
  };
};
const PIVOT: Record<PartKind, [number, number, number]> = {
  torso: [0, 0.9, 0], head: [0, 1.48, 0], hair: [0, 1.48, 0],
  legL: [0.09, 0.9, 0], legR: [-0.09, 0.9, 0], shoeL: [0.09, 0.9, 0], shoeR: [-0.09, 0.9, 0],
  armL: [0.21, 1.4, 0], armR: [-0.21, 1.4, 0],
};
const KINDS: PartKind[] = ['torso', 'head', 'hair', 'legL', 'legR', 'armL', 'armR', 'shoeL', 'shoeR'];

const CrowdInner: React.FC<{ count: number; shadows: boolean }> = ({ count, shadows }) => {
  const geos = useMemo(PART_GEOS, []);
  const material = useMemo(() => new THREE.MeshStandardMaterial({ roughness: 0.8, metalness: 0.02 }), []);
  const meshes = useRef<Record<string, THREE.InstancedMesh | null>>({});
  const peds = useMemo<Ped[]>(() => {
    const rnd = mulberry32(777 + count);
    const out: Ped[] = [];
    for (let n = 0; n < count; n++) {
      const p = {
        i: Math.floor(rnd() * NL), j: Math.floor(rnd() * NL), sx: rnd() < 0.5 ? -1 : 1, sy: rnd() < 0.5 ? -1 : 1,
        lat: (rnd() - 0.5) * 1.6, speed: 1.1 + rnd() * 0.5, wait: 0, yaw: 0, t: 0, len: 1, cross: 0, off: rnd() * 6.28,
        sc: 0.92 + rnd() * 0.16, run: rnd() < 0.3,
      } as Ped;
      pickMove(p, rnd);
      p.t = rnd();
      out.push(p);
    }
    return out;
  }, [count]);
  const rnd = useMemo(() => mulberry32(4242 + count), [count]);
  const appear = useMemo(() => peds.map((_, n) => appearanceFor(`npc-${n}`, n % 5 === 0 ? 'BACKEND' : n % 7 === 0 ? 'PM_BA' : undefined)), [peds]);
  const phase = useRef(0), clock = useRef(0);

  useEffect(() => {
    const col = new THREE.Color();
    for (const kind of KINDS) {
      const m = meshes.current[kind]; if (!m) continue;
      appear.forEach((a, n) => {
        const c = kind === 'torso' || kind === 'armL' || kind === 'armR' ? a.top
          : kind === 'head' ? a.skin : kind === 'hair' ? a.hair
          : kind.startsWith('shoe') ? a.shoes : a.bottom;
        m.setColorAt(n, col.set(c));
      });
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  }, [appear]);

  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.1);
    clock.current += dt;
    const rain = live.rain, heavy = rain > 0.6;
    const spdMul = heavy ? 0.6 : 1 - rain * 0.4;
    phase.current += dt * 7.5 * (heavy ? 1.25 : 1);
    const ph = phase.current;
    const time = clock.current;
    const arrs: Record<string, Float32Array> = {};
    for (const kind of KINDS) { const m = meshes.current[kind]; if (m) arrs[kind] = m.instanceMatrix.array as Float32Array; }
    for (let n = 0; n < peds.length; n++) {
      const p = peds[n];
      let moving = true;
      if (p.wait > 0) { p.wait -= dt; moving = false; }
      else if (p.t === 0 && p.cross && !signalOk(p.cross, time)) moving = false;
      if (moving) {
        const sp = p.speed * spdMul * (heavy && p.run ? 2.2 : 1);
        p.t += (sp * dt) / p.len;
        if (p.t >= 1) {
          p.i = p.ni; p.j = p.nj; p.sx = p.nsx; p.sy = p.nsy;
          pickMove(p, rnd);
          if (p.cross) p.t = 0; // wait for signal at the kerb
          if (rnd() < 0.15) p.wait = 0.5 + rnd() * 2.5;
        }
      }
      const e = Math.min(p.t, 1);
      const x = p.fx + (p.tx - p.fx) * e, z = p.fz + (p.tz - p.fz) * e;
      const target = Math.atan2(p.tx - p.fx, p.tz - p.fz);
      let dy = target - p.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      p.yaw += dy * Math.min(1, dt * 8);
      const run = heavy && p.run && moving;
      const swing = moving ? (run ? 0.95 : 0.55) : 0;
      const s = Math.sin(ph * (run ? 1.5 : 1) + p.off) * swing;
      const bob = moving ? Math.abs(Math.cos(ph + p.off)) * 0.03 : 0;
      const sn = Math.sin(p.yaw), cs = Math.cos(p.yaw), k = p.sc;
      for (const kind of KINDS) {
        const arr = arrs[kind]; if (!arr) continue;
        const piv = PIVOT[kind];
        let ang = 0;
        if (kind === 'legL' || kind === 'shoeL' || kind === 'armR') ang = -s;
        else if (kind === 'legR' || kind === 'shoeR' || kind === 'armL') ang = s;
        const lift = kind === 'legL' || kind === 'legR' || kind === 'shoeL' || kind === 'shoeR' ? 0 : bob;
        const sa = Math.sin(ang), ca = Math.cos(ang), o = n * 16;
        // M = k * Ry * Rx, column-major
        arr[o] = cs * k; arr[o + 1] = 0; arr[o + 2] = -sn * k; arr[o + 3] = 0;
        arr[o + 4] = sn * sa * k; arr[o + 5] = ca * k; arr[o + 6] = cs * sa * k; arr[o + 7] = 0;
        arr[o + 8] = sn * ca * k; arr[o + 9] = -sa * k; arr[o + 10] = cs * ca * k; arr[o + 11] = 0;
        arr[o + 12] = x + k * (cs * piv[0] + sn * piv[2]);
        arr[o + 13] = k * (piv[1] + lift);
        arr[o + 14] = z + k * (-sn * piv[0] + cs * piv[2]);
        arr[o + 15] = 1;
      }
    }
    for (const kind of KINDS) { const m = meshes.current[kind]; if (m) m.instanceMatrix.needsUpdate = true; }
  });

  return (
    <group>
      {KINDS.map((kind) => (
        <instancedMesh key={kind} ref={(m) => { meshes.current[kind] = m; }} args={[geos[kind], material, count]}
          frustumCulled={false} castShadow={shadows && kind !== 'hair' && !kind.startsWith('shoe') && !kind.startsWith('arm')} />
      ))}
    </group>
  );
};

export const Crowd: React.FC = () => {
  const quality = useCity((s) => s.quality);
  return <CrowdInner key={quality} count={COUNT[quality] ?? 120} shadows={quality !== 'low'} />;
};

// ---------------------------------------------------------------- Player
const PLAYER_APPEARANCE: CharacterAppearance = {
  skin: '#e2b48c', hair: '#facc15', hairStyle: 'cap', top: '#e11d48', bottom: '#111827', shoes: '#fafafa', accessory: 'glasses', height: 1.78,
};

const isTyping = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  if (!el || !el.tagName) return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable;
};
const GAME_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight', 'Space']);

const PlayerInner: React.FC = () => {
  const group = useRef<THREE.Group>(null);
  const keys = useRef(new Set<string>());
  const st = useRef({
    vx: 0, vz: 0, vy: 0, y: live.player.y, heading: live.player.heading, ground: true,
    gy: live.player.y, floor: 0, onPad: false, hint: '', setFloor: false, prevMode: null as null | string, loweredCam: false,
    grids: new Map<number, Grid>(), gridReady: false, p: { x: 0, z: 0 },
  });
  const [pose, setPose] = useState<CharacterPose>('idle');
  const poseRef = useRef<CharacterPose>('idle');
  const { camera, gl } = useThree();
  const fwd = useMemo(() => new THREE.Vector3(), []);

  useEffect(() => {
    const kd = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      if (GAME_KEYS.has(e.code)) { e.preventDefault(); keys.current.add(e.code); }
    };
    const ku = (e: KeyboardEvent) => { if (GAME_KEYS.has(e.code)) keys.current.delete(e.code); };
    const liftKey = (e: KeyboardEvent) => {
      const s = st.current;
      if (!s.onPad || isTyping(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      let f: number | null = null;
      if (/^Digit[0-7]$/.test(e.code)) f = e.code === 'Digit0' ? -1 : Number(e.code.slice(5)) - 1;
      else if (e.code === 'KeyE' || e.code === 'PageUp') f = s.floor + 1;
      else if (e.code === 'KeyQ' || e.code === 'PageDown') f = s.floor - 1;
      if (f == null) return;
      e.preventDefault(); e.stopImmediatePropagation();
      s.floor = Math.max(-1, Math.min(TOWER_FLOORS - 1, f));
    };
    window.addEventListener('keydown', liftKey, true);
    const blur = () => keys.current.clear();
    let drag = false, lx = 0, ly = 0;
    const pd = (e: PointerEvent) => { if (e.button === 0 || e.button === 2) { drag = true; lx = e.clientX; ly = e.clientY; } };
    const pm = (e: PointerEvent) => {
      if (!drag) return;
      playerLook.yaw -= (e.clientX - lx) * 0.005;
      playerLook.pitch = Math.max(0.05, Math.min(1.2, playerLook.pitch + (e.clientY - ly) * 0.004));
      lx = e.clientX; ly = e.clientY;
    };
    const pu = () => { drag = false; };
    window.addEventListener('keydown', kd); window.addEventListener('keyup', ku); window.addEventListener('blur', blur);
    const el = gl.domElement;
    el.addEventListener('pointerdown', pd); window.addEventListener('pointermove', pm); window.addEventListener('pointerup', pu);
    return () => {
      window.removeEventListener('keydown', liftKey, true);
      window.removeEventListener('keydown', kd); window.removeEventListener('keyup', ku); window.removeEventListener('blur', blur);
      el.removeEventListener('pointerdown', pd); window.removeEventListener('pointermove', pm); window.removeEventListener('pointerup', pu);
    };
  }, [gl]);

  useEffect(() => () => {
    const s = st.current;
    live.playerFloor = null;
    if (s.setFloor) cityStore.set({ selectedFloor: null });
    if (s.prevMode != null && cityStore.get().cameraMode === 'follow') cityStore.set({ cameraMode: s.prevMode as any });
    if (s.loweredCam) playerLook.dist = 6;
    if (s.hint) { try { window.dispatchEvent(new CustomEvent('city3d:hint', { detail: { text: '' } })); } catch { /* ignore */ } }
  }, []);

  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05), s = st.current, K = keys.current, P = live.player, g = group.current;
    if (!g) return;
    const ix = (K.has('KeyD') || K.has('ArrowRight') ? 1 : 0) - (K.has('KeyA') || K.has('ArrowLeft') ? 1 : 0);
    const iz = (K.has('KeyW') || K.has('ArrowUp') ? 1 : 0) - (K.has('KeyS') || K.has('ArrowDown') ? 1 : 0);
    const run = K.has('ShiftLeft') || K.has('ShiftRight');
    camera.getWorldDirection(fwd);
    let fx = fwd.x, fz = fwd.z; const fl = Math.hypot(fx, fz) || 1; fx /= fl; fz /= fl;
    const rx = -fz, rz = fx;
    let dx = fx * iz + rx * ix, dz = fz * iz + rz * ix;
    const dl = Math.hypot(dx, dz);
    const maxSp = run ? 6.2 : 2.6;
    let tvx = 0, tvz = 0;
    if (dl > 0.01) { dx /= dl; dz /= dl; tvx = dx * maxSp; tvz = dz * maxSp; }
    const a = 1 - Math.exp(-dt * (dl > 0.01 ? 10 : 14));
    s.vx += (tvx - s.vx) * a; s.vz += (tvz - s.vz) * a;
    // ---------------- interior / floor logic
    const half = TOWER_FOOTPRINT.w / 2, halfD = TOWER_FOOTPRINT.d / 2;
    const inZone = Math.abs(P.x) < half + 2 && Math.abs(P.z) < halfD + 2;
    const inBuilding = Math.abs(P.x) < half && Math.abs(P.z) < halfD;
    const I = interior;
    let stairY: number | null = null;
    s.onPad = false;
    if (I.ready && inBuilding) {
      for (const L of I.lifts) if (Math.hypot(P.x - L.x, P.z - L.z) < L.r) { s.onPad = true; break; }
      // flights can overlap in plan (stacked, one storey apart): take the one whose surface is closest to the player's height
      let best: { y: number; floor: number } | null = null, bestD = 1.0;
      for (const S of I.stairs) {
        if (s.floor !== S.floorA && s.floor !== S.floorB) continue;
        const ax = S.a[0], az = S.a[1], bx = S.b[0], bz = S.b[1], ex = bx - ax, ez = bz - az, el = ex * ex + ez * ez || 1;
        const t = ((P.x - ax) * ex + (P.z - az) * ez) / el;
        if (t < -0.02 || t > 1.02) continue;
        const lx = P.x - (ax + ex * t), lz = P.z - (az + ez * t);
        if (Math.hypot(lx, lz) > S.width / 2) continue;
        const tc = Math.max(0, Math.min(1, t));
        const y = I.floorY(S.floorA) + (I.floorY(S.floorB) - I.floorY(S.floorA)) * tc;
        const dd = Math.abs(y - s.gy);
        if (dd < bestD) { bestD = dd; best = { y, floor: tc < 0.5 ? S.floorA : S.floorB }; }
      }
      if (best) { stairY = best.y; s.floor = best.floor; }
    }
    const hint = s.onPad ? 'Thang máy: phím 0-7 chọn tầng (0 = B1), E/Q lên/xuống' : '';
    if (hint !== s.hint) { s.hint = hint; try { window.dispatchEvent(new CustomEvent('city3d:hint', { detail: { text: hint } })); } catch { /* ignore */ } }
    const flo = I.ready && inBuilding ? s.floor : 0;
    const targetY = I.ready ? I.floorY(flo) : 0;
    if (stairY != null) s.gy = stairY;
    else if (Math.abs(targetY - s.gy) < 0.01) s.gy = targetY;
    else s.gy += (targetY - s.gy) * (1 - Math.exp(-dt * 6));
    if (!inBuilding && s.floor !== 0) s.floor = 0;
    if (K.has('Space') && s.ground) { s.vy = 5.2; s.ground = false; }
    if (s.ground) { s.y = s.gy; s.vy = 0; }
    else { s.vy -= 14 * dt; s.y += s.vy * dt; if (s.y <= s.gy) { s.y = s.gy; s.vy = 0; s.ground = true; } }
    let nx = P.x + s.vx * dt, nz = P.z + s.vz * dt;
    const R = 0.35;
    const pp = s.p; pp.x = nx; pp.z = nz;
    for (let it = 0; it < 2; it++) for (const o of obstacles) pushOut(o, R, pp);
    if (inZone || Math.abs(nx) < half + 2 && Math.abs(nz) < halfD + 2) {
      if (I.ready) {
        let g = s.grids.get(flo);
        if (!g || !s.gridReady) { if (!s.gridReady) { s.grids.clear(); s.gridReady = true; } g = buildGrid(I.colliders(flo)); s.grids.set(flo, g); }
        resolveGrid(g, R, pp);
      } else {
        pushOut({ minX: -half, maxX: half, minZ: -halfD, maxZ: halfD }, R, pp);
      }
    }
    nx = pp.x; nz = pp.z;
    if (!I.ready) s.gridReady = false;
    const lim = CITY_EXTENT + 20;
    nx = Math.max(-lim, Math.min(lim, nx)); nz = Math.max(-lim, Math.min(lim, nz));
    const sp = Math.hypot(s.vx, s.vz);
    if (sp > 0.3) {
      const target = Math.atan2(s.vx, s.vz);
      let d = target - s.heading; d = Math.atan2(Math.sin(d), Math.cos(d));
      s.heading += d * Math.min(1, dt * 12);
    }
    P.x = nx; P.z = nz; P.y = s.y; P.heading = s.heading; P.speed = sp;
    const inside = I.ready && Math.abs(nx) < half && Math.abs(nz) < halfD;
    const pf = inside ? s.floor : null;
    if (live.playerFloor !== pf) live.playerFloor = pf;
    const cs = cityStore.get();
    if (pf != null) {
      if (cs.selectedFloor !== pf || (cs.cameraMode !== 'follow' && s.prevMode == null)) {
        const patch: Partial<typeof cs> = {};
        if (cs.selectedFloor !== pf) patch.selectedFloor = pf;
        if (cs.cameraMode !== 'follow' && s.prevMode == null) { s.prevMode = cs.cameraMode; patch.cameraMode = 'follow'; }
        s.setFloor = true; cityStore.set(patch);
      }
      if (!s.loweredCam) { s.loweredCam = true; playerLook.dist = 4; }
    } else {
      if (s.setFloor) { s.setFloor = false; if (cs.selectedFloor != null) cityStore.set({ selectedFloor: null }); }
      if (s.prevMode != null) { if (cs.cameraMode === 'follow') cityStore.set({ cameraMode: s.prevMode as any }); s.prevMode = null; }
      if (s.loweredCam) { s.loweredCam = false; playerLook.dist = 6; }
    }
    g.position.set(nx, s.y, nz); g.rotation.y = s.heading;
    const np: CharacterPose = sp > 4 ? 'run' : sp > 0.4 ? 'walk' : 'idle';
    if (np !== poseRef.current) { poseRef.current = np; setPose(np); }
  });

  return (
    <group ref={group} position={[live.player.x, live.player.y, live.player.z]}>
      <Character3D appearance={PLAYER_APPEARANCE} pose={pose} priority />
    </group>
  );
};

export const Player: React.FC = () => {
  const mode = useCity((s) => s.playerMode);
  return mode === 'walk' ? <PlayerInner /> : null;
};
