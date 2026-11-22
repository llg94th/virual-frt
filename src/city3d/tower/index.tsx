/**
 * FPT Software F-Town 3 ("Building in the Park"): 7 floors + B1, 2 courtyard atria, terrace gardens,
 * cutaway dollhouse, real team bay on TEAM_FLOOR. Procedural only.
 */
import React, { memo, useEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import * as THREE from 'three';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import { interior } from '../shared';
import { FLOOR_H, TOWER_FLOORS, TEAM_FLOOR, FLOOR_DEPARTMENTS, cityStore, useCity, live, mulberry32, type Quality } from '../shared';
import { Character3D, appearanceFor } from '../characters';
import { EMPLOYEE_BY_ID } from '../../data/employees';
import { officeSimulationEngine } from '../../engine/simulationStore';
import { getBrandAtlas, CELLS, ATLAS, ATLAS_H } from './brand';
import { getFloor, atriumFlights, Furn, FT, CLEAR, CORE, HX, HZ, K, COURTYARDS, type Box, type Label, type Walker, type Prop } from './furn';
import { AgentView, FloorPeople, Effects, stepAgents, remap, syncTransfers, officeLookOf, type Agent } from './agents';
import { DOOR, GLAZE_INSET, LIFT_PAD, ENTRANCE, collidersFor, playerCollidersFor } from './nav';
import { getProp, usePropsState } from './props';
import { fasciaGeo, slabGeo, cortenGeo, carpetGeo } from './facade';
import { LongChauGreeter } from './greeter';
import { FiguresLayer } from './figures';
export { LongChauModel } from './greeter';

const BOX_GEO = new THREE.BoxGeometry(1, 1, 1);
const BALL_GEO = new THREE.IcosahedronGeometry(1, 1);
const ROOF = TOWER_FLOORS; // index of the roof group

// ---------- shared materials ----------
function useMats() {
  return useMemo(() => {
    const glassFull = new THREE.MeshStandardMaterial({ color: '#1d2d33', transparent: true, opacity: 0.55, roughness: 0.15, metalness: 0.5, depthWrite: false, side: THREE.DoubleSide, emissive: '#ffd9a0', emissiveIntensity: 0 });
    const glassCut = new THREE.MeshStandardMaterial({ color: '#9fd8d4', transparent: true, opacity: 0.05, roughness: 0.05, metalness: 0.2, depthWrite: false, side: THREE.DoubleSide });
    const grainBox = (() => { if (typeof document === 'undefined') return null; const t = (document.createElement('canvas')); t.width = t.height = 128; const g = t.getContext('2d')!; const r = mulberry32(21); g.fillStyle = '#f8f8f8'; g.fillRect(0, 0, 128, 128); for (let i = 0; i < 90; i++) { const v = 224 + ((r() * 30) | 0); g.fillStyle = `rgba(${v},${v},${v},0.5)`; const s = 6 + r() * 26; g.beginPath(); g.ellipse(r() * 128, r() * 128, s, s * (0.25 + r() * 0.4), 0, 0, 7); g.fill(); } for (let i = 0; i < 700; i++) { g.fillStyle = r() < 0.5 ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.06)'; g.fillRect(r() * 128, r() * 128, 1, 1); } const c = new THREE.CanvasTexture(t); c.colorSpace = THREE.SRGBColorSpace; c.anisotropy = 4; return c; })();
    const solid = new THREE.MeshStandardMaterial({ color: '#ffffff', map: grainBox, roughness: 0.72, metalness: 0.04 });
    const inner = new THREE.MeshStandardMaterial({ color: '#dfe9e6', transparent: true, opacity: 0.08, roughness: 0.05, depthWrite: false, side: THREE.DoubleSide });
    const screen = new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false });
    const dispTex = (() => { // desktop wallpaper: blue bloom, one open window, icons, taskbar
      if (typeof document === 'undefined') return null;
      const c = document.createElement('canvas'); c.width = 256; c.height = 144; const g = c.getContext('2d')!;
      const gr = g.createLinearGradient(0, 0, 256, 144); gr.addColorStop(0, '#0a2a6c'); gr.addColorStop(0.5, '#1c6fd1'); gr.addColorStop(1, '#6fc3ff'); g.fillStyle = gr; g.fillRect(0, 0, 256, 144);
      g.fillStyle = 'rgba(255,255,255,0.12)'; g.beginPath(); g.ellipse(170, 50, 90, 34, -0.5, 0, 7); g.fill();
      g.fillStyle = '#eef2f7'; g.fillRect(40, 14, 150, 100); g.fillStyle = '#2b3a55'; g.fillRect(40, 14, 150, 9);
      g.fillStyle = '#c9d3e2'; for (let i = 0; i < 7; i++) g.fillRect(48, 32 + i * 11, 40 + ((i * 37) % 70), 4);
      g.fillStyle = '#4c8dff'; g.fillRect(140, 70, 40, 34); g.fillStyle = '#ffffff'; for (let i = 0; i < 4; i++) g.fillRect(8, 10 + i * 24, 16, 14);
      g.fillStyle = '#141b2b'; g.fillRect(0, 132, 256, 12); g.fillStyle = '#4c8dff'; for (let i = 0; i < 5; i++) g.fillRect(8 + i * 14, 135, 9, 6);
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
    })();
    const display = new THREE.MeshBasicMaterial({ color: '#ffffff', map: dispTex, toneMapped: false });
    const led = new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false, transparent: true });
    const leaf = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.9, flatShading: true });
    const slab = new THREE.MeshStandardMaterial({ color: '#d9dcdb', roughness: 0.7 });
    const dots = (() => {
      if (typeof document === 'undefined') return null;
      const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d')!;
      g.fillStyle = '#f6f7f5'; g.fillRect(0, 0, 64, 64); g.fillStyle = '#c9cecb';
      for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) { g.beginPath(); g.arc(8 + x * 16 + (y % 2) * 8, 8 + y * 16, 2.2, 0, 7); g.fill(); }
      const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; return t;
    })();
    const fascia = new THREE.MeshStandardMaterial({ color: '#ffffff', map: dots, roughness: 0.7, side: THREE.DoubleSide });
    const corten = new THREE.MeshStandardMaterial({ color: '#8a3b22', roughness: 0.8, side: THREE.DoubleSide });
    const tex = (draw: (g: CanvasRenderingContext2D, n: number) => void, repeat: number) => {
      if (typeof document === 'undefined') return null;
      const c = document.createElement('canvas'); c.width = c.height = 512; const g = c.getContext('2d')!; draw(g, 512);
      const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat, repeat); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
    };
    // charcoal-grey carpet tiles (0.5 m tiles, 4x4 per 2 m texture) with dye-lot variation, fibre speckle and dark seams
    const carpetMap = tex((g, n) => {
      const h = n / 4, r = mulberry32(5);
      for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) { const v = (r() - 0.5) * 14; g.fillStyle = `rgb(${66 + v},${70 + v},${75 + v})`; g.fillRect(x * h, y * h, h, h); }
      for (let i = 0; i < 14000; i++) { g.fillStyle = r() < 0.5 ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.12)'; g.fillRect(r() * n, r() * n, 1.5, 1.5 + r() * 3); }
      g.strokeStyle = 'rgba(20,22,25,0.6)'; g.lineWidth = 3;
      for (let i = 0; i <= 4; i++) { g.beginPath(); g.moveTo(i * h, 0); g.lineTo(i * h, n); g.moveTo(0, i * h); g.lineTo(n, i * h); g.stroke(); }
    }, 0.5);
    // greyscale pile bump (shared by carpet): fibre speckle + tile seams
    const carpetBump = tex((g, n) => {
      const h = n / 2, r = mulberry32(6); // (seams every n/4 px via h/2)
      g.fillStyle = '#808080'; g.fillRect(0, 0, n, n);
      for (let i = 0; i < 14000; i++) { const v = (r() * 255) | 0; g.fillStyle = `rgba(${v},${v},${v},0.55)`; g.fillRect(r() * n, r() * n, 1.5, 1.5 + r() * 2.5); }
      g.strokeStyle = '#303030'; g.lineWidth = 4;
      for (let i = 0; i <= 4; i++) { g.beginPath(); g.moveTo(i * h / 2, 0); g.lineTo(i * h / 2, n); g.moveTo(0, i * h / 2); g.lineTo(n, i * h / 2); g.stroke(); }
    }, 0.5);
    // soft blotchy grain for all instanced furniture boxes / concrete: breaks up flat colour (multiplies instance colour)
    const grain = (rep: number, grid: boolean, seed: number) => tex((g, n) => {
      const r = mulberry32(seed);
      g.fillStyle = '#f4f4f4'; g.fillRect(0, 0, n, n);
      for (let i = 0; i < 260; i++) { const v = 215 + ((r() * 40) | 0); g.fillStyle = `rgba(${v},${v},${v},0.5)`; const s = 14 + r() * 70; g.beginPath(); g.ellipse(r() * n, r() * n, s, s * (0.3 + r() * 0.5), r() * 3, 0, 7); g.fill(); }
      for (let i = 0; i < 5000; i++) { g.fillStyle = r() < 0.5 ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.07)'; g.fillRect(r() * n, r() * n, 1.5, 1.5); }
      if (grid) { g.strokeStyle = 'rgba(120,125,125,0.5)'; g.lineWidth = 3; const q = n / 4; for (let i = 0; i < 4; i++) { g.beginPath(); g.moveTo(i * q, 0); g.lineTo(i * q, n); g.moveTo(0, i * q); g.lineTo(n, i * q); g.stroke(); } }
    }, rep);
    // marble lobby: 2 m tiles, alternate tone, light veins
    const marbleMap = tex((g, n) => {
      const h = n / 2, r = mulberry32(9);
      for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) { g.fillStyle = (x + y) % 2 ? '#e4e3dd' : '#f1f0ea'; g.fillRect(x * h, y * h, h, h); }
      g.strokeStyle = 'rgba(150,150,145,0.35)'; g.lineWidth = 1;
      for (let i = 0; i < 26; i++) { g.beginPath(); let px = r() * n, py = r() * n; g.moveTo(px, py); for (let k = 0; k < 5; k++) { px += (r() - 0.5) * 90; py += (r() - 0.3) * 90; g.lineTo(px, py); } g.stroke(); }
      g.strokeStyle = '#a9a79c'; g.lineWidth = 4; g.strokeRect(2, 2, n - 4, n - 4); g.beginPath(); g.moveTo(h, 0); g.lineTo(h, n); g.moveTo(0, h); g.lineTo(n, h); g.stroke();
    }, 0.25);
    const slabMap = grain(0.25, true, 33); slab.map = slabMap;
    const carpet = new THREE.MeshStandardMaterial({ color: '#ffffff', map: carpetMap, bumpMap: carpetBump, bumpScale: 1.6, roughness: 0.96, envMapIntensity: 0.6 });
    const marble = new THREE.MeshStandardMaterial({ color: '#ffffff', map: marbleMap, roughness: 0.22, metalness: 0.05, bumpMap: marbleMap, bumpScale: 0.4 });
    const plate = new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false });
    const prop = new THREE.MeshStandardMaterial({ color: '#ffffff', vertexColors: true, roughness: 0.75, metalness: 0.05 });
    const cabin = new THREE.MeshStandardMaterial({ color: '#cfe9e6', emissive: '#bff5ef', emissiveIntensity: 0.4, roughness: 0.3, metalness: 0.4 });
    return { glassFull, glassCut, solid, inner, screen, display, led, leaf, slab, cabin, fascia, corten, carpet, plate, prop, marble };
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
  const key = `${l.art ?? ''}|${l.t}|${l.fg}|${l.bg}|${l.w / l.h}`;
  let t = texCache.get(key); if (t) return t;
  const cw = 1024, ch = Math.max(64, Math.round((cw * l.h) / l.w));
  const c = document.createElement('canvas'); c.width = cw; c.height = ch;
  const g = c.getContext('2d')!;
  if (l.art === 'compass') {
    const m = cw / 2; g.translate(m, ch / 2);
    for (const [r, col, lw] of [[m * 0.96, '#6f8f86', 14], [m * 0.84, '#c9a24a', 6], [m * 0.62, '#6f8f86', 10]] as const) { g.strokeStyle = col; g.lineWidth = lw; g.beginPath(); g.arc(0, 0, r, 0, 7); g.stroke(); }
    for (let i = 0; i < 8; i++) { const a = (i * Math.PI) / 4, long = i % 2 === 0, R = m * (long ? 0.9 : 0.66); g.fillStyle = long ? '#2e6f66' : '#c9a24a'; g.beginPath(); g.moveTo(Math.cos(a) * R, Math.sin(a) * R); g.lineTo(Math.cos(a + 0.17) * m * 0.14, Math.sin(a + 0.17) * m * 0.14); g.lineTo(Math.cos(a - 0.17) * m * 0.14, Math.sin(a - 0.17) * m * 0.14); g.fill(); }
    g.fillStyle = '#f08a3a'; g.beginPath(); g.arc(0, 0, m * 0.09, 0, 7); g.fill();
    const t0 = new THREE.CanvasTexture(c); t0.colorSpace = THREE.SRGBColorSpace; texCache.set(key, t0); return t0;
  }
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
    add(0, -HZ + i, 2 * HX - 2 * sh, 0.06);
    if (f === 0) { // main entrance gap on the south facade
      const x0 = -HX + sh, x1 = HX - sh, g0 = DOOR.x - DOOR.halfW, g1 = DOOR.x + DOOR.halfW;
      add((x0 + g0) / 2, HZ - i, g0 - x0, 0.06); add((g1 + x1) / 2, HZ - i, x1 - g1, 0.06);
    } else add(0, HZ - i, 2 * HX - 2 * sh, 0.06); add(-HX + i, 0, 0.06, 2 * HZ - 2 * sh); add(HX - i, 0, 0.06, 2 * HZ - 2 * sh);
    for (const c of COURTYARDS) {
      const o = 0.6, w = c.w - 2 * 3, d = c.d - 2 * 3;
      add(c.x, c.z - c.d / 2 - o, w, 0.06); add(c.x, c.z + c.d / 2 + o, w, 0.06); add(c.x - c.w / 2 - o, c.z, 0.06, d); add(c.x + c.w / 2 + o, c.z, 0.06, d);
    }
    return out;
  }, [isRoof, data, f]);
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
      {f === 0 && <mesh geometry={carpetGeo()} material={mats.marble} position={[0, FT + 0.004, 0]} receiveShadow />}
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
      {on && <InstBoxes list={furn.disp} material={mats.display} />}
      {on && furn.plates.length > 0 && <Plates furn={furn} mat={mats.plate} />}
      {on && furn.decals.length > 0 && <BrandDecals furn={furn} />}
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
      <instancedMesh ref={a} args={[geo.main, geo.mat ?? mats.prop, items.length]} frustumCulled={false} castShadow={shadow} receiveShadow={shadow} />
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

/** All FPT Retail brand decals of a Furn merged into ONE mesh sharing ONE atlas texture (1 draw call, alpha-tested so no sorting). */
const BrandDecals: React.FC<{ furn: Furn }> = ({ furn }) => {
  const { geo, mat } = useMemo(() => {
    const pos: number[] = [], uv: number[] = [], idx: number[] = [], nrm: number[] = [];
    for (const d of furn.decals) {
      const c = CELLS[d.id]; if (!c) continue;
      const base = pos.length / 3, cs = Math.cos(d.rot), sn = Math.sin(d.rot);
      for (const [lx, ly] of [[-d.w / 2, -d.h / 2], [d.w / 2, -d.h / 2], [d.w / 2, d.h / 2], [-d.w / 2, d.h / 2]]) {
        if (d.flat) { pos.push(d.x + lx * cs - ly * sn, FT + d.y, d.z - (lx * sn + ly * cs)); nrm.push(0, 1, 0); }
        else { pos.push(d.x + lx * cs, FT + d.y + ly, d.z - lx * sn); nrm.push(sn, 0, cs); }
      }
      const u0 = (c.x + 0.5) / ATLAS, u1 = (c.x + c.w - 0.5) / ATLAS, v1 = 1 - (c.y + 0.5) / ATLAS_H, v0 = 1 - (c.y + c.h - 0.5) / ATLAS_H;
      uv.push(u0, v0, u1, v0, u1, v1, u0, v1); idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geo.setIndex(idx);
    const mat = new THREE.MeshBasicMaterial({ map: getBrandAtlas(), alphaTest: 0.4, toneMapped: false, color: '#f4f4f4', polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    return { geo, mat };
  }, [furn]);
  useEffect(() => () => { geo.dispose(); mat.dispose(); }, [geo, mat]);
  return <mesh geometry={geo} material={mat} frustumCulled={false} />;
};

const FloorLights: React.FC<{ quality: Quality }> = ({ quality }) => {
  const refs = useRef<THREE.PointLight[]>([]);
  // low, wide, dim fill (no hot-spot): the visible light comes from the ceiling panels
  useFrame(() => { const nf = live.nightFactor; refs.current.forEach((l) => { if (l) l.intensity = 3 + nf * 9; }); });
  const pts: [number, number][] = quality === 'high' ? [[4, -12], [16, -12], [4, 0], [16, 0], [4, 12], [16, 12]] : [[10, -9], [10, 9]];
  return <>{pts.map(([x, z], i) => <pointLight key={i} ref={(r) => { if (r) refs.current[i] = r; }} position={[x, 3.3, z]} distance={22} decay={2} color="#ffe6bf" intensity={4} />)}</>;
};

/** Open main entrance: door frame, canopy, mat and a short ramp up to the lobby slab (no glazing / rotor in the way). */
const RevolvingDoor: React.FC<{ mats: Mats }> = ({ mats }) => {
  return (
    <group position={[DOOR.x, 0, HZ - GLAZE_INSET]}>
      {[-DOOR.halfW - 0.08, DOOR.halfW + 0.08].map((x) => <mesh key={x} position={[x, FT + 1.25, 0]} scale={[0.16, 2.5, 0.2]} geometry={BOX_GEO} material={mats.solid} />)}
      <mesh position={[0, FT + 2.55, 0]} scale={[2 * DOOR.halfW + 0.5, 0.2, 0.3]} geometry={BOX_GEO} material={mats.slab} />
      <mesh position={[0, FT + 0.012, 0.3]} scale={[2.8, 0.025, 1.2]} geometry={BOX_GEO}><meshStandardMaterial color="#3a4a50" roughness={1} /></mesh>
      <mesh position={[0, 0.07, 1.25]} rotation={[0.19, 0, 0]} scale={[2.8, 0.12, 1.75]} geometry={BOX_GEO}><meshStandardMaterial color="#c9ced0" roughness={0.9} /></mesh>
    </group>
  );
};

// ---------- animated bits: elevators + LED blink + night glow ----------
const Elevators: React.FC<{ mats: Mats }> = ({ mats }) => {
  const a = useRef<THREE.Group>(null!), b = useRef<THREE.Group>(null!);
  const da = useRef<THREE.Group>(null!), db = useRef<THREE.Group>(null!);
  const open = useRef(0);
  // floor indicator on the lintel above the player's lift doorway (follows the player's floor, shows "B1"/"F1".."F7")
  const ind = useMemo(() => {
    const cv = document.createElement('canvas'); cv.width = 128; cv.height = 64;
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false });
    return { cv, tex, mat, last: -99 };
  }, []);
  const indRef = useRef<THREE.Mesh>(null!);
  useFrame(({ clock }, dt) => {
    const pfl = live.playerFloor;
    if (indRef.current) {
      indRef.current.visible = pfl !== null;
      if (pfl !== null) {
        indRef.current.position.y = FT + pfl * FLOOR_H + 2.78;
        if (ind.last !== pfl) {
          ind.last = pfl;
          const c = ind.cv.getContext('2d')!;
          c.fillStyle = '#10201f'; c.fillRect(0, 0, 128, 64);
          c.fillStyle = '#7dffb0'; c.font = 'bold 44px monospace'; c.textAlign = 'center'; c.textBaseline = 'middle';
          c.fillText(pfl < 0 ? 'B1' : 'F' + (pfl + 1), 64, 34); ind.tex.needsUpdate = true;
        }
      }
    }
    const sel = cityStore.get().selectedFloor;
    const maxF = sel === null ? TOWER_FLOORS - 1 : Math.min(sel, TOWER_FLOORS - 1);
    const pf = live.playerFloor;
    const onPad = pf !== null && Math.hypot(live.player.x - LIFT_PAD.x, live.player.z - LIFT_PAD.z) < LIFT_PAD.r;
    open.current += ((onPad ? 1 : 0) - open.current) * Math.min(1, dt * 4);
    const run = (g: THREE.Group | null, d: THREE.Group | null, sp: number, ph: number, park: boolean) => {
      if (!g) return;
      const tri = Math.abs((((clock.elapsedTime * sp + ph) % 2) + 2) % 2 - 1);
      const s = tri * tri * (3 - 2 * tri);
      const fl = park && pf !== null ? Math.min(pf, maxF) : -1 + (maxF + 1) * s;
      const ty = FT + fl * FLOOR_H + 1.25;
      g.position.y = park && pf !== null ? g.position.y + (ty - g.position.y) * Math.min(1, dt * 6) : ty; // parked cabin snaps to the player's floor
      if (d) { const o = (park ? open.current : 0) * 0.55; d.children[0].position.x = -0.5 - o; d.children[1].position.x = 0.5 + o; }
    };
    run(a.current, da.current, 0.05, 0, onPad); run(b.current, db.current, 0.037, 0.8, false);
  });
  const cabin = (ref: React.RefObject<THREE.Group>, door: React.RefObject<THREE.Group>, x: number) => (
    <group ref={ref} position={[x, 1.5, 0]}>
      <mesh scale={[2, 2.5, 2.2]} geometry={BOX_GEO} material={mats.cabin} />
      <group ref={door} position={[0, 0, 1.12]}>
        {[-1, 1].map((sx) => <mesh key={sx} position={[sx * 0.5, -0.15, 0]} scale={[0.98, 2.2, 0.05]} geometry={BOX_GEO} material={mats.solid} />)}
      </group>
    </group>
  );
  return <>{cabin(a, da, -3.75)}{cabin(b, db, -1.25)}
    <mesh ref={indRef} position={[LIFT_PAD.x, 3, CORE.z + CORE.d / 2 + 0.13]} scale={[0.9, 0.45, 1]} material={ind.mat} visible={false}><planeGeometry args={[1, 1]} /></mesh></>;
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

const FiguresNearGate: React.FC<{ sel: number | null; quality: Quality }> = ({ sel, quality }) => <FiguresLayer sel={sel} quality={quality} near={useNearTower()} />;

const Population: React.FC<{ f: number; sel: number | null; quality: Quality }> = ({ f, sel, quality }) => {
  const near = useNearTower();
  const show = sel === f || (near && quality === 'high' && (sel === null || sel >= f));
  if (!show) return null;
  return <FloorPeople f={f} />;
};

const Team: React.FC<{ sel: number | null; quality: Quality }> = ({ sel, quality }) => {
  const key = useSyncExternalStore(
    officeSimulationEngine.subscribe,
    () => {
      const sn = officeSimulationEngine.getSnapshot();
      return `${sn.selectedEmployeeId ?? ''}\u0001${sn.employees.map((e) => `${e.id}~${e.seatCode ?? ''}~${e.deskId ?? ''}~${e.account ?? ''}`).join('|')}\u0001${sn.employees.map((e) => `${e.id}:${e.status}`).join('|')}`;
    },
  );
  const [selectedId, mapKey, statuses] = useMemo(() => key.split('\u0001') as [string, string, string], [key]);
  const status = useMemo(() => Object.fromEntries(statuses.split('|').map((s) => s.split(':'))) as Record<string, string>, [statuses]);
  // real employees -> seats (exact by assigned id / desk / seat code / account, else a stable proxy seat); re-mapped whenever the roster changes
  const { mapping, empById } = useMemo(() => {
    const emps = officeSimulationEngine.getSnapshot().employees;
    return { mapping: remap(emps), empById: new Map(emps.map((e) => [e.id, e])) };
  }, [mapKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const agents = mapping.agents;
  const [hover, setHover] = React.useState<string | null>(null);
  const floorVisible = sel === null || sel >= TEAM_FLOOR;
  const near = useNearTower();
  const show = floorVisible && (sel !== null || near) && (quality === 'low' ? sel === TEAM_FLOOR : true);
  const interactive = sel === TEAM_FLOOR;
  const y = TEAM_FLOOR * FLOOR_H + FT;
  // employee status -> seated pose (idle people lean back, others type)
  useEffect(() => {
    for (const a of agents) { const st = status[a.emp ?? ''] ?? 'IDLE'; a.home.pose = st === 'IDLE' ? 'sit' : 'type'; if (a.st === 'home' && a.pose !== a.home.pose) { a.pose = a.home.pose; a.setPose(a.home.pose); } }
  }, [agents, status]);
  // simulation-driven document handoffs (re-run after a re-map so proxies resolve)
  useEffect(() => {
    const run = () => syncTransfers(officeSimulationEngine.getSnapshot().activeTransfers);
    run(); return officeSimulationEngine.subscribe(run);
  }, [mapping]);
  if (!show) return null;
  return (
    <>
      <StatusDots agents={agents} status={status} />
      {agents.map((a) => {
        const emp = empById.get(a.emp ?? '');
        const chipOn = interactive && (hover === a.id || a.emp === 'EMP-01' || a.emps.includes(selectedId));
        const handlers = interactive ? {
          onPointerOver: (e: ThreeEvent<PointerEvent>) => { e.stopPropagation(); setHover(a.id); setCursor('pointer'); },
          onPointerOut: () => { setHover(null); setCursor('auto'); },
          onClick: (e: ThreeEvent<MouseEvent>) => { e.stopPropagation(); officeSimulationEngine.selectEmployee(a.emp ?? null); },
        } : undefined;
        const st = status[a.emp ?? ''] ?? emp?.status ?? 'IDLE';
        const chip = chipOn ? (
          <Html position={[0, 1.95, 0]} center distanceFactor={11} zIndexRange={[20, 0]} style={{ pointerEvents: 'none' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '1px 6px', borderRadius: 8, background: 'rgba(12,28,26,0.88)', color: '#fff', font: '600 10px system-ui', whiteSpace: 'nowrap', border: `1px solid ${emp?.badgeColor ?? '#2e8f8a'}` }}>
              <span style={{ width: 6, height: 6, borderRadius: 3, background: STATUS_COLOR[st] ?? '#f59e0b' }} />
              {emp?.displayName ?? a.emp}<span style={{ opacity: 0.65, fontWeight: 400 }}>{emp?.account ? `${emp.account} · ` : ''}{emp?.role ?? ''} · {st}</span>
            </div>
          </Html>
        ) : null;
        return <AgentView key={a.id} a={a} look={officeLookOf(a.emp ?? a.id, emp?.role)} handlers={handlers} chip={chip} office />;
      })}
      {quality === 'high' && mapping.freeSlots.map((s) => <Npc key={s.id} id={`seat-${s.id}`} x={s.x} y={y} z={s.z} rot={s.rot} pose="type" />)}
    </>
  );
};
const STATUS_COLOR: Record<string, string> = { WORKING: '#22c55e', IDLE: '#9ca3af', REVIEWING: '#3b82f6', WALKING: '#f59e0b', CARRYING_DOCS: '#f59e0b', HANDOFF: '#a855f7', WALKING_BACK: '#f59e0b' };
/** one instanced mesh: tiny coloured status dot above each person; follows people who get up and walk */
const StatusDots: React.FC<{ agents: Agent[]; status: Record<string, string> }> = ({ agents, status }) => {
  const ref = useRef<THREE.InstancedMesh>(null!);
  const col = useMemo(() => new THREE.Color(), []), o = useMemo(() => new THREE.Object3D(), []);
  useLayoutEffect(() => {
    const m = ref.current; if (!m) return;
    agents.forEach((a, i) => m.setColorAt(i, col.set(STATUS_COLOR[status[a.emp ?? ''] ?? 'IDLE'] ?? '#f59e0b')));
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }, [agents, status, col]);
  useFrame(() => {
    const m = ref.current; if (!m) return;
    for (let i = 0; i < agents.length; i++) { const a = agents[i]; o.position.set(a.x, TEAM_FLOOR * FLOOR_H + FT + (a.st === 'go' || a.st === 'back' ? 2.0 : 1.72), a.z); o.updateMatrix(); m.setMatrixAt(i, o.matrix); }
    m.instanceMatrix.needsUpdate = true;
  });
  if (!agents.length) return null;
  return <instancedMesh ref={ref} args={[DOT_GEO, DOT_MAT, agents.length]} frustumCulled={false} />;
};
const DOT_GEO = new THREE.IcosahedronGeometry(0.11, 0);
const DOT_MAT = new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false });

// ---------- root ----------
export const FrtTower: React.FC = () => {
  const sel = useCity((s) => s.selectedFloor);
  const mode = useCity((s) => s.cameraMode);
  const quality = useCity((s) => s.quality);
  const mats = useMats();

  // interior registry for the Player (walk-in): floor heights, colliders, entrance, lift pad
  useEffect(() => {
    interior.floorY = (f) => f * FLOOR_H + FT;
    interior.colliders = (f) => playerCollidersFor(f);
    interior.entrance = { outside: ENTRANCE.outside, inside: ENTRANCE.inside };
    interior.lifts = [{ x: LIFT_PAD.x, z: LIFT_PAD.z, r: LIFT_PAD.r }];
    interior.stairs = atriumFlights().map((s) => ({ floorA: s.floorA, floorB: s.floorB, a: s.a, b: s.b, width: s.width }));
    interior.ready = true;
    return () => { interior.ready = false; };
  }, []);

  useFrame(({ clock }, dt) => {
    if (quality !== 'low') stepAgents(Math.min(dt, 0.1));
    const nf = live.nightFactor;
    mats.glassFull.emissiveIntensity = nf * 0.55;
    const base = quality === 'high' ? 0.42 : quality === 'medium' ? 0.52 : 0.7;
    mats.glassFull.opacity = base + nf * 0.08;
    mats.slab.emissiveIntensity = 0;
    mats.led.opacity = 0.55 + 0.45 * Math.abs(Math.sin(clock.elapsedTime * 7));
    mats.cabin.emissiveIntensity = 0.3 + nf * 0.9;
  });

  const floors = useMemo(() => Array.from({ length: TOWER_FLOORS + 2 }, (_, i) => i - 1), []); // -1..7
  // eye-level office tour: keep the floor above as a ceiling (shell only) so the room is not open to the sky
  const lid = mode === 'office' && sel !== null && sel >= 0 && sel < TOWER_FLOORS - 1 ? sel + 1 : -9;
  const visible = (f: number) => (f === -1 ? sel === -1 : f === ROOF ? sel === null : sel === null ? true : f <= sel || f === lid);
  const label = FLOOR_DEPARTMENTS.find((d) => d.floor === sel);
  return (
    <group>
      {floors.map((f) => (
        <Floor key={f} f={f} visible={visible(f)} cut={sel === f} quality={quality} mats={mats}
          interior={f === lid ? false : quality !== 'low' || sel === f} />
      ))}
      <Elevators mats={mats} />
      {quality !== 'low' && <Effects />}
      <Team sel={sel} quality={quality} />
      {floors.filter((f) => f >= 0 && f < TOWER_FLOORS && f !== TEAM_FLOOR && f !== lid && visible(f)).map((f) => <Population key={f} f={f} sel={sel} quality={quality} />)}
      {quality !== 'low' && (sel === null || sel >= 0) && <LongChauGreeter />}
      <FiguresNearGate sel={sel} quality={quality} />
      {sel !== null && label && (
        <Html position={[-HX, sel * FLOOR_H + 3, HZ]} center distanceFactor={30} style={{ pointerEvents: 'none' }}>
          <div style={{ padding: '3px 10px', borderRadius: 10, background: 'rgba(15,122,115,0.92)', color: '#fff', font: '700 13px system-ui', whiteSpace: 'nowrap' }}>{label.label} • {label.name}</div>
        </Html>
      )}
    </group>
  );
};

export default FrtTower;
