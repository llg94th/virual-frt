import React, { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { stylize } from '../characters/stylize';
import { useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CITY_EXTENT, CITY_SEED, ROAD_LINES, ROAD_W, cityStore, live, mulberry32, useCity } from '../shared';
import { CityAudio } from './audio';

export { CityAudio };

// =====================================================================
// Public state / API
// =====================================================================
export interface VehicleObstacle { cx: number; cz: number; w: number; d: number; h: number }
let obstacles: VehicleObstacle[] = [];
/** Provide AABB building colliders (world space) for the hero car. */
export function setVehicleObstacles(list: VehicleObstacle[]) { obstacles = list; }

/** Mutable hero car pose. Heading convention: forward = (sin h, cos h). */
export const heroCar = { x: 0, z: 36, heading: Math.PI / 2, speed: 0 };
/** Traffic positions (x,z pairs) for the minimap. */
export const trafficView = { count: 0, pos: new Float32Array(2 * 400) };

/** Rideable vehicles. `heroCar` is always the pose of the ACTIVE ride; the other one is stored parked here. */
export type RideKind = 'car' | 'scooter';
export const rides = { active: 'car' as RideKind, car: { x: 0, z: 36, heading: Math.PI / 2 }, scooter: { x: 9, z: 26, heading: Math.PI / 2 } };
const poseOf = (k: RideKind) => (rides.active === k ? heroCar : rides[k]);
/** Which ride is within reach of the walking player (or null). */
export function nearestRide(): RideKind | null {
  let best: RideKind | null = null, bd = 1e9;
  for (const [k, r] of [['car', 6], ['scooter', 4]] as [RideKind, number][]) {
    const p = poseOf(k); const d = Math.hypot(live.player.x - p.x, live.player.z - p.z);
    if (d < r && d < bd) { best = k; bd = d; }
  }
  return best;
}
function switchRide(k: RideKind) {
  if (k === rides.active) return;
  rides[rides.active] = { x: heroCar.x, z: heroCar.z, heading: heroCar.heading };
  const n = rides[k];
  heroCar.x = n.x; heroCar.z = n.z; heroCar.heading = n.heading; heroCar.speed = 0;
  hv.vx = 0; hv.vz = 0; hv.steer = 0;
  rides.active = k;
}

export function setDriving(on: boolean, kind?: RideKind) {
  const s = cityStore.get();
  if (on) {
    if (kind) switchRide(kind);
    cityStore.set({ playerMode: 'drive', cameraMode: 'drive' });
  } else {
    const h = heroCar.heading;
    live.player.x = heroCar.x - Math.cos(h) * 2.8;
    live.player.z = heroCar.z + Math.sin(h) * 2.8;
    live.player.y = 0;
    live.player.heading = h;
    live.player.speed = 0;
    cityStore.set({ playerMode: 'walk', cameraMode: s.cameraMode === 'drive' ? 'follow' : s.cameraMode });
  }
}

// =====================================================================
// Geometry helpers
// =====================================================================
type G = THREE.BufferGeometry;
const _c = new THREE.Color();
function paint(g: G, c: THREE.ColorRepresentation): G {
  _c.set(c);
  const n = g.attributes.position.count;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = _c.r; a[i * 3 + 1] = _c.g; a[i * 3 + 2] = _c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}
const box = (w: number, h: number, d: number, x: number, y: number, z: number, c: THREE.ColorRepresentation): G => {
  const g = new THREE.BoxGeometry(w, h, d); g.translate(x, y, z); return paint(g, c);
};
const wheelG = (r: number, w: number, x: number, y: number, z: number, c: THREE.ColorRepresentation = '#111'): G => {
  const g = new THREE.CylinderGeometry(r, r, w, 10); g.rotateZ(Math.PI / 2); g.translate(x, y, z); return paint(g, c);
};
const ball = (r: number, x: number, y: number, z: number, c: THREE.ColorRepresentation): G => {
  const g = new THREE.SphereGeometry(r, 8, 6); g.translate(x, y, z); return paint(g, c);
};
const merge = (a: G[]): G => mergeGeometries(a, false) as G;
const W = '#ffffff';
const HEAD = '#fff3c4';
const TAIL = '#ff2222';

interface Model { body: G; dark: G; heads: G; tails: G; rider?: boolean }
interface CarSpec {
  len: number; wid: number; bodyH: number; bodyY: number; cabW: number; cabH: number; cabY: number; cabL: number; cabZ: number;
  wheelR: number; wheelZ: number[]; wheels: boolean; roofSign?: boolean;
}
function carModel(s: CarSpec): Model {
  const body = [box(s.wid, s.bodyH, s.len, 0, s.bodyY, 0, W), box(s.cabW, s.cabH, s.cabL, 0, s.cabY, s.cabZ, W)];
  const dark: G[] = [
    box(s.cabW + 0.06, s.cabH * 0.72, s.cabL + 0.06, 0, s.cabY + 0.02, s.cabZ, '#10161d'),
    box(s.wid - 0.1, 0.16, 0.12, 0, s.bodyY - s.bodyH / 2 + 0.12, s.len / 2, '#1a1a1a'),
    box(s.wid - 0.1, 0.16, 0.12, 0, s.bodyY - s.bodyH / 2 + 0.12, -s.len / 2, '#1a1a1a'),
  ];
  if (s.wheels) for (const z of s.wheelZ) { dark.push(wheelG(s.wheelR, 0.26, s.wid / 2 - 0.05, s.wheelR, z)); dark.push(wheelG(s.wheelR, 0.26, -s.wid / 2 + 0.05, s.wheelR, z)); }
  const hy = s.bodyY + 0.05;
  const heads = [box(0.38, 0.18, 0.06, 0.6, hy, s.len / 2 + 0.01, HEAD), box(0.38, 0.18, 0.06, -0.6, hy, s.len / 2 + 0.01, HEAD)];
  const tails = [box(0.42, 0.14, 0.06, 0.6, hy, -s.len / 2 - 0.01, TAIL), box(0.42, 0.14, 0.06, -0.6, hy, -s.len / 2 - 0.01, TAIL)];
  if (s.roofSign) heads.push(box(0.5, 0.18, 0.22, 0, s.cabY + s.cabH / 2 + 0.1, s.cabZ, '#ffffcc'));
  return { body: merge(body), dark: merge(dark), heads: merge(heads), tails: merge(tails) };
}
const SEDAN: CarSpec = { len: 4.4, wid: 1.8, bodyH: 0.6, bodyY: 0.65, cabW: 1.5, cabH: 0.5, cabY: 1.2, cabL: 2.2, cabZ: -0.2, wheelR: 0.34, wheelZ: [1.4, -1.4], wheels: true };
function busModel(): Model {
  const dark = [box(2.56, 0.9, 10.4, 0, 2.25, 0, '#10161d'), box(2.2, 0.5, 0.1, 0, 2.6, 5.52, '#0a0a0a')];
  for (const z of [3.4, -3.2, -4.4]) { dark.push(wheelG(0.5, 0.3, 1.2, 0.5, z), wheelG(0.5, 0.3, -1.2, 0.5, z)); }
  return {
    body: merge([box(2.5, 2.9, 11, 0, 1.95, 0, W)]), dark: merge(dark),
    heads: merge([box(0.4, 0.22, 0.06, 0.9, 0.9, 5.51, HEAD), box(0.4, 0.22, 0.06, -0.9, 0.9, 5.51, HEAD)]),
    tails: merge([box(0.4, 0.22, 0.06, 0.9, 0.9, -5.51, TAIL), box(0.4, 0.22, 0.06, -0.9, 0.9, -5.51, TAIL)]),
  };
}
function truckModel(): Model {
  const dark = [box(2.3, 0.9, 0.1, 0, 2.0, 3.72, '#10161d'), box(2.4, 0.3, 7.6, 0, 0.55, -0.3, '#222')];
  for (const z of [2.8, -2.2, -3.4]) { dark.push(wheelG(0.5, 0.3, 1.1, 0.5, z), wheelG(0.5, 0.3, -1.1, 0.5, z)); }
  return {
    body: merge([box(2.3, 2.0, 2.2, 0, 1.6, 2.6, W), box(2.5, 2.6, 5.6, 0, 2.15, -1.4, '#d8d8d8')]), dark: merge(dark),
    heads: merge([box(0.4, 0.22, 0.06, 0.8, 0.95, 3.71, HEAD), box(0.4, 0.22, 0.06, -0.8, 0.95, 3.71, HEAD)]),
    tails: merge([box(0.4, 0.22, 0.06, 0.9, 0.9, -4.21, TAIL), box(0.4, 0.22, 0.06, -0.9, 0.9, -4.21, TAIL)]),
  };
}
function bikeModel(): Model {
  return {
    body: merge([box(0.28, 0.45, 1.1, 0, 0.55, 0, W), box(0.5, 0.62, 0.32, 0, 1.3, -0.12, W), box(0.18, 0.4, 0.3, 0.3, 1.35, 0.1, W), box(0.18, 0.4, 0.3, -0.3, 1.35, 0.1, W)]),
    dark: merge([
      wheelG(0.3, 0.1, 0, 0.3, 0.72), wheelG(0.3, 0.1, 0, 0.3, -0.72),
      box(0.7, 0.06, 0.06, 0, 1.0, 0.55, '#111'), box(0.36, 0.5, 0.38, 0, 0.85, -0.12, '#1d2740'),
      ball(0.17, 0, 1.78, -0.08, '#f1f1f1'), box(0.3, 0.1, 0.3, 0, 0.42, -0.5, '#222'),
    ]),
    heads: merge([box(0.2, 0.14, 0.06, 0, 0.95, 0.6, HEAD)]),
    tails: merge([box(0.2, 0.1, 0.05, 0, 0.7, -0.93, TAIL)]),
    rider: true,
  };
}

// =====================================================================
// Traffic signals
// =====================================================================
const CYCLE = 28;
/** 0 green, 1 yellow, 2 red for the given axis (0 = moving along x, 1 = along z). */
function lightFor(axis: 0 | 1, t: number): 0 | 1 | 2 {
  const m = t % CYCLE;
  const a = axis === 0 ? 0 : 14;
  const r = m - a;
  if (r >= 0 && r < 11) return 0;
  if (r >= 11 && r < 13) return 1;
  return 2;
}
const NL = ROAD_LINES.length;
let simT = 0;

const POLES = [
  { ox: -8, oz: 8, axis: 0 as const, fx: -1, fz: 0, rot: Math.PI },
  { ox: 8, oz: -8, axis: 0 as const, fx: 1, fz: 0, rot: 0 },
  { ox: -8, oz: -8, axis: 1 as const, fx: 0, fz: -1, rot: Math.PI / 2 },
  { ox: 8, oz: 8, axis: 1 as const, fx: 0, fz: 1, rot: -Math.PI / 2 },
];
const LAMP_COL = [new THREE.Color('#ff2b2b'), new THREE.Color('#ffb400'), new THREE.Color('#22e06a')];

const TrafficLights: React.FC = () => {
  const data = useMemo(() => {
    const poleGeo = merge([
      box(0.24, 6.2, 0.24, 0, 3.1, 0, '#3a3f45'),
      box(0.4, 1.3, 0.5, 0.2, 6.2, 0, '#15181c'),
    ]);
    const poleMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.4 });
    const total = ROAD_LINES.length * ROAD_LINES.length * 4;
    const poles = new THREE.InstancedMesh(poleGeo, poleMat, total);
    const lampGeo = new THREE.SphereGeometry(0.15, 8, 6);
    const lampMat = new THREE.MeshBasicMaterial({ toneMapped: false });
    const lamps = new THREE.InstancedMesh(lampGeo, lampMat, total * 3);
    const d = new THREE.Object3D();
    const meta: number[] = []; // axis per pole
    let pi = 0;
    for (const X of ROAD_LINES) for (const Z of ROAD_LINES) {
      for (const p of POLES) {
        d.position.set(X + p.ox, 0, Z + p.oz); d.rotation.set(0, p.rot, 0); d.scale.set(1, 1, 1); d.updateMatrix();
        poles.setMatrixAt(pi, d.matrix);
        for (let k = 0; k < 3; k++) {
          d.position.set(X + p.ox + p.fx * 0.42, 6.55 - k * 0.38, Z + p.oz + p.fz * 0.42); d.rotation.set(0, 0, 0); d.updateMatrix();
          lamps.setMatrixAt(pi * 3 + k, d.matrix);
          lamps.setColorAt(pi * 3 + k, LAMP_COL[k]);
        }
        meta.push(p.axis);
        pi++;
      }
    }
    poles.frustumCulled = false; lamps.frustumCulled = false;
    const g = new THREE.Group(); g.add(poles, lamps);
    return { g, lamps, meta, poleGeo, poleMat, lampGeo, lampMat };
  }, []);
  const last = useRef(-1);
  const tmp = useMemo(() => new THREE.Color(), []);
  useEffect(() => () => { data.poleGeo.dispose(); data.poleMat.dispose(); data.lampGeo.dispose(); data.lampMat.dispose(); }, [data]);
  useFrame(() => {
    const s0 = lightFor(0, simT), s1 = lightFor(1, simT);
    const key = s0 * 3 + s1;
    if (key === last.current) return;
    last.current = key;
    const st = [s0, s1];
    for (let p = 0; p < data.meta.length; p++) {
      const s = st[data.meta[p]];
      for (let k = 0; k < 3; k++) {
        const on = (s === 0 && k === 2) || (s === 1 && k === 1) || (s === 2 && k === 0);
        tmp.copy(LAMP_COL[k]).multiplyScalar(on ? 1.4 : 0.1);
        data.lamps.setColorAt(p * 3 + k, tmp);
      }
    }
    if (data.lamps.instanceColor) data.lamps.instanceColor.needsUpdate = true;
  });
  return <primitive object={data.g} />;
};

// =====================================================================
// AI fleet
// =====================================================================
// type index: 0 sedan, 1 suv, 2 taxi, 3 bus, 4 truck, 5 bike, 6 hatchback, 7 van, 8 police, 9 ambulance, 10 firetruck
type TypeIdx = number;
const LENGTH = [4.4, 4.7, 4.4, 11, 6, 1.9, 3.9, 5, 4.5, 5.6, 8, 1.9];
const VMAX: [number, number][] = [[9, 14], [8, 13], [9, 14], [7, 10], [7, 10], [8, 12], [9, 14], [8, 12], [10, 15], [10, 15], [8, 11], [10, 15]];
/** GLB (Kenney) variant per type; bus and bike stay procedural. */
const KIT_FILE: (string | null)[] = ['sedan', 'suv', 'taxi', null, 'delivery', null, 'hatchback-sports', 'van', 'police', 'ambulance', 'firetruck', null /* 11: GHN shipper, loaded separately */];
const KIT_LEN = [4.4, 4.7, 4.4, 0, 6, 0, 3.9, 5, 4.5, 5.6, 8, 1.85];
const PAINT: string[][] = [
  ['#c9ccd1', '#1f2a44', '#8b1a1a', '#e8e8e8', '#2f3b35', '#3b5b8c', '#111214'],
  ['#222428', '#d9d9d9', '#4a3a2a', '#5a6470', '#7a1d1d'],
  ['#f2c200', '#19a35a', '#f4f4f4'],
  ['#1e88e5', '#e53935', '#43a047'],
  ['#f0f0f0', '#3a6ea5', '#c27a2a', '#6b7b4b'],
  ['#e53935', '#1e88e5', '#fdd835', '#43a047', '#222222', '#ec407a', '#ff7043', '#ffffff'],
  ['#e8e8e8', '#3b5b8c', '#8b1a1a'], ['#f0f0f0', '#3a6ea5'], ['#1d2b4a'], ['#ffffff'], ['#c62828'], ['#f97316'],
];

interface Veh {
  type: TypeIdx; slot: number; axis: 0 | 1; dir: 1 | -1; li: number; ci: number; s: number; lat: number; lane: 0 | 1;
  v: number; vmax: number; len: number; x: number; z: number; h: number; ox: number; oz: number;
  stuck: number; ghost: number; leader: Veh | null; lean: number;
}
const laneOf = (lat: number): 0 | 1 => (lat < 3.7 ? 0 : 1);
function logical(v: Veh, out: { x: number; z: number }) {
  if (v.axis === 0) { out.x = v.s; out.z = ROAD_LINES[v.li] + v.dir * v.lat; }
  else { out.z = v.s; out.x = ROAD_LINES[v.li] - v.dir * v.lat; }
}
function nextCross(s: number, dir: 1 | -1): number {
  if (dir > 0) { for (let i = 0; i < NL; i++) if (ROAD_LINES[i] > s) return i; return NL; }
  for (let i = NL - 1; i >= 0; i--) if (ROAD_LINES[i] < s) return i;
  return -1;
}
const countsFor = (n: number) => {
  const rare = (x: number) => (n >= 100 ? Math.max(1, Math.round(n * x)) : Math.round(n * x));
  const c = [Math.round(n * 0.14), Math.round(n * 0.07), Math.round(n * 0.08), Math.round(n * 0.05), Math.round(n * 0.05), 0,
    Math.round(n * 0.06), Math.round(n * 0.05), rare(0.015), rare(0.01), rare(0.01), n >= 200 ? 10 : n >= 100 ? 8 : 0];
  c[5] = Math.max(0, n - c.reduce((a, b) => a + b, 0));
  return c;
};

function createFleet(n: number, seed: number): Veh[] {
  const rnd = mulberry32(seed);
  const counts = countsFor(n);
  const out: Veh[] = [];
  const tmp = { x: 0, z: 0 };
  counts.forEach((cnt, t) => {
    for (let slot = 0; slot < cnt; slot++) {
      for (let attempt = 0; attempt < 30; attempt++) {
        const axis = (rnd() < 0.5 ? 0 : 1) as 0 | 1;
        const dir = (rnd() < 0.5 ? 1 : -1) as 1 | -1;
        const li = Math.floor(rnd() * NL);
        const s = ROAD_LINES[0] + rnd() * (ROAD_LINES[NL - 1] - ROAD_LINES[0]);
        if (ROAD_LINES.some((L) => Math.abs(L - s) < 11)) continue;
        const lane = (rnd() < 0.5 ? 0 : 1) as 0 | 1;
        const lat = t === 5 || t === 11 ? (lane === 0 ? 1.4 + rnd() * 2 : 4.4 + rnd() * 2) : lane === 0 ? 1.9 : 5.3;
        const clash = out.some((o) => o.axis === axis && o.li === li && o.dir === dir && laneOf(o.lat) === laneOf(lat) && Math.abs(o.s - s) < (o.len + LENGTH[t]) / 2 + 4);
        if (clash) continue;
        const [a, b] = VMAX[t];
        const v: Veh = {
          type: t as TypeIdx, slot, axis, dir, li, ci: nextCross(s, dir), s, lat, lane: laneOf(lat), v: 0, vmax: a + rnd() * (b - a), len: LENGTH[t],
          x: 0, z: 0, h: 0, ox: 0, oz: 0, stuck: 0, ghost: 0, leader: null, lean: 0,
        };
        v.v = v.vmax * 0.6;
        logical(v, tmp); v.x = tmp.x; v.z = tmp.z;
        v.h = v.axis === 0 ? (v.dir > 0 ? Math.PI / 2 : -Math.PI / 2) : v.dir > 0 ? 0 : Math.PI;
        out.push(v);
        break;
      }
    }
  });
  return out;
}

function lightsOnly(len: number, wid: number, y: number): G {
  const x = wid * 0.32;
  return merge([
    box(0.4, 0.2, 0.08, x, y, len / 2 + 0.02, HEAD), box(0.4, 0.2, 0.08, -x, y, len / 2 + 0.02, HEAD),
    box(0.44, 0.16, 0.08, x, y, -len / 2 - 0.02, TAIL), box(0.44, 0.16, 0.08, -x, y, -len / 2 - 0.02, TAIL),
  ]);
}

function bikeLights(len: number, h: number): G {
  return merge([box(0.22, 0.16, 0.08, 0, h * 0.5, len / 2 + 0.02, HEAD), box(0.2, 0.12, 0.06, 0, h * 0.42, -len / 2 - 0.02, TAIL)]);
}
const SHIPPER_URL = `${import.meta.env.BASE_URL || '/'}models/meshy/shipper.glb`;
const SHIPPER_HQ_URL = `${import.meta.env.BASE_URL || '/'}models/meshy/original/shipper.glb`;
/** Rotation about Y mapping the GLB's length axis (X) onto +Z so the front faces forward. -PI/2: front is +X; +PI/2: front is -X. */
const SHIPPER_ROT = -Math.PI / 2;
function useShipper(): KitVariant | null {
  const g = useGLTF(SHIPPER_URL) as unknown as { scene: THREE.Object3D };
  return useMemo(() => {
    try { return bakeVariant(g.scene.clone(true), 1.85, SHIPPER_ROT); } catch (e) { console.warn('[city3d] shipper bake failed', e); return null; }
  }, [g]);
}

// =====================================================================
// Kenney GLB kit (loaded lazily; procedural fallback when unavailable)
// =====================================================================
interface KitVariant { geo: G; mat: THREE.Material; len: number; wid: number; h: number }
interface Kit { variants: Record<string, KitVariant>; hero: THREE.Object3D }
const KIT_BASE = `${import.meta.env.BASE_URL || '/'}models/kenney/car-kit/`;
const HERO_FILE = 'sedan-sports';
const KIT_NAMES = Array.from(new Set([...(KIT_FILE.filter(Boolean) as string[]), HERO_FILE]));
const KIT_URLS = KIT_NAMES.map((n) => `${KIT_BASE}${n}.glb`);

/** Bake all meshes of a GLB scene into one pos/normal/uv geometry, normalised to targetLen, ground at y=0, centred. */
function bakeVariant(scene: THREE.Object3D, targetLen: number, rotY = 0): KitVariant | null {
  scene.updateMatrixWorld(true);
  const parts: G[] = [];
  let mat: THREE.Material | null = null;
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    let g = m.geometry.clone();
    g.applyMatrix4(m.matrixWorld);
    if (g.index) g = g.toNonIndexed();
    const ng = new THREE.BufferGeometry();
    ng.setAttribute('position', g.getAttribute('position'));
    if (g.getAttribute('normal')) ng.setAttribute('normal', g.getAttribute('normal'));
    else ng.computeVertexNormals();
    ng.setAttribute('uv', g.getAttribute('uv') ?? new THREE.BufferAttribute(new Float32Array(g.getAttribute('position').count * 2), 2));
    parts.push(ng);
    if (!mat) mat = Array.isArray(m.material) ? m.material[0] : m.material;
  });
  if (!parts.length || !mat) return null;
  const geo = mergeGeometries(parts, false);
  if (!geo) return null;
  if (rotY) geo.rotateY(rotY);
  geo.computeBoundingBox();
  const bb = geo.boundingBox as THREE.Box3;
  const sz = bb.getSize(new THREE.Vector3());
  const sc = targetLen / sz.z;
  geo.translate(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -(bb.min.z + bb.max.z) / 2);
  geo.scale(sc, sc, sc);
  stylize(mat);
  return { geo, mat, len: sz.z * sc, wid: sz.x * sc, h: sz.y * sc };
}

function useKit(): Kit {
  const gltfs = useGLTF(KIT_URLS) as unknown as { scene: THREE.Object3D }[];
  return useMemo(() => {
    const variants: Record<string, KitVariant> = {};
    KIT_NAMES.forEach((name, i) => {
      const t = KIT_FILE.indexOf(name);
      const v = bakeVariant(gltfs[i].scene.clone(true), t >= 0 ? KIT_LEN[t] : 4.6);
      if (v) variants[name] = v;
    });
    return { variants, hero: gltfs[KIT_NAMES.indexOf(HERO_FILE)].scene };
  }, [gltfs]);
}

class KitBoundary extends React.Component<{ fallback: React.ReactNode; children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(e: unknown) { console.warn('[city3d] car kit GLB failed, using procedural vehicles', e); }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

const Fleet: React.FC<{ n: number; shadows: boolean; kit: Kit | null; shipper: KitVariant | null }> = ({ n, shadows, kit, shipper }) => {
  const fleet = useMemo(() => {
    const rnd = mulberry32(CITY_SEED + n);
    const vs = createFleet(n, CITY_SEED + n * 7);
    const models: Model[] = [
      carModel(SEDAN),
      carModel({ ...SEDAN, len: 4.7, wid: 1.95, bodyH: 0.8, bodyY: 0.85, cabW: 1.85, cabH: 0.6, cabY: 1.55, cabL: 3.0, cabZ: -0.3, wheelR: 0.4 }),
      carModel({ ...SEDAN, roofSign: true }),
      busModel(), truckModel(), bikeModel(),
      carModel(SEDAN), carModel({ ...SEDAN, len: 4.7, wid: 1.95, bodyH: 0.8, bodyY: 0.85, cabW: 1.85, cabH: 0.6, cabY: 1.55, cabL: 3.0, cabZ: -0.3, wheelR: 0.4 }),
      carModel(SEDAN), carModel({ ...SEDAN, len: 4.7, wid: 1.95, bodyH: 0.8, bodyY: 0.85, cabW: 1.85, cabH: 0.6, cabY: 1.55, cabL: 3.0, cabZ: -0.3, wheelR: 0.4 }),
      truckModel(), bikeModel(),
    ];
    const counts = countsFor(n).map((_, t) => vs.filter((v) => v.type === t).length);
    const bodyMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.35 });
    const darkMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.2 });
    const lightMat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
    const group = new THREE.Group();
    const meshes: THREE.InstancedMesh[][] = [];
    const geos: G[] = [];
    models.forEach((m, t) => {
      const cnt = counts[t];
      if (cnt === 0) { meshes.push([]); return; }
      const kv = t === 11 ? shipper ?? undefined : KIT_FILE[t] && kit ? kit.variants[KIT_FILE[t] as string] : undefined;
      if (kv) {
        const lg = t === 11 ? bikeLights(kv.len, kv.h) : lightsOnly(kv.len, kv.wid, kv.h * 0.38);
        geos.push(lg);
        const b = new THREE.InstancedMesh(kv.geo, kv.mat, cnt);
        const l = new THREE.InstancedMesh(lg, lightMat, cnt);
        b.castShadow = shadows;
        [b, l].forEach((x) => { x.frustumCulled = false; group.add(x); });
        meshes.push([b, l]);
        return;
      }
      const lights = merge([m.heads, m.tails]);
      geos.push(m.body, m.dark, m.heads, m.tails, lights);
      const b = new THREE.InstancedMesh(m.body, bodyMat, cnt);
      const d = new THREE.InstancedMesh(m.dark, darkMat, cnt);
      const l = new THREE.InstancedMesh(lights, lightMat, cnt);
      b.castShadow = shadows;
      const pal = PAINT[t];
      for (let i = 0; i < cnt; i++) b.setColorAt(i, new THREE.Color(pal[Math.floor(rnd() * pal.length)]));
      [b, d, l].forEach((x) => { x.frustumCulled = false; group.add(x); });
      meshes.push([b, d, l]);
    });
    return { vs, group, meshes, geos, mats: [bodyMat, darkMat, lightMat], lightMat };
  }, [n, shadows, kit, shipper]);
  useEffect(() => () => { fleet.geos.forEach((g) => g.dispose()); fleet.mats.forEach((m) => m.dispose()); }, [fleet]);

  const groups = useMemo(() => new Map<number, Veh[]>(), []);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const tmp = useMemo(() => ({ x: 0, z: 0 }), []);

  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05);
    const { vs, meshes } = fleet;
    // light scale
    const k = 0.18 + 0.82 * live.nightFactor;
    fleet.lightMat.color.setScalar(k);

    // grouping
    groups.forEach((a) => { a.length = 0; });
    for (const v of vs) {
      const key = ((v.axis * 16 + v.li) * 2 + (v.dir > 0 ? 1 : 0)) * 2 + laneOf(v.lat);
      let a = groups.get(key);
      if (!a) { a = []; groups.set(key, a); }
      a.push(v);
    }
    groups.forEach((a) => {
      a.sort((p, q) => q.s * q.dir - p.s * p.dir);
      for (let i = 0; i < a.length; i++) a[i].leader = i === 0 ? null : a[i - 1];
    });

    let di = 0;
    for (const v of vs) {
      const fx = v.axis === 0 ? v.dir : 0, fz = v.axis === 1 ? v.dir : 0;
      let gap = Infinity;
      let lv = 0;
      if (v.ghost > 0) v.ghost -= dt;
      else if (v.leader) {
        gap = (v.leader.s - v.s) * v.dir - (v.leader.len + v.len) / 2;
        lv = v.leader.v;
      }
      // hero car as obstacle
      {
        const dx = heroCar.x - v.x, dz = heroCar.z - v.z;
        const along = dx * fx + dz * fz;
        if (along > 0 && along < 16) {
          const lat = Math.abs(-dx * fz + dz * fx);
          if (lat < 2.4) { const g2 = along - 3.4 - v.len / 2; if (g2 < gap) { gap = g2; lv = 0; } }
        }
      }
      let target = v.vmax;
      if (gap < Infinity) target = Math.min(target, Math.sqrt(2 * 4 * Math.max(0, gap - 2)) + lv * 0.6);
      if (v.ci >= 0 && v.ci < NL) {
        const d = (ROAD_LINES[v.ci] - v.s) * v.dir - (ROAD_W / 2 + 2.5);
        if (d > -0.8) {
          const st = lightFor(v.axis, simT);
          if (st === 2 || (st === 1 && d > (v.v * v.v) / 10 + v.v * 0.3)) {
            target = Math.min(target, Math.sqrt(2 * 5 * Math.max(0, d)) * 0.95);
          }
        }
      }
      if (v.v < target) v.v = Math.min(target, v.v + 3.2 * dt);
      else v.v = Math.max(target, v.v - 7 * dt);
      if (v.v < 0.15) { v.stuck += dt; if (v.stuck > 20) { v.ghost = 5; v.stuck = 0; } } else v.stuck = 0;

      v.s += v.dir * v.v * dt;
      // crossing
      if (v.ci >= 0 && v.ci < NL && (v.s - ROAD_LINES[v.ci]) * v.dir >= 0) {
        logical(v, tmp);
        const ovx = v.x, ovz = v.z;
        const opts: { w: number; nfx: number; nfz: number }[] = [];
        if (v.ci + v.dir >= 0 && v.ci + v.dir < NL) opts.push({ w: 0.6, nfx: fx, nfz: fz });
        for (const [w, nfx, nfz] of [[0.22, -fz, fx], [0.18, fz, -fx]] as [number, number, number][]) {
          const nd = nfx + nfz;
          if (v.li + nd >= 0 && v.li + nd < NL) opts.push({ w, nfx, nfz });
        }
        const tot = opts.reduce((a, o) => a + o.w, 0);
        let r = Math.random() * tot;
        let pick = opts[0];
        for (const o of opts) { r -= o.w; if (r <= 0) { pick = o; break; } }
        const straight = pick.nfx === fx && pick.nfz === fz;
        if (straight) v.ci += v.dir;
        else {
          const nd = (pick.nfx + pick.nfz) as 1 | -1;
          const oldLi = v.li;
          v.axis = pick.nfx !== 0 ? 0 : 1;
          v.dir = nd;
          v.s = ROAD_LINES[oldLi];
          v.li = v.ci;
          v.ci = oldLi + nd;
          logical(v, tmp);
          v.ox = ovx - tmp.x; v.oz = ovz - tmp.z;
        }
      }
      // visual
      logical(v, tmp);
      const decay = Math.exp(-dt * 2.5);
      v.ox *= decay; v.oz *= decay;
      const nx = tmp.x + v.ox, nz = tmp.z + v.oz;
      const mx = nx - v.x, mz = nz - v.z;
      if (mx * mx + mz * mz > 1e-6) {
        const th = Math.atan2(mx, mz);
        let dh = th - v.h; dh = Math.atan2(Math.sin(dh), Math.cos(dh));
        const step = dh * Math.min(1, dt * 9);
        v.h += step;
        v.lean += (Math.max(-0.35, Math.min(0.35, -step * 6)) - v.lean) * Math.min(1, dt * 6);
      }
      v.x = nx; v.z = nz;

      dummy.position.set(v.x, 0.04, v.z);
      dummy.rotation.set(0, v.h, v.type === 5 || v.type === 11 ? v.lean : 0);
      dummy.updateMatrix();
      for (const m of meshes[v.type]) m.setMatrixAt(v.slot, dummy.matrix);
      if (di < 400) { trafficView.pos[di * 2] = v.x; trafficView.pos[di * 2 + 1] = v.z; }
      di++;
    }
    trafficView.count = Math.min(di, 400);
    for (const arr of meshes) for (const m of arr) m.instanceMatrix.needsUpdate = true;
  });
  return <primitive object={fleet.group} />;
};

// =====================================================================
// Hero car
// =====================================================================
const GAME_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'ShiftLeft', 'ShiftRight']);
function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  if (!t) return false;
  if (t.isContentEditable || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT') return true;
  if (t.tagName === 'INPUT') { const ty = (t as HTMLInputElement).type; return !['range', 'checkbox', 'radio', 'button'].includes(ty); }
  return false;
}

const hv = { vx: 0, vz: 0, steer: 0, spin: 0, pitch: 0, roll: 0, lastVF: 0 };

const HeroCar: React.FC<{ kit: Kit | null }> = ({ kit }) => {
  const root = useRef<THREE.Group>(null);
  const tilt = useRef<THREE.Group>(null);
  const spot = useRef<THREE.SpotLight>(null);
  const tgt = useRef<THREE.Object3D>(null);
  const wheelsF = useRef<THREE.Group[]>([]);
  const wheelsS = useRef<THREE.Group[]>([]);
  const keys = useRef(new Set<string>());

  const model = useMemo(() => {
    const m = carModel({ ...SEDAN, len: 4.5, wid: 1.85, bodyH: 0.55, cabH: 0.46, cabL: 2.0, cabY: 1.15, wheels: false });
    const extra = [
      box(1.7, 0.08, 0.4, 0, 1.2, -2.05, '#111'), box(0.12, 0.3, 0.1, 0.7, 1.05, -2.0, '#111'), box(0.12, 0.3, 0.1, -0.7, 1.05, -2.0, '#111'),
    ];
    const stripe = box(0.4, 0.02, 4.3, 0, 0.955, 0, '#111');
    return {
      body: m.body, dark: merge([m.dark, ...extra, stripe]), heads: m.heads, tails: m.tails,
      wheel: wheelG(0.36, 0.28, 0, 0, 0, '#141414'), rim: wheelG(0.22, 0.3, 0, 0, 0, '#b9c0c8'),
    };
  }, []);
  const hero = useMemo(() => {
    if (!kit) return null;
    try {
      const obj = kit.hero.clone(true);
      obj.updateMatrixWorld(true);
      const bb = new THREE.Box3().setFromObject(obj);
      const sz = bb.getSize(new THREE.Vector3());
      const sc = 4.6 / sz.z;
      obj.position.set(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -(bb.min.z + bb.max.z) / 2);
      const wrap = new THREE.Group(); wrap.add(obj); wrap.scale.setScalar(sc);
      const wheels = ['wheel-front-left', 'wheel-front-right', 'wheel-back-left', 'wheel-back-right'].map((n) => obj.getObjectByName(n) ?? null);
      wheels.forEach((w) => { if (w) w.rotation.order = 'YXZ'; });
      obj.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
      const wid = sz.x * sc, y = sz.y * sc * 0.38, x = wid * 0.32, len = 4.6;
      const heads = merge([box(0.4, 0.2, 0.08, x, y, len / 2 + 0.02, HEAD), box(0.4, 0.2, 0.08, -x, y, len / 2 + 0.02, HEAD)]);
      const tails = merge([box(0.44, 0.16, 0.08, x, y, -len / 2 - 0.02, TAIL), box(0.44, 0.16, 0.08, -x, y, -len / 2 - 0.02, TAIL)]);
      return { wrap, wheels, heads, tails, r: 0.3 * sc };
    } catch (e) { console.warn('[city3d] hero GLB unusable', e); return null; }
  }, [kit]);
  useEffect(() => () => { hero?.heads.dispose(); hero?.tails.dispose(); }, [hero]);
  const mats = useMemo(() => ({
    body: new THREE.MeshStandardMaterial({ vertexColors: true, color: '#e0222d', roughness: 0.25, metalness: 0.6 }),
    dark: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.3 }),
    heads: new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }),
    tails: new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }),
  }), []);
  useEffect(() => () => { Object.values(model).forEach((g) => g.dispose()); Object.values(mats).forEach((m) => m.dispose()); }, [model, mats]);

  useEffect(() => { if (spot.current && tgt.current) spot.current.target = tgt.current; }, []);

  useEffect(() => {
    const K = keys.current;
    const down = (e: KeyboardEvent) => {
      if (isTyping(e) || e.ctrlKey || e.metaKey || e.altKey) return;
      const mode = cityStore.get().playerMode;
      if (e.code === 'KeyF') {
        if (e.repeat) return;
        if (mode === 'drive') { e.preventDefault(); setDriving(false); }
        else if (mode === 'walk') {
          const k = nearestRide();
          if (k) { e.preventDefault(); setDriving(true, k); }
        }
        return;
      }
      if (mode === 'drive' && GAME_KEYS.has(e.code)) { e.preventDefault(); K.add(e.code); }
    };
    const up = (e: KeyboardEvent) => { if (GAME_KEYS.has(e.code)) { K.delete(e.code); if (cityStore.get().playerMode === 'drive') e.preventDefault(); } };
    const blur = () => K.clear();
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', blur); };
  }, []);

  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05);
    simT += dt;
    const driving = cityStore.get().playerMode === 'drive';
    const K = keys.current;
    if (!driving && K.size) K.clear();
    const fw = K.has('KeyW') || K.has('ArrowUp');
    const bk = K.has('KeyS') || K.has('ArrowDown');
    const lf = K.has('KeyA') || K.has('ArrowLeft');
    const rt = K.has('KeyD') || K.has('ArrowRight');
    const hand = K.has('Space') || !driving;
    const boost = K.has('ShiftLeft') || K.has('ShiftRight');

    let h = heroCar.heading;
    // steering
    const st = (lf ? 1 : 0) - (rt ? 1 : 0);
    hv.steer += (st - hv.steer) * Math.min(1, dt * 7);
    let fx = Math.sin(h), fz = Math.cos(h);
    let vF = hv.vx * fx + hv.vz * fz;
    const sc = rides.active === 'scooter';
    const yaw = hv.steer * ((sc ? 2.7 : 1.9) / (1 + Math.abs(vF) * (sc ? 0.05 : 0.04))) * Math.max(-1, Math.min(1, vF / 5)) * (K.has('Space') && !sc ? 1.5 : 1);
    h += yaw * dt;
    fx = Math.sin(h); fz = Math.cos(h);
    const rx = -Math.cos(h), rz = Math.sin(h);
    vF = hv.vx * fx + hv.vz * fz;
    let vL = hv.vx * rx + hv.vz * rz;
    const maxF = sc ? (boost ? 36 : 27) : boost ? 52 : 36;
    if (fw) vF += ((sc ? 24 : 16) * (boost ? 1.7 : 1) * (1 - Math.max(0, vF) / maxF) + 2) * dt;
    if (bk) { if (vF > 0.5) vF -= 34 * dt; else vF = Math.max(-10, vF - 9 * dt); }
    if (!fw && !bk) { const dr = (3 + 0.02 * vF * vF) * dt; vF -= Math.sign(vF) * Math.min(Math.abs(vF), dr); }
    if (hand) vF -= Math.sign(vF) * Math.min(Math.abs(vF), (driving ? 10 : 25) * dt);
    vL *= Math.exp(-(K.has('Space') && !sc ? 1.4 : sc ? 14 : 9) * dt);
    hv.vx = fx * vF + rx * vL; hv.vz = fz * vF + rz * vL;
    let px = heroCar.x + hv.vx * dt, pz = heroCar.z + hv.vz * dt;

    // collisions (two circles)
    const R = sc ? 0.6 : 1.15, OFF = sc ? 0.65 : 1.3;
    for (let pass = 0; pass < 2; pass++) {
      for (const off of [OFF, -OFF]) {
        const cx = px + fx * off, cz = pz + fz * off;
        for (const o of obstacles) {
          const hw = o.w / 2, hd = o.d / 2;
          if (Math.abs(cx - o.cx) > hw + R || Math.abs(cz - o.cz) > hd + R) continue;
          const qx = Math.max(o.cx - hw, Math.min(o.cx + hw, cx)), qz = Math.max(o.cz - hd, Math.min(o.cz + hd, cz));
          let nx = cx - qx, nz = cz - qz;
          let dist = Math.hypot(nx, nz);
          let pen: number;
          if (dist < 1e-4) {
            const dxl = cx - (o.cx - hw), dxr = o.cx + hw - cx, dzl = cz - (o.cz - hd), dzr = o.cz + hd - cz;
            const m = Math.min(dxl, dxr, dzl, dzr);
            if (m === dxl) { nx = -1; nz = 0; } else if (m === dxr) { nx = 1; nz = 0; } else if (m === dzl) { nx = 0; nz = -1; } else { nx = 0; nz = 1; }
            pen = m + R; dist = 1;
          } else { nx /= dist; nz /= dist; pen = R - dist; if (pen <= 0) continue; }
          px += nx * pen; pz += nz * pen;
          const vn = hv.vx * nx + hv.vz * nz;
          if (vn < 0) { hv.vx -= 1.2 * vn * nx; hv.vz -= 1.2 * vn * nz; hv.vx *= 0.92; hv.vz *= 0.92; }
        }
      }
    }
    const lim = CITY_EXTENT - 3;
    if (px > lim) { px = lim; hv.vx = Math.min(0, hv.vx) * 0.3; }
    if (px < -lim) { px = -lim; hv.vx = Math.max(0, hv.vx) * 0.3; }
    if (pz > lim) { pz = lim; hv.vz = Math.min(0, hv.vz) * 0.3; }
    if (pz < -lim) { pz = -lim; hv.vz = Math.max(0, hv.vz) * 0.3; }

    heroCar.x = px; heroCar.z = pz; heroCar.heading = h;
    const vF2 = hv.vx * fx + hv.vz * fz;
    heroCar.speed = vF2;
    if (driving) {
      live.player.x = px; live.player.y = 0; live.player.z = pz; live.player.heading = h; live.player.speed = vF2;
    }

    // visuals
    const g = root.current, t = tilt.current;
    const isCar = rides.active === 'car';
    if (g && t) {
      const ps = isCar ? heroCar : rides.car;
      g.position.set(ps.x, 0.04, ps.z); g.rotation.y = ps.heading;
      const acc = (vF2 - hv.lastVF) / Math.max(dt, 1e-3); hv.lastVF = vF2;
      const rollT = Math.max(-0.1, Math.min(0.1, -hv.steer * vF2 * 0.003 + vL * 0.01));
      const pitchT = Math.max(-0.06, Math.min(0.06, -acc * 0.003));
      hv.roll += (rollT - hv.roll) * Math.min(1, dt * 6); hv.pitch += (pitchT - hv.pitch) * Math.min(1, dt * 6);
      t.rotation.z = isCar ? hv.roll : 0; t.rotation.x = isCar ? hv.pitch : 0;
      hv.spin += (vF2 * dt) / (hero ? hero.r : 0.36);
      if (hero) {
        hero.wheels.forEach((w, i) => { if (w) { w.rotation.x = hv.spin; if (i < 2) w.rotation.y = hv.steer * 0.45; } });
      } else {
        wheelsF.current.forEach((w) => { if (w) w.rotation.y = hv.steer * 0.45; });
        wheelsS.current.forEach((w) => { if (w) w.rotation.x = hv.spin; });
      }
    }
    const night = live.nightFactor;
    mats.heads.color.setScalar(0.3 + 0.9 * night);
    mats.tails.color.setScalar(0.25 + 0.5 * night + (bk || hand ? 0.9 : 0));
    if (spot.current) spot.current.intensity = night > 0.15 && driving ? 220 * night : 0;
  });

  const W4: [number, number, boolean][] = [[0.88, 1.4, true], [-0.88, 1.4, true], [0.88, -1.4, false], [-0.88, -1.4, false]];
  return (
    <group ref={root} position={[heroCar.x, 0.04, heroCar.z]} rotation={[0, heroCar.heading, 0]}>
      <group ref={tilt}>
        {hero ? <primitive object={hero.wrap} /> : (
          <>
            <mesh geometry={model.body} material={mats.body} castShadow />
            <mesh geometry={model.dark} material={mats.dark} />
          </>
        )}
        <mesh geometry={hero ? hero.heads : model.heads} material={mats.heads} />
        <mesh geometry={hero ? hero.tails : model.tails} material={mats.tails} />
        <spotLight ref={spot} position={[0, 0.9, 2.1]} angle={0.5} penumbra={0.7} distance={70} decay={1.4} intensity={0} />
        <object3D ref={tgt} position={[0, 0, 22]} />
        {!hero && W4.map(([x, z, front], i) => (
          <group key={i} position={[x, 0.36, z]}>
            <group ref={(el) => { if (el) { if (front) wheelsF.current[i] = el; } }}>
              <group ref={(el) => { if (el) wheelsS.current[i] = el; }}>
                <mesh geometry={model.wheel} material={mats.dark} castShadow />
                <mesh geometry={model.rim} material={mats.dark} />
              </group>
            </group>
          </group>
        ))}
      </group>
    </group>
  );
};

// =====================================================================
// Traffic (root export)
// =====================================================================
const Rig: React.FC<{ n: number; quality: string; kit: Kit | null; shipper: KitVariant | null }> = ({ n, quality, kit, shipper }) => (
  <>
    <Fleet key={quality} n={n} shadows={quality === 'high'} kit={kit} shipper={shipper} />
    <HeroCar kit={kit} />
    <ShipperProp shipper={shipper} />
  </>
);
const KitScene: React.FC<{ n: number; quality: string; shipper: KitVariant | null }> = ({ n, quality, shipper }) => {
  const kit = useKit();
  return <Rig n={n} quality={quality} kit={kit} shipper={shipper} />;
};
const KitTier: React.FC<{ n: number; quality: string; shipper: KitVariant | null }> = ({ n, quality, shipper }) => {
  const plain = <Rig n={n} quality={quality} kit={null} shipper={shipper} />;
  return (
    <KitBoundary fallback={plain}>
      <Suspense fallback={plain}><KitScene n={n} quality={quality} shipper={shipper} /></Suspense>
    </KitBoundary>
  );
};
const ShipperScene: React.FC<{ n: number; quality: string }> = ({ n, quality }) => <KitTier n={n} quality={quality} shipper={useShipper()} />;

/** Original (undecimated) shipper for the single parked/ridden bike; the 13k-tri one stays for the instanced traffic and as placeholder. */
const ShipperHQ: React.FC = () => {
  const g = useGLTF(SHIPPER_HQ_URL) as unknown as { scene: THREE.Object3D };
  const v = useMemo(() => bakeVariant(g.scene.clone(true), 1.85, SHIPPER_ROT), [g]);
  if (!v) throw new Error('shipper HQ bake failed');
  return <mesh geometry={v.geo} material={v.mat} castShadow={false} />;
};
const ShipperBody: React.FC<{ low: KitVariant }> = ({ low }) => {
  const [hq, setHq] = useState(false);
  const ref = useRef<THREE.Group>(null);
  const acc = useRef(0);
  useFrame((state, dt) => {
    acc.current += dt; if (acc.current < 0.5) return; acc.current = 0;
    const p = ref.current; if (!p) return;
    const d = state.camera.position.distanceTo(p.getWorldPosition(new THREE.Vector3()));
    const want = rides.active === 'scooter' || d < (hq ? 45 : 32);
    if (want !== hq) setHq(want);
  });
  const lowMesh = <mesh geometry={low.geo} material={low.mat} castShadow />;
  return (
    <group ref={ref}>
      {hq ? <KitBoundary fallback={lowMesh}><Suspense fallback={lowMesh}><ShipperHQ /></Suspense></KitBoundary> : lowMesh}
    </group>
  );
};

/** GHN shipper bike parked near the F1 door; becomes the ridden vehicle when rides.active==='scooter'. */
const ShipperProp: React.FC<{ shipper: KitVariant | null }> = ({ shipper }) => {
  const root = useRef<THREE.Group>(null);
  const tilt = useRef<THREE.Group>(null);
  const res = useMemo(() => {
    const lightMat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
    if (shipper) return { lightMat, lg: bikeLights(shipper.len, shipper.h), proc: null as Model | null, body: null, dark: null };
    const proc = bikeModel();
    return {
      lightMat, lg: merge([proc.heads, proc.tails]), proc,
      body: new THREE.MeshStandardMaterial({ vertexColors: true, color: '#f97316', roughness: 0.5 }),
      dark: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 }),
    };
  }, [shipper]);
  useEffect(() => () => { res.lightMat.dispose(); res.lg.dispose(); res.body?.dispose(); res.dark?.dispose(); }, [res]);
  useFrame(() => {
    const act = rides.active === 'scooter';
    const ps = act ? heroCar : rides.scooter;
    if (root.current) { root.current.position.set(ps.x, 0.04, ps.z); root.current.rotation.y = ps.heading; }
    if (tilt.current) { tilt.current.rotation.z = act ? hv.roll * 3 + hv.steer * heroCar.speed * 0.01 : 0; tilt.current.rotation.x = act ? hv.pitch : 0; }
    res.lightMat.color.setScalar(0.2 + 0.8 * live.nightFactor);
  });
  return (
    <group ref={root}>
      <group ref={tilt}>
        {shipper ? <ShipperBody low={shipper} /> : res.proc && (
          <>
            <mesh geometry={res.proc.body} material={res.body!} castShadow />
            <mesh geometry={res.proc.dark} material={res.dark!} />
          </>
        )}
        <mesh geometry={res.lg} material={res.lightMat} />
      </group>
    </group>
  );
};

export const Traffic: React.FC = () => {
  const quality = useCity((s) => s.quality);
  const n = quality === 'low' ? 8 : quality === 'medium' ? 18 : 36;
  const plain = <KitTier n={n} quality={quality} shipper={null} />;
  return (
    <>
      <TrafficLights />
      <KitBoundary fallback={plain}>
        <Suspense fallback={plain}><ShipperScene n={n} quality={quality} /></Suspense>
      </KitBoundary>
    </>
  );
};

useGLTF.preload(SHIPPER_URL);
KIT_URLS.forEach((u) => useGLTF.preload(u));
