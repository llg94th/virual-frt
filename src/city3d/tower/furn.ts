/**
 * Procedural data builders for F-Town 3 floors. Pure data (no React): lists of boxes / balls / labels
 * that index.tsx renders with instancing. Floor-local coordinates: y=0 is the slab bottom, FT is the walking surface.
 */
import { FLOOR_H, TEAM_FLOOR, mulberry32 } from '../shared';
import { NHA_THUOC_SEAT_SLOTS } from '../../data/officeLayout';
import { EMPLOYEE_BY_ID } from '../../data/employees';

export const FT = 0.3; // slab thickness
export const CLEAR = FLOOR_H - FT; // clear height 3.3
export const HALF = 26; // half footprint (52 / 2)
export type V3 = [number, number, number];
export interface Box { p: V3; s: V3; c: string; r: number; rx: number }
export interface Ball { p: V3; r: number; c: string }
export interface Label { t: string; x: number; y: number; z: number; w: number; h: number; rot: number; flat?: boolean; fg?: string; bg?: string }
export interface Seat { x: number; z: number; rot: number; id?: string }
export interface Walker { a: [number, number]; b: [number, number]; speed: number; id: string }
export interface Stand { x: number; z: number; rot: number; id: string; pose?: 'idle' | 'wave' }

/** Courtyard atria (open voids through every floor) */
export const COURTYARDS = [
  { x: -16, z: -13, w: 14, d: 14 },
  { x: -16, z: 13, w: 14, d: 14 },
];
/** Slab = footprint minus courtyards: [cx, cz, w, d] */
export const SLAB_PIECES: [number, number, number, number][] = [
  [8.5, 0, 35, 52], [-24.5, 0, 3, 52], [-16, -23, 14, 6], [-16, 0, 14, 12], [-16, 23, 14, 6],
];
/** Elevator/structural core */
export const CORE = { x: -2.5, z: 0, w: 5, d: 7 };

export class Furn {
  boxes: Box[] = [];
  glass: Box[] = [];
  screens: Box[] = [];
  leds: Box[] = [];
  balls: Ball[] = [];
  labels: Label[] = [];
  seats: Seat[] = []; // generic 'type' desks available to NPC workers
  sitSeats: Seat[] = []; // bench / lounge seats ('sit')
  stands: Stand[] = [];
  walkers: Walker[] = [];
  /** Real team seats on TEAM_FLOOR */
  team: { emp: string; x: number; z: number; rot: number }[] = [];
  /** Occupied-by-someone-else seats (other staff in the bay) */
  extraTeam: Seat[] = [];
  npcSeated = 0;
  npcSit = 0;
  solid = false;

  private mk(list: Box[], x: number, y: number, z: number, w: number, h: number, d: number, c: string, r = 0, rx = 0) {
    list.push({ p: [x, FT + y + h / 2, z], s: [w, h, d], c, r, rx });
  }
  /** y = bottom above the walking surface */
  b(x: number, y: number, z: number, w: number, h: number, d: number, c: string, r = 0, rx = 0) { this.mk(this.boxes, x, y, z, w, h, d, c, r, rx); }
  g(x: number, y: number, z: number, w: number, h: number, d: number, c = '#bfe8ea', r = 0) { this.mk(this.glass, x, y, z, w, h, d, c, r); }
  scr(x: number, y: number, z: number, w: number, h: number, d: number, c = '#4fd1ff', r = 0) { this.mk(this.screens, x, y, z, w, h, d, c, r); }
  led(x: number, y: number, z: number, c: string) { this.mk(this.leds, x, y, z, 0.05, 0.05, 0.02, c); }
  ball(x: number, y: number, z: number, r: number, c: string) { this.balls.push({ p: [x, FT + y, z], r, c }); }
  label(l: Label) { this.labels.push(l); }

  /** local (lx,lz) in a frame rotated by th at (cx,cz) */
  lp(cx: number, cz: number, th: number, lx: number, lz: number): [number, number] {
    return [cx + lx * Math.cos(th) + lz * Math.sin(th), cz - lx * Math.sin(th) + lz * Math.cos(th)];
  }
  /** a rotated box in a local frame */
  rb(cx: number, cz: number, th: number, lx: number, lz: number, y: number, w: number, h: number, d: number, c: string) {
    const [x, z] = this.lp(cx, cz, th, lx, lz); this.b(x, y, z, w, h, d, c, th);
  }

  tree(x: number, z: number, h = 4, r = 1.6, c = '#3f9a5a') {
    this.b(x, 0, z, 0.22, h * 0.6, 0.22, '#6b4a2f');
    this.ball(x, h * 0.6 + r * 0.5, z, r, c);
    this.ball(x + r * 0.45, h * 0.6 + r * 0.2, z + r * 0.2, r * 0.7, '#4fae6a');
  }
  plant(x: number, z: number, s = 1) {
    this.b(x, 0, z, 0.4 * s, 0.4 * s, 0.4 * s, '#e8e4dc');
    this.ball(x, 0.4 * s + 0.35 * s, z, 0.4 * s, '#3e9b55');
  }
  chair(x: number, z: number, th: number, c = '#2f3b44') {
    this.rb(x, z, th, 0, 0, 0, 0.06, 0.42, 0.06, '#333');
    this.rb(x, z, th, 0, 0, 0.42, 0.46, 0.06, 0.46, c);
    this.rb(x, z, th, 0, -0.23, 0.5, 0.46, 0.42, 0.05, c);
  }
  /** Desk with monitor, keyboard and chair. Occupant sits at the chair looking along dir=(sin th,cos th). */
  workstation(x: number, z: number, th: number, o: { dw?: number; dd?: number; on?: boolean; top?: string; chair?: string } = {}): Seat {
    const dw = o.dw ?? 1.4, dd = o.dd ?? 0.7;
    this.rb(x, z, th, 0, 0, 0.7, dw, 0.05, dd, o.top ?? '#e9e2d3');
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) this.rb(x, z, th, sx * (dw / 2 - 0.04), sz * (dd / 2 - 0.04), 0, 0.04, 0.7, 0.04, '#8a949b');
    this.rb(x, z, th, 0, 0.12, 0.75, 0.06, 0.16, 0.06, '#222');
    const [mx, mz] = this.lp(x, z, th, 0, 0.12);
    this.scr(mx, 0.9, mz, 0.55, 0.32, 0.03, o.on === false ? '#16262b' : '#4fd1ff', th);
    this.rb(x, z, th, 0, -0.12, 0.75, 0.4, 0.02, 0.14, '#202428');
    const cd = dd / 2 + 0.25;
    const [cx, cz] = this.lp(x, z, th, 0, -cd);
    this.chair(cx, cz, th, o.chair);
    const seat = { x: cx, z: cz, rot: th };
    return seat;
  }
  table(x: number, z: number, w: number, d: number, c = '#d9c7a8', h = 0.74) {
    this.b(x, h - 0.05, z, w, 0.05, d, c);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) this.b(x + sx * (w / 2 - 0.1), 0, z + sz * (d / 2 - 0.1), 0.06, h - 0.05, 0.06, '#7a838a');
  }
  sofa(x: number, z: number, th: number, len = 2.2, c = '#2e8f8a') {
    this.rb(x, z, th, 0, 0, 0, len, 0.42, 0.85, c);
    this.rb(x, z, th, 0, -0.38, 0.42, len, 0.45, 0.14, c);
    this.rb(x, z, th, -len / 2 + 0.07, 0, 0.42, 0.14, 0.25, 0.8, c);
    this.rb(x, z, th, len / 2 - 0.07, 0, 0.42, 0.14, 0.25, 0.8, c);
  }
  counter(x: number, z: number, w: number, d: number, c = '#f1ede4', top = '#3a4a50') {
    this.b(x, 0, z, w, 1.0, d, c);
    this.b(x, 1.0, z, w + 0.06, 0.05, d + 0.06, top);
  }
  stool(x: number, z: number) {
    this.b(x, 0, z, 0.06, 0.55, 0.06, '#555'); this.b(x, 0.55, z, 0.34, 0.05, 0.34, '#e07a3a');
  }
  /** Glass-walled room (door gap on south side) */
  room(cx: number, cz: number, w: number, d: number, tableTone = '#d9c7a8') {
    this.g(cx, 0, cz - d / 2, w, CLEAR - 0.4, 0.05);
    this.g(cx - w / 2, 0, cz, 0.05, CLEAR - 0.4, d);
    this.g(cx + w / 2, 0, cz, 0.05, CLEAR - 0.4, d);
    const seg = (w - 1.4) / 2;
    this.g(cx - w / 2 + seg / 2, 0, cz + d / 2, seg, CLEAR - 0.4, 0.05);
    this.g(cx + w / 2 - seg / 2, 0, cz + d / 2, seg, CLEAR - 0.4, 0.05);
    this.b(cx, 0, cz, w - 0.4, 0.015, d - 0.4, '#c9d8cc');
    this.table(cx, cz, w * 0.55, d * 0.3, tableTone);
    const n = Math.max(2, Math.round((w * 0.55) / 0.9));
    for (let i = 0; i < n; i++) {
      const px = cx - (w * 0.55) / 2 + ((i + 0.5) * (w * 0.55)) / n;
      this.chair(px, cz - d * 0.15 - 0.45, Math.PI); this.chair(px, cz + d * 0.15 + 0.45, 0);
    }
    this.scr(cx, 1.0, cz - d / 2 + 0.2, 2.2, 1.2, 0.05, '#2a7fb8');
  }
  /** Islands of 4 workstations (2 rows face to face) */
  island(cx: number, cz: number, top?: string) {
    for (const sx of [-1, 1]) {
      this.seats.push(this.workstation(cx + sx * 0.72, cz - 0.42, 0, { top }));
      this.seats.push(this.workstation(cx + sx * 0.72, cz + 0.42, Math.PI, { top }));
    }
    this.g(cx, 0.75, cz, 2.9, 0.4, 0.03);
  }
  /** frame (mullions + spandrel) along a segment */
  frame(x0: number, z0: number, x1: number, z1: number, step = 2.6) {
    const L = Math.hypot(x1 - x0, z1 - z0);
    const alongX = Math.abs(z1 - z0) < 1e-6;
    const n = Math.max(1, Math.round(L / step));
    for (let i = 0; i <= n; i++) {
      const x = x0 + ((x1 - x0) * i) / n, z = z0 + ((z1 - z0) * i) / n;
      const big = i === 0 || i === n;
      this.b(x, 0, z, big ? 0.5 : 0.1, CLEAR, big ? 0.5 : 0.1, big ? '#e9eeed' : '#dfe7e6');
    }
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    this.b(cx, CLEAR - 0.35, cz, alongX ? L : 0.24, 0.35, alongX ? 0.24 : L, '#f4f6f5');
    this.b(cx, 0, cz, alongX ? L : 0.2, 0.12, alongX ? 0.2 : L, '#f4f6f5');
  }
}

// ---------- shared parts ----------
function shell(F: Furn, f: number) {
  const H = HALF;
  if (F.solid) {
    F.b(0, 0, -H, 52, CLEAR, 0.4, '#8d949a'); F.b(0, 0, H, 52, CLEAR, 0.4, '#8d949a');
    F.b(-H, 0, 0, 0.4, CLEAR, 52, '#8d949a'); F.b(H, 0, 0, 0.4, CLEAR, 52, '#8d949a');
    return;
  }
  F.frame(-H, -H, H, -H); F.frame(-H, H, H, H); F.frame(-H, -H, -H, H); F.frame(H, -H, H, H);
  for (const c of COURTYARDS) {
    const x0 = c.x - c.w / 2, x1 = c.x + c.w / 2, z0 = c.z - c.d / 2, z1 = c.z + c.d / 2;
    F.frame(x0, z0, x1, z0, 3.5); F.frame(x0, z1, x1, z1, 3.5); F.frame(x0, z0, x0, z1, 3.5); F.frame(x1, z0, x1, z1, 3.5);
  }
  // terrace garden balconies: alternate facades by floor ("Building in the Park")
  if (f >= 1) {
    const rnd = mulberry32(f * 131 + 7);
    const sides = f % 2 === 1 ? ['N', 'S'] : ['E', 'W'];
    for (const s of sides) {
      const alongX = s === 'N' || s === 'S';
      const sign = s === 'N' || s === 'W' ? -1 : 1;
      const off = H + 1.2;
      const cx = alongX ? 0 : sign * off, cz = alongX ? sign * off : 0;
      F.b(cx, -FT, cz, alongX ? 46 : 2.4, FT, alongX ? 2.4 : 46, '#eef1ef');
      const edge = H + 2.2;
      F.g(alongX ? 0 : sign * (H + 2.4), 0, alongX ? sign * (H + 2.4) : 0, alongX ? 46 : 0.04, 1.0, alongX ? 0.04 : 46);
      for (let i = -11; i <= 11; i++) {
        const along = i * 2;
        const px = alongX ? along : sign * edge, pz = alongX ? sign * edge : along;
        F.b(px, 0, pz, alongX ? 1.7 : 0.7, 0.5, alongX ? 0.7 : 1.7, '#d4cfc4');
        F.b(px, 0.5, pz, alongX ? 1.6 : 0.6, 0.06, alongX ? 0.6 : 1.6, '#5b4630');
        if (rnd() < 0.3) F.tree(px, pz, 2.4 + rnd() * 1.6, 0.8 + rnd() * 0.5, rnd() < 0.5 ? '#2f8a4a' : '#59b36a');
        else F.ball(px, 0.5 + FT * 0 + 0.35, pz, 0.45 + rnd() * 0.15, rnd() < 0.5 ? '#3e9b55' : '#6cc07a');
      }
    }
  }
}
function core(F: Furn) {
  const { x, z, w, d } = CORE;
  F.b(x, 0, z - d / 2, w, CLEAR, 0.2, '#cfd6d4');
  F.b(x - w / 2, 0, z, 0.2, CLEAR, d, '#cfd6d4');
  F.b(x + w / 2, 0, z, 0.2, CLEAR, d, '#cfd6d4');
  F.b(x, 0, z, 0.12, CLEAR, d, '#cfd6d4');
  F.b(x, 2.75, z + d / 2, w, 0.55, 0.2, '#2e8f8a');
  for (const dx of [-w / 2, 0, w / 2]) F.b(x + dx, 0, z + d / 2, 0.2, 2.8, 0.2, '#aeb8b6');
  F.b(-2.5, 0, 4.3, 0.1, 0.1, 0.1, '#222');
  // call buttons panel
  F.scr(x, 1.3, z + d / 2 + 0.12, 0.3, 0.45, 0.04, '#ffb03a');
  // stairwell next to the south wall (rises one storey)
  const steps = 14;
  for (let i = 0; i < steps; i++) F.b(8 + i * 0.7 + 0.35, 0, 24.2, 0.7, ((i + 1) * CLEAR) / steps, 1.6, '#c9cfcc');
  F.g(13, 0.4, 25.1, 10, 1.0, 0.04);
}
function garden(F: Furn) {
  const rnd = mulberry32(2024);
  COURTYARDS.forEach((c, k) => {
    F.b(c.x, -FT - 0.1, c.z, c.w - 0.2, 0.15, c.d - 0.2, '#4c9a4f');
    F.b(c.x + (k ? 2 : -2), -FT - 0.07, c.z, 5, 0.04, 6.5, '#4fc0cf'); // pond
    F.b(c.x + (k ? 2 : -2), -FT, c.z, 5.4, 0.1, 0.3, '#d8d2c4');
    for (let i = 0; i < 9; i++) F.b(c.x - 6 + i * 1.5, -FT - 0.05, c.z + (k ? -5 : 5), 0.9, 0.08, 0.9, '#c9c3b5');
    for (let i = 0; i < 7; i++) {
      const tx = c.x + (rnd() - 0.5) * (c.w - 3), tz = c.z + (rnd() - 0.5) * (c.d - 3);
      F.tree(tx, tz, 5 + rnd() * 8, 2 + rnd() * 1.8, rnd() < 0.5 ? '#2f8a4a' : '#3da35a');
    }
    for (let i = 0; i < 14; i++) F.ball(c.x + (rnd() - 0.5) * 12, -FT + 0.4, c.z + (rnd() - 0.5) * 12, 0.45 + rnd() * 0.4, rnd() < 0.3 ? '#e87aa0' : '#5ab86a');
  });
  F.label({ t: 'GIẾNG TRỜI • RAINFOREST', x: -16, y: 0.2, z: 0, w: 8, h: 1, rot: 0, flat: true, fg: '#ffffff', bg: 'rgba(30,110,90,0.0)' });
}

// ---------- floors ----------
export const TEAM_SEATS: { emp: string; x: number; z: number; rot: number }[] = [];

function lobby(F: Furn) {
  F.counter(12, 13, 8, 1.2, '#f4f4f0', '#2e8f8a');
  F.b(12, 1.05, 12.8, 3, 0.35, 0.05, '#222');
  F.label({ t: 'F-TOWN 3 • FPT SOFTWARE', x: 12, y: 2.6, z: 10.3, w: 8, h: 1.2, rot: 0, fg: '#ffffff', bg: '#2e8f8a' });
  F.stands.push({ x: 12, z: 11.8, rot: 0, id: 'f1-reception' });
  F.stands.push({ x: 15, z: 16, rot: Math.PI, id: 'f1-visitor1', pose: 'wave' });
  // turnstiles
  for (let i = 0; i < 3; i++) { F.b(2.6 + i * 1.5, 0, 7, 0.1, 1.0, 0.9, '#b8c2c6'); F.scr(2.6 + i * 1.5, 1.0, 7, 0.1, 0.06, 0.2, '#38d96a'); }
  F.b(7.1, 0, 7, 0.1, 1.0, 0.9, '#b8c2c6');
  // lounge
  F.sofa(-3, 16, Math.PI, 2.6); F.sofa(-3, 20, 0, 2.6); F.table(-3, 18, 1.4, 0.7, '#e9e2d3', 0.4);
  F.sofa(2, 18, -Math.PI / 2, 2.2, '#e0a64b');
  for (const [px, pz] of [[-7, 24], [-7, 9], [6, 9], [-1, 24]]) F.plant(px, pz, 1.4);
  // cafe
  F.counter(24, 17, 1.2, 9, '#2e8f8a', '#e9e2d3');
  F.b(24, 1.05, 14, 0.5, 0.45, 0.6, '#b9c1c5'); F.b(24, 1.05, 17, 0.5, 0.35, 0.6, '#222'); F.scr(24, 1.4, 17, 0.2, 0.1, 0.2, '#ff8a3a');
  F.label({ t: 'CAFÉ', x: 25.8, y: 2.6, z: 17, w: 3, h: 0.9, rot: -Math.PI / 2, fg: '#ffffff', bg: '#6b4a2f' });
  F.stands.push({ x: 25.2, z: 17, rot: -Math.PI / 2, id: 'f1-barista' });
  for (const z of [12, 16.5, 21]) { F.table(19, z, 0.9, 0.9, '#e9e2d3', 1.0); F.stool(18.1, z); F.stool(19.9, z); }
  F.walkers.push({ a: [-6, 22.5], b: [8, 22.5], speed: 1.1, id: 'f1-walk1' });
  F.walkers.push({ a: [3, 9], b: [3, 21], speed: 1.0, id: 'f1-walk2' });
  F.tree(-8, 18, 3.5, 1.2);
}
function training(F: Furn) {
  // training room
  F.scr(16, 1.0, 10.6, 6, 1.8, 0.08, '#2a7fb8'); F.b(16, 0, 10.5, 6.4, 0.1, 0.2, '#ddd');
  F.label({ t: 'TRAINING', x: 16, y: 3.0, z: 10.4, w: 4, h: 0.7, rot: 0, fg: '#fff', bg: '#2e8f8a' });
  for (const rz of [13, 15.5, 18, 20.5]) for (const rx of [12, 19]) {
    F.table(rx, rz, 5, 0.6, '#e9e2d3');
    for (let i = 0; i < 4; i++) F.chair(rx - 1.9 + i * 1.25, rz + 0.75, Math.PI);
  }
  F.stands.push({ x: 16, z: 11.8, rot: 0, id: 'f2-trainer' });
  // meeting rooms
  [4, 13, 22].forEach((x) => F.room(x, -21, 7, 6));
  // pantry
  F.counter(-16, -3, 8, 0.8, '#f1ede4', '#2e8f8a'); F.b(-18.5, 1.05, -3, 0.5, 0.4, 0.5, '#b9c1c5');
  F.b(-21.2, 0, -3, 1, 1.9, 0.8, '#d7dcde');
  F.label({ t: 'PANTRY', x: -16, y: 2.6, z: -3.6, w: 3.2, h: 0.8, rot: 0, fg: '#fff', bg: '#e07a3a' });
  for (const x of [-20, -16, -12]) { F.table(x, 2.5, 0.9, 0.9, '#e9e2d3', 1.0); F.stool(x - 0.7, 2.5); F.stool(x + 0.7, 2.5); }
  F.stands.push({ x: -17, z: -4.2, rot: Math.PI, id: 'f2-pantry1' }); F.stands.push({ x: -13.5, z: -1.8, rot: 0, id: 'f2-pantry2' });
  // coworking lounge
  for (let i = 0; i < 4; i++) { F.sofa(6 + i * 5, -6, 0, 2.2); F.table(6 + i * 5, -3.8, 1.2, 0.6, '#e9e2d3', 0.4); F.plant(8.5 + i * 5, -4, 1.1); }
  F.sitSeats.push({ x: 6, z: -5.8, rot: 0 }, { x: 11, z: -5.8, rot: 0 });
  F.walkers.push({ a: [3, 5], b: [22, 5], speed: 1.0, id: 'f2-walk1' });
}
function teamFloor(F: Furn) {
  const S = 0.0327, CX = 13.5;
  const mx = (wx: number) => CX + (wx - 1177.5) * S, mz = (wy: number) => (wy - 492.5) * S;
  F.b(CX, 0, 0, 24.2, 0.02, 20.6, '#b9cfae');
  // low glass bay walls with north door gap
  F.g(CX, 0, 10.3, 24.2, 1.4, 0.05); F.g(1.5, 0, 0, 0.05, 1.4, 20.6); F.g(25.5, 0, 0, 0.05, 1.4, 20.6);
  F.g(5.5, 0, -10.3, 8, 1.4, 0.05); F.g(19.5, 0, -10.3, 12, 1.4, 0.05);
  F.b(CX, 1.4, 10.3, 24.2, 0.05, 0.08, '#2e8f8a');
  F.label({ t: 'CỬA RA VÀO', x: 11.5, y: 0.05, z: -9.2, w: 3.6, h: 0.6, rot: 0, flat: true, fg: '#1d5a4c', bg: 'rgba(255,255,255,0.0)' });
  F.label({ t: 'NHÀ THUỐC', x: CX, y: 0.06, z: mz(418), w: 9, h: 1.7, rot: 0, flat: true, fg: '#2c6b4f', bg: 'rgba(0,0,0,0)' });
  const islands = new Map<string, typeof NHA_THUOC_SEAT_SLOTS>();
  for (const s of NHA_THUOC_SEAT_SLOTS) { const a = islands.get(s.islandId) ?? []; a.push(s); islands.set(s.islandId, a); }
  islands.forEach((slots) => {
    const xs = slots.map((s) => mx(s.wx)), zs = slots.map((s) => mz(s.wy));
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cz = (Math.min(...zs) + Math.max(...zs)) / 2;
    const d = Math.max(...zs) - Math.min(...zs) + 1.4;
    F.b(cx, 0.02, cz, 3.2, 0.01, d + 0.4, '#9fb994');
    F.g(cx, 0.75, cz, 0.04, 0.4, d);
  });
  for (const s of NHA_THUOC_SEAT_SLOTS) {
    const x = mx(s.wx), z = mz(s.wy);
    if (s.kind === 'PILLAR') { F.b(x, 0, z, 0.7, CLEAR, 0.7, '#e6e8e6'); continue; }
    const th = s.side === 'LEFT' ? Math.PI / 2 : -Math.PI / 2;
    const emp = s.assignedEmployeeId && EMPLOYEE_BY_ID[s.assignedEmployeeId] ? s.assignedEmployeeId : undefined;
    const occupied = s.kind === 'OCCUPIED';
    const seat = F.workstation(x, z, th, {
      dw: 1.05, dd: 1.11, on: occupied,
      top: s.highlight === 'red' ? '#d94a4a' : s.highlight === 'yellow' ? '#e8c24a' : '#efe9dc',
    });
    if (emp) F.team.push({ emp, x: seat.x, z: seat.z, rot: th });
    else if (occupied) F.extraTeam.push({ ...seat, id: s.seatCode });
  }
  TEAM_SEATS.length = 0; TEAM_SEATS.push(...F.team);
  // surroundings
  F.room(6, -19, 8, 6); F.room(18, -19, 8, 6);
  F.counter(-16, -3, 8, 0.8, '#f1ede4', '#2e8f8a');
  F.label({ t: 'PANTRY', x: -16, y: 2.6, z: -3.6, w: 3.2, h: 0.8, rot: 0, fg: '#fff', bg: '#e07a3a' });
  F.sofa(8, 17, Math.PI, 2.6); F.sofa(14, 17, Math.PI, 2.6); F.table(11, 19, 1.4, 0.7, '#e9e2d3', 0.4);
  for (const [px, pz] of [[2, 12], [25, 12], [2, -12], [-7, 8], [-7, -8]]) F.plant(px, pz, 1.4);
  F.walkers.push({ a: [4, 13], b: [23, 13], speed: 1.0, id: 'f3-walk1' });
}
function openPlan(F: Furn, f: number) {
  const rnd = mulberry32(f * 977);
  const tones = ['#e9e2d3', '#dfe9e1', '#e6e2ee'];
  for (const cx of [-5, 3, 11, 19]) for (const cz of [-19, -11, 11, 19]) {
    if (f === 4 && cz === 19 && cx > 5) continue; // breakout area
    F.island(cx, cz, tones[Math.floor(rnd() * 3)]);
  }
  if (f === 4) { F.sofa(14, 19, Math.PI, 2.6); F.sofa(20, 19, Math.PI, 2.6); F.table(17, 21, 1.4, 0.7, '#e9e2d3', 0.4); }
  F.room(22, -3, 4, 5);
  for (const [px, pz] of [[7, 0], [15, 0], [24, -7], [-7, 0]]) F.plant(px, pz, 1.3);
  F.label({ t: f === 3 ? 'F4 • OPEN WORKSPACE' : 'F5 • OPEN WORKSPACE', x: 13, y: 0.05, z: 0, w: 9, h: 1.2, rot: 0, flat: true, fg: '#1d5a4c', bg: 'rgba(0,0,0,0)' });
  F.npcSeated = 6;
}
function rnd(F: Furn) {
  F.label({ t: 'R&D CENTER', x: 12, y: 0.05, z: -2, w: 8, h: 1.3, rot: 0, flat: true, fg: '#1d5a4c', bg: 'rgba(0,0,0,0)' });
  for (let i = 0; i < 3; i++) {
    const z = -22 + i * 5;
    F.table(10, z, 14, 1.3, '#f1f1ef', 0.9);
    for (let k = 0; k < 4; k++) { F.scr(5 + k * 3.6, 1.0, z - 0.3, 0.6, 0.35, 0.04, '#6cf0b8'); F.b(6.5 + k * 3.6, 0.9, z + 0.2, 0.5, 0.35, 0.5, '#4a5a64'); F.chair(5 + k * 3.6, z + 1.1, Math.PI); }
  }
  F.b(22, 0, -22, 2.2, 1.6, 1.4, '#4a5a64'); F.b(22, 1.6, -22, 0.5, 1.0, 0.5, '#e07a3a'); // robot arm
  F.island(-5, -11); F.island(3, -9);
  F.npcSeated = 3;
  // Jenkins server room
  const cx = 13, cz = 15;
  F.g(cx, 0, 10, 18, CLEAR - 0.3, 0.05); F.g(cx, 0, 20, 18, CLEAR - 0.3, 0.05); F.g(4, 0, cz, 0.05, CLEAR - 0.3, 10); F.g(22, 0, cz, 0.05, CLEAR - 0.3, 10);
  F.b(cx, 0, cz, 17.6, 0.02, 9.6, '#3a4650');
  F.label({ t: 'JENKINS • CI/CD', x: cx, y: 2.8, z: 9.9, w: 6, h: 0.9, rot: Math.PI, fg: '#fff', bg: '#c0392b' });
  F.label({ t: 'JENKINS • CI/CD', x: cx, y: 2.8, z: 10.1, w: 6, h: 0.9, rot: 0, fg: '#fff', bg: '#c0392b' });
  const lr = mulberry32(55);
  for (let i = 0; i < 15; i++) for (const [rz, fz] of [[13, 13.55], [17, 16.45]] as const) {
    const x = 5.2 + i * 1.15;
    F.b(x, 0, rz, 0.8, 2.2, 1.0, '#1b2228');
    for (let k = 0; k < 8; k++) F.led(x - 0.25 + (k % 4) * 0.17, 0.4 + Math.floor(k / 4) * 0.5 + lr() * 0.8, fz, lr() < 0.7 ? '#33ff88' : lr() < 0.5 ? '#3aa0ff' : '#ffb03a');
  }
  F.scr(cx, 1.4, 19.9, 5, 1.6, 0.05, '#3aa0ff');
  F.stands.push({ x: 13, z: 15, rot: 0, id: 'f6-ops' });
}
function canteen(F: Furn) {
  F.label({ t: 'CANTEEN', x: 14, y: 2.9, z: -23.7, w: 5, h: 0.9, rot: 0, fg: '#fff', bg: '#e07a3a' });
  F.counter(14, -22.5, 20, 1.2, '#f1ede4', '#e0a64b');
  for (let i = 0; i < 6; i++) F.b(5 + i * 3.4, 1.05, -22.5, 0.7, 0.18, 0.7, '#c9a46a');
  F.stands.push({ x: 8, z: -24.2, rot: 0, id: 'f7-chef1' }, { x: 17, z: -24.2, rot: 0, id: 'f7-chef2' });
  for (const x of [6, 15, 24]) for (let r = 0; r < 4; r++) {
    const z = -17 + r * 3.8;
    F.table(x, z, 6, 1.0, '#e0c79a');
    F.b(x, 0.4, z - 0.85, 5.8, 0.06, 0.35, '#2e8f8a'); F.b(x, 0.4, z + 0.85, 5.8, 0.06, 0.35, '#2e8f8a');
    if (r % 2 === 0) F.sitSeats.push({ x: x - 1.5, z: z - 0.85, rot: 0 }, { x: x + 1.5, z: z + 0.85, rot: Math.PI });
  }
  // sky garden (indoor/terrace)
  const r = mulberry32(99);
  F.b(8, 0, 17, 30, 0.12, 14, '#59a85c');
  F.label({ t: 'SKY GARDEN', x: 8, y: 0.2, z: 10.4, w: 6, h: 1, rot: 0, flat: true, fg: '#ffffff', bg: 'rgba(0,0,0,0)' });
  for (let i = 0; i < 14; i++) F.tree(-6 + r() * 28, 11 + r() * 12, 2.5 + r() * 1.5, 0.9 + r() * 0.6, r() < 0.5 ? '#2f8a4a' : '#59b36a');
  for (let i = 0; i < 4; i++) F.b(-2 + i * 7, 0.12, 20, 2.2, 0.4, 0.6, '#c49a6c');
  F.walkers.push({ a: [0, 9], b: [24, 9], speed: 1.0, id: 'f7-walk1' });
}
function basement(F: Furn) {
  F.solid = true;
  const r = mulberry32(4242);
  const paints = ['#e8e8e8', '#2b3a4a', '#a33', '#5a6b78', '#d6c26a', '#1f6f6a', '#111'];
  for (const rowZ of [-23, -14, 14, 23]) {
    const maxX = rowZ > 0 ? 16 : 24;
    for (let x = -24; x <= maxX; x += 2.6) {
      F.b(x - 1.3, 0, rowZ, 0.08, 0.01, 5, '#f2f2f2');
      if (r() < 0.62) {
        const col = paints[Math.floor(r() * paints.length)];
        F.b(x, 0.18, rowZ, 1.8, 0.55, 4.2, col); F.b(x, 0.7, rowZ + (rowZ > 0 ? 0.2 : -0.2), 1.5, 0.5, 2.2, '#222a30');
      }
    }
  }
  for (let x = -24; x <= 24; x += 8) for (let z = -24; z <= 24; z += 8) {
    if (Math.abs(x + 2.5) < 5 && Math.abs(z) < 5) continue;
    F.b(x, 0, z, 0.7, CLEAR, 0.7, '#b9bec2');
  }
  // MEP
  F.b(-23, 0, 0, 3, 2.4, 6, '#9aa6ad'); F.b(-23, 2.4, 0, 2.6, 0.5, 5.6, '#7d8b93');
  F.b(8, 0, 0, 4, 2.2, 3, '#e0a64b'); F.label({ t: 'GENERATOR', x: 8, y: 1.2, z: 1.55, w: 2.4, h: 0.5, rot: 0, fg: '#222', bg: '#fff' });
  F.b(14, 0, 0, 1.2, 2.0, 3, '#33a1a8'); F.b(17, 0, 0, 1.2, 2.0, 3, '#33a1a8');
  F.b(0, 2.9, -8.5, 52, 0.18, 0.18, '#3aa0ff'); F.b(0, 2.6, -8.1, 52, 0.18, 0.18, '#e04a3a'); F.b(0, 2.9, 8.5, 52, 0.18, 0.18, '#e8c24a');
  F.b(23.5, 0, 20.5, 5, 0.06, 10, '#6b7880', 0, -0.0); // ramp apron
  F.b(23.5, 0.5, 24, 5, 0.12, 6, '#6b7880', 0, 0.2);
  F.label({ t: 'B1 • HẦM ĐỖ XE', x: 0, y: 0.04, z: 0, w: 9, h: 1.2, rot: 0, flat: true, fg: '#ffffff', bg: 'rgba(0,0,0,0)' });
  F.scr(-2.5, 2.8, 3.7, 1.2, 0.3, 0.05, '#ff5a3a');
}

export function roof(F: Furn) {
  const H = HALF, rnd = mulberry32(777);
  F.b(0, 0, -H, 52.4, 0.9, 0.25, '#f1f4f2'); F.b(0, 0, H, 52.4, 0.9, 0.25, '#f1f4f2');
  F.b(-H, 0, 0, 0.25, 0.9, 52.4, '#f1f4f2'); F.b(H, 0, 0, 0.25, 0.9, 52.4, '#f1f4f2');
  for (const c of COURTYARDS) {
    const x0 = c.x - c.w / 2, x1 = c.x + c.w / 2, z0 = c.z - c.d / 2, z1 = c.z + c.d / 2;
    F.b(c.x, 0, z0, c.w, 0.9, 0.2, '#f1f4f2'); F.b(c.x, 0, z1, c.w, 0.9, 0.2, '#f1f4f2');
    F.b(x0, 0, c.z, 0.2, 0.9, c.d, '#f1f4f2'); F.b(x1, 0, c.z, 0.2, 0.9, c.d, '#f1f4f2');
  }
  // solar panels
  for (let row = 0; row < 5; row++) for (let i = 0; i < 11; i++) {
    const x = -6 + i * 2.6, z = -23 + row * 3.4;
    F.b(x, 0.35, z, 2.2, 0.06, 1.3, '#1d3b66', 0, -0.45);
    F.b(x, 0, z + 0.25, 0.08, 0.5, 0.08, '#8a949b');
    F.b(x, 0, z - 0.25, 0.08, 0.2, 0.08, '#8a949b');
  }
  // plant room over core + AHU
  F.b(-2.5, 0, 0, 6, 2.2, 8, '#d8dedc'); F.b(-2.5, 2.2, 0, 6.4, 0.2, 8.4, '#2e8f8a');
  F.b(10, 0, -4, 3, 1.4, 2, '#9aa6ad'); F.b(15, 0, -4, 3, 1.4, 2, '#9aa6ad'); F.b(20, 0, -4, 3, 1.4, 2, '#9aa6ad');
  // sky garden on roof
  F.b(11, 0, 16, 28, 0.15, 14, '#5eb862');
  F.b(11, 0.15, 16, 3, 0.03, 13, '#d8d2c4');
  for (let i = 0; i < 16; i++) F.tree(-2 + rnd() * 26, 10 + rnd() * 12, 2.6 + rnd() * 2, 1 + rnd() * 0.7, rnd() < 0.5 ? '#2f8a4a' : '#5cbf6b');
  for (let i = 0; i < 5; i++) F.b(-1 + i * 6, 0.15, 21.5, 2.2, 0.4, 0.6, '#c49a6c');
  F.label({ t: 'F-TOWN 3', x: 0, y: 1.8, z: H - 0.3, w: 14, h: 2.6, rot: 0, fg: '#ffffff', bg: '#0f7a73' });
  F.label({ t: 'FRT • SKY GARDEN & SOLAR', x: 11, y: 0.25, z: 16, w: 10, h: 1, rot: 0, flat: true, fg: '#ffffff', bg: 'rgba(0,0,0,0)' });
}

const cache = new Map<number, Furn>();
export function getFloor(f: number): Furn {
  const hit = cache.get(f); if (hit) return hit;
  const F = new Furn();
  if (f === 7) { roof(F); cache.set(f, F); return F; }
  if (f === -1) basement(F);
  if (f === 0) garden(F);
  shell(F, f);
  core(F);
  if (f === 0) lobby(F);
  else if (f === 1) training(F);
  else if (f === TEAM_FLOOR) teamFloor(F);
  else if (f === 3 || f === 4) openPlan(F, f);
  else if (f === 5) rnd(F);
  else if (f === 6) canteen(F);
  cache.set(f, F);
  return F;
}
