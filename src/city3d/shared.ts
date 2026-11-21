/**
 * Shared contract for the 3D City mode (GTA-inspired). ALL modules import from here.
 * Units: 1 world unit = 1 metre. Y is up. Tower is centred at (0,0,0).
 */
import { useSyncExternalStore } from 'react';

// ---------- City layout ----------
export const PITCH = 70; // distance between block centres
export const ROAD_W = 14; // road width (between blocks)
export const BLOCK_SIZE = PITCH - ROAD_W; // 56 buildable square per block
export const GRID_HALF = 3; // blocks i,j in [-GRID_HALF..GRID_HALF] => 7x7 city
export const CITY_EXTENT = (GRID_HALF + 0.5) * PITCH; // half-size of city incl. outer road
export const FLOOR_H = 3.6; // storey height
export const SIDEWALK_W = 3;
/** Block (0,0) is reserved for the FRT Tower. */
export const blockCenter = (i: number, j: number): [number, number] => [i * PITCH, j * PITCH];
/** Road centre lines lie at k*PITCH + PITCH/2 on both axes. */
export const roadLine = (k: number): number => k * PITCH + PITCH / 2;
export const ROAD_LINES: number[] = Array.from({ length: GRID_HALF * 2 + 2 }, (_, n) => roadLine(n - GRID_HALF - 1));
/** Deterministic PRNG so every module generates the same city. */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const CITY_SEED = 20261121;

// ---------- Tower contract: F-Town 3 (FPT Software HCM, Saigon Hi-Tech Park, Q9/Thu Duc) ----------
// Real facts: 7 above-ground floors + 1 basement, ~7,500 staff, "Building in the Park" concept
// (layered terrace gardens, natural light, rainforest/water-journey themes), smart building, opened 13/11/2019.
export const TOWER_FOOTPRINT = { w: 44, d: 44 }; // leaves a ~6m park ring inside the reserved block (0,0); has inner courtyard(s)
export const TOWER_FLOORS = 7; // above ground: index 0..6 == F1..F7
export const BASEMENT_FLOORS = 1; // B1 occupies y in [-FLOOR_H, 0]
/** Floor index the user's team (Khoang NHA THUOC FT3.III2A.1, 30 staff) sits on. Change here if wrong. */
export const TEAM_FLOOR = 1; // F2 (index 1) - confirmed by user
/** index -1 = B1 basement; 0..6 = F1..F7 */
export const FLOOR_DEPARTMENTS: { floor: number; label: string; name: string; role: string }[] = [
  { floor: -1, label: 'B1', name: 'Hầm xe & Kỹ thuật', role: 'BASEMENT' },
  { floor: 0, label: 'F1', name: 'Sảnh đón tiếp, Café & Lễ tân', role: 'COMMON' },
  { floor: 1, label: 'F2', name: 'Khoang NHÀ THUỐC – Phòng Lập trình (30 nhân sự)', role: 'TEAM' },
  { floor: 2, label: 'F3', name: 'Training, Phòng họp & Pantry', role: 'COMMON' },
  { floor: 3, label: 'F4', name: 'Khối phát triển phần mềm (đơn vị khác)', role: 'OTHER_BU' },
  { floor: 4, label: 'F5', name: 'Khối phát triển phần mềm (đơn vị khác)', role: 'OTHER_BU' },
  { floor: 5, label: 'F6', name: 'R&D Center & Jenkins/Server room', role: 'RND' },
  { floor: 6, label: 'F7', name: 'Sky Garden, Canteen & Sân thượng', role: 'ROOF' },
];

// ---------- Character contract ----------
export type CharacterPose = 'idle' | 'walk' | 'run' | 'sit' | 'type' | 'wave' | 'drive';
export interface CharacterAppearance {
  skin: string; hair: string; hairStyle: 'short' | 'long' | 'bun' | 'cap' | 'bald';
  top: string; bottom: string; shoes: string; accessory?: 'glasses' | 'badge' | 'headset' | 'none';
  /** Optional mascot costume (procedural). */
  mascot?: 'none' | 'longchau' | 'doraemon' | 'luffy' | 'zoro' | 'nami' | 'sanji' | 'chopper' | 'usopp';
  height?: number; // metres, default 1.75
}
/** Seeded appearance from an employee/NPC id so everyone looks stable across reloads. */
export type AppearanceFor = (id: string, role?: string) => CharacterAppearance;

// ---------- Global city store (no external dep) ----------
export type Weather = 'clear' | 'cloudy' | 'rain' | 'storm';
export type CameraMode = 'orbit' | 'follow' | 'cutaway' | 'cinematic' | 'drive';
export type Quality = 'low' | 'medium' | 'high';
export type PlayerMode = 'none' | 'walk' | 'drive';
export interface CityState {
  timeOfDay: number; // 0..24 hours
  autoTime: boolean; // advance with real clock / accelerated
  timeScale: number; // game-minutes per real second when autoTime
  weather: Weather;
  quality: Quality;
  cameraMode: CameraMode;
  selectedFloor: number | null; // cutaway: floors above this are hidden
  playerMode: PlayerMode;
  muted: boolean;
  /** Mutable live player position (read each frame via getPlayerPos; no re-render). */
}
const initial: CityState = {
  timeOfDay: 18.2, autoTime: true, timeScale: 6, weather: 'clear', quality: 'medium',
  cameraMode: 'orbit', selectedFloor: null, playerMode: 'none', muted: true,
};
let state = initial;
const listeners = new Set<() => void>();
export const cityStore = {
  get: () => state,
  set: (p: Partial<CityState>) => { state = { ...state, ...p }; listeners.forEach((l) => l()); },
  subscribe: (l: () => void) => { listeners.add(l); return () => listeners.delete(l); },
};
export function useCity<T>(sel: (s: CityState) => T): T {
  return useSyncExternalStore(cityStore.subscribe, () => sel(state));
}
/** Mutable refs updated every frame (cheap, no React re-render). */
export const live = {
  player: { x: 0, y: 0, z: 30, heading: 0, speed: 0 },
  /** Sun elevation in [-1,1], 1=noon, <0 night. Written by atmosphere, read by others (neon, lamps). */
  daylight: 1,
  /** 0..1 how dark/neon-lit things should be (inverse of daylight). */
  nightFactor: 0,
  /** 0..1 rain intensity */
  rain: 0,
  /** Floor index (-1..TOWER_FLOORS-1) the player is currently standing in inside F-Town 3, or null when outside. Written by Player. */
  playerFloor: null as number | null,
};

// ---------- Tower interior registry (filled by tower/, read by characters/ Player) ----------
export interface Rect2 { minX: number; maxX: number; minZ: number; maxZ: number }
export interface InteriorApi {
  /** set true by tower/ once the data below is valid */
  ready: boolean;
  /** standing height of a floor slab top (world y) */
  floorY: (floor: number) => number;
  /** blocking rectangles (world x/z) for a floor: exterior walls (with door gaps), atria, lift core, furniture, partitions */
  colliders: (floor: number) => Rect2[];
  /** main entrance: world position just outside and just inside the F1 door */
  entrance: { outside: [number, number]; inside: [number, number] } | null;
  /** lift pads: standing zone centre + radius; same x/z on every floor */
  lifts: { x: number; z: number; r: number }[];
  /** walkable stair flights joining two floors (optional) */
  stairs: { floorA: number; floorB: number; a: [number, number]; b: [number, number]; width: number }[];
}
export const interior: InteriorApi = {
  ready: false,
  floorY: (f) => f * FLOOR_H,
  colliders: () => [],
  entrance: null,
  lifts: [],
  stairs: [],
};
