/**
 * Living office: A*-driven agents (team, workers, roamers, lobby visitors) + simulation-driven document handoffs.
 * One module-level simulation steps every *registered* (= mounted/visible) agent each frame; no per-frame allocations.
 */
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import { FLOOR_H, TEAM_FLOOR, mulberry32, type CharacterAppearance } from '../shared';
import { Character3D, appearanceFor } from '../characters';
import { officeSimulationEngine } from '../../engine/simulationStore';
import { EMPLOYEE_BY_ID } from '../../data/employees';
import type { DocumentTransferTask, Employee } from '../../types/office';
import { getFloor, FT, K } from './furn';
import { findPath, freePoint, ENTRANCE, FIGURES } from './nav';

export type Pose = 'idle' | 'walk' | 'sit' | 'type' | 'wave';
type St = 'home' | 'wait' | 'go' | 'back' | 'at' | 'handing' | 'gone';
interface Home { x: number; z: number; rot: number; pose: 'type' | 'sit' | 'idle' }
interface Job { id: string; key: string; color: string; isReturn: boolean }
export interface Agent {
  id: string; floor: number; kind: 'team' | 'worker' | 'roamer' | 'visitor' | 'static'; emp?: string;
  home: Home; x: number; z: number; yaw: number; st: St; pose: Pose; shown: boolean;
  path: Float32Array | null; pi: number; speed: number; timer: number; tgtSt: 'go' | 'back';
  tgt: { x: number; z: number; rot: number; pose: 'idle' | 'sit' | 'wave' }; stage: number;
  emps: string[]; busy: boolean; job: Job | null; carry: { key: string; color: string } | null;
  g: THREE.Group | null; setPose: (p: Pose) => void; setCarry: (c: { key: string; color: string } | null) => void;
}
const noop = () => {};
const rnd = (a: number, b: number) => a + Math.random() * (b - a);

// ---------------------------------------------------------------- simulation core
const arr: Agent[] = [];
export const sim = { budget: 2, quality: 'high' as string };
const movers = new Float32Array(10), totals = new Float32Array(10);
/** walking figures (Meshy) counted into dbg.walking */
export const figWalk = new Map<string, number>();
/** distance from (x,z) to the nearest mounted, shown agent on the floor (for figure reactions) */
export function nearestAgentDist(floor: number, x: number, z: number): number { let b = 99; for (let i = 0; i < arr.length; i++) { const o = arr[i]; if (o.floor !== floor || !o.shown) continue; const d = Math.hypot(o.x - x, o.z - z); if (d < b) b = d; } return b; }
export const dbg: { walking: number; seated: number; transfers: number; mapped: number; proxied: number; unmappedTransfers: number; inject?: (from: string, to: string, key?: string) => void } = { walking: 0, seated: 0, transfers: 0, mapped: 0, proxied: 0, unmappedTransfers: 0 };
if (typeof window !== 'undefined') (window as unknown as { __city3dAgents?: unknown }).__city3dAgents = dbg;
export const register = (a: Agent) => { if (!arr.includes(a)) arr.push(a); };
export const unregister = (a: Agent) => { const i = arr.indexOf(a); if (i >= 0) arr.splice(i, 1); };
const setPose = (a: Agent, p: Pose) => { if (a.pose !== p) { a.pose = p; a.setPose(p); } };

function makeAgent(id: string, floor: number, kind: Agent['kind'], home: Home, emp?: string): Agent {
  return {
    id, floor, kind, emp, home, x: home.x, z: home.z, yaw: home.rot, st: 'home', pose: home.pose === 'idle' ? 'idle' : home.pose, shown: true,
    path: null, pi: 0, speed: 1.1, timer: rnd(8, 60), tgtSt: 'go', tgt: { x: 0, z: 0, rot: 0, pose: 'idle' }, stage: 0,
    emps: emp ? [emp] : [], busy: false, job: null, carry: null, g: null, setPose: noop, setCarry: noop,
  };
}

interface Poi { x: number; z: number; rot: number; pose: 'idle' | 'sit' }
const poiCache = new Map<number, Poi[]>();
function poisFor(f: number): Poi[] {
  const hit = poiCache.get(f); if (hit) return hit;
  const d = getFloor(f), out: Poi[] = [];
  const addAll = (F: typeof d.lay, k: number) => {
    for (const p of F.poi) out.push({ x: p.x * k, z: p.z * k, rot: p.rot, pose: p.pose });
    for (const s of F.stands) out.push({ x: s.x * k, z: s.z * k + 1.2 * k, rot: s.rot + Math.PI, pose: 'idle' });
    for (const s of F.sitSeats) out.push({ x: s.x * k, z: s.z * k, rot: s.rot, pose: 'sit' });
  };
  addAll(d.str, 1); addAll(d.lay, K);
  poiCache.set(f, out); return out;
}

function tryPath(a: Agent) {
  if (sim.budget <= 0) return;
  sim.budget--;
  const p = findPath(a.floor, a.x, a.z, a.tgt.x, a.tgt.z);
  if (!p || p.length < 4) { // unreachable: give up gracefully
    if (a.tgtSt === 'back') { snapHome(a); } else { a.st = 'at'; a.timer = rnd(2, 5); setPose(a, 'idle'); }
    return;
  }
  a.path = p; a.pi = 1; a.st = a.tgtSt; setPose(a, 'walk');
}
function startTrip(a: Agent, x: number, z: number, rot: number, pose: 'idle' | 'sit' | 'wave', st: 'go' | 'back', speed: number) {
  if (pose !== 'sit' && st === 'go') { const o: [number, number] = [0, 0]; if (freePoint(a.floor, x, z, o)) { x = o[0]; z = o[1]; } } // never end inside furniture
  a.tgt.x = x; a.tgt.z = z; a.tgt.rot = rot; a.tgt.pose = pose; a.tgtSt = st; a.speed = speed; a.st = 'wait'; a.path = null;
  tryPath(a);
}
function snapHome(a: Agent) {
  a.x = a.home.x; a.z = a.home.z; a.yaw = a.home.rot; a.st = 'home'; a.timer = rnd(20, 90); a.path = null; a.busy = false;
  setPose(a, a.home.pose);
}
const fi = (f: number) => f + 1;
function canGo(a: Agent) { const i = fi(a.floor); return movers[i] < Math.max(1, Math.ceil(0.2 * totals[i])); }

function randomTrip(a: Agent) {
  const p = poisFor(a.floor);
  if (a.kind === 'team' && Math.random() < 0.28) { // chat at a colleague's desk
    const o = teamList[(Math.random() * teamList.length) | 0];
    if (o && o !== a && o.st === 'home') {
      const out: [number, number] = [0, 0];
      if (freePoint(a.floor, o.home.x, o.home.z, out)) { startTrip(a, out[0], out[1], Math.atan2(o.home.x - out[0], o.home.z - out[1]), 'idle', 'go', rnd(0.9, 1.2)); return; }
    }
  }
  if (!p.length) { a.timer = rnd(10, 30); return; }
  const t = p[(Math.random() * p.length) | 0];
  startTrip(a, t.x, t.z, t.rot, t.pose, 'go', rnd(0.9, 1.3));
}
function goHome(a: Agent) { startTrip(a, a.home.x, a.home.z, a.home.rot, 'idle', 'back', a.job ? 1.3 : rnd(0.9, 1.3)); }

function spawnVisitor(a: Agent) {
  a.x = ENTRANCE.inside[0] + rnd(-0.6, 0.6); a.z = ENTRANCE.inside[1]; a.yaw = Math.PI; a.shown = true; a.stage = 0; a.st = 'at'; a.timer = 0.1; setPose(a, 'idle');
}
function visitorNext(a: Agent) {
  const p = poisFor(a.floor);
  if (a.stage === 0) { // reception
    const r = p.find((q) => q.pose === 'idle' && Math.abs(q.x - 14.5) < 5 && q.z > 12);
    a.stage = 1; const t = r ?? p[0]; if (t) { startTrip(a, t.x, t.z, t.rot, 'idle', 'go', rnd(0.9, 1.2)); return; }
  }
  if (a.stage === 1) { a.stage = 2; const t = p[(Math.random() * p.length) | 0]; if (t) { startTrip(a, t.x, t.z, t.rot, t.pose, 'go', rnd(0.9, 1.2)); return; } }
  a.stage = 3; startTrip(a, ENTRANCE.inside[0], ENTRANCE.inside[1], Math.PI, 'idle', 'go', 1.1);
}

function arrive(a: Agent) {
  if (a.st === 'back') { snapHome(a); return; }
  a.x = a.tgt.x; a.z = a.tgt.z; a.yaw = a.tgt.rot; a.path = null;
  if (a.job) { a.st = 'handing'; a.timer = 1.8; setPose(a, 'wave'); if (a.job.isReturn) burst(a.x, a.floor * FLOOR_H + FT + 1.4, a.z); return; }
  if (a.kind === 'visitor' && a.stage === 3) { a.st = 'gone'; a.shown = false; a.timer = rnd(6, 25); setPose(a, 'idle'); return; }
  a.st = 'at'; setPose(a, a.tgt.pose === 'sit' ? 'sit' : 'idle');
  a.timer = a.tgt.pose === 'sit' ? rnd(10, 25) : rnd(5, 10);
}

function follow(a: Agent, dt: number): boolean {
  const p = a.path!, n = p.length >> 1;
  const dx = p[a.pi * 2] - a.x, dz = p[a.pi * 2 + 1] - a.z, d = Math.sqrt(dx * dx + dz * dz), last = a.pi === n - 1;
  if (d < (last ? 0.1 : 0.3)) { if (last) return true; a.pi++; return false; }
  const des = Math.atan2(dx, dz); let diff = des - a.yaw; diff -= Math.PI * 2 * Math.round(diff / (Math.PI * 2));
  const mt = 7 * dt; a.yaw += Math.abs(diff) < mt ? diff : Math.sign(diff) * mt;
  let sp = a.speed * (1 - Math.min(0.7, Math.abs(diff) / 1.6)), slow = 1;
  const sy = Math.sin(a.yaw), cy = Math.cos(a.yaw);
  for (let i = 0; i < arr.length; i++) { // loose separation / yielding
    const o = arr[i]; if (o === a || o.floor !== a.floor || !o.shown) continue;
    const ex = a.x - o.x, ez = a.z - o.z, dd = ex * ex + ez * ez;
    if (dd < 0.5 && dd > 1e-4) {
      const dist = Math.sqrt(dd);
      if (o.st !== 'home' || o.pose === 'idle') { const push = (0.7 - dist) * 1.5 * dt; a.x += (ex / dist) * push; a.z += (ez / dist) * push; }
      if ((-ex * sy - ez * cy) / dist > 0.5) slow = 0.45;
    }
  }
  for (let i = 0; i < FIGURES.length; i++) { // dynamic obstacles: Meshy figures
    const o = FIGURES[i]; if (o.floor !== a.floor) continue;
    const ex = a.x - o.x, ez = a.z - o.z, dd = ex * ex + ez * ez;
    if (dd < 0.55 && dd > 1e-4) { const dist = Math.sqrt(dd), push = (0.75 - dist) * 2 * dt; a.x += (ex / dist) * push; a.z += (ez / dist) * push; }
  }
  sp *= slow; const step = Math.min(d, sp * dt);
  a.x += (dx / d) * step; a.z += (dz / d) * step;
  return false;
}

let teamList: Agent[] = [];
export function stepAgents(dt: number) {
  sim.budget = 2;
  movers.fill(0); totals.fill(0);
  for (let i = 0; i < arr.length; i++) { const a = arr[i], k = fi(a.floor); if (a.kind === 'team' || a.kind === 'worker') { totals[k]++; if (a.st === 'wait' || a.st === 'go' || a.st === 'back') movers[k]++; } }
  let walking = 0, seated = 0, busy = 0;
  for (let i = 0; i < arr.length; i++) {
    const a = arr[i]; a.timer -= dt;
    switch (a.st) {
      case 'home': if (a.kind !== 'static' && a.timer <= 0) { if (canGo(a)) { randomTrip(a); if (a.st !== 'home') movers[fi(a.floor)]++; } else a.timer = rnd(3, 8); } break;
      case 'wait': tryPath(a); break;
      case 'go': case 'back': if (a.path && follow(a, dt)) arrive(a); break;
      case 'at': if (a.timer <= 0) { if (a.kind === 'visitor') visitorNext(a); else if (a.kind === 'roamer') randomTrip(a); else goHome(a); } break;
      case 'handing': if (a.timer <= 0) { a.job = null; a.carry = null; a.setCarry(null); goHome(a); } break;
      case 'gone': if (a.timer <= 0) spawnVisitor(a); break;
    }
    if (a.busy) busy++;
    if (a.st === 'go' || a.st === 'back') walking++; else if (a.pose === 'sit' || a.pose === 'type') seated++;
    if (a.g) { a.g.position.set(a.x, a.floor * FLOOR_H + FT, a.z); a.g.rotation.y = a.yaw; if (a.g.visible !== a.shown) a.g.visible = a.shown; }
  }
  figWalk.forEach((v) => { walking += v; });
  dbg.walking = walking; dbg.seated = seated; dbg.transfers = busy;
}

// ---------------------------------------------------------------- agent factories
const looks = new Map<string, CharacterAppearance>();
export const lookOf = (id: string, role?: string): CharacterAppearance => {
  let l = looks.get(id); if (l) return l;
  const a = appearanceFor(id, role);
  const lift = (c: string, t: number) => '#' + new THREE.Color(c).lerp(new THREE.Color('#ffffff'), t).getHexString();
  l = { ...a, top: lift(a.top, 0.3), bottom: lift(a.bottom, 0.15) }; looks.set(id, l); return l;
};

// ---- real-employee -> 3D seat mapping (NHÀ THUỐC bay) ----
const seatAgents = new Map<string, Agent>();
let empAgent = new Map<string, Agent>();
let pmAgent: Agent | null = null;
export interface TeamMapping { agents: Agent[]; empAgent: Map<string, Agent>; mapped: number; proxied: number; freeSlots: { id: string; x: number; z: number; rot: number }[] }
const codesOf = (c?: string): string[] => {
  if (!c) return [];
  const parts = c.split('/').map((p) => p.trim()).filter(Boolean); if (!parts.length) return [];
  const out = [parts[0]]; const base = parts[0].slice(0, parts[0].lastIndexOf('.') + 1);
  for (let i = 1; i < parts.length; i++) out.push(/^\d+$/.test(parts[i]) ? base + parts[i] : parts[i]);
  return out;
};
const acct = (s?: string) => (s ?? '').toLowerCase().replace(/\(.*?\)/g, '').trim().split(/\s+/)[0];
const hash = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };

/** Seat every engine employee: exact match by assigned id / deskId / seatCode / account, otherwise a stable proxy seat. */
export function remap(employees: Employee[]): TeamMapping {
  const slots = getFloor(TEAM_FLOOR).str.slots;
  const byAssigned = new Map<string, number>(), byDesk = new Map<string, number>(), byCode = new Map<string, number>(), byAcct = new Map<string, number>();
  slots.forEach((s, i) => {
    if (s.assigned) byAssigned.set(s.assigned, i); if (s.deskId) byDesk.set(s.deskId, i);
    for (const c of codesOf(s.seatCode)) byCode.set(c, i); if (s.account) byAcct.set(acct(s.account), i);
  });
  const seatEmps: string[][] = slots.map(() => []);
  const unmatched: Employee[] = [];
  const sorted = [...employees].sort((p, q) => (p.id < q.id ? -1 : 1));
  let mapped = 0;
  for (const e of sorted) {
    let i = byAssigned.get(e.id);
    if (i === undefined && e.deskId) i = byDesk.get(e.deskId);
    if (i === undefined) for (const c of codesOf(e.seatCode)) { const j = byCode.get(c); if (j !== undefined) { i = j; break; } }
    if (i === undefined && e.account) i = byAcct.get(acct(e.account));
    if (i !== undefined) { seatEmps[i].push(e.id); mapped++; } else unmatched.push(e);
  }
  // proxies: stable hash -> a seat nobody sits in yet (probe forward), reuse deterministically when all are taken
  let proxied = 0;
  if (slots.length) for (const e of unmatched) {
    const free: number[] = []; seatEmps.forEach((l, i) => { if (!l.length) free.push(i); });
    const i = free.length ? free[hash(e.id) % free.length] : hash(e.id) % slots.length;
    seatEmps[i].push(e.id); proxied++;
  }
  const rs = mulberry32(31); const agents: Agent[] = []; const map = new Map<string, Agent>(); const freeSlots: TeamMapping['freeSlots'] = [];
  slots.forEach((s, i) => {
    if (!seatEmps[i].length) { freeSlots.push({ id: s.id, x: s.x, z: s.z, rot: s.rot }); return; }
    let ag = seatAgents.get(s.id);
    if (!ag) { ag = makeAgent(s.id, TEAM_FLOOR, 'team', { x: s.x, z: s.z, rot: s.rot, pose: 'type' }, seatEmps[i][0]); ag.timer = 20 + rs() * 70; seatAgents.set(s.id, ag); }
    ag.emp = seatEmps[i][0]; ag.emps = seatEmps[i]; agents.push(ag);
    for (const id of seatEmps[i]) map.set(id, ag);
  });
  teamList = agents; empAgent = map; pmAgent = map.get('EMP-01') ?? agents[0] ?? null;
  dbg.mapped = mapped; dbg.proxied = proxied;
  return { agents, empAgent: map, mapped, proxied, freeSlots };
}

const floorCache = new Map<number, Agent[]>();
export function floorAgents(f: number): Agent[] {
  const hit = floorCache.get(f); if (hit) return hit;
  const d = getFloor(f).lay, list: Agent[] = [];
  const r = mulberry32(f * 7 + 3);
  const pick = <T,>(a: T[], n: number) => a.map((v) => [r(), v] as const).sort((p, q) => p[0] - q[0]).slice(0, n).map((p) => p[1]);
  pick(d.seats, d.npcSeated).forEach((s, i) => list.push(makeAgent(`npc-f${f}-t${i}`, f, 'worker', { x: s.x * K, z: s.z * K, rot: s.rot, pose: 'type' })));
  pick(d.sitSeats, d.npcSit || 4).forEach((s, i) => list.push(makeAgent(`npc-f${f}-s${i}`, f, 'worker', { x: s.x * K, z: s.z * K, rot: s.rot, pose: 'sit' })));
  for (const s of d.stands) {
    const still = /reception|barista|chef|guard|trainer|led/.test(s.id);
    list.push(makeAgent(s.id, f, still ? 'static' : 'worker', { x: s.x * K, z: s.z * K, rot: s.rot, pose: 'idle' }));
  }
  d.walkers.forEach((w, i) => {
    const a = makeAgent(w.id, f, f === 0 ? 'visitor' : 'roamer', { x: w.a[0] * K, z: w.a[1] * K, rot: 0, pose: 'idle' });
    a.st = 'at'; a.timer = i * 0.7 + rnd(0, 3); a.stage = f === 0 ? (i % 3 === 0 ? 0 : 1) : 0; list.push(a);
  });
  floorCache.set(f, list); return list;
}

// ---------------------------------------------------------------- transfers (simulation-driven handoffs)
const PRIORITY: Record<string, string> = { CRITICAL: '#ef4444', HIGH: '#f97316', MEDIUM: '#facc15', LOW: '#4ade80' };
const seen = new Set<string>();
const tmp: [number, number] = [0, 0];
/** Visualise every transfer whose from/to resolves to a seat agent (directly or via proxy seat). */
export function syncTransfers(list: DocumentTransferTask[]) {
  if (!empAgent.size) return;
  let unmapped = 0;
  for (const t of list) {
    if (t.phase === 'COMPLETED') continue;
    const a = empAgent.get(t.fromEmployeeId);
    if (!a) { unmapped++; continue; }
    if (t.phase === 'QUEUED' || seen.has(t.id) || a.busy || !arr.includes(a)) continue;
    let to = empAgent.get(t.isReturnToPM ? 'EMP-01' : t.toEmployeeId) ?? pmAgent;
    if (!to || to === a) to = pmAgent && pmAgent !== a ? pmAgent : teamList[(teamList.indexOf(a) + 1) % teamList.length];
    if (!to || to === a || !freePoint(a.floor, to.home.x, to.home.z, tmp)) continue;
    const tx = tmp[0], tz = tmp[1], face = Math.atan2(to.home.x - tx, to.home.z - tz);
    if (seen.size > 400) seen.clear();
    seen.add(t.id); a.busy = true;
    if (t.phase === 'RETURNING_TO_DESK') { // already delivered: appear at the target desk and walk home empty-handed
      a.x = tx; a.z = tz; a.yaw = face; a.job = null; a.carry = null; a.setCarry(null);
      goHome(a);
    } else {
      a.job = { id: t.id, key: t.ticketKey, color: PRIORITY[t.ticketPriority] ?? '#facc15', isReturn: t.isReturnToPM };
      a.carry = { key: t.ticketKey, color: a.job.color }; a.setCarry(a.carry);
      startTrip(a, tx, tz, face, 'wave', 'go', 1.3);
    }
    a.stage = 9;
  }
  dbg.unmappedTransfers = unmapped;
}
if (import.meta.env?.DEV) {
  dbg.inject = (from, to, key = 'TEST-1') => syncTransfers([{ id: `inj-${Date.now()}-${Math.random()}`, ticketId: key, ticketKey: key, ticketSummary: '', ticketPriority: 'HIGH', targetStatus: 'IN_PROGRESS', fromEmployeeId: from, toEmployeeId: to, fromDeskId: '', toDeskId: '', isReturnToPM: to === 'EMP-01', documentStackSize: 2, phase: 'PICKING_UP', outboundPath: [], returnPath: [], currentSegmentIndex: 0, progress: 0, startedAt: Date.now(), description: '' } as unknown as DocumentTransferTask]);
}

// ---------------------------------------------------------------- confetti + carried stacks
const NP = 64;
const cpos = new Float32Array(NP * 3), cvel = new Float32Array(NP * 3), clife = new Float32Array(NP);
let confettiDirty = false, cursor = 0;
export function burst(x: number, y: number, z: number) {
  for (let i = 0; i < 40; i++) {
    const k = cursor++ % NP; cpos[k * 3] = x; cpos[k * 3 + 1] = y; cpos[k * 3 + 2] = z;
    const a = Math.random() * 6.283, s = 1 + Math.random() * 2.2; cvel[k * 3] = Math.cos(a) * s; cvel[k * 3 + 1] = 2.5 + Math.random() * 2.5; cvel[k * 3 + 2] = Math.sin(a) * s; clife[k] = 1.6 + Math.random() * 0.6;
  }
  confettiDirty = true;
}
const BOX = new THREE.BoxGeometry(1, 1, 1);
const CONF_COLORS = ['#ff5a5a', '#ffd23f', '#4ade80', '#38bdf8', '#c084fc', '#fb923c'];
export const Effects: React.FC = () => {
  const conf = useRef<THREE.InstancedMesh>(null!), stack = useRef<THREE.InstancedMesh>(null!);
  const o = useMemo(() => new THREE.Object3D(), []), col = useMemo(() => new THREE.Color(), []);
  useLayoutEffect(() => { for (let i = 0; i < NP; i++) conf.current.setColorAt(i, col.set(CONF_COLORS[i % 6])); conf.current.instanceColor!.needsUpdate = true; }, [col]);
  useFrame((_, dt) => {
    void confettiDirty; confettiDirty = false;
    let n = 0;
    for (let k = 0; k < NP; k++) {
      if (clife[k] <= 0) continue;
      clife[k] -= dt; cvel[k * 3 + 1] -= 7 * dt;
      cpos[k * 3] += cvel[k * 3] * dt; cpos[k * 3 + 1] += cvel[k * 3 + 1] * dt; cpos[k * 3 + 2] += cvel[k * 3 + 2] * dt;
      o.position.set(cpos[k * 3], cpos[k * 3 + 1], cpos[k * 3 + 2]); o.rotation.set(clife[k] * 6, clife[k] * 4, 0); o.scale.set(0.09, 0.02, 0.06); o.updateMatrix();
      conf.current.setMatrixAt(n, o.matrix); conf.current.setColorAt(n, col.set(CONF_COLORS[k % 6])); n++;
    }
    conf.current.count = n; conf.current.instanceMatrix.needsUpdate = true; if (conf.current.instanceColor) conf.current.instanceColor.needsUpdate = true;
    let m = 0;
    for (let i = 0; i < arr.length && m < 12; i++) {
      const a = arr[i]; if (!a.carry || !a.shown) continue;
      o.position.set(a.x + Math.sin(a.yaw) * 0.38, a.floor * FLOOR_H + FT + 1.02, a.z + Math.cos(a.yaw) * 0.38); o.rotation.set(0, a.yaw, 0); o.scale.set(0.34, 0.1, 0.24); o.updateMatrix();
      stack.current.setMatrixAt(m, o.matrix); stack.current.setColorAt(m, col.set(a.carry.color)); m++;
    }
    stack.current.count = m; stack.current.instanceMatrix.needsUpdate = true; if (stack.current.instanceColor) stack.current.instanceColor.needsUpdate = true;
  });
  return (
    <>
      <instancedMesh ref={conf} args={[BOX, undefined, NP]} frustumCulled={false}><meshBasicMaterial toneMapped={false} /></instancedMesh>
      <instancedMesh ref={stack} args={[BOX, undefined, 12]} frustumCulled={false}><meshStandardMaterial roughness={0.7} /></instancedMesh>
    </>
  );
};

// ---------------------------------------------------------------- views
export const AgentView: React.FC<{ a: Agent; look: CharacterAppearance; handlers?: Record<string, unknown>; chip?: React.ReactNode }> = ({ a, look, handlers, chip }) => {
  const ref = useRef<THREE.Group>(null!);
  const [pose, setP] = useState<Pose>(a.pose);
  const [carry, setC] = useState(a.carry);
  useLayoutEffect(() => {
    a.setPose = setP; a.setCarry = setC; a.g = ref.current; setP(a.pose); setC(a.carry);
    ref.current.position.set(a.x, a.floor * FLOOR_H + FT, a.z); ref.current.rotation.y = a.yaw; ref.current.visible = a.shown;
    register(a);
    return () => { unregister(a); a.g = null; a.setPose = noop; a.setCarry = noop; };
  }, [a]);
  return (
    <group ref={ref} {...(handlers as object)}>
      <Character3D appearance={look} pose={pose === 'wave' ? 'wave' : pose} />
      {chip}
      {carry && (
        <Html position={[0, 2.25, 0]} center distanceFactor={11} zIndexRange={[20, 0]} style={{ pointerEvents: 'none' }}>
          <div style={{ padding: '1px 6px', borderRadius: 8, background: carry.color, color: '#111', font: '700 10px system-ui', whiteSpace: 'nowrap' }}>{carry.key}</div>
        </Html>
      )}
    </group>
  );
};

/** Non-team floors: workers, sitters, standers and roamers/visitors as agents. */
export const FloorPeople: React.FC<{ f: number }> = ({ f }) => {
  const list = useMemo(() => floorAgents(f), [f]);
  return <>{list.map((a) => <AgentView key={a.id} a={a} look={lookOf(a.id)} />)}</>;
};

export type { ThreeEvent };
export { EMPLOYEE_BY_ID, officeSimulationEngine };
