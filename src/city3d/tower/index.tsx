/**
 * FPT Software F-Town 3 ("Building in the Park"): 7 floors + B1, 2 courtyard atria, terrace gardens,
 * cutaway dollhouse, real team bay on TEAM_FLOOR. Procedural only.
 */
import React, { memo, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import * as THREE from 'three';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import { FLOOR_H, TOWER_FLOORS, TEAM_FLOOR, FLOOR_DEPARTMENTS, cityStore, useCity, live, mulberry32, type Quality } from '../shared';
import { Character3D, appearanceFor } from '../characters';
import { EMPLOYEE_BY_ID } from '../../data/employees';
import { officeSimulationEngine } from '../../engine/simulationStore';
import { getFloor, Furn, FT, CLEAR, HX, HZ, K, COURTYARDS, type Box, type Label, type Walker, type Prop } from './furn';
import { getProp, usePropsState } from './props';
import { fasciaGeo, slabGeo, cortenGeo, carpetGeo } from './facade';
import { LongChauGreeter } from './greeter';
export { LongChauModel } from './greeter';

const BOX_GEO = new THREE.BoxGeometry(1, 1, 1);
const BALL_GEO = new THREE.IcosahedronGeometry(1, 1);
const ROOF = TOWER_FLOORS; // index of the roof group

// ---------- shared materials ----------
function useMats() {
  return useMemo(() => {
    const glassFull = new THREE.MeshStandardMaterial({ color: '#1d2d33', transparent: true, opacity: 0.55, roughness: 0.15, metalness: 0.5, depthWrite: false, side: THREE.DoubleSide, emissive: '#ffd9a0', emissiveIntensity: 0 });
    const glassCut = new THREE.MeshStandardMaterial({ color: '#9fd8d4', transparent: true, opacity: 0.05, roughness: 0.05, metalness: 0.2, depthWrite: false, side: THREE.DoubleSide });
    const solid = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.85 });
    const inner = new THREE.MeshStandardMaterial({ color: '#bfe8ea', transparent: true, opacity: 0.22, roughness: 0.05, depthWrite: false, side: THREE.DoubleSide });
    const screen = new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false });
    const led = new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false, transparent: true });
    const leaf = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.9, flatShading: true });
    const slab = new THREE.MeshStandardMaterial({ color: '#f2f4f3', roughness: 0.8 });
    const dots = (() => {
      if (typeof document === 'undefined') return null;
      const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d')!;
      g.fillStyle = '#f6f7f5'; g.fillRect(0, 0, 64, 64); g.fillStyle = '#c9cecb';
      for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) { g.beginPath(); g.arc(8 + x * 16 + (y % 2) * 8, 8 + y * 16, 2.2, 0, 7); g.fill(); }
      const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; return t;
    })();
    const fascia = new THREE.MeshStandardMaterial({ color: '#ffffff', map: dots, roughness: 0.7, side: THREE.DoubleSide });
    const corten = new THREE.MeshStandardMaterial({ color: '#8a3b22', roughness: 0.8, side: THREE.DoubleSide });
    const carpet = new THREE.MeshStandardMaterial({ color: '#a7bf9d', roughness: 1 });
    const plate = new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false });
    const prop = new THREE.MeshStandardMaterial({ color: '#ffffff', vertexColors: true, roughness: 0.75, metalness: 0.05 });
    const cabin = new THREE.MeshStandardMaterial({ color: '#cfe9e6', emissive: '#bff5ef', emissiveIntensity: 0.4, roughness: 0.3, metalness: 0.4 });
    return { glassFull, glassCut, solid, inner, screen, led, leaf, slab, cabin, fascia, corten, carpet, plate, prop };
  }, []);
}
type Mats = ReturnType<typeof useMats>;

// ---------- instancing helpers ----------
const InstBoxes: React.FC<{ list: Box[]; material: THREE.Material; shadow?: boolean }> = ({ list, material, shadow }) => {
  const ref = useRef<THREE.InstancedMesh>(null!);
  useLayoutEffect(() => {
    const m = ref.current; if (!m) return;
    const o = new THREE.Object3D(); const col = new THREE.Color();
    list.forEach((b, i) => {
      o.position.set(b.p[0], b.p[1], b.p[2]); o.rotation.set(b.rx, b.r, 0, 'YXZ'); o.scale.set(b.s[0], b.s[1], b.s[2]); o.updateMatrix();
      m.setMatrixAt(i, o.matrix); m.setColorAt(i, col.set(b.c));
    });
    m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }, [list]);
  if (!list.length) return null;
  return <instancedMesh ref={ref} args={[BOX_GEO, material, list.length]} frustumCulled={false} castShadow={shadow} receiveShadow={shadow} />;
};
const InstBalls: React.FC<{ balls: Furn['balls']; material: THREE.Material; shadow?: boolean }> = ({ balls, material, shadow }) => {
  const ref = useRef<THREE.InstancedMesh>(null!);
  useLayoutEffect(() => {
    const m = ref.current; if (!m) return;
    const o = new THREE.Object3D(); const col = new THREE.Color();
    balls.forEach((b, i) => { o.position.set(...b.p); o.rotation.set(0, i, 0); o.scale.setScalar(b.r); o.updateMatrix(); m.setMatrixAt(i, o.matrix); m.setColorAt(i, col.set(b.c)); });
    m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }, [balls]);
  if (!balls.length) return null;
  return <instancedMesh ref={ref} args={[BALL_GEO, material, balls.length]} frustumCulled={false} castShadow={shadow} />;
};

// ---------- text labels (canvas textures, no network) ----------
const texCache = new Map<string, THREE.CanvasTexture>();
function labelTex(l: Label): THREE.CanvasTexture {
  const key = `${l.t}|${l.fg}|${l.bg}|${l.w / l.h}`;
  let t = texCache.get(key); if (t) return t;
  const cw = 1024, ch = Math.max(64, Math.round((cw * l.h) / l.w));
  const c = document.createElement('canvas'); c.width = cw; c.height = ch;
  const g = c.getContext('2d')!;
  if (l.bg) { g.fillStyle = l.bg; g.fillRect(0, 0, cw, ch); }
  g.fillStyle = l.fg ?? '#ffffff'; g.textAlign = 'center'; g.textBaseline = 'middle';
  let size = ch * 0.62; g.font = `bold ${size}px "Segoe UI", Arial, sans-serif`;
  while (g.measureText(l.t).width > cw * 0.92 && size > 8) { size -= 4; g.font = `bold ${size}px "Segoe UI", Arial, sans-serif`; }
  g.fillText(l.t, cw / 2, ch / 2 + size * 0.04);
  t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  texCache.set(key, t); return t;
}
const LabelMesh: React.FC<{ l: Label }> = ({ l }) => {
  const tex = useMemo(() => labelTex(l), [l]);
  return (
    <mesh position={[l.x, l.flat ? FT + l.y : l.y, l.z]} rotation={l.flat ? [-Math.PI / 2, 0, l.rot] : [0, l.rot, 0]}>
      <planeGeometry args={[l.w, l.h]} />
      <meshBasicMaterial map={tex} transparent toneMapped={false} side={THREE.DoubleSide} />
    </mesh>
  );
};

// ---------- floor ----------
const setCursor = (c: string) => { try { document.body.style.cursor = c; } catch { /* ignore */ } };

interface FloorProps { f: number; visible: boolean; cut: boolean; quality: Quality; mats: Mats; interior: boolean }
const Floor = memo(({ f, visible, cut, quality, mats, interior }: FloorProps) => {
  const data = useMemo(() => getFloor(f), [f]);
  const isRoof = f === ROOF;
  const walls = useMemo((): Box[] => {
    if (isRoof || data.str.solid) return [];
    const out: Box[] = [];
    const add = (cx: number, cz: number, w: number, d: number) => out.push({ p: [cx, FT + CLEAR / 2, cz], s: [w, CLEAR, d], c: '#ffffff', r: 0, rx: 0 });
    // glazing is recessed ~0.9 m behind the slab edge (open dark terraces, as in the real building)
    const i = 0.9, sh = 5;
    add(0, -HZ + i, 2 * HX - 2 * sh, 0.06); add(0, HZ - i, 2 * HX - 2 * sh, 0.06); add(-HX + i, 0, 0.06, 2 * HZ - 2 * sh); add(HX - i, 0, 0.06, 2 * HZ - 2 * sh);
    for (const c of COURTYARDS) {
      const o = 0.6, w = c.w - 2 * 3, d = c.d - 2 * 3;
      add(c.x, c.z - c.d / 2 - o, w, 0.06); add(c.x, c.z + c.d / 2 + o, w, 0.06); add(c.x - c.w / 2 - o, c.z, 0.06, d); add(c.x + c.w / 2 + o, c.z, 0.06, d);
    }
    return out;
  }, [isRoof, data]);
  const fascia = useMemo(() => (f >= 0 && !isRoof ? fasciaGeo(f) : null), [f, isRoof]);
  const dark = f === -1;
  const onClick = (e: ThreeEvent<MouseEvent>) => { e.stopPropagation(); cityStore.set({ selectedFloor: isRoof ? null : f }); };
  const interiorOn = interior || cut;
  return (
    <group position={[0, f * FLOOR_H, 0]} visible={visible} onClick={onClick}
      onPointerOver={(e) => { e.stopPropagation(); setCursor('pointer'); }} onPointerOut={() => setCursor('auto')}>
      {dark
        ? <mesh position={[0, FT / 2, 0]} scale={[2 * HX, FT, 2 * HZ]} geometry={BOX_GEO} material={mats.solid} castShadow receiveShadow><meshStandardMaterial attach="material" color="#5c646a" roughness={0.95} /></mesh>
        : <mesh geometry={slabGeo()} material={mats.slab} castShadow receiveShadow />}
      {fascia && <mesh geometry={fascia} material={mats.fascia} castShadow />}
      {FLOOR_DEPARTMENTS.find((d) => d.floor === f)?.role === 'TEAM' && <mesh geometry={carpetGeo()} material={mats.carpet} position={[0, FT + 0.004, 0]} receiveShadow />}
      {f === 0 && <mesh geometry={cortenGeo()} material={mats.corten} castShadow />}
      <InstBoxes list={walls} material={cut ? mats.glassCut : mats.glassFull} />
      <FloorStuff furn={data.str} mats={mats} shadow={quality === 'high'} on={interiorOn} props={quality !== 'low'} />
      <group scale={[K, 1, K]}>
        <FloorStuff furn={data.lay} mats={mats} shadow={quality === 'high'} on={interiorOn} props={quality !== 'low'} />
      </group>
      {cut && quality !== 'low' && <FloorLights quality={quality} />}
      {f === 0 && <RevolvingDoor mats={mats} />}
      {f === 0 && <mesh position={[5, 3.05, HZ + 1]} scale={[7, 0.25, 3.4]} geometry={BOX_GEO} material={mats.slab} />}
    </group>
  );
});
type V3t = [number, number, number];

/** Instanced content of one Furn. When `on` is false (low quality, uncut) only structural uprights are drawn. */
const FloorStuff: React.FC<{ furn: Furn; mats: Mats; shadow: boolean; on: boolean; props: boolean }> = ({ furn, mats, shadow, on, props }) => {
  const struct = useMemo(() => furn.boxes.filter((b) => b.s[1] > 2.5 || b.c === '#dfe7e6' || b.c === '#e9eeed' || b.c === '#f4f6f5'), [furn]);
  const names = useMemo(() => [...new Set(furn.props.map((p) => p.m))], [furn]);
  const state = usePropsState(names, props && on);
  const usingProps = state === 'ready';
  const boxes = useMemo(() => (usingProps ? furn.boxes : [...furn.boxes, ...furn.altBoxes]), [furn, usingProps]);
  const screens = useMemo(() => (usingProps ? furn.screens : [...furn.screens, ...furn.altScreens]), [furn, usingProps]);
  const balls = useMemo(() => (usingProps ? furn.balls : [...furn.balls, ...furn.altBalls]), [furn, usingProps]);
  return (
    <>
      <InstBoxes list={on ? boxes : struct} material={mats.solid} shadow={shadow} />
      {on && <InstBoxes list={furn.glass} material={mats.inner} />}
      {on && <InstBoxes list={screens} material={mats.screen} />}
      {on && <InstBoxes list={furn.leds} material={mats.led} />}
      {on && furn.plates.length > 0 && <Plates furn={furn} mat={mats.plate} />}
      {on && usingProps && <PropInstances list={furn.props} mats={mats} shadow={shadow} />}
      <InstBalls balls={on ? balls : furn.balls} material={mats.leaf} shadow={shadow} />
      {on && furn.labels.map((l, i) => <LabelMesh key={i} l={l} />)}
    </>
  );
};

/** One InstancedMesh per model (plus one emissive mesh for screens). */
const PropInstances: React.FC<{ list: Prop[]; mats: Mats; shadow: boolean }> = ({ list, mats, shadow }) => {
  const groups = useMemo(() => { const m = new Map<string, Prop[]>(); list.forEach((p) => { const a = m.get(p.m) ?? []; a.push(p); m.set(p.m, a); }); return [...m.entries()]; }, [list]);
  return <>{groups.map(([name, items]) => <PropMesh key={name} name={name} items={items} mats={mats} shadow={shadow} />)}</>;
};
const PropMesh: React.FC<{ name: string; items: Prop[]; mats: Mats; shadow: boolean }> = ({ name, items, mats, shadow }) => {
  const geo = getProp(name);
  const a = useRef<THREE.InstancedMesh>(null!), g = useRef<THREE.InstancedMesh>(null!);
  useLayoutEffect(() => {
    const o = new THREE.Object3D(), col = new THREE.Color();
    items.forEach((p, i) => {
      o.position.set(...p.p); o.rotation.set(0, p.r, 0); o.scale.set(...p.s); o.updateMatrix();
      if (a.current) { a.current.setMatrixAt(i, o.matrix); a.current.setColorAt(i, col.set(p.t ?? '#ffffff')); }
      if (g.current) { g.current.setMatrixAt(i, o.matrix); g.current.setColorAt(i, col.set(p.c ?? '#4fd1ff')); }
    });
    for (const m of [a.current, g.current]) if (m) { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
  }, [items, geo]);
  if (!geo) return null;
  return (
    <>
      <instancedMesh ref={a} args={[geo.main, mats.prop, items.length]} frustumCulled={false} castShadow={shadow} receiveShadow={shadow} />
      {geo.glow && <instancedMesh ref={g} args={[geo.glow, mats.screen, items.length]} frustumCulled={false} />}
    </>
  );
};

/** All desk name plates merged into one mesh (canvas atlas, one draw call). */
const Plates: React.FC<{ furn: Furn; mat: THREE.MeshBasicMaterial }> = ({ furn, mat }) => {
  const { geo, tex } = useMemo(() => {
    const items = furn.plates, cols = 4, cw = 256, ch = 64, rowsN = Math.ceil(items.length / cols);
    const c = document.createElement('canvas'); c.width = cols * cw; c.height = rowsN * ch;
    const g = c.getContext('2d')!; g.textAlign = 'center'; g.textBaseline = 'middle';
    const pos: number[] = [], uv: number[] = [], idx: number[] = [];
    items.forEach((it, i) => {
      const cx = (i % cols) * cw, cy = Math.floor(i / cols) * ch;
      g.fillStyle = '#fbfbf6'; g.fillRect(cx, cy, cw, ch); g.fillStyle = '#1d3a33'; g.font = 'bold 34px system-ui, Arial'; g.fillText(it.text, cx + cw / 2, cy + ch / 2 + 2);
      const cs = Math.cos(it.rot), sn = Math.sin(it.rot), w = 0.3, h = 0.075, base = pos.length / 3;
      for (const [lx, ly] of [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]]) pos.push(it.x + lx * cs, it.y + ly + 0.045, it.z - lx * sn);
      const u0 = cx / c.width, u1 = (cx + cw) / c.width, v1 = 1 - cy / c.height, v0 = 1 - (cy + ch) / c.height;
      uv.push(u0, v0, u1, v0, u1, v1, u0, v1); idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geo.setIndex(idx);
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
    return { geo, tex };
  }, [furn]);
  useLayoutEffect(() => { mat.map = tex; mat.side = THREE.DoubleSide; mat.needsUpdate = true; }, [mat, tex]);
  return <mesh geometry={geo} material={mat} frustumCulled={false} />;
};

const FloorLights: React.FC<{ quality: Quality }> = ({ quality }) => {
  const refs = useRef<THREE.PointLight[]>([]);
  // low, wide, dim fill (no hot-spot): the visible light comes from the ceiling panels
  useFrame(() => { const nf = live.nightFactor; refs.current.forEach((l) => { if (l) l.intensity = 3 + nf * 9; }); });
  const pts: [number, number][] = quality === 'high' ? [[4, -12], [16, -12], [4, 0], [16, 0], [4, 12], [16, 12]] : [[10, -9], [10, 9]];
  return <>{pts.map(([x, z], i) => <pointLight key={i} ref={(r) => { if (r) refs.current[i] = r; }} position={[x, 3.3, z]} distance={22} decay={2} color="#ffe6bf" intensity={4} />)}</>;
};

const RevolvingDoor: React.FC<{ mats: Mats }> = ({ mats }) => {
  const g = useRef<THREE.Group>(null!);
  useFrame((_, dt) => { if (g.current) g.current.rotation.y += dt * 0.8; });
  return (
    <group position={[5, FT, HZ - 0.3]}>
      <mesh position={[0, 1.2, 0]} scale={[0.1, 2.4, 0.1]} geometry={BOX_GEO} material={mats.solid} />
      <group ref={g}>
        {[0, Math.PI / 2].map((r) => <mesh key={r} position={[0, 1.2, 0]} rotation={[0, r, 0]} scale={[2.4, 2.3, 0.04]} geometry={BOX_GEO} material={mats.inner} />)}
      </group>
      <mesh position={[0, 2.5, 0]} scale={[2.8, 0.2, 2.8]} geometry={BOX_GEO} material={mats.slab} />
    </group>
  );
};

// ---------- animated bits: elevators + LED blink + night glow ----------
const Elevators: React.FC<{ mats: Mats }> = ({ mats }) => {
  const a = useRef<THREE.Mesh>(null!), b = useRef<THREE.Mesh>(null!);
  useFrame(({ clock }) => {
    const sel = cityStore.get().selectedFloor;
    const maxF = sel === null ? TOWER_FLOORS - 1 : Math.min(sel, TOWER_FLOORS - 1);
    const minF = -1;
    const run = (m: THREE.Mesh | null, sp: number, ph: number) => {
      if (!m) return;
      const tri = Math.abs((((clock.elapsedTime * sp + ph) % 2) + 2) % 2 - 1);
      const s = tri * tri * (3 - 2 * tri);
      const fl = minF + (maxF - minF) * s;
      m.position.y = FT + fl * FLOOR_H + 1.25;
    };
    run(a.current, 0.05, 0); run(b.current, 0.037, 0.8);
  });
  return (
    <>
      <mesh ref={a} position={[-3.75, 1.5, 0]} scale={[2, 2.5, 2.2]} geometry={BOX_GEO} material={mats.cabin} />
      <mesh ref={b} position={[-1.25, 1.5, 0]} scale={[2, 2.5, 2.2]} geometry={BOX_GEO} material={mats.cabin} />
    </>
  );
};

// ---------- people ----------
const Walk: React.FC<{ w: Walker; y: number }> = ({ w: w0, y }) => {
  const w = useMemo(() => ({ ...w0, a: [w0.a[0] * K, w0.a[1] * K] as [number, number], b: [w0.b[0] * K, w0.b[1] * K] as [number, number], speed: w0.speed }), [w0]);
  const g = useRef<THREE.Group>(null!);
  const len = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
  const ph = useMemo(() => mulberry32(w.id.length * 31 + w.id.charCodeAt(w.id.length - 1))() * 2, [w.id]);
  const look = useMemo(() => appearanceFor(w.id), [w.id]);
  useFrame(({ clock }) => {
    if (!g.current) return;
    const t = (((clock.elapsedTime * w.speed) / len + ph) % 2 + 2) % 2;
    const fwd = t < 1, u = fwd ? t : 2 - t;
    const x = w.a[0] + (w.b[0] - w.a[0]) * u, z = w.a[1] + (w.b[1] - w.a[1]) * u;
    g.current.position.set(x, y, z);
    g.current.rotation.y = Math.atan2(w.b[0] - w.a[0], w.b[1] - w.a[1]) + (fwd ? 0 : Math.PI);
  });
  return <group ref={g}><Character3D appearance={look} pose="walk" /></group>;
};
const Npc: React.FC<{ id: string; x: number; y: number; z: number; rot: number; pose: 'type' | 'sit' | 'idle' | 'wave' }> = memo(({ id, x, y, z, rot, pose }) => {
  const look = useMemo(() => appearanceFor(id), [id]);
  return <Character3D appearance={look} pose={pose} position={[x, y, z]} rotationY={rot} />;
});

/** True when the camera is within ~110 m of the tower (hysteresis), polled 4x/s. Far away the occupants are sub-pixel, so skipping them saves hundreds of draw calls. */
function useNearTower(): boolean {
  const [near, setNear] = React.useState(true);
  const t = React.useRef(0);
  const cur = React.useRef(true);
  useFrame(({ camera }, dt) => {
    t.current += dt;
    if (t.current < 0.25) return;
    t.current = 0;
    const d = Math.hypot(camera.position.x, camera.position.z, camera.position.y - 10);
    const next = cur.current ? d < 125 : d < 100;
    if (next !== cur.current) { cur.current = next; setNear(next); }
  });
  return near;
}

const Population: React.FC<{ f: number; sel: number | null; quality: Quality }> = ({ f, sel, quality }) => {
  const data = useMemo(() => getFloor(f).lay, [f]);
  const y = f * FLOOR_H + FT;
  const near = useNearTower();
  const show = sel === f || (near && quality === 'high' && (sel === null || sel >= f));
  const items = useMemo(() => {
    const r = mulberry32(f * 7 + 3);
    const pick = <T,>(arr: T[], n: number) => arr.map((v) => [r(), v] as const).sort((p, q) => p[0] - q[0]).slice(0, n).map((p) => p[1]);
    return { type: pick(data.seats, data.npcSeated), sit: pick(data.sitSeats, 4) };
  }, [data, f]);
  if (!show) return null;
  return (
    <>
      {items.type.map((s, i) => <Npc key={`t${i}`} id={`npc-f${f}-t${i}`} x={s.x * K} y={y} z={s.z * K} rot={s.rot} pose="type" />)}
      {items.sit.map((s, i) => <Npc key={`s${i}`} id={`npc-f${f}-s${i}`} x={s.x * K} y={y} z={s.z * K} rot={s.rot} pose="sit" />)}
      {data.stands.map((s) => <Npc key={s.id} id={s.id} x={s.x * K} y={y} z={s.z * K} rot={s.rot} pose={s.pose ?? 'idle'} />)}
      {data.walkers.map((w) => <Walk key={w.id} w={w} y={y} />)}
    </>
  );
};

const Team: React.FC<{ sel: number | null; quality: Quality }> = ({ sel, quality }) => {
  const key = useSyncExternalStore(
    officeSimulationEngine.subscribe,
    () => { const sn = officeSimulationEngine.getSnapshot(); return `${sn.selectedEmployeeId ?? ''}#${sn.employees.map((e) => `${e.id}:${e.status}`).join('|')}`; },
  );
  const [selectedId, statuses] = useMemo(() => { const i = key.indexOf('#'); return [key.slice(0, i), key.slice(i + 1)] as const; }, [key]);
  const status = useMemo(() => Object.fromEntries(statuses.split('|').map((s) => s.split(':'))) as Record<string, string>, [statuses]);
  const data = useMemo(() => getFloor(TEAM_FLOOR).str, []);
  const [hover, setHover] = React.useState<string | null>(null);
  const y = TEAM_FLOOR * FLOOR_H + FT;
  const floorVisible = sel === null || sel >= TEAM_FLOOR;
  const near = useNearTower();
  const show = floorVisible && (sel !== null || near) && (quality === 'low' ? sel === TEAM_FLOOR : true);
  const interactive = sel === TEAM_FLOOR;
  if (!show) return null;
  return (
    <>
      <StatusDots team={data.team} status={status} y={y + 1.72} />
      {data.team.map((t) => {
        const emp = EMPLOYEE_BY_ID[t.emp]; const st = status[t.emp] ?? emp?.status ?? 'IDLE';
        const chipOn = interactive && (hover === t.emp || t.emp === 'EMP-01' || selectedId === t.emp);
        return <TeamMember key={t.emp} id={t.emp} x={t.x} y={y} z={t.z} rot={t.rot} pose={st === 'IDLE' ? 'sit' : 'type'} interactive={interactive}
          onHover={setHover} chip={chipOn ? { name: emp?.displayName ?? t.emp, role: emp?.role ?? '', status: st, color: emp?.badgeColor ?? '#2e8f8a' } : null} />;
      })}
      {quality === 'high' && data.extraTeam.map((s, i) => <Npc key={s.id ?? i} id={`seat-${s.id ?? i}`} x={s.x} y={y} z={s.z} rot={s.rot} pose="type" />)}
    </>
  );
};
const STATUS_COLOR: Record<string, string> = { WORKING: '#22c55e', IDLE: '#9ca3af', REVIEWING: '#3b82f6', WALKING: '#f59e0b', CARRYING_DOCS: '#f59e0b', HANDOFF: '#a855f7', WALKING_BACK: '#f59e0b' };
/** one instanced mesh: tiny coloured status dot above each seated person */
const StatusDots: React.FC<{ team: { emp: string; x: number; z: number }[]; status: Record<string, string>; y: number }> = ({ team, status, y }) => {
  const ref = useRef<THREE.InstancedMesh>(null!);
  useLayoutEffect(() => {
    const m = ref.current; if (!m) return; const o = new THREE.Object3D(); const c = new THREE.Color();
    team.forEach((t, i) => { o.position.set(t.x, y, t.z); o.updateMatrix(); m.setMatrixAt(i, o.matrix); m.setColorAt(i, c.set(STATUS_COLOR[status[t.emp] ?? 'IDLE'] ?? '#f59e0b')); });
    m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }, [team, status, y]);
  if (!team.length) return null;
  return <instancedMesh ref={ref} args={[DOT_GEO, DOT_MAT, team.length]} frustumCulled={false} />;
};
const DOT_GEO = new THREE.IcosahedronGeometry(0.07, 0);
const DOT_MAT = new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false });
const TeamMember: React.FC<{ id: string; x: number; y: number; z: number; rot: number; pose: 'type' | 'sit'; interactive: boolean; onHover: (id: string | null) => void; chip: { name: string; role: string; status: string; color: string } | null }> = ({ id, x, y, z, rot, pose, interactive, onHover, chip }) => {
  const look = useMemo(() => appearanceFor(id, EMPLOYEE_BY_ID[id]?.role), [id]);
  const handlers = interactive ? {
    onPointerOver: (e: ThreeEvent<PointerEvent>) => { e.stopPropagation(); onHover(id); setCursor('pointer'); },
    onPointerOut: () => { onHover(null); setCursor('auto'); },
    onClick: (e: ThreeEvent<MouseEvent>) => { e.stopPropagation(); officeSimulationEngine.selectEmployee(id); },
  } : {};
  return (
    <group {...handlers}>
      <Character3D appearance={look} pose={pose} position={[x, y, z]} rotationY={rot} />
      {chip && (
        <Html position={[x, y + 1.95, z]} center distanceFactor={11} zIndexRange={[20, 0]} style={{ pointerEvents: 'none' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '1px 6px', borderRadius: 8, background: 'rgba(12,28,26,0.88)', color: '#fff', font: '600 10px system-ui', whiteSpace: 'nowrap', border: `1px solid ${chip.color}` }}>
            <span style={{ width: 6, height: 6, borderRadius: 3, background: STATUS_COLOR[chip.status] ?? '#f59e0b' }} />
            {chip.name}<span style={{ opacity: 0.65, fontWeight: 400 }}>{chip.role}</span>
          </div>
        </Html>
      )}
    </group>
  );
};

// ---------- root ----------
export const FrtTower: React.FC = () => {
  const sel = useCity((s) => s.selectedFloor);
  const quality = useCity((s) => s.quality);
  const mats = useMats();

  useFrame(({ clock }) => {
    const nf = live.nightFactor;
    mats.glassFull.emissiveIntensity = nf * 0.55;
    const base = quality === 'high' ? 0.42 : quality === 'medium' ? 0.52 : 0.7;
    mats.glassFull.opacity = base + nf * 0.08;
    mats.slab.emissiveIntensity = 0;
    mats.led.opacity = 0.55 + 0.45 * Math.abs(Math.sin(clock.elapsedTime * 7));
    mats.cabin.emissiveIntensity = 0.3 + nf * 0.9;
  });

  const floors = useMemo(() => Array.from({ length: TOWER_FLOORS + 2 }, (_, i) => i - 1), []); // -1..7
  const visible = (f: number) => (f === -1 ? sel === -1 : f === ROOF ? sel === null : sel === null ? true : f <= sel);
  const label = FLOOR_DEPARTMENTS.find((d) => d.floor === sel);
  return (
    <group>
      {floors.map((f) => (
        <Floor key={f} f={f} visible={visible(f)} cut={sel === f} quality={quality} mats={mats}
          interior={quality !== 'low' || sel === f} />
      ))}
      <Elevators mats={mats} />
      <Team sel={sel} quality={quality} />
      {floors.filter((f) => f >= 0 && f < TOWER_FLOORS && f !== TEAM_FLOOR && visible(f)).map((f) => <Population key={f} f={f} sel={sel} quality={quality} />)}
      {quality !== 'low' && (sel === null || sel >= 0) && <LongChauGreeter />}
      {sel !== null && label && (
        <Html position={[-HX, sel * FLOOR_H + 3, HZ]} center distanceFactor={30} style={{ pointerEvents: 'none' }}>
          <div style={{ padding: '3px 10px', borderRadius: 10, background: 'rgba(15,122,115,0.92)', color: '#fff', font: '700 13px system-ui', whiteSpace: 'nowrap' }}>{label.label} • {label.name}</div>
        </Html>
      )}
    </group>
  );
};

export default FrtTower;
