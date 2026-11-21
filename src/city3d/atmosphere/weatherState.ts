import * as THREE from 'three';

/** Smoothed weather values shared between atmosphere sub-modules (mutable, no re-render). */
export const wx = {
  cover: 0, // 0..1 cloud cover
  dark: 0, // 0..1 storm darkness
  flash: 0, // 0..1 lightning flash envelope
  tint: new THREE.Color('#ffffff'), // cloud colour for the current time of day
  sunDir: new THREE.Vector3(0, 1, 0),
  elev: 1,
};

export interface ThunderEvent {
  /** 0..1 loudness (louder = closer strike). */
  intensity: number;
  /** Seconds between the flash and this thunder (already elapsed when the callback fires). */
  delay: number;
}
type ThunderCb = (e: ThunderEvent) => void;
const cbs = new Set<ThunderCb>();

/** Subscribe to thunder claps (fires after the visual flash, delayed by distance). Returns unsubscribe. */
export function onThunder(cb: ThunderCb): () => void {
  cbs.add(cb);
  return () => { cbs.delete(cb); };
}
export function emitThunder(e: ThunderEvent) {
  cbs.forEach((cb) => { try { cb(e); } catch { /* ignore listener errors */ } });
}
