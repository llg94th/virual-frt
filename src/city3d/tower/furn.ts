/**
 * Procedural data builders for F-Town 3 floors. Pure data (no React): lists of boxes / balls / labels
 * that index.tsx renders with instancing. Floor-local coordinates: y=0 is the slab bottom, FT is the walking surface.
 */
import { FLOOR_H, TOWER_FLOORS, TOWER_FOOTPRINT, FLOOR_DEPARTMENTS, mulberry32 } from '../shared';
import { NHA_THUOC_SEAT_SLOTS } from '../../data/officeLayout';
import { EMPLOYEE_BY_ID } from '../../data/employees';
import { teamSignId, type Decal } from './brand';

export const FT = 0.3; // slab thickness
export const CLEAR = FLOOR_H - FT; // clear height 3.3
export const HX = TOWER_FOOTPRINT.w / 2;
export const HZ = TOWER_FOOTPRINT.d / 2;
export const HALF = Math.max(HX, HZ);
/** Layout items were authored for a 52 m plate; the layout group is squashed horizontally by K (axis-aligned only, so no shear). */
/** computerScreen GLB display face (model units, bottom-centre origin): centre height, width, height, and depth in front of the model centre */
const SCR_Y = 0.2, SCR_W = 0.3, SCR_H = 0.19, SCR_Z = 0.052;
export const K = Math.min(TOWER_FOOTPRINT.w, TOWER_FOOTPRINT.d) / 52;
export type V3 = [number, number, number];
export interface Prop { m: string; p: V3; r: number; s: V3; c?: string; t?: string }
export interface Box { p: V3; s: V3; c: string; r: number; rx: number }
export interface Ball { p: V3; r: number; c: string }
export interface Label { art?: 'compass'; t: string; x: number; y: number; z: number; w: number; h: number; rot: number; flat?: boolean; fg?: string; bg?: string }
export interface Seat { x: number; z: number; rot: number; id?: string }
export interface Walker { a: [number, number]; b: [number, number]; speed: number; id: string }
export interface Stand { x: number; z: number; rot: number; id: string; pose?: 'idle' | 'wave' }

/** Courtyard atria (open voids through every floor), proportional to the footprint */
const STRIP = 0.057 * TOWER_FOOTPRINT.w;
const CW = 0.273 * TOWER_FOOTPRINT.w, CD = 0.273 * TOWER_FOOTPRINT.d;
const CXC = -HX + STRIP + CW / 2;
export const COURTYARDS = [
  { x: CXC, z: -0.25 * TOWER_FOOTPRINT.d, w: CW, d: CD },
  { x: CXC, z: 0.25 * TOWER_FOOTPRINT.d, w: CW, d: CD },
];
/** Slab = footprint minus courtyards: [cx, cz, w, d] */
export const SLAB_PIECES: [number, number, number, number][] = (() => {
  const [c1, c2] = COURTYARDS, xe = CXC + CW / 2;
  const z = [-HZ, c1.z - c1.d / 2, c1.z + c1.d / 2, c2.z - c2.d / 2, c2.z + c2.d / 2, HZ];
  return [
    [(xe + HX) / 2, 0, HX - xe, 2 * HZ], [-HX + STRIP / 2, 0, STRIP, 2 * HZ],
    [CXC, (z[0] + z[1]) / 2, CW, z[1] - z[0]], [CXC, (z[2] + z[3]) / 2, CW, z[3] - z[2]], [CXC, (z[4] + z[5]) / 2, CW, z[5] - z[4]],
  ];
})();
/** Elevator/structural core */
export const CORE = { x: -2.5, z: 0, w: 5, d: 7 };

export class Furn {
  boxes: Box[] = [];
  glass: Box[] = [];
  screens: Box[] = [];
  leds: Box[] = [];
  disp: Box[] = [];
  balls: Ball[] = [];
  labels: Label[] = [];
  /** brand-atlas decals (logo wall, signs, posters, screensavers): rendered as ONE merged mesh. y = height above the walking surface */
  decals: Decal[] = [];
  plates: { x: number; y: number; z: number; rot: number; text: string }[] = [];
  seats: Seat[] = []; // generic 'type' desks available to NPC workers
  sitSeats: Seat[] = []; // bench / lounge seats ('sit')
  stands: Stand[] = [];
  /** points of interest agents walk to (world coords on S, layout coords on lay) */
  poi: { x: number; z: number; rot: number; pose: 'idle' | 'sit' }[] = [];
  walkers: Walker[] = [];
  /** Real team seats on TEAM_FLOOR */
  team: { emp: string; x: number; z: number; rot: number }[] = [];
  /** Occupied-by-someone-else seats (other staff in the bay) */
  extraTeam: Seat[] = [];
  /** every occupied NHÀ THUỐC seat (world coords of the chair) with its layout identity, for real-employee mapping */
  slots: { id: string; seatCode: string; account: string; deskId?: string; assigned?: string; x: number; z: number; rot: number }[] = [];
  npcSeated = 0;
  npcSit = 0;
  solid = false;

  /** GLB props (Kenney furniture) replacing the procedural `alt*` pieces once loaded */
  props: Prop[] = [];
  altBoxes: Box[] = [];
  altScreens: Box[] = [];
  altBalls: Ball[] = [];
  private altMode = false;
  /** run procedural builders so their output lands in the fallback lists */
  alt(fn: () => void) { const prev = this.altMode; this.altMode = true; try { fn(); } finally { this.altMode = prev; } }
  /** y = bottom above the walking surface; s = uniform scale or [sx,sy,sz] on top of the normalised model (bottom-centre origin, front +z) */
  prop(m: string, x: number, y: number, z: number, rot: number, s: number | V3, c?: string, t?: string) {
    this.props.push({ m, p: [x, FT + y, z], r: rot, s: typeof s === 'number' ? [s, s, s] : s, c, t });
  }

  private mk(list: Box[], x: number, y: number, z: number, w: number, h: number, d: number, c: string, r = 0, rx = 0) {
    if (this.altMode) { if (list === this.boxes) list = this.altBoxes; else if (list === this.screens) list = this.altScreens; }
    list.push({ p: [x, FT + y + h / 2, z], s: [w, h, d], c, r, rx });
  }
  /** y = bottom above the walking surface */
  b(x: number, y: number, z: number, w: number, h: number, d: number, c: string, r = 0, rx = 0) { this.mk(this.boxes, x, y, z, w, h, d, c, r, rx); }
  g(x: number, y: number, z: number, w: number, h: number, d: number, c = '#bfe8ea', r = 0) { this.mk(this.glass, x, y, z, w, h, d, c, r); }
  scr(x: number, y: number, z: number, w: number, h: number, d: number, c = '#4fd1ff', r = 0) { this.mk(this.screens, x, y, z, w, h, d, c, r); }
  led(x: number, y: number, z: number, c: string) { this.mk(this.leds, x, y, z, 0.05, 0.05, 0.02, c); }
  ball(x: number, y: number, z: number, r: number, c: string) { (this.altMode ? this.altBalls : this.balls).push({ p: [x, FT + y, z], r, c }); }
  label(l: Label) { this.labels.push(l); }
  /** brand decal. Vertical: faces (sin rot, cos rot), upright. flat: lies on the surface, top edge points to (-sin rot, -cos rot). */
  decal(id: string, x: number, y: number, z: number, w: number, h: number, rot = 0, flat = false) { this.decals.push({ id, x, y, z, w, h, rot, flat }); }
  /** tiled manifestation stripe (4:1 cells), vertical, centred on (x,y,z) running along the wall direction of `rot` */
  stripe(x: number, y: number, z: number, len: number, h: number, rot: number) {
    const n = Math.max(1, Math.round(len / (h * 4))), w = len / n, dx = Math.cos(rot), dz = -Math.sin(rot);
    for (let i = 0; i < n; i++) { const o = -len / 2 + (i + 0.5) * w; this.decal('manif', x + dx * o, y, z + dz * o, w, h, rot); }
  }

  /** local (lx,lz) in a frame rotated by th at (cx,cz) */
  lp(cx: number, cz: number, th: number, lx: number, lz: number): [number, number] {
    return [cx + lx * Math.cos(th) + lz * Math.sin(th), cz - lx * Math.sin(th) + lz * Math.cos(th)];
  }
  /** a rotated box in a local frame */
  rb(cx: number, cz: number, th: number, lx: number, lz: number, y: number, w: number, h: number, d: number, c: string) {
    const [x, z] = this.lp(cx, cz, th, lx, lz); this.b(x, y, z, w, h, d, c, th);
  }

  tree(x: number, z: number, h = 4, r = 1.6, c = '#3f9a5a') {
    this.alt(() => {
      this.b(x, 0, z, 0.22, h * 0.6, 0.22, '#6b4a2f');
      this.ball(x, h * 0.6 + r * 0.5, z, r, c);
      this.ball(x + r * 0.45, h * 0.6 + r * 0.2, z + r * 0.2, r * 0.7, '#4fae6a');
    });
    const k = Math.abs(Math.sin(x * 4.7 + z * 9.1) * 1000) % 1; // leaf-card tree (textured), nominal ~6.2 m tall / 2.2 m crown radius
    this.prop(`v:tree_${Math.floor(k * 3) % 3}`, x, 0, z, k * 6.28, [r / 2.2, (h * 0.6 + r * 1.2) / 6.2, r / 2.2]);
  }
  plant(x: number, z: number, s = 1) {
    this.alt(() => { this.b(x, 0, z, 0.4 * s, 0.4 * s, 0.4 * s, '#e8e4dc'); this.ball(x, 0.4 * s + 0.35 * s, z, 0.4 * s, '#3e9b55'); });
    const k = Math.abs(Math.sin(x * 12.9898 + z * 78.233) * 43758.5453) % 1; // Poly Haven scanned plants (~1.1 m at s=1)
    this.prop(k < 0.3 ? 'v:ficus' : k < 0.55 ? 'v:pachira' : k < 0.8 ? 'v:alocasia' : 'v:calathea', x, 0, z, (x * 7.3 + z) % 6.28, 0.95 * s);
  }
  /** local-frame box: centre at (lx,lz) of a frame rotated by th at (cx,cz), extra yaw dth, pitch rx */
  lb(cx: number, cz: number, th: number, lx: number, lz: number, y: number, w: number, h: number, d: number, c: string, dth = 0, rx = 0) {
    const [x, z] = this.lp(cx, cz, th, lx, lz); this.b(x, y, z, w, h, d, c, th + dth, rx);
  }
  /** flat-panel display (textured desktop wallpaper, tinted by `c`) */
  display(x: number, y: number, z: number, w: number, h: number, c: string, r = 0, rx = 0) { this.mk(this.disp, x, y, z, w, h, 0.004, c, r, rx); }
  /** thin-bezel monitor on a stand; (lx,lz) local to the desk frame (cx,cz,th), screen faces -lz (the user). */
  monitor(cx: number, cz: number, th: number, lx: number, lz: number, dth: number, on: boolean, tint: string, k = 1) {
    const yaw = th + dth, [mx, mz] = this.lp(cx, cz, th, lx, lz), P = (a: number, b: number) => this.lp(mx, mz, yaw, a, b);
    let [px, pz] = P(0, 0); this.b(px, 0.75, pz, 0.24, 0.012, 0.17, '#17191c', yaw);
    [px, pz] = P(0, 0.05); this.b(px, 0.76, pz, 0.05, 0.17 * k, 0.025, '#1d1f22', yaw);
    [px, pz] = P(0, 0.04); this.b(px, 0.9, pz, 0.56 * k, 0.33 * k, 0.03, '#0f1113', yaw);
    [px, pz] = P(0, 0.021); this.display(px, 0.905, pz, 0.545 * k, 0.318 * k, on ? tint : '#0b0e10', yaw);
  }
  chair(x: number, z: number, th: number, c = '#2a2e33') {
    const L = (lx: number, lz: number, y: number, w: number, h: number, d: number, col: string, dth = 0, rx = 0) => this.lb(x, z, th, lx, lz, y, w, h, d, col, dth, rx);
    const dk = '#17191c';
    for (let i = 0; i < 5; i++) { // five-star base + castors
      const a = (i * Math.PI * 2) / 5 + 0.3, s = Math.sin(a), co = Math.cos(a);
      L(0.12 * s, 0.12 * co, 0.05, 0.04, 0.025, 0.26, dk, a); L(0.25 * s, 0.25 * co, 0, 0.05, 0.05, 0.05, '#0c0d0e', a);
    }
    L(0, 0, 0.075, 0.05, 0.33, 0.05, '#34373a'); L(0, 0, 0.4, 0.15, 0.04, 0.15, dk); // gas lift + mechanism
    L(0, 0.02, 0.44, 0.5, 0.07, 0.48, c); // seat
    L(0, -0.2, 0.47, 0.06, 0.17, 0.04, dk); // spine
    L(0, -0.25, 0.58, 0.46, 0.48, 0.04, dk, 0, -0.1); L(0, -0.255, 0.61, 0.37, 0.4, 0.046, '#363c42', 0, -0.1); // frame + mesh back
    L(0, -0.285, 1.06, 0.04, 0.1, 0.03, dk, 0, -0.1); L(0, -0.3, 1.13, 0.26, 0.12, 0.05, dk, 0, -0.1); // headrest
    for (const s of [-1, 1]) { L(s * 0.27, -0.02, 0.5, 0.03, 0.18, 0.03, dk); L(s * 0.27, -0.02, 0.67, 0.065, 0.025, 0.27, '#0e0f10'); } // armrests
  }
  /** Desk with dual monitors, peripherals and an ergonomic chair. Occupant sits at the chair looking along dir=(sin th,cos th). */
  workstation(x: number, z: number, th: number, o: { dw?: number; dd?: number; on?: boolean; top?: string; chair?: string; rich?: boolean; plate?: string; tint?: string; brand?: boolean } = {}): Seat {
    const dw = o.dw ?? 1.4, dd = o.dd ?? 0.7;
    const h = Math.abs(Math.sin(x * 12.9898 + z * 78.233) * 43758.5453) % 1; // stable per-desk variety
    const on = o.on !== false;
    const face = th + Math.PI;
    const L = (lx: number, lz: number, y: number, w: number, hh: number, d: number, c: string, dth = 0, rx = 0) => this.lb(x, z, th, lx, lz, y, w, hh, d, c, dth, rx);
    // white laminate top, panel legs, modesty panel, drawer pedestal, under-desk cable tray
    L(0, 0, 0.72, dw, 0.03, dd, o.top ?? '#e6e8e8');
    L(0, dd / 2 - 0.01, 0.74, dw, 0.012, 0.02, '#3a3e42'); // back edge strip
    for (const sx of [-1, 1]) L(sx * (dw / 2 - 0.03), 0, 0, 0.035, 0.72, dd - 0.12, '#d3d6d8');
    L(0, dd / 2 - 0.08, 0.34, dw - 0.1, 0.36, 0.02, '#dfe2e3');
    L(0, dd / 2 - 0.15, 0.6, 0.7, 0.025, 0.1, '#25282b');
    L(dw / 2 - 0.3, dd / 2 - 0.1, 0.752, 0.05, 0.006, 0.05, '#1b1d1f'); // cable grommet
    if (h < 0.6) {
      L(-dw / 2 + 0.28, 0.0, 0, 0.4, 0.7, 0.5, '#e2e5e6');
      for (const y of [0.18, 0.4, 0.58]) { L(-dw / 2 + 0.28, -0.255, y, 0.36, 0.004, 0.006, '#8e959a'); L(-dw / 2 + 0.28, -0.258, y - 0.07, 0.14, 0.012, 0.012, '#2b2e31'); }
    }
    const dual = !!o.rich && h >= 0.35, tintA = on ? '#cfe4ff' : '#0b0e10';
    if (dual) { for (const sx of [-1, 1]) this.monitor(x, z, th, sx * 0.29, 0.2, sx * 0.2, on, sx < 0 ? '#d6e6ff' : '#bfd7f5'); }
    else this.monitor(x, z, th, 0, 0.2, 0, on, tintA, 1.1);
    L(0, -0.15, 0.75, 0.43, 0.015, 0.14, '#24272b'); L(0, -0.145, 0.765, 0.4, 0.005, 0.115, '#3b4046'); // keyboard
    L(0.34, -0.14, 0.75, 0.22, 0.004, 0.18, '#202326'); L(0.34, -0.14, 0.754, 0.06, 0.028, 0.1, '#2e3236'); // mouse pad + mouse
    if (o.rich) {
      if (h > 0.5 && h < 0.8) { // laptop
        L(-dw / 2 + 0.55, -0.04, 0.75, 0.32, 0.015, 0.22, '#b4bac0', 0.25);
        const [lx, lz] = this.lp(x, z, th, -dw / 2 + 0.55, 0.07);
        this.b(lx, 0.765, lz, 0.32, 0.2, 0.01, '#aab0b6', th + 0.25, 0.3);
        const [dx, dz] = this.lp(lx, lz, th + 0.25, 0, -0.009); this.display(dx, 0.77, dz, 0.29, 0.17, on ? '#cfe4ff' : '#0b0e10', th + 0.25, 0.3);
      }
      const mc = ['#e0a64b', '#f0f0f0', '#2e8f8a', '#c0392b', '#2c5aa0'][Math.floor(h * 5) % 5];
      L(dw / 2 - 0.14, 0.2, 0.75, 0.075, 0.09, 0.075, mc); L(dw / 2 - 0.09, 0.2, 0.78, 0.015, 0.05, 0.02, mc); // mug
      L(dw / 2 - 0.2, -0.28, 0.75, 0.07, 0.008, 0.145, '#1a1b1d', 0.35); // phone
      if (h > 0.25 && h < 0.45) { for (const s of [-1, 1]) L(0.5 + s * 0.06, -0.3, 0.75, 0.05, 0.045, 0.05, '#202326'); L(0.5, -0.3, 0.795, 0.17, 0.012, 0.03, '#202326'); } // headset
      if (h > 0.8) { // desk lamp
        L(-dw / 2 + 0.12, 0.25, 0.75, 0.13, 0.015, 0.13, '#25282b'); L(-dw / 2 + 0.12, 0.25, 0.765, 0.02, 0.3, 0.02, '#25282b'); L(-dw / 2 + 0.12, 0.2, 1.05, 0.05, 0.025, 0.22, '#e6e8e8');
      } else if (h < 0.18) { // small plant
        L(-dw / 2 + 0.14, 0.2, 0.75, 0.1, 0.1, 0.1, '#e8e8e4');
        const [px, pz] = this.lp(x, z, th, -dw / 2 + 0.14, 0.2); this.ball(px, 0.93, pz, 0.1, '#3e9b55'); this.prop('v:haworthia', px, 0.75, pz, h * 40, 0.6);
      }
      if (o.brand && on) { // lanyard badge + strap on the desk, in front of the keyboard
        const [bx, bz] = this.lp(x, z, th, 0.02, -0.31); this.decal('badge', bx, 0.762, bz, 0.07, 0.105, face, true);
        const [lx2, lz2] = this.lp(x, z, th, 0.02, -0.385); this.decal('lanyard', lx2, 0.761, lz2, 0.12, 0.025, face, true);
      }
      if (o.plate) { const [px, pz] = this.lp(x, z, th, 0, -dd / 2 + 0.06); this.plates.push({ x: px, y: FT + 0.8, z: pz, rot: th + Math.PI, text: o.plate }); this.b(px, 0.75, pz, 0.3, 0.02, 0.05, '#555'); }
    }
    const cd = dd / 2 + 0.25;
    const [cx, cz] = this.lp(x, z, th, 0, -cd);
    this.chair(cx, cz, th, o.chair);
    return { x: cx, z: cz, rot: th };
  }
  table(x: number, z: number, w: number, d: number, c = '#d9c7a8', h = 0.74) {
    this.b(x, h - 0.04, z, w, 0.04, d, c);
    const lg = w > 2.2 ? [-1, 1].map((sx) => [sx * (w / 2 - 0.15)] as number[]) : null;
    if (lg) for (const [ox] of lg) this.b(x + ox, 0, z, 0.05, h - 0.04, d * 0.7, '#2d3135');
    else for (const sx of [-1, 1]) for (const sz of [-1, 1]) this.b(x + sx * (w / 2 - 0.08), 0, z + sz * (d / 2 - 0.08), 0.045, h - 0.04, 0.045, '#2d3135');
  }
  sofa(x: number, z: number, th: number, len = 2.2, c = '#2e8f8a') {
    this.alt(() => {
      this.rb(x, z, th, 0, 0, 0, len, 0.42, 0.85, c);
      this.rb(x, z, th, 0, -0.38, 0.42, len, 0.45, 0.14, c);
      this.rb(x, z, th, -len / 2 + 0.07, 0, 0.42, 0.14, 0.25, 0.8, c);
      this.rb(x, z, th, len / 2 - 0.07, 0, 0.42, 0.14, 0.25, 0.8, c);
    });
    this.prop('loungeSofa', x, 0, z, th, [len / 0.98, 2, 2]);
  }
  /** kitchen cabinet run; `face` = yaw of the cabinet fronts (default: front +z for x-long runs, -x for z-long runs) */
  counter(x: number, z: number, w: number, d: number, c = '#f1ede4', top = '#3a4a50', face?: number) {
    this.alt(() => { this.b(x, 0, z, w, 1.0, d, c); this.b(x, 1.0, z, w + 0.06, 0.05, d + 0.06, top); });
    const alongX = w >= d, L = alongX ? w : d, n = Math.max(1, Math.round(L / 0.9)), yaw = face ?? (alongX ? 0 : -Math.PI / 2);
    for (let i = 0; i < n; i++) {
      const o = -L / 2 + ((i + 0.5) * L) / n;
      this.prop('kitchenCabinet', alongX ? x + o : x, 0, alongX ? z : z + o, yaw, [(L / n) / 0.43, 2.2, (alongX ? d : w) / 0.45]);
    }
  }
  fridge(x: number, z: number, th = 0) {
    this.alt(() => this.rb(x, z, th, 0, 0, 0, 0.8, 1.9, 0.75, '#d7dcde'));
    this.prop('kitchenFridge', x, 0, z, th, 2.1);
  }
  bookcase(x: number, z: number, th: number) {
    this.alt(() => this.rb(x, z, th, 0, 0, 0, 0.8, 1.7, 0.45, '#cdb48a'));
    this.prop('bookcaseClosed', x, 0, z, th, 2);
  }
  stool(x: number, z: number) {
    this.alt(() => { this.b(x, 0, z, 0.06, 0.55, 0.06, '#555'); this.b(x, 0.55, z, 0.34, 0.05, 0.34, '#e07a3a'); });
    this.prop('stoolBar', x, 0, z, 0, [1.4, 1.35, 1.4]);
  }
  /** Glass-walled room (door gap on south side) */
  room(cx: number, cz: number, w: number, d: number, tableTone = '#d9c7a8') {
    this.g(cx, 0, cz - d / 2, w, CLEAR - 0.4, 0.05);
    this.g(cx - w / 2, 0, cz, 0.05, CLEAR - 0.4, d);
    this.g(cx + w / 2, 0, cz, 0.05, CLEAR - 0.4, d);
    const seg = (w - 1.4) / 2;
    this.g(cx - w / 2 + seg / 2, 0, cz + d / 2, seg, CLEAR - 0.4, 0.05);
    this.g(cx + w / 2 - seg / 2, 0, cz + d / 2, seg, CLEAR - 0.4, 0.05);
    this.b(cx, 0, cz, w - 0.4, 0.015, d - 0.4, '#6c7176'); // room carpet
    const al = '#2a2d30', hh = CLEAR - 0.4;
    this.b(cx, 0, cz - d / 2, w, 0.08, 0.07, al); this.b(cx, hh - 0.05, cz - d / 2, w, 0.05, 0.07, al); this.b(cx, 0.85, cz - d / 2, w, 0.5, 0.052, '#eef1f1');
    { const sg = (w - 1.4) / 2; for (const ox of [-(1.4 + sg) / 2, (1.4 + sg) / 2]) { this.b(cx + ox, 0, cz + d / 2, sg, 0.08, 0.07, al); this.b(cx + ox, hh - 0.05, cz + d / 2, sg, 0.05, 0.07, al); this.b(cx + ox, 0.85, cz + d / 2, sg, 0.5, 0.052, '#eef1f1'); } }
    for (const xx of [cx - w / 2, cx + w / 2]) { this.b(xx, 0, cz, 0.07, 0.08, d, al); this.b(xx, hh - 0.05, cz, 0.07, 0.05, d, al); this.b(xx, 0.85, cz, 0.052, 0.5, d, '#eef1f1'); }
    for (const xx of [cx - w / 2, cx - 0.7, cx + 0.7, cx + w / 2]) this.b(xx, 0, cz + d / 2, 0.06, hh, 0.07, al);
    for (const zz of [cz - d / 2, cz + d / 2]) for (const xx of [cx - w / 2, cx + w / 2]) this.b(xx, 0, zz, 0.07, hh, 0.07, al);
    for (let i = 1; i < Math.round(w / 1.5); i++) this.b(cx - w / 2 + (i * w) / Math.round(w / 1.5), 0, cz - d / 2, 0.04, hh, 0.06, al);
    this.b(cx, hh, cz + d / 2, 1.4, 0.06, 0.07, al); // door header
    this.b(cx - 0.7 + 0.03, 0, cz + d / 2 - 0.5, 0.04, 2.0, 0.9, '#b6d4d8'); // door leaf (open 90 deg)
    this.b(cx - 0.7 + 0.03, 0.9, cz + d / 2 - 0.92, 0.03, 0.3, 0.03, '#c9ced1'); // handle
    this.b(cx - 0.7 + 0.03, 1.95, cz + d / 2 - 0.5, 0.05, 0.05, 0.9, al);
    this.b(cx + 0.78, 1.25, cz + d / 2 + 0.05, 0.1, 0.14, 0.03, '#1c1f22'); // door reader
    this.led(cx + 0.78, 1.28, cz + d / 2 + 0.07, '#33ff88');
    this.table(cx, cz, w * 0.55, d * 0.3, tableTone);
    const n = Math.max(2, Math.round((w * 0.55) / 0.9));
    for (let i = 0; i < n; i++) {
      const px = cx - (w * 0.55) / 2 + ((i + 0.5) * (w * 0.55)) / n;
      this.chair(px, cz - d * 0.15 - 0.45, 0); this.chair(px, cz + d * 0.15 + 0.45, Math.PI);
      this.sitSeats.push({ x: px, z: cz - d * 0.15 - 0.45, rot: 0 }, { x: px, z: cz + d * 0.15 + 0.45, rot: Math.PI });
    }
    this.b(cx, 0.95, cz - d / 2 + 0.2, 2.3, 1.3, 0.05, '#101214'); this.display(cx, 1.0, cz - d / 2 + 0.223, 2.2, 1.2, '#cfe4ff'); // wall display
  }
  /** Islands of 4 workstations (2 rows face to face) */
  island(cx: number, cz: number, top?: string) {
    for (const sx of [-1, 1]) {
      this.seats.push(this.workstation(cx + sx * 0.72, cz - 0.42, 0, { top }));
      this.seats.push(this.workstation(cx + sx * 0.72, cz + 0.42, Math.PI, { top }));
    }
    this.g(cx, 0.75, cz, 2.9, 0.4, 0.03);
  }
  /** slim grey columns + thin dark railings along a straight slab edge (facade is open / recessed, not curtain wall) */
  frame(x0: number, z0: number, x1: number, z1: number, step = 4.4) {
    const L = Math.hypot(x1 - x0, z1 - z0);
    if (L < 0.5) return;
    const alongX = Math.abs(z1 - z0) < 1e-6;
    const n = Math.max(1, Math.round(L / step));
    for (let i = 0; i <= n; i++) this.b(x0 + ((x1 - x0) * i) / n, 0, z0 + ((z1 - z0) * i) / n, 0.32, CLEAR - 0.9, 0.32, '#eef1ef');
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    for (const y of [1.0, 0.5]) this.b(cx, y, cz, alongX ? L : 0.04, 0.04, alongX ? 0.04 : L, '#2b3338');
    const posts = Math.round(L / 1.6);
    for (let i = 0; i <= posts; i++) this.b(x0 + ((x1 - x0) * i) / posts, 0, z0 + ((z1 - z0) * i) / posts, 0.04, 1.0, 0.04, '#2b3338');
  }
  /** attached frond: pivot at (x,y,z) (y absolute above walking surface), yaw r, pitch-down a, length L */
  frond(x: number, y: number, z: number, r: number, a: number, L: number, w: number, c: string) {
    const ca = Math.cos(a);
    this.boxes.push({ p: [x + Math.sin(r) * ca * (L / 2), FT + y - Math.sin(a) * (L / 2), z + Math.cos(r) * ca * (L / 2)], s: [w, 0.04, L], c, r, rx: a });
  }
  palm(x: number, z: number, h = 6) {
    this.alt(() => {
      this.b(x, 0, z, 0.26, h, 0.26, '#a28b6a');
      for (let i = 0; i < 8; i++) this.frond(x, h, z, (i * Math.PI * 2) / 8 + x, 0.25 + (i % 2) * 0.35, 2.6, 0.5, i % 2 ? '#3f9a4f' : '#2e8a45');
      this.ball(x, h + 0.1, z, 0.3, '#4a8a3a');
    });
    const k = Math.abs(Math.sin(x * 3.1 + z * 5.7) * 1000) % 1;
    this.prop(`v:palm_${Math.floor(k * 3) % 3}`, x, 0, z, k * 6.28, h / 8.5); // leaf-card palm, ~8.5 m tall at scale 1
  }
  banana(x: number, z: number) {
    this.alt(() => { for (let i = 0; i < 5; i++) this.frond(x, 0.25, z, i * 1.26 + x, -0.9 + (i % 2) * 0.3, 1.7, 0.65, i % 2 ? '#4fb05a' : '#3c9c4c'); });
    for (let i = 0; i < 2; i++) this.prop('v:alocasia', x + Math.cos(i * 2.1 + x) * 0.3, 0, z + Math.sin(i * 2.1 + x) * 0.3, i * 2.1 + z, 1.5 + (i % 2) * 0.4);
  }
  /** ground cover (bush / grass / flower) from the Nature Kit; procedural green ball as fallback */
  cover(x: number, y: number, z: number, k: number, s = 1) {
    this.alt(() => this.ball(x, y + 0.4, z, 0.45 + (k % 0.4), k < 0.2 ? '#e87aa0' : '#5ab86a'));
    const names = ['v:bush_0', 'v:bush_1', 'v:grass_0', 'v:bush_1', 'v:flower_0', 'v:flower_0', 'v:fern', 'v:grass_0'], sc = [0.9, 0.8, 1.6, 0.7, 1.5, 1.2, 1.1, 1.8];
    const i = Math.floor(k * names.length) % names.length;
    this.prop(names[i], x, y, z, k * 40, sc[i] * s);
  }
}

// ---------- shared parts ----------
const R_OUT = 5, R_CT = 3;
/** Concrete stair flights down the atrium sides: flight (k, f) links floor f (top, `b`) to floor f-1 (bottom, `a`). */
export const STAIR_W = 1.4;
export interface AtriumFlight { k: number; floorA: number; floorB: number; a: [number, number]; b: [number, number]; width: number; len: number; dir: number }
let _flights: AtriumFlight[] | null = null;
export function atriumFlights(): AtriumFlight[] {
  if (_flights) return _flights;
  const out: AtriumFlight[] = [];
  COURTYARDS.forEach((c, k) => {
    const dir = k === 0 ? 1 : -1, len = c.d + 0.2; // spans the whole void, 0.1 m onto each slab edge
    const xx = c.x + (k === 0 ? 1 : -1) * (c.w / 2 - R_CT - 1.0); // inside the straight part of the (rounded) atrium edge
    for (let f = 1; f <= TOWER_FLOORS - 1; f++)
      out.push({ k, floorA: f - 1, floorB: f, a: [xx, c.z + (dir * len) / 2], b: [xx, c.z - (dir * len) / 2], width: STAIR_W, len, dir });
  });
  return (_flights = out);
}
function shell(F: Furn, f: number) {
  const W = 2 * HX, D = 2 * HZ;
  if (F.solid) {
    F.b(0, 0, -HZ, W, CLEAR, 0.4, '#8d949a'); F.b(0, 0, HZ, W, CLEAR, 0.4, '#8d949a');
    F.b(-HX, 0, 0, 0.4, CLEAR, D, '#8d949a'); F.b(HX, 0, 0, 0.4, CLEAR, D, '#8d949a');
    return;
  }
  // railings + slim columns along the straight parts of the (rounded) slab edge
  const r = R_OUT, e = 0.15;
  F.frame(-HX + r, -HZ + e, HX - r, -HZ + e);
  if (f === 0) { F.frame(-HX + r, HZ - e, 3.4, HZ - e); F.frame(6.6, HZ - e, HX - r, HZ - e); } // keep the main entrance (x 3.4..6.6) open
  else F.frame(-HX + r, HZ - e, HX - r, HZ - e);
  F.frame(-HX + e, -HZ + r, -HX + e, HZ - r); F.frame(HX - e, -HZ + r, HX - e, HZ - r);
  const rc = R_CT;
  COURTYARDS.forEach((c, k) => {
    const x0 = c.x - c.w / 2 - e, x1 = c.x + c.w / 2 + e, z0 = c.z - c.d / 2 - e, z1 = c.z + c.d / 2 + e;
    // north/south railings are opened where a stair flight starts (high end of flight f, low end of flight f+1)
    const hasTop = f >= 1 && f <= TOWER_FLOORS - 1, hasBot = f >= 0 && f <= TOWER_FLOORS - 2;
    const xs = c.x + (k === 0 ? 1 : -1) * (c.w / 2 - R_CT - 1.0);
    const edgeZ = (zz: number, open: boolean) => {
      if (!open) F.frame(x0 + rc, zz, x1 - rc, zz, 4);
      else { F.frame(x0 + rc, zz, xs - 0.9, zz, 4); F.frame(xs + 0.9, zz, x1 - rc, zz, 4); }
    };
    edgeZ(z0, k === 0 ? hasTop : hasBot); edgeZ(z1, k === 0 ? hasBot : hasTop);
    F.frame(x0, z0 + rc, x0, z1 - rc, 4); F.frame(x1, z0 + rc, x1, z1 - rc, 4);
    // trailing greenery on the atrium railings
    const rnd = mulberry32(f * 31 + k * 7 + 5);
    for (let i = 0; i < 9; i++) {
      const side = Math.floor(rnd() * 4), u = (rnd() - 0.5) * (c.w - 2 * rc);
      const px = side < 2 ? c.x + u : side === 2 ? x0 : x1, pz = side < 2 ? (side === 0 ? z0 : z1) : c.z + u;
      F.cover(px, 0.95, pz, rnd(), 0.8);
    }
    // concrete stair flight cascading down the atrium side (connects this floor to the one below).
    // Geometry comes from atriumFlights() so the walkable ramp registered in `interior.stairs` matches this exactly.
    if (f >= 1 && f <= TOWER_FLOORS - 1) {
      const fl = atriumFlights().find((q) => q.k === k && q.floorB === f)!;
      const len = fl.len, a = Math.atan2(FLOOR_H, len), L = Math.hypot(len, FLOOR_H);
      const xx = fl.a[0], dir = fl.dir; // descends toward +z for k=0, toward -z for k=1
      const zmid = c.z;
      F.boxes.push({ p: [xx, FT - FLOOR_H / 2 - 0.12, zmid], s: [STAIR_W, 0.24, L], c: '#a8442b', r: 0, rx: dir * a });
      for (const o of [-STAIR_W / 2, STAIR_W / 2]) {
        F.boxes.push({ p: [xx + o, FT - FLOOR_H / 2 + 0.95, zmid], s: [0.06, 0.06, L], c: '#6e2c1a', r: 0, rx: dir * a });
        F.boxes.push({ p: [xx + o, FT - FLOOR_H / 2 + 0.55, zmid], s: [0.03, 0.03, L], c: '#6e2c1a', r: 0, rx: dir * a });
        F.boxes.push({ p: [xx + o, FT - FLOOR_H / 2 + 0.4, zmid], s: [0.04, 0.9, L], c: '#8a3b22', r: 0, rx: dir * a }); // solid red balustrade panel
      }
    }
    // ground-floor Y-shaped rust-red bridge through the garden (real F-Town 3 courtyard): stem lands on the foot of the stair flight
    if (f === 0) {
      const sgn = k === 0 ? 1 : -1, wv = 1.5;
      const hub: [number, number] = [c.x + (xs - c.x) * 0.2, c.z + sgn * 0.5];
      const legs: [number, number][] = [[xs, c.z + sgn * (c.d / 2 + 0.3)], [c.x - c.w / 2 - 0.3, c.z - sgn * 2.2], [c.x + c.w / 2 + 0.3, c.z - sgn * 4.5]];
      for (const [lx, lz] of legs) {
        const dx = lx - hub[0], dz = lz - hub[1], len = Math.hypot(dx, dz), yaw = Math.atan2(dx, dz), mx = hub[0] + dx / 2, mz = hub[1] + dz / 2, cs = Math.cos(yaw), sn = Math.sin(yaw);
        F.boxes.push({ p: [mx, FT + 0.05, mz], s: [wv, 0.18, len], c: '#a8442b', r: yaw, rx: 0 });
        for (const o of [-wv / 2, wv / 2]) {
          F.boxes.push({ p: [mx + cs * o, FT + 0.6, mz - sn * o], s: [0.06, 0.07, len], c: '#6e2c1a', r: yaw, rx: 0 });
          F.boxes.push({ p: [mx + cs * o, FT + 0.35, mz - sn * o], s: [0.04, 0.55, len], c: '#8a3b22', r: yaw, rx: 0 });
        }
        for (const t of [0.5, 0.85]) F.boxes.push({ p: [hub[0] + dx * t, FT - 0.45, hub[1] + dz * t], s: [0.25, 0.9, 0.25], c: '#8a3b22', r: 0, rx: 0 }); // piers into the garden
      }
      F.boxes.push({ p: [hub[0], FT + 0.05, hub[1]], s: [wv + 0.5, 0.18, wv + 0.5], c: '#a8442b', r: Math.PI / 4, rx: 0 });
    }
    // red-brown (corten) pedestrian bridge across the atrium at the second storey
    if (f === 1) {
      const xa = c.x - c.w / 2 - 0.3, xb = c.x + c.w / 2 + 0.3, segs = 4, wv = 1.2;
      for (let i = 0; i < segs; i++) {
        const u0 = i / segs, u1 = (i + 1) / segs, zc0 = c.z + Math.sin(u0 * Math.PI) * 1.6, zc1 = c.z + Math.sin(u1 * Math.PI) * 1.6;
        const px0 = xa + (xb - xa) * u0, px1 = xa + (xb - xa) * u1, len = Math.hypot(px1 - px0, zc1 - zc0), yaw = Math.atan2(px1 - px0, zc1 - zc0);
        const mx = (px0 + px1) / 2, mz = (zc0 + zc1) / 2;
        F.boxes.push({ p: [mx, FT + 0.05, mz], s: [wv, 0.16, len + 0.05], c: '#8a3b22', r: yaw, rx: 0 });
        for (const o of [-wv / 2, wv / 2]) F.boxes.push({ p: [mx + Math.cos(yaw) * o, FT + 0.6, mz - Math.sin(yaw) * o], s: [0.05, 1.0, len + 0.05], c: '#6e2c1a', r: yaw, rx: 0 });
      }
    }
  });
}
function core(F: Furn, stairs = true) {
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
  if (stairs) for (let i = 0; i < steps; i++) F.b(6 + i * 0.7 + 0.35, 0, HZ - 1.8, 0.7, ((i + 1) * CLEAR) / steps, 1.6, '#c9cfcc');
  if (stairs) F.g(11, 0.4, HZ - 0.9, 10, 1.0, 0.04);
}
function garden(F: Furn) {
  const rnd = mulberry32(2024);
  COURTYARDS.forEach((c, k) => {
    const sx = k === 0 ? -1 : 1, sz = k === 0 ? 1 : -1; // pond sits at a different corner of each atrium
    const px = c.x + sx * (c.w / 2 - 3), pz = c.z + sz * (c.d / 2 - 3);
    F.b(c.x, -FT - 0.1, c.z, c.w - 0.2, 0.15, c.d - 0.2, '#4f8a52');
    F.b(px, -FT - 0.04, pz, 5.2, 0.05, 5.2, '#4aa7b5'); // lily pond
    for (let i = 0; i < 16; i++) {
      const lx = px + (rnd() - 0.5) * 4.4, lz = pz + (rnd() - 0.5) * 4.4, lw = 0.5 + rnd() * 0.3, ly = rnd() * 6;
      F.altBoxes.push({ p: [lx, 0.03, lz], s: [lw, 0.02, lw], c: '#3f8f4a', r: ly, rx: 0 });
      F.prop(i % 3 === 0 ? 'n:lily_small' : 'n:lily_large', lx, -FT + 0.02, lz, ly, 2.6 + rnd());
    }
    for (let i = 0; i < 4; i++) F.ball(px + (rnd() - 0.5) * 3.6, -FT + 0.1, pz + (rnd() - 0.5) * 3.6, 0.14, '#f08ab0');
    for (let i = 0; i < 6; i++) { const a = (i / 6) * 6.28 + k; F.prop(i % 2 ? 'n:rock_smallA' : 'n:rock_smallC', px + Math.cos(a) * 2.9, -FT, pz + Math.sin(a) * 2.9, a, 3 + rnd()); }
    // stepping path + broadleaf trees
    for (let i = 0; i < 9; i++) {
      const sx2 = c.x - c.w / 2 + 1.5 + i * 1.2, sz2 = c.z + (k ? -1 : 1) * 0.2;
      F.altBoxes.push({ p: [sx2, 0.03, sz2], s: [0.9, 0.08, 0.9], c: '#c9c3b5', r: 0, rx: 0 });
      F.prop('n:path_stone', sx2, -FT, sz2, Math.PI / 2, 1.1);
    }
    for (let i = 0; i < 9; i++) F.tree(c.x + (rnd() - 0.5) * (c.w - 3), c.z + (rnd() - 0.5) * (c.d - 3), 4 + rnd() * 7, 1.8 + rnd() * 1.5, rnd() < 0.5 ? '#2f8a4a' : '#3da35a');
    for (let i = 0; i < 16; i++) {
      const tx = c.x + (rnd() - 0.5) * (c.w - 2.5), tz = c.z + (rnd() - 0.5) * (c.d - 2.5);
      if (Math.hypot(tx - px, tz - pz) < 3.3) continue;
      F.palm(tx, tz, 5 + rnd() * 5);
    }
    for (let i = 0; i < 16; i++) {
      const tx = c.x + (rnd() - 0.5) * (c.w - 1.5), tz = c.z + (rnd() - 0.5) * (c.d - 1.5);
      if (Math.hypot(tx - px, tz - pz) < 3) continue;
      F.banana(tx, tz);
    }
    for (let i = 0; i < 70; i++) F.cover(c.x + (rnd() - 0.5) * (c.w - 1), -FT, c.z + (rnd() - 0.5) * (c.d - 1), rnd());
    // clipped hedge + trailing plants along the planter rim (real garden: dense green edge around every void)
    for (let t = 0; t < 1; t += 1.3 / (2 * (c.w + c.d))) {
      const a = t * 4, e = Math.min(3, Math.floor(a)), u = a - e, ix = c.w / 2 - 0.9, iz = c.d / 2 - 0.9;
      const hx = e === 0 ? -ix + u * 2 * ix : e === 2 ? ix - u * 2 * ix : e === 1 ? ix : -ix, hz = e === 1 ? -iz + u * 2 * iz : e === 3 ? iz - u * 2 * iz : e === 0 ? -iz : iz;
      F.prop(rnd() < 0.5 ? 'v:bush_1' : 'v:bush_0', c.x + hx, -FT, c.z + hz, rnd() * 6.28, 0.8 + rnd() * 0.4);
    }
  });
}

// ---------- floors ----------
export const TEAM_SEATS: { emp: string; x: number; z: number; rot: number }[] = [];

function lobby(F: Furn, S: Furn) {
  // Authored in world metres on S (unsquashed); people go on F (layout group, scaled by K) so convert with pw().
  const pw = (x: number, z: number): [number, number] => [x / K, z / K];
  const stand = (id: string, x: number, z: number, rot: number, pose?: 'idle' | 'wave') => { const [a, b] = pw(x, z); F.stands.push({ x: a, z: b, rot, id, pose }); };
  const walk = (id: string, ax: number, az: number, bx: number, bz: number, speed = 1.0) => F.walkers.push({ a: pw(ax, az), b: pw(bx, bz), speed, id });
  const sit = (x: number, z: number, rot: number) => { const [a, b] = pw(x, z); F.sitSeats.push({ x: a, z: b, rot }); };
  const X0 = -6.5, X1 = HX - 1.8, Z0 = -HZ + 1.8, Z1 = HZ - 1.8;
  // inlaid border + compass motif on the marble floor
  const bc = '#6f8f86';
  S.b((X0 + X1) / 2, 0.012, Z0, X1 - X0, 0.01, 0.3, bc); S.b((X0 + X1) / 2, 0.012, Z1, X1 - X0, 0.01, 0.3, bc);
  S.b(X0, 0.012, 0, 0.3, 0.01, Z1 - Z0, bc); S.b(X1, 0.012, 0, 0.3, 0.01, Z1 - Z0, bc);
  S.label({ art: 'compass', t: 'compass', x: 7, y: 0.02, z: -1, w: 11, h: 11, rot: 0, flat: true });
  // reception with big backlit wall
  S.counter(14.5, 16.2, 9, 1.2, '#f4f4f0', '#2e8f8a');
  S.scr(14.5, 1.0, 16.2 - 0.2, 6, 0.05, 0.03, '#7de0d0');
  S.b(14.5, 0, 13.4, 11, CLEAR - 0.3, 0.3, '#f4f4f0');
  S.scr(14.5, 0.35, 13.58, 10.4, 2.6, 0.05, '#2d8f88');
  S.label({ t: 'FPT SOFTWARE', x: 14.5, y: 2.35, z: 13.63, w: 8, h: 1.2, rot: 0, fg: '#ffffff', bg: 'rgba(0,0,0,0)' });
  S.label({ t: 'F-TOWN 3', x: 14.5, y: 1.2, z: 13.63, w: 5, h: 0.9, rot: 0, fg: '#bff5ea', bg: 'rgba(0,0,0,0)' });
  S.label({ t: 'LỄ TÂN • RECEPTION', x: 14.5, y: 1.5, z: 16.85, w: 3.6, h: 0.45, rot: 0, fg: '#fff', bg: '#2e8f8a' });
  stand('f1-reception1', 12.5, 15.0, 0); stand('f1-reception2', 16.5, 15.0, 0);
  // security turnstile gate line
  for (let i = 0; i < 7; i++) { S.b(-1 + i * 1.7, 0, 10.5, 0.12, 1.05, 1.0, '#b8c2c6'); S.scr(-1 + i * 1.7, 1.05, 10.5, 0.12, 0.06, 0.25, i % 3 === 0 ? '#ff5a4a' : '#38d96a'); }
  S.label({ t: 'KIỂM SOÁT RA VÀO', x: 4.5, y: 2.6, z: 9.9, w: 5, h: 0.6, rot: 0, fg: '#fff', bg: '#34495e' });
  S.label({ t: 'KIỂM SOÁT RA VÀO', x: 4.5, y: 2.6, z: 9.86, w: 5, h: 0.6, rot: Math.PI, fg: '#fff', bg: '#34495e' }); // readable from both sides
  stand('f1-guard', -1.8, 11.6, 0);
  // Long Chau standee area (greeter model stands here)
  S.b(8.5, 0.012, 17.6, 3.6, 0.01, 3.6, '#f08a3a'); S.b(8.5, 0.02, 17.6, 3.0, 0.01, 3.0, '#ffd9b0');
  S.label({ t: 'NHÀ THUỐC LONG CHÂU', x: 8.5, y: 0.03, z: 19.7, w: 3.6, h: 0.5, rot: 0, flat: true, fg: '#c0392b', bg: 'rgba(0,0,0,0)' });
  // LED screen wall
  S.scr(10, 0.4, Z0 - 0.5, 18, 2.8, 0.1, '#245f93');
  for (let i = 0; i < 3; i++) S.scr(2.5 + i * 7.5, 0.7, Z0 - 0.42, 5.4, 2.2, 0.04, ['#2e9bd6', '#2fc09a', '#e0913a'][i]);
  S.label({ t: 'BUILDING IN THE PARK', x: 10, y: 3.0, z: Z0 - 0.4, w: 11, h: 0.8, rot: 0, fg: '#ffffff', bg: 'rgba(0,0,0,0)' });
  stand('f1-led1', 4.5, Z0 + 1.6, Math.PI); stand('f1-led2', 5.7, Z0 + 1.9, Math.PI);
  // café: counter + stools + menu board + high tables
  S.counter(HX - 1.6, 3, 1.2, 12, '#2e8f8a', '#e9e2d3', -Math.PI / 2);
  S.prop('kitchenCoffeeMachine', HX - 1.6, 1.0, 1, -Math.PI / 2, 2); S.prop('kitchenCoffeeMachine', HX - 1.6, 1.0, 5, -Math.PI / 2, 2);
  for (let i = 0; i < 6; i++) S.stool(HX - 3.4, -1.5 + i * 2.1);
  S.scr(HX - 1.0, 1.8, 3, 0.08, 1.1, 4.2, '#2b2118');
  S.label({ t: 'CAFÉ • MENU', x: HX - 1.2, y: 2.95, z: 3, w: 3.4, h: 0.55, rot: -Math.PI / 2, fg: '#fff', bg: '#6b4a2f' });
  stand('f1-barista', HX - 0.7, 2, -Math.PI / 2); stand('f1-cust1', HX - 4.4, 0.5, Math.PI / 2); stand('f1-cust2', HX - 4.4, 4.5, Math.PI / 2);
  for (const z of [-5, 0, 5, 10]) { S.table(16.2, z, 0.9, 0.9, '#e9e2d3', 1.0); S.stool(15.4, z); S.stool(17.0, z); }
  // lounge groups on rugs (Kenney sofas) + seated people
  const group = (cx: number, cz: number, rug: string, tag: string) => {
    S.b(cx, 0.012, cz, 5.4, 0.01, 4.4, rug);
    S.sofa(cx, cz - 1.5, 0, 2.8); S.sofa(cx, cz + 1.5, Math.PI, 2.8); S.table(cx, cz, 1.4, 0.7, '#e9e2d3', 0.4);
    S.prop('loungeChair', cx + 2.3, 0, cz, -Math.PI / 2, 2); S.plant(cx - 2.4, cz - 1.8, 1.3);
    sit(cx - 0.6, cz - 1.5, 0); sit(cx + 0.6, cz - 1.5, 0); sit(cx - 0.6, cz + 1.5, Math.PI); sit(cx + 0.6, cz + 1.5, Math.PI);
    void tag;
  };
  group(-3.4, 15.5, '#7fb3a6', 'a'); group(-3.4, -13, '#e0b27a', 'b'); group(7, -11, '#9bb8d9', 'c'); group(16.5, -14, '#c9a6c9', 'd');
  // big plants, wayfinding totems, pillars with light strips
  for (let z = -18; z <= 18; z += 6) S.plant(-6.6, z, 1.9);
  for (const [px, pz] of [[1.2, 19.8], [11, 19.8], [HX - 2.4, 11.5], [HX - 2.4, -8]]) S.plant(px, pz, 1.8);
  const totem = (x: number, z: number, t: string, rot = 0) => { S.b(x, 0, z, 0.55, 2.3, 0.16, '#2e3f46', rot); S.label({ t, x: x + Math.sin(rot) * 0.1, y: 1.7, z: z + Math.cos(rot) * 0.1, w: 0.5, h: 0.5, rot, fg: '#ffffff', bg: '#2e8f8a' }); S.label({ t: t === 'THANG MÁY' ? 'LIFT ▲' : 'WAY ▶', x: x + Math.sin(rot) * 0.1, y: 1.1, z: z + Math.cos(rot) * 0.1, w: 0.5, h: 0.4, rot, fg: '#ffd9a0', bg: '#2e3f46' }); };
  totem(1.5, 8.5, 'THANG MÁY'); totem(12, 8.2, 'CAFÉ'); totem(-1.5, -6, 'F2-F7');
  for (const [px, pz] of [[2, -7], [12, -7], [12, 5], [2, 5]]) { S.b(px, 0, pz, 0.7, CLEAR, 0.7, '#f1f1ec'); for (const d of [-1, 1]) S.scr(px + d * 0.36, 0.3, pz, 0.04, 2.6, 0.3, '#cfc6aa'); }
  // walking people
  walk('f1-walk1', -5, 18.5, 20, 19, 1.1); walk('f1-walk2', 4.5, 19, 4.5, 11.5, 0.9); walk('f1-walk3', 0, 8.5, 12, 8.5, 1.0); walk('f1-walk4', -4, -3, 18, -3, 1.2);
  walk('f1-walk5', 15, -18, 0, -18, 1.0); walk('f1-walk6', 2, -9, 2, 7, 0.9); walk('f1-walk7', 13, 6.5, 13, -9, 1.0); walk('f1-walk8', -6, 4, -6, -9, 0.8);
  stand('f1-visitor1', 4.5, 15.6, Math.PI, 'wave'); stand('f1-visitor2', 5.7, 15.4, Math.PI);
  F.npcSit = 10;
}
function training(F: Furn) {
  // training room
  F.scr(16, 1.0, 10.6, 6, 1.8, 0.08, '#2a7fb8'); F.b(16, 0, 10.5, 6.4, 0.1, 0.2, '#ddd');
  F.label({ t: 'TRAINING', x: 16, y: 3.0, z: 10.4, w: 4, h: 0.7, rot: 0, fg: '#fff', bg: '#2e8f8a' });
  for (const rz of [13, 15.5, 18, 20.5]) for (const rx of [12, 19]) {
    F.table(rx, rz, 5, 0.6, '#e9e2d3');
    for (let i = 0; i < 4; i++) F.chair(rx - 1.9 + i * 1.25, rz + 0.75, Math.PI);
  }
  // glass partition around the training room (door gap in the middle of the north side)
  F.g(10.5, 0, 11.6, 4, CLEAR - 0.4, 0.05); F.g(21.5, 0, 11.6, 6, CLEAR - 0.4, 0.05); F.g(8, 0, 17, 0.05, CLEAR - 0.4, 11);
  for (const rz of [13, 15.5, 18, 20.5]) for (const rx of [12, 19]) for (let i = 0; i < 4; i++) F.sitSeats.push({ x: rx - 1.9 + i * 1.25, z: rz + 0.75, rot: Math.PI });
  F.npcSit = 16; F.bookcase(25, 17, -Math.PI / 2); F.bookcase(25, 20, -Math.PI / 2);
  // meeting rooms
  [4, 13, 22].forEach((x) => F.room(x, -21, 7, 6));
  // pantry
  F.counter(-16, -3, 8, 0.8, '#f1ede4', '#2e8f8a'); F.b(-18.5, 1.05, -3, 0.5, 0.4, 0.5, '#b9c1c5');
  F.fridge(-21.2, -3, Math.PI / 2);
  F.label({ t: 'PANTRY', x: -16, y: 2.6, z: -3.6, w: 3.2, h: 0.8, rot: 0, fg: '#fff', bg: '#e07a3a' });
  for (const x of [-20, -16, -12]) { F.table(x, 2.5, 0.9, 0.9, '#e9e2d3', 1.0); F.stool(x - 0.7, 2.5); F.stool(x + 0.7, 2.5); }
  F.stands.push({ x: -17, z: -4.2, rot: Math.PI, id: 'f2-pantry1' }); F.stands.push({ x: -13.5, z: -1.8, rot: 0, id: 'f2-pantry2' });
  // coworking lounge
  for (let i = 0; i < 4; i++) { F.sofa(6 + i * 5, -6, 0, 2.2); F.table(6 + i * 5, -3.8, 1.2, 0.6, '#e9e2d3', 0.4); F.plant(8.5 + i * 5, -4, 1.1); }
  F.sitSeats.push({ x: 6, z: -5.8, rot: 0 }, { x: 11, z: -5.8, rot: 0 });
  F.walkers.push({ a: [3, 5], b: [22, 5], speed: 1.0, id: 'f2-walk1' });
}
/** Personal clutter on one desk, deterministic per seat. Local frame: +lz = far side (monitor), -lz = towards the chair, +lx = right of the user. */
function deskItems(S: Furn, x: number, z: number, th: number, r: () => number) {
  const face = th + Math.PI, Y = 0.75;
  const put = (m: string, lx: number, lz: number, rot: number, s: number | V3 = 1) => { const [px, pz] = S.lp(x, z, th, lx, lz); S.prop(m, px, Y, pz, face + rot, s); };
  if (r() < 0.6) put('o:notebook', -0.46, -0.29, (r() - 0.5) * 0.7);
  if (r() < 0.5) put('o:paper_stack', 0.5, -0.27, (r() - 0.5) * 0.9, 0.8 + r() * 0.4);
  else if (r() < 0.45) put('o:books', 0.5, -0.24, r() * 6.28, 0.7);
  if (r() < 0.3) put('o:binder', 0.28, 0.34, (r() - 0.5) * 0.4, 0.8);
  if (r() < 0.25) put('o:tissue', -0.2, 0.33, (r() - 0.5) * 0.8);
  if (r() < 0.35) put('o:sticky', 0.2, -0.02, (r() - 0.5) * 1.2);
}
/** column wrap + safety kit (alternating fire extinguisher / first-aid sign) */
function pillarKit(S: Furn, x: number, z: number, i: number) {
  S.b(x, 0, z, 0.76, 0.14, 0.76, '#8f989c'); S.b(x, CLEAR - 0.14, z, 0.76, 0.14, 0.76, '#8f989c');
  const zf = z + 0.355;
  if (i % 2 === 0) {
    S.prop('o:extinguisher', x, 0.85, z + 0.35 + 0.15, 0, 1);
    S.b(x, 1.55, zf, 0.32, 0.32, 0.012, '#c0392b'); S.b(x, 1.61, zf + 0.008, 0.06, 0.2, 0.006, '#ffffff'); S.b(x, 1.68, zf + 0.008, 0.2, 0.06, 0.006, '#ffffff');
  } else {
    S.b(x, 1.4, zf, 0.34, 0.34, 0.012, '#2f9e5b'); S.b(x, 1.47, zf + 0.008, 0.07, 0.2, 0.006, '#ffffff'); S.b(x, 1.54, zf + 0.008, 0.2, 0.07, 0.006, '#ffffff');
  }
}
interface TeamCtx { x0: number; x1: number; zN: number; zS: number; CX: number; doorX: number; gl: number; gr: number }
/** extra realism for the NHÀ THUỐC floor: solid back walls, pantry wall units, storage, signage, ceiling services, meeting room dressing */
function teamDetail(S: Furn, c: TeamCtx) {
  const { x0, x1, zN, zS, CX, doorX, gl, gr } = c;
  const rd = mulberry32(2024);
  const rail = '#5b676d', frost = '#f3f6f6';
  // --- glass bay walls: frosted privacy band, base rail, top rail, door frame ---
  const run = (cx: number, cz: number, w: number, d: number) => { S.b(cx, 0.72, cz, w, 0.14, d + 0.012, frost); S.b(cx, 0, cz, w, 0.09, d + 0.02, rail); S.b(cx, 1.4, cz, w, 0.04, d + 0.03, '#2b3338'); };
  run((x0 + gl) / 2, zN, gl - x0, 0.05); run((gr + x1) / 2, zN, x1 - gr, 0.05); run(CX, zS, x1 - x0, 0.05); run(x1, 0, 0.05, zS - zN);
  run(x0, (zN - 1.2) / 2, 0.05, -1.2 - zN); run(x0, (1.2 + zS) / 2, 0.05, zS - 1.2);
  for (const px of [gl, gr]) S.b(px, 0, zN, 0.09, 2.2, 0.09, rail);
  S.b(doorX, 2.2, zN, gr - gl + 0.09, 0.09, 0.09, rail);
  S.prop('o:exit_sign', doorX, 2.3, zN + 0.04, 0, 1);
  S.b(doorX, 0.012, zN + 1.0, gr - gl + 0.4, 0.012, 1.3, '#3d4b50'); // entrance mat
  for (let i = 0; i < 5; i++) S.b(doorX, 0.024, zN + 0.55 + i * 0.2, gr - gl + 0.2, 0.004, 0.05, '#566a70');
  S.decal('mat', doorX, 0.034, zN + 1.0, 2.4, 1.2, 0, true); // logo entrance mat, readable from inside the bay
  S.b(doorX, 2.62, zN, 1.64, 0.4, 0.05, '#e9eef5'); // door header sign, both faces
  S.decal('hdr', doorX, 2.82, zN + 0.03, 1.6, 0.4, 0); S.decal('hdr', doorX, 2.82, zN - 0.03, 1.6, 0.4, Math.PI);
  // --- solid back wall behind the north service strip ---
  const wz = -HZ + 0.5, wx0 = 1.0, wx1 = 21.4, wcx = (wx0 + wx1) / 2, wl = wx1 - wx0;
  S.b(wcx, 0, wz, wl, 3.0, 0.12, '#eef0ef'); S.b(wcx, 0, wz + 0.07, wl, 0.12, 0.03, '#454a4f'); S.b(wcx, 1.05, wz + 0.065, wl, 0.05, 0.012, '#2e8f8a');
  // storage: filing cabinets + archive boxes + sign
  for (const cx of [4.8, 5.45, 6.1]) S.prop('o:cabinet', cx, 0, wz + 0.06 + 0.29, 0, 1);
  S.prop('o:box', 4.95, 1.3, wz + 0.4, 0.2, 0.7); S.prop('o:box', 5.7, 1.3, wz + 0.4, -0.1, 0.6); S.prop('o:box', 5.35, 1.6, wz + 0.4, 0.5, 0.5);
  // safety point beside the print corner
  S.prop('o:extinguisher', 18.0, 0.9, wz + 0.2, 0, 1); S.b(18.0, 1.65, wz + 0.07, 0.32, 0.32, 0.012, '#c0392b'); S.b(18.0, 1.71, wz + 0.08, 0.06, 0.2, 0.006, '#fff'); S.b(18.0, 1.78, wz + 0.08, 0.2, 0.06, 0.006, '#fff');
  S.prop('o:clock', 9.0, 2.45, wz + 0.07, 0, 1); S.prop('o:calendar', 17.2, 1.4, wz + 0.07, 0, 1);
  S.prop('o:bin_small', 15.7, 0, -HZ + 1.3, 0, 1); S.prop('o:box', 15.6, 0, -HZ + 2.0, 0.4, 0.8);
  // --- south strip: back wall behind lounge art + pantry ---
  const sz = 21.05, sx0 = 4.2, sx1 = 21.4, scx = (sx0 + sx1) / 2, sl = sx1 - sx0, wf = sz - 0.1; // wf = wall front face
  S.b(scx, 0, sz, sl, 2.9, 0.2, '#eef0ef'); S.b(scx, 0, wf - 0.015, sl, 0.12, 0.03, '#454a4f'); S.b(scx, 1.05, wf - 0.006, sl, 0.05, 0.012, '#e07a3a');
  // pantry wall units, backsplash
  S.b(18.4, 1.07, wf - 0.006, 5.0, 0.5, 0.012, '#dfe7e6');
  S.b(18.4, 1.65, 20.78, 5.0, 0.7, 0.36, '#f1ede4');
  for (let i = 0; i <= 5; i++) S.b(15.9 + i * 1.0, 1.65, 20.595, 0.015, 0.7, 0.01, '#c4beb0');
  for (let i = 0; i < 5; i++) S.b(16.4 + i * 1.0 + 0.4, 1.78, 20.59, 0.03, 0.18, 0.015, '#8a949b');
  S.b(18.4, 1.62, 20.78, 5.04, 0.04, 0.38, '#2e8f8a');
  for (const [cx, k] of [[16.7, 'o:coffee_cup'], [17.5, 'o:mug'], [17.75, 'o:coffee_cup'], [18.6, 'o:tissue']] as [number, string][]) S.prop(k, cx, 1.05, 20.45, rd() * 6, 1);
  S.prop('o:msgboard', 14.4, 1.45, wf - 0.05, Math.PI, 1);
  S.prop('o:clock', 13.0, 2.15, wf, Math.PI, 1);
  S.prop('o:bins3', 15.45, 0, 20.4, Math.PI, 1);
  S.prop('o:extinguisher', 11.95, 0.9, wf - 0.15, Math.PI, 1); S.b(11.95, 1.65, wf - 0.008, 0.32, 0.32, 0.012, '#c0392b'); S.b(11.95, 1.71, wf - 0.016, 0.06, 0.2, 0.006, '#fff'); S.b(11.95, 1.78, wf - 0.016, 0.2, 0.06, 0.006, '#fff');
  // lounge table dressing
  S.prop('o:books', 2.5, 0.4, 18.6, 0.4, 0.8); S.prop('o:coffee_cup', 3.2, 0.4, 18.85, 1, 1); S.prop('o:mug', 2.95, 0.4, 18.5, 2, 1);
  // --- meeting room dressing (room(-3.4,-16, 6x5): table 3.3 x 1.5) ---
  for (let i = 0; i < 4; i++) for (const sd of [-1, 1]) {
    const px = -3.4 - 1.2 + i * 0.8 + (rd() - 0.5) * 0.1, pz = -16 + sd * 0.45;
    S.prop('o:notebook', px, 0.74, pz, sd < 0 ? 0 : Math.PI, 0.9); S.prop(rd() < 0.5 ? 'o:mug' : 'o:coffee_cup', px + 0.3, 0.74, pz + sd * 0.1, rd() * 6, 1);
  }
  S.prop('o:paper_stack', -3.4, 0.74, -16, 0.3, 1.1); S.b(-3.0, 0.74, -16.05, 0.2, 0.05, 0.2, '#1b2228');
  S.prop('o:whiteboard', -6.33, 0.45, -16, Math.PI / 2, 1);
  S.b(-3.4, 0.95, -18.34, 2.4, 1.4, 0.05, '#1b2228');
  S.prop('v:ficus', -6.0, 0, -18.1, 1, 1); S.prop('o:cabinet', -0.9, 0, -17.2, -Math.PI / 2, 1);
  // --- ceiling services: AC diffusers, sprinkler heads, long supply ducts ---
  for (let px = 4; px <= 21; px += 6) for (let pz = -18; pz <= 20; pz += 6) {
    S.b(px + 3, CLEAR - 0.05, pz + 3, 0.6, 0.03, 0.6, '#d9dee0'); S.b(px + 3, CLEAR - 0.065, pz + 3, 0.44, 0.015, 0.44, '#b9c1c5'); S.b(px, CLEAR - 0.12, pz + 1.5, 0.04, 0.12, 0.04, '#c0392b');
  }
  for (const dx of [7, 13, 19]) { // galvanised supply ducts with flanged joints + hangers
    S.b(dx, CLEAR - 0.3, 0, 0.5, 0.22, 27, '#c4ccd0');
    for (let k = -4; k <= 4; k++) { S.b(dx, CLEAR - 0.32, k * 3, 0.54, 0.26, 0.04, '#9aa3a8'); for (const o of [-0.22, 0.22]) S.b(dx + o, CLEAR - 0.08, k * 3 + 1.5, 0.012, 0.08, 0.012, '#5b6368'); }
  }
  S.b(10, CLEAR - 0.16, 0, 0.32, 0.012, 27, '#8d9599'); for (const o of [-0.16, 0.16]) S.b(10 + o, CLEAR - 0.1, 0, 0.012, 0.06, 27, '#8d9599'); // cable tray
  for (let k = -13; k <= 13; k++) S.b(10, CLEAR - 0.158, k, 0.3, 0.008, 0.02, '#6f777b');
  S.b(4.2, CLEAR - 0.15, 0, 0.06, 0.06, 27, '#b5362a'); // fire-sprinkler main
  for (const pz of [-12, -4, 4, 12]) S.b((4.2 + 10) / 2, CLEAR - 0.15, pz, 5.8, 0.04, 0.04, '#b5362a');
  for (let px = 4; px <= 16; px += 6) for (let pz = -17; pz <= 19; pz += 6) S.b(px + 3.5, CLEAR - 0.04, pz + 3, 0.11, 0.03, 0.11, '#f4f4f1'); // smoke detectors
}

/** FPT Retail branding for the floor-2 office: reception logo wall, room plates, glass graphics, slogan wall, whiteboard/TV graphics */
function brandDetail(S: Furn, c: TeamCtx) {
  const { doorX, zN } = c;
  void doorX; void zN;
  // --- reception: lit logo wall on the west glass beside the lift opening, with a branded desk in front ---
  const zc = -6.5, gx = 0.9;
  S.scr(gx + 0.1, 0.4, zc, 0.12, 2.55, 4.9, '#0c1330'); // dark backing / frame
  S.scr(gx + 0.17, 0.33, zc, 0.04, 0.05, 4.9, '#bfe0ff'); S.scr(gx + 0.17, 2.95, zc, 0.04, 0.05, 4.9, '#bfe0ff'); // LED edge lines
  S.decal('wall', gx + 0.17, 1.675, zc, 4.4, 2.3, Math.PI / 2);
  S.b(2.3, 0, zc, 0.55, 1.0, 2.8, '#eef1f5'); S.b(2.3, 1.0, zc, 0.75, 0.05, 3.0, '#2b3338');
  S.decal('hdr', 2.58, 0.54, zc, 2.0, 0.5, Math.PI / 2);
  S.b(2.3, 1.05, zc, 0.03, 0.2, 0.55, '#ffffff'); S.decal('pl_welcome', 2.318, 1.16, zc, 0.5, 0.156, Math.PI / 2); S.decal('pl_welcome', 2.282, 1.16, zc, 0.5, 0.156, -Math.PI / 2);
  S.prop('o:plant_white', 1.6, 0, zc - 2.0, 0.3, 1); S.prop('o:plant_a', 1.6, 0, zc + 2.0, 1.2, 1);
  // --- meeting room (-3.4,-16, 6x5): glass logo + manifestation stripes, TV welcome screen, door plate ---
  const rx = -3.4, rz = -16, hw = 3, hd = 2.5;
  S.decal('glass', rx + hw + 0.04, 1.65, rz, 1.7, 0.64, Math.PI / 2); S.decal('glass', rx + hw - 0.04, 1.65, rz, 1.7, 0.64, -Math.PI / 2);
  S.stripe(rx + hw + 0.036, 1.1, rz, 4.0, 0.2, Math.PI / 2); S.stripe(rx + hw - 0.036, 1.1, rz, 4.0, 0.2, -Math.PI / 2);
  S.decal('glass', rx - hw + 0.04, 1.65, rz, 1.7, 0.64, Math.PI / 2); S.decal('glass', rx - hw - 0.04, 1.65, rz, 1.7, 0.64, -Math.PI / 2);
  for (const sx of [-1, 1]) { const cx = rx + sx * 1.85; S.stripe(cx, 1.1, rz + hd + 0.036, 2.2, 0.2, 0); S.stripe(cx, 1.1, rz + hd - 0.036, 2.2, 0.2, Math.PI); }
  S.decal('glass', rx + 1.85, 1.65, rz + hd + 0.04, 1.5, 0.56, 0); S.decal('glass', rx + 1.85, 1.65, rz + hd - 0.04, 1.5, 0.56, Math.PI);
  S.decal('scr1', rx, 1.65, rz - hd + 0.19, 2.08, 1.3, 0); // TV
  S.decal('pl_meet', rx, 2.7, rz + hd + 0.045, 1.92, 0.6, 0);
  S.decal('pl_meet', rx, 2.7, rz + hd - 0.045, 1.92, 0.6, Math.PI);
  // --- north service strip back wall (z -21.44): storage / network / sprint plates, whiteboard graphic ---
  const wf = -HZ + 0.56;
  S.decal('pl_kho', 5.45, 2.35, wf + 0.012, 1.28, 0.4, 0); S.decal('pl_net', 19.7, 2.42, wf + 0.012, 1.28, 0.4, 0); S.decal('pl_sprint', 11, 2.97, wf + 0.012, 1.09, 0.34, 0);
  S.decal('wb', 2.9, 1.5, -HZ + 0.62 + 0.035, 1.9, 1.19, 0);
  S.decal('pl_print', 16.6, 1.35, wf + 0.012, 0.8, 0.25, 0);
  // --- lounge / pantry south wall (front face z 20.95, facing north) ---
  S.decal('slogan', 7.2, 1.55, 20.94, 5.6, 1.75, Math.PI);
  S.b(7.2, 0.6, 20.93, 5.7, 0.05, 0.04, '#2b3338'); S.b(7.2, 2.45, 20.93, 5.7, 0.05, 0.04, '#2b3338');
  S.decal('pl_pantry', 18.4, 2.75, 20.93, 1.92, 0.6, Math.PI);
}
function teamFloor(F: Furn, S: Furn) {
  void F;
  // The bay fills the east block (x 1.6..21, z +-14), authored directly in world metres (S = unsquashed structure group).
  const bw = 19.4, bd = 28, sx = bw / 735, sz = bd / 625, CX = HX - 11.6 + 0.2;
  const mx = (wx: number) => CX + (wx - 1177.5) * sx, mz = (wy: number) => (wy - 492.5) * sz;
  const x0 = CX - bw / 2, x1 = CX + bw / 2, zN = -bd / 2, zS = bd / 2;
  const doorX = mx(1115), doorW = 124 * sx + 0.6;
  const gl = doorX - doorW / 2, gr = doorX + doorW / 2;
  // low glass bay walls: door gap north, secondary opening west towards the lift core
  S.g((x0 + gl) / 2, 0, zN, gl - x0, 1.4, 0.05); S.g((gr + x1) / 2, 0, zN, x1 - gr, 1.4, 0.05);
  S.g(CX, 0, zS, bw, 1.4, 0.05); S.g(x1, 0, 0, 0.05, 1.4, bd);
  S.g(x0, (-bd / 2 - 1.2) / 2 * 0, (zN + -1.2) / 2, 0.05, 1.4, -1.2 - zN); S.g(x0, 0, (1.2 + zS) / 2, 0.05, 1.4, zS - 1.2);
  S.b(CX, 1.4, zS, bw, 0.05, 0.08, '#2e8f8a');
  // entrance: double glass doors swung open (aluminium frame, push-bar handles) + card reader
  for (const [px, sd] of [[gl, 1], [gr, -1]] as [number, number][]) {
    const lw = 1.0;
    S.g(px, 0, zN + lw / 2, 0.03, 2.1, lw); S.b(px, 0, zN + lw / 2, 0.05, 0.12, lw, '#2a2d30'); S.b(px, 2.05, zN + lw / 2, 0.05, 0.08, lw, '#2a2d30');
    S.b(px, 0, zN + lw, 0.05, 2.1, 0.05, '#2a2d30'); S.b(px, 0, zN + 0.02, 0.05, 2.1, 0.05, '#2a2d30');
    S.b(px - sd * 0.04, 0.95, zN + lw - 0.1, 0.025, 0.4, 0.025, '#cfd4d7');
  }
  S.b(gl - 0.35, 1.2, zN + 0.06, 0.09, 0.13, 0.03, '#1c1f22'); S.led(gl - 0.35, 1.25, zN + 0.08, '#33ff88');
  // curtain-wall mullions + transom + skirting along the recessed glazing (all four sides)
  {
    const mi = 0.9, sh = 5, al = '#3a3f44', mL = (x0: number, z0: number, x1: number, z1: number) => {
      const L = Math.hypot(x1 - x0, z1 - z0), n = Math.round(L / 1.5), ax = Math.abs(z1 - z0) < 1e-6;
      for (let i = 0; i <= n; i++) S.b(x0 + ((x1 - x0) * i) / n, 0, z0 + ((z1 - z0) * i) / n, ax ? 0.06 : 0.1, CLEAR, ax ? 0.1 : 0.06, al);
      for (const y of [0, 2.3, CLEAR - 0.06]) S.b((x0 + x1) / 2, y, (z0 + z1) / 2, ax ? L : 0.08, y === 0 ? 0.12 : 0.06, ax ? 0.08 : L, y === 0 ? '#9aa1a5' : al);
    };
    mL(-HX + sh, -HZ + mi, HX - sh, -HZ + mi); mL(-HX + sh, HZ - mi, HX - sh, HZ - mi); mL(-HX + mi, -HZ + sh, -HX + mi, HZ - sh); mL(HX - mi, -HZ + sh, HX - mi, HZ - sh);
  }
  S.label({ t: 'CỬA RA VÀO', x: doorX, y: 0.05, z: zN + 1.0, w: 3.2, h: 0.55, rot: 0, flat: true, fg: '#1d5a4c', bg: 'rgba(255,255,255,0.0)' });
  // embossed floor title: dark drop shadow, mid body, bright highlight on top
  S.label({ t: 'NHÀ THUỐC', x: CX + 0.07, y: 0.03, z: mz(418) + 0.07, w: 10, h: 1.8, rot: 0, flat: true, fg: '#1c4a38', bg: 'rgba(0,0,0,0)' });
  S.label({ t: 'NHÀ THUỐC', x: CX, y: 0.045, z: mz(418), w: 10, h: 1.8, rot: 0, flat: true, fg: '#d9f5c8', bg: 'rgba(0,0,0,0)' });
  S.label({ t: 'NHÀ THUỐC', x: CX - 0.04, y: 0.06, z: mz(418) - 0.04, w: 10, h: 1.8, rot: 0, flat: true, fg: '#ffffff', bg: 'rgba(0,0,0,0)' });
  const islands = new Map<string, typeof NHA_THUOC_SEAT_SLOTS>();
  for (const q of NHA_THUOC_SEAT_SLOTS) { const a = islands.get(q.islandId) ?? []; a.push(q); islands.set(q.islandId, a); }
  const cols = new Set<number>(), rows = new Set<number>();
  let teamIdx = 0;
  islands.forEach((slots) => {
    const xs = slots.map((q) => mx(q.wx)), zs = slots.map((q) => mz(q.wy));
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cz = (Math.min(...zs) + Math.max(...zs)) / 2;
    const d = Math.max(...zs) - Math.min(...zs) + 1.4;
    { // per-cluster team sign on a short post at each end of the divider (readable from the aisles)
      const sid = teamSignId(teamIdx++);
      for (const sd of [-1, 1]) { S.b(cx, 1.2, cz + sd * (d / 2 - 0.05), 0.04, 0.3, 0.04, '#2b3338'); S.decal(sid, cx, 1.64, cz + sd * (d / 2 - 0.05 + 0.03), 0.84, 0.2625, sd < 0 ? Math.PI : 0); }
    }
    cols.add(Math.round(cx * 100) / 100); rows.add(Math.round(cz * 100) / 100);
    S.b(cx, 0.012, cz, 3.3, 0.01, d + 0.4, '#3a3e43'); // island rug
    S.g(cx, 0.75, cz, 0.04, 0.45, d);
    S.b(cx, 1.2, cz, 0.05, 0.03, d, '#2b3338'); // cable tray / partition top rail
    S.b(cx, 0.92, cz, 0.052, 0.12, d - 0.1, '#f3f6f6'); // frosted privacy band on the glass divider
    S.b(cx, 0.745, cz, 0.06, 0.03, d, '#2b3338'); // divider base rail
  });
  // lighter aisle strips between island columns / rows
  const cs = [...cols].sort((a, b) => a - b), rs = [...rows].sort((a, b) => a - b);
  for (let i = 0; i + 1 < cs.length; i++) S.b((cs[i] + cs[i + 1]) / 2, 0.011, 0, 1.4, 0.01, bd - 1.0, '#70767c');
  for (let i = 0; i + 1 < rs.length; i++) S.b(CX, 0.011, (rs[i] + rs[i + 1]) / 2, bw - 1.0, 0.01, 1.4, '#70767c');
  let pi = 0;
  for (const q of NHA_THUOC_SEAT_SLOTS) {
    const x = mx(q.wx), z = mz(q.wy);
    if (q.kind === 'PILLAR') { S.b(x, 0, z, 0.7, CLEAR, 0.7, '#e6e8e6'); pillarKit(S, x, z, pi);
      // 'values' poster set on the other three column faces
      S.decal(`poster${(pi * 3) % 6}`, x, 1.55, z - 0.356, 0.5, 0.75, Math.PI); S.decal(`poster${(pi * 3 + 1) % 6}`, x + 0.356, 1.55, z, 0.5, 0.75, Math.PI / 2); S.decal(`poster${(pi * 3 + 2) % 6}`, x - 0.356, 1.55, z, 0.5, 0.75, -Math.PI / 2);
      pi++; continue; }
    const th = q.side === 'LEFT' ? Math.PI / 2 : -Math.PI / 2;
    const emp = q.assignedEmployeeId && EMPLOYEE_BY_ID[q.assignedEmployeeId] ? q.assignedEmployeeId : undefined;
    const occupied = q.kind === 'OCCUPIED';
    const seat = S.workstation(x, z, th, {
      dw: 1.25, dd: 0.85, on: occupied, rich: true, brand: true, plate: q.account || undefined,
      top: q.highlight === 'red' ? '#d94a4a' : q.highlight === 'yellow' ? '#e8c24a' : '#e3e5e5',
      tint: q.highlight === 'red' ? '#ff7a7a' : q.highlight === 'yellow' ? '#ffd84a' : undefined,
    });
    deskItems(S, x, z, th, mulberry32(Math.floor(Math.abs(x * 131 + z * 17) * 100) + 7));
    if (occupied) S.slots.push({ id: q.id, seatCode: q.seatCode, account: q.account, deskId: q.deskId, assigned: q.assignedEmployeeId, x: seat.x, z: seat.z, rot: th });
    if (emp) S.team.push({ emp, x: seat.x, z: seat.z, rot: th });
    else if (occupied) S.extraTeam.push({ ...seat, id: q.seatCode });
  }
  TEAM_SEATS.length = 0; TEAM_SEATS.push(...S.team);

  // --- north strip: kanban wall, whiteboard, network cabinets, printer ---
  const zk = -HZ + 0.62;
  S.b(11, 0.8, zk, 9, 2.0, 0.08, '#f5f5f2');
  const stick = ['#f7d154', '#7ac7f0', '#b6e07a', '#f29bbb'], cnt = [5, 4, 3, 6], kr = mulberry32(88);
  ['TO DO', 'DOING', 'REVIEW', 'DONE'].forEach((t, i) => {
    const cx = 11 - 3.3 + i * 2.2;
    S.b(cx, 0.8, zk + 0.045, 0.03, 2.0, 0.01, '#9aa6a3');
    S.label({ t, x: cx, y: 2.65, z: zk + 0.06, w: 1.6, h: 0.3, rot: 0, fg: '#33403d', bg: 'rgba(255,255,255,0)' });
    for (let k = 0; k < cnt[i]; k++) S.b(cx - 0.55 + (k % 2) * 1.0 + (kr() - 0.5) * 0.08, 1.0 + Math.floor(k / 2) * 0.5, zk + 0.05, 0.42, 0.32, 0.01, stick[i], (kr() - 0.5) * 0.15);
  });
  S.b(2.9, 0.9, zk, 3.0, 1.2, 0.06, '#ffffff'); S.b(2.9, 0.88, zk, 3.1, 0.03, 0.08, '#8a949b');
  S.table(16.6, -HZ + 1.8, 1.2, 0.6, '#e9e2d3', 0.75);
  S.alt(() => { S.b(16.6, 0.75, -HZ + 1.8, 0.75, 0.35, 0.5, '#f2f2f2'); S.b(16.6, 1.1, -HZ + 1.8, 0.6, 0.04, 0.4, '#d9d9d9'); });
  S.prop('o:printer', 16.6, 0.75, -HZ + 1.8, 0, 0.5); S.scr(16.75, 0.9, -HZ + 1.55, 0.05, 0.03, 0.01, '#38d96a');
  const lr = mulberry32(61);
  for (const cx of [19.2, 20.2]) {
    S.b(cx, 0, -HZ + 1.05, 0.8, 2.1, 0.9, '#1b2228');
    for (let k = 0; k < 10; k++) S.led(cx - 0.28 + (k % 5) * 0.14, 0.4 + Math.floor(k / 5) * 0.6 + lr() * 0.5, -HZ + 1.05 + 0.46, lr() < 0.7 ? '#33ff88' : '#3aa0ff');
  }
  // --- south strip: lounge + pantry ---
  S.sofa(2.8, 17.4, Math.PI, 2.6); S.sofa(2.8, 20, 0, 2.6); S.table(2.8, 18.7, 1.4, 0.7, '#a9794c', 0.4);
  S.counter(18.4, HZ - 1.6, 5, 0.75, '#e9ebec', '#3b3f43', Math.PI);
  S.prop('kitchenCoffeeMachine', 16.4, 1.0, HZ - 1.6, Math.PI, 2); S.prop('kitchenMicrowave', 19.4, 1.0, HZ - 1.6, Math.PI, 2); S.bookcase(-6.7, -12, Math.PI / 2); S.bookcase(-6.7, 12, Math.PI / 2); S.bookcase(-4.5, -HZ + 0.6, 0); S.bookcase(-3.6, -HZ + 0.6, 0);
  S.b(16.4, 1.05, HZ - 1.6, 0.5, 0.4, 0.5, '#b9c1c5'); S.fridge(21, HZ - 1.6, Math.PI);
  for (const px of [17, 19.5]) { S.table(px, 17.6, 0.9, 0.9, '#c29a6b', 1.0); S.stool(px - 0.7, 17.6); S.stool(px + 0.7, 17.6); }
  for (const [px, pz] of [[1.2, -14.8], [21, -14.8], [-6.5, 8], [-6.5, -8], [-6.5, 20], [-6.5, -20], [1.4, 14.9], [21, 14.9], [-1, 7], [-1, -7]]) S.plant(px, pz, 1.4);
  // points of interest for the living office
  S.poi.push({ x: 18.4, z: HZ - 2.9, rot: 0, pose: 'idle' }, { x: 20, z: HZ - 2.9, rot: 0, pose: 'idle' }, { x: 16.6, z: -HZ + 3.1, rot: Math.PI, pose: 'idle' },
    { x: 11, z: -HZ + 3.0, rot: Math.PI, pose: 'idle' }, { x: 8.5, z: -HZ + 3.0, rot: Math.PI, pose: 'idle' }, { x: -3.4, z: -12.3, rot: Math.PI, pose: 'idle' },
    { x: -2.5, z: 5.2, rot: Math.PI, pose: 'idle' }, { x: -6, z: 0, rot: -Math.PI / 2, pose: 'idle' }, { x: -4.5, z: 8, rot: 0, pose: 'idle' },
    { x: 2.3, z: 17.4, rot: Math.PI, pose: 'sit' }, { x: 3.3, z: 17.4, rot: Math.PI, pose: 'sit' }, { x: 2.3, z: 20, rot: 0, pose: 'sit' }, { x: 3.3, z: 20, rot: 0, pose: 'sit' });
  // glass meeting room + clearer lounge / pantry zones
  S.room(-3.4, -16, 6, 5, '#d9c7a8');
  { // oak plank lounge floor + charcoal rug
    const tones = ['#b98d5f', '#a9794c', '#c29a6b', '#b0804f'], pr = mulberry32(77);
    for (let i = 0; i < 26; i++) S.b(2.8, 0.012, 16.4 + i * 0.19, 5.4, 0.008, 0.185, tones[Math.floor(pr() * 4)]);
    S.b(2.8, 0.02, 18.7, 3.2, 0.012, 4.3, '#3d4650');
  }
  S.label({ t: 'LOUNGE', x: 2.8, y: 0.03, z: 21.2, w: 3.4, h: 0.7, rot: 0, flat: true, fg: '#1d5a4c', bg: 'rgba(0,0,0,0)' });
  S.label({ t: 'PANTRY • CÀ PHÊ', x: 18.4, y: 0.03, z: 15.2, w: 5, h: 0.8, rot: 0, flat: true, fg: '#9a4a14', bg: 'rgba(0,0,0,0)' });
  S.b(18.4, 0.012, 17.4, 6, 0.01, 4.2, '#a7acaf'); // polished concrete pantry floor
  // Office Pack props (flat-colour GLBs in public/models/office): amenities, greenery, wall art
  S.prop('o:cooler', 14.4, 0, HZ - 1.6, Math.PI, 1); S.prop('o:vending', 12.9, 0, HZ - 1.6, Math.PI, 1);
  for (const [px, pz, k] of [[1.4, -12, 0], [21, -9, 1], [21, 9, 0], [1.4, 12, 1], [-1, 3, 0], [-1, -3, 1]] as [number, number, number][]) S.prop(k ? 'v:alocasia' : 'v:ficus', px, 0, pz, px * 3.1, 1);
  S.prop('o:floor_light', 4.7, 0, 17.2, 0, 1); S.prop('o:floor_light', 0.9, 0, 21, 0, 1);
  S.prop('o:coat_rack', -1.2, 0, -HZ + 1.0, 0, 1);
  teamDetail(S, { x0, x1, zN, zS, CX, doorX, gl, gr });
  brandDetail(S, { x0, x1, zN, zS, CX, doorX, gl, gr });
  // ceiling light panels (soft, evenly spaced, deliberately dim so bloom stays calm)
  // suspended linear LED luminaires (housing + diffuser strip)
  for (const px of [2.5, 7.8, 13, 18.2]) for (let pz = -19; pz <= 20; pz += 3.9) {
    S.b(px, CLEAR - 0.24, pz, 1.2, 0.05, 0.1, '#e8eaeb'); S.scr(px, CLEAR - 0.25, pz, 1.12, 0.012, 0.07, '#aeb1a0');
    for (const o of [-0.5, 0.5]) S.b(px + o, CLEAR - 0.2, pz, 0.008, 0.2, 0.008, '#8b9296');
  }
}
function openPlan(F: Furn, f: number, tag: string) {
  const rnd = mulberry32(f * 977);
  const tones = ['#e9e2d3', '#dfe9e1', '#e6e2ee'];
  for (const cx of [-5, 3, 11, 19]) for (const cz of [-19, -11, 11, 19]) {
    if (f % 2 === 0 && cz === 19 && cx > 5) continue; // breakout area
    F.island(cx, cz, tones[Math.floor(rnd() * 3)]);
  }
  if (f % 2 === 0) { F.sofa(14, 19, Math.PI, 2.6); F.sofa(20, 19, Math.PI, 2.6); F.table(17, 21, 1.4, 0.7, '#e9e2d3', 0.4); }
  F.room(22, -3, 4, 5);
  for (const [px, pz] of [[7, 0], [15, 0], [24, -7], [-7, 0]]) F.plant(px, pz, 1.3);
  F.label({ t: `${tag} • OPEN WORKSPACE`, x: 13, y: 0.05, z: 0, w: 9, h: 1.2, rot: 0, flat: true, fg: '#1d5a4c', bg: 'rgba(0,0,0,0)' });
  // phone booths + print corner + breakout
  for (const [bx, bz] of [[24, 6], [24, 9], [-7, 8], [-7, 12]]) { F.g(bx, 0, bz, 1.5, CLEAR - 0.8, 0.04); F.g(bx, 0, bz + 1.4, 1.5, CLEAR - 0.8, 0.04); F.g(bx + 0.75, 0, bz + 0.7, 0.04, CLEAR - 0.8, 1.4); F.table(bx - 0.1, bz + 0.5, 0.9, 0.5, '#e9e2d3', 0.75); F.chair(bx - 0.1, bz + 1.05, Math.PI); F.b(bx, 2.4, bz + 0.7, 1.6, 0.06, 1.5, '#2e8f8a'); }
  for (const px of [-7, -5.5]) { F.table(px, -4, 0.9, 0.6, '#e9e2d3', 0.75); F.b(px, 0.75, -4, 0.7, 0.35, 0.5, '#f2f2f2'); F.scr(px, 0.95, -3.76, 0.15, 0.05, 0.02, '#38d96a'); }
  F.label({ t: 'IN ẤN • PRINT', x: -6.2, y: 2.3, z: -4.6, w: 2.2, h: 0.4, rot: 0, fg: '#fff', bg: '#34495e' });
  F.counter(24, -14, 1.2, 4, '#f1ede4', '#2e8f8a'); F.stands.push({ x: 22.5, z: -13, rot: Math.PI / 2, id: `f${f}-pantry` }, { x: 22.5, z: -15, rot: Math.PI / 2, id: `f${f}-pantry2` });
  F.stands.push({ x: 7, z: -3.5, rot: 0, id: `f${f}-chat1` }, { x: 8.2, z: -3.2, rot: Math.PI, id: `f${f}-chat2` });
  F.walkers.push({ a: [-5, 0], b: [20, 0], speed: 1.0, id: `f${f}-walk1` }, { a: [7, -15], b: [7, 15], speed: 0.9, id: `f${f}-walk2` });
  F.npcSeated = 16;
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
  F.npcSeated = 6;
  for (let i = 0; i < 3; i++) { F.b(2 + i * 1.3, 0, -8.5, 0.9, 0.9, 0.9, '#e8e8e8'); F.scr(2 + i * 1.3, 0.95, -8.5 + 0.46, 0.5, 0.35, 0.03, '#ffb03a'); } // 3D printers
  F.label({ t: '3D PRINT & ROBOTICS', x: 3.6, y: 2.3, z: -9.4, w: 4, h: 0.5, rot: 0, fg: '#fff', bg: '#34495e' });
  F.b(24.3, 0.8, -12, 0.08, 2.2, 6, '#ffffff'); F.scr(24.2, 1.0, -12, 0.04, 1.6, 4.5, '#2a7fb8'); // wall whiteboard / screen
  F.stands.push({ x: 20, z: -17, rot: Math.PI / 2, id: 'f6-lab1' }, { x: 21.2, z: -17.2, rot: -Math.PI / 2, id: 'f6-lab2' }, { x: 15, z: 7, rot: Math.PI, id: 'f6-lab3' });
  F.walkers.push({ a: [3, -3], b: [22, -3], speed: 1.0, id: 'f6-walk1' });
  F.plant(-7, 0, 1.3); F.plant(24, 2, 1.3);
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
  F.b(8, 0, 17, 30, 0.12, 14, '#5f9362');
  F.label({ t: 'SKY GARDEN', x: 8, y: 0.2, z: 10.4, w: 6, h: 1, rot: 0, flat: true, fg: '#ffffff', bg: 'rgba(0,0,0,0)' });
  for (let i = 0; i < 14; i++) F.tree(-6 + r() * 28, 11 + r() * 12, 2.5 + r() * 1.5, 0.9 + r() * 0.6, r() < 0.5 ? '#2f8a4a' : '#59b36a');
  for (let i = 0; i < 4; i++) F.b(-2 + i * 7, 0.12, 20, 2.2, 0.4, 0.6, '#c49a6c');
  F.walkers.push({ a: [0, 9], b: [24, 9], speed: 1.0, id: 'f7-walk1' }, { a: [3, 20], b: [20, 20], speed: 0.8, id: 'f7-walk2' }, { a: [-5, -20], b: [24, -20], speed: 0.7, id: 'f7-walk3' });
  // serving line: trays, food wells and a queue; garden path + planter beds
  for (let i = 0; i < 8; i++) { F.b(5 + i * 2.3, 1.05, -22.2, 0.5, 0.04, 0.35, '#cfd6d4'); F.b(5 + i * 2.3, 1.05, -22.7, 0.45, 0.14, 0.4, ['#e0a64b', '#c0392b', '#59b36a', '#f1d98a'][i % 4]); }
  F.stands.push({ x: 7, z: -20.8, rot: Math.PI, id: 'f7-q1' }, { x: 9.2, z: -20.8, rot: Math.PI, id: 'f7-q2' }, { x: 12, z: -20.8, rot: Math.PI, id: 'f7-q3' }, { x: 15.5, z: -20.8, rot: Math.PI, id: 'f7-q4' });
  for (let i = 0; i < 10; i++) F.b(-5 + i * 2.8, 0.12, 14.5, 1.3, 0.04, 0.8, '#d8d2c4'); // stepping path
  for (const z of [12, 22]) for (let i = 0; i < 6; i++) { F.b(-5 + i * 5, 0.12, z, 2.6, 0.45, 0.9, '#a8693c'); F.ball(-5 + i * 5, 0.9, z, 0.55, i % 2 ? '#3f9a55' : '#e87aa0'); }
  F.npcSit = 14;
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
  F.b(0, 2.9, -8.5, 44 / K, 0.18, 0.18, '#3aa0ff'); F.b(0, 2.6, -8.1, 44 / K, 0.18, 0.18, '#e04a3a'); F.b(0, 2.9, 8.5, 44 / K, 0.18, 0.18, '#e8c24a');
  F.b(23.5, 0, 20.5, 5, 0.06, 10, '#6b7880', 0, -0.0); // ramp apron
  F.b(23.5, 0.5, 24, 5, 0.12, 6, '#6b7880', 0, 0.2);
  F.label({ t: 'B1 • HẦM ĐỖ XE', x: 0, y: 0.04, z: 0, w: 9, h: 1.2, rot: 0, flat: true, fg: '#ffffff', bg: 'rgba(0,0,0,0)' });
  F.scr(-2.5, 2.8, 3.7, 1.2, 0.3, 0.05, '#ff5a3a');
}

export function roof(F: Furn, S: Furn) {
  const rnd = mulberry32(777), W = 2 * HX, D = 2 * HZ;
  // parapet itself is one merged mesh (facade.ts parapetGeo); here: FPT Software sign walls (logo plane added in index.tsx), planter beds, AC units, stair/lift boxes
  S.b(-9, 0, HZ + 0.3, 9, 3.2, 0.3, '#f4f6f4'); S.b(-HX - 0.3, 0, 9, 0.3, 3.2, 9, '#f4f6f4');
  for (const [x, z, w, d] of [[-14, -HZ + 1.2, 12, 1.2], [-14, HZ - 1.2, 12, 1.2], [HX - 1.2, -1, 1.2, 8], [HX - 1.2, 9, 1.2, 8]] as [number, number, number, number][]) {
    S.b(x, 0, z, w, 0.45, d, '#cfd4d1'); S.b(x, 0.45, z, w - 0.2, 0.2, d - 0.2, '#4f8f50');
    for (let i = 0; i < Math.floor(Math.max(w, d) / 1.6); i++) S.ball(x + (w > d ? -w / 2 + 0.8 + i * 1.6 : 0), 0.95, z + (w > d ? 0 : -d / 2 + 0.8 + i * 1.6), 0.4 + rnd() * 0.15, '#3f9b52');
  }
  // lift overrun + stair box + AC condensers
  F.b(-2.5, 2.35, 0, 6.6, 0.2, 8.6, '#f1f4f2');
  F.b(4.2, 0, 8.5, 3.2, 2.5, 3.2, '#e4e8e5'); F.b(4.2, 2.5, 8.5, 3.5, 0.15, 3.5, '#f1f4f2'); F.b(4.2, 0.2, 10.12, 1.0, 2.0, 0.06, '#3b4a50');
  for (let i = 0; i < 6; i++) { const x = 8 + i * 2.1; F.b(x, 0, -0.8, 1.8, 1.3, 1.1, '#b9c2c6'); F.b(x, 1.3, -0.8, 1.6, 0.05, 0.9, '#6b767b'); F.b(x, 0.2, -0.22, 1.1, 0.8, 0.04, '#2b3338'); }
  // solar panels
  for (let row = 0; row < 5; row++) for (let i = 0; i < 11; i++) {
    const x = -6 + i * 2.6, z = -23 + row * 3.4;
    F.b(x, 0.35, z, 2.2, 0.06, 1.3, '#1d3b66', 0, -0.45);
    F.b(x, 0, z + 0.25, 0.08, 0.5, 0.08, '#8a949b');
    F.b(x, 0, z - 0.25, 0.08, 0.2, 0.08, '#8a949b');
  }
  // plant room over core + AHU
  F.b(-2.5, 0, 0, 6, 2.2, 8, '#d9cdb4'); F.b(-2.5, 2.2, 0, 6.3, 0.15, 8.3, '#efe8d8');
  F.b(10, 0, -4, 3, 1.4, 2, '#9aa6ad'); F.b(15, 0, -4, 3, 1.4, 2, '#9aa6ad'); F.b(20, 0, -4, 3, 1.4, 2, '#9aa6ad');
  // sky garden on roof
  F.b(11, 0, 16, 28, 0.15, 14, '#639a66');
  F.b(11, 0.15, 16, 3, 0.03, 13, '#d8d2c4');
  for (let i = 0; i < 16; i++) F.tree(-2 + rnd() * 26, 10 + rnd() * 12, 2.6 + rnd() * 2, 1 + rnd() * 0.7, rnd() < 0.5 ? '#2f8a4a' : '#5cbf6b');
  for (let i = 0; i < 5; i++) F.b(-1 + i * 6, 0.15, 21.5, 2.2, 0.4, 0.6, '#c49a6c');
  F.label({ t: 'FRT • SKY GARDEN & SOLAR', x: 11, y: 0.25, z: 16, w: 10, h: 1, rot: 0, flat: true, fg: '#ffffff', bg: 'rgba(0,0,0,0)' });
}

export interface FloorData { lay: Furn; str: Furn }
const cache = new Map<number, FloorData>();
export function getFloor(f: number): FloorData {
  const hit = cache.get(f); if (hit) return hit;
  const lay = new Furn(), str = new Furn();
  const dept = FLOOR_DEPARTMENTS.find((d) => d.floor === f);
  const commons = FLOOR_DEPARTMENTS.filter((d) => d.role === 'COMMON').map((d) => d.floor).sort((a, b) => a - b);
  if (f === TOWER_FLOORS) roof(lay, str);
  else {
    if (f === -1) { str.solid = true; basement(lay); }
    if (f === 0) garden(str);
    shell(str, f);
    core(str, dept?.role !== 'TEAM'); // the decorative stairwell would sit inside the NHÀ THUỐC pantry
    switch (dept?.role) {
      case 'COMMON': if (f === commons[0]) lobby(lay, str); else training(lay); break;
      case 'TEAM': teamFloor(lay, str); break;
      case 'OTHER_BU': openPlan(lay, f, dept.label); break;
      case 'RND': rnd(lay); break;
      case 'ROOF': canteen(lay); break;
      default: break;
    }
  }
  const out = { lay, str };
  cache.set(f, out);
  return out;
}
