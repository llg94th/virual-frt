/**
 * Small helpers shared by the character code: error boundary and the per-frame view frustum used to freeze off-screen animation.
 * (The old Quaternius / Meshy / RPM rigs were removed: every human is the boy in boy.tsx.)
 */
import React from 'react';
import * as THREE from 'three';

export class RigBoundary extends React.Component<{ children: React.ReactNode; onError?: () => void; fallback?: React.ReactNode }, { bad: boolean }> {
  state = { bad: false };
  static getDerivedStateFromError() { return { bad: true }; }
  componentDidCatch() { this.props.onError?.(); }
  render() { return this.state.bad ? (this.props.fallback ?? null) : this.props.children; }
}

const frustum = new THREE.Frustum(), pv = new THREE.Matrix4(), sph = new THREE.Sphere();
let lastFrame = -1;
/** Called from characters' useFrame; refreshes the view frustum once per rendered frame. */
export function rigTick(camera: THREE.Camera, frame: number) {
  if (frame === lastFrame) return;
  lastFrame = frame;
  pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  frustum.setFromProjectionMatrix(pv);
}
export const inView = (x: number, y: number, z: number) => { sph.center.set(x, y, z); sph.radius = 1.3; return frustum.intersectsSphere(sph); };
