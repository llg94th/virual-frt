import React, { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { cityStore, live, useCity, CameraMode, CITY_EXTENT, FLOOR_H, TOWER_FLOORS, TOWER_FOOTPRINT, TEAM_FLOOR } from '../shared';
import { getFloor } from '../tower/furn';
import { buildingFootprints } from '../world/layout';

const MODES: CameraMode[] = ['orbit', 'follow', 'cutaway', 'cinematic', 'drive'];
const V3 = THREE.Vector3;
const damp = THREE.MathUtils.damp;
const dampV = (v: THREE.Vector3, to: THREE.Vector3, l: number, dt: number) => {
  v.x = damp(v.x, to.x, l, dt); v.y = damp(v.y, to.y, l, dt); v.z = damp(v.z, to.z, l, dt);
};

const CINE_POINTS: [number, number, number][] = [
  [240, 130, 240], [250, 60, 90], [175, 24, 35], [60, 14, 35], [-45, 20, 80], [-120, 45, 150],
  [-230, 90, 60], [-200, 32, -105], [-90, 75, -190], [30, 26, -110], [130, 50, -170], [255, 95, -120],
];

const TW = Math.max(TOWER_FOOTPRINT.w, TOWER_FOOTPRINT.d);
let teamCentre: [number, number] | null = null;
function teamBay(): [number, number] {
  if (teamCentre) return teamCentre;
  let x = 0, z = 0;
  try {
    const t = getFloor(TEAM_FLOOR).str.team;
    if (t.length) { x = t.reduce((a, q) => a + q.x, 0) / t.length; z = t.reduce((a, q) => a + q.z, 0) / t.length; }
  } catch { /* fall back to tower centre */ }
  return (teamCentre = [x, z]);
}
const CUT_POLAR = 0.99; // ~57 deg from vertical
function cutawayTarget(floor: number | null): { target: THREE.Vector3; dist: number } {
  if (floor == null) return { target: new V3(0, 20, 0), dist: Math.max(150, TW * 3.1) };
  const [bx, bz] = floor === TEAM_FLOOR ? teamBay() : [0, 0];
  return { target: new V3(bx, floor * FLOOR_H + FLOOR_H * 0.5, bz), dist: 50 };
}

const CLEAR = 6;
/** Minimum safe camera altitude at (x,z): above any building within CLEAR metres of its footprint. */
function minAltitude(x: number, z: number): number {
  let y = 3;
  for (const f of buildingFootprints) {
    if (Math.abs(x - f.cx) < f.w / 2 + CLEAR && Math.abs(z - f.cz) < f.d / 2 + CLEAR) y = Math.max(y, f.h + 10);
  }
  return y;
}
/** Resample the spline, lift it above rooftops where it crosses buildings, and keep it smooth/closed. */
function buildSafeCurve(): THREE.CatmullRomCurve3 {
  const raw = new THREE.CatmullRomCurve3(CINE_POINTS.map((p) => new V3(...p)), true, 'centripetal');
  const N = 192;
  const pts = Array.from({ length: N }, (_, i) => raw.getPointAt(i / N));
  const req = pts.map((p) => minAltitude(p.x, p.z));
  // also pad requirement along the path so the lift is anticipated early
  const padded = req.map((_, i) => { let m = req[i]; for (let k = -6; k <= 6; k++) m = Math.max(m, req[(i + k + N) % N]); return m; });
  let ys = pts.map((p, i) => Math.max(p.y, padded[i]));
  for (let it = 0; it < 4; it++) {
    ys = ys.map((_, i) => { let a = 0; for (let k = -4; k <= 4; k++) a += ys[(i + k + N) % N]; return Math.max(a / 9, padded[i]); });
  }
  const out: THREE.Vector3[] = [];
  for (let i = 0; i < N; i += 4) out.push(new V3(pts[i].x, ys[i], pts[i].z));
  return new THREE.CatmullRomCurve3(out, true, 'centripetal');
}

export const CameraRig: React.FC = () => {
  const mode = useCity((s) => s.cameraMode);
  const selectedFloor = useCity((s) => s.selectedFloor);
  const { camera, gl } = useThree();
  const controls = useRef<any>(null);
  const curve = useMemo(buildSafeCurve, []);

  const S = useRef({
    mode, look: new V3(0, 20, 0), enterT: 0,
    trans: { active: false, t: 0, pos: new V3(), target: new V3() },
    yawOff: 0, pitchOff: 0, dragging: false, lastDrag: -10, dist: 6.5, fov: 55, cin: 0, time: 0,
  });
  S.current.mode = mode;

  // ---- mode / floor change: set up transition ----
  const floorKey = mode === 'cutaway' ? selectedFloor : -2;
  useEffect(() => {
    const s = S.current;
    s.enterT = 0;
    if (mode === 'orbit' || mode === 'cutaway') {
      const from = s.look.clone();
      let target: THREE.Vector3, dist: number;
      if (mode === 'cutaway') ({ target, dist } = cutawayTarget(selectedFloor));
      else { target = new V3(0, 20, 0); dist = THREE.MathUtils.clamp(camera.position.distanceTo(target), 90, 450); }
      const dir = camera.position.clone().sub(from);
      if (dir.lengthSq() < 1) dir.set(1, 0.6, 1);
      dir.normalize();
      const hl = Math.hypot(dir.x, dir.z) || 1;
      if (mode === 'cutaway' && selectedFloor != null) {
        // look down into the cut floor at ~57deg from vertical, keep current yaw
        dir.set((dir.x / hl) * Math.sin(CUT_POLAR), Math.cos(CUT_POLAR), (dir.z / hl) * Math.sin(CUT_POLAR));
      } else if (dir.y < 0.18 * hl) { dir.y = 0.18 * hl; dir.normalize(); }
      s.trans.pos.copy(target).addScaledVector(dir, dist);
      s.trans.pos.y = Math.max(s.trans.pos.y, selectedFloor != null && mode === 'cutaway' ? 1 : 8);
      s.trans.target.copy(target);
      s.trans.active = true; s.trans.t = 0;
    } else {
      s.trans.active = false;
      if (mode === 'cinematic') {
        // start the spline near where the camera currently is
        let best = 0, bd = Infinity;
        for (let i = 0; i < 40; i++) { const d = curve.getPointAt(i / 40).distanceToSquared(camera.position); if (d < bd) { bd = d; best = i / 40; } }
        s.cin = best;
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, floorKey]);

  // ---- C key cycles cameras ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const isC = e.key === 'c' || e.key === 'C';
      const dFloor = e.key === ']' || e.key === 'PageUp' ? 1 : e.key === '[' || e.key === 'PageDown' ? -1 : 0;
      if (!isC && !dFloor) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if (dFloor) {
        const sf = cityStore.get().selectedFloor;
        if (sf == null) return;
        e.preventDefault();
        cityStore.set({ selectedFloor: Math.max(-1, Math.min(TOWER_FLOORS - 1, sf + dFloor)) });
        return;
      }
      const cur = cityStore.get().cameraMode;
      cityStore.set({ cameraMode: MODES[(MODES.indexOf(cur) + 1) % MODES.length] });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ---- drag-to-orbit + wheel zoom for chase modes ----
  useEffect(() => {
    if (mode !== 'follow' && mode !== 'drive') return;
    const el = gl.domElement; const s = S.current;
    let lx = 0, ly = 0;
    const move = (e: PointerEvent) => {
      s.yawOff -= (e.clientX - lx) * 0.006;
      s.pitchOff = THREE.MathUtils.clamp(s.pitchOff + (e.clientY - ly) * 0.004, -0.2, 1.0);
      lx = e.clientX; ly = e.clientY; s.lastDrag = s.time;
    };
    const up = () => { s.dragging = false; window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    const down = (e: PointerEvent) => { s.dragging = true; lx = e.clientX; ly = e.clientY; window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); };
    const wheel = (e: WheelEvent) => { s.dist = THREE.MathUtils.clamp(s.dist * (1 + Math.sign(e.deltaY) * 0.08), 3, 18); };
    el.addEventListener('pointerdown', down); el.addEventListener('wheel', wheel, { passive: true });
    return () => { el.removeEventListener('pointerdown', down); el.removeEventListener('wheel', wheel); up(); };
  }, [mode, gl]);

  const _p = useMemo(() => ({ pos: new V3(), look: new V3(), fwd: new V3(), a: new V3() }), []);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const s = S.current; const cam = camera as THREE.PerspectiveCamera;
    const m = s.mode; s.time += dt; s.enterT += dt;
    const c = controls.current;
    let wantFov = 55;

    if (m === 'orbit' || m === 'cutaway') {
      if (!c) return;
      if (s.trans.active) {
        c.enabled = false;
        const tr = s.trans;
        const l = 3.2;
        dampV(cam.position, tr.pos, l, dt); dampV(s.look, tr.target, l, dt);
        c.target.copy(s.look); cam.lookAt(s.look);
        tr.t += dt;
        if ((tr.t > 0.4 && cam.position.distanceTo(tr.pos) < 1 && s.look.distanceTo(tr.target) < 0.5) || tr.t > 3) {
          tr.active = false; c.target.copy(s.look); c.update();
        }
      } else {
        c.enabled = true;
        c.target.x = THREE.MathUtils.clamp(c.target.x, -CITY_EXTENT, CITY_EXTENT);
        c.target.z = THREE.MathUtils.clamp(c.target.z, -CITY_EXTENT, CITY_EXTENT);
        c.target.y = THREE.MathUtils.clamp(c.target.y, -6, 200);
        if (cam.position.y < 1.5 && !(m === 'cutaway' && cityStore.get().selectedFloor === -1)) cam.position.y = 1.5;
        s.look.copy(c.target);
      }
    } else {
      if (c) c.enabled = false;
      const blend = THREE.MathUtils.smoothstep(s.enterT, 0, 1.6);
      const { pos, look, fwd, a } = _p;
      if (m === 'follow' || m === 'drive') {
        const p = live.player; const drive = m === 'drive';
        if (!s.dragging && s.time - s.lastDrag > (drive ? 1.2 : 2.5)) {
          s.yawOff = damp(s.yawOff, 0, 1.6, dt); s.pitchOff = damp(s.pitchOff, 0, 1.6, dt);
        }
        const speed = Math.abs(p.speed);
        const dist = drive ? Math.min(14, 9 + speed * 0.06) * (s.dist / 6.5) : s.dist;
        const yaw = p.heading + Math.PI + s.yawOff;
        const pitch = (drive ? 0.2 : 0.24) + s.pitchOff;
        pos.set(p.x + Math.sin(yaw) * dist * Math.cos(pitch), p.y + (drive ? 1.2 : 1.5) + Math.sin(pitch) * dist, p.z + Math.cos(yaw) * dist * Math.cos(pitch));
        pos.y = Math.max(pos.y, 0.6);
        fwd.set(Math.sin(p.heading), 0, Math.cos(p.heading));
        look.set(p.x, p.y + (drive ? 1.3 : 1.5), p.z).addScaledVector(fwd, drive ? 5 + speed * 0.12 : 2);
        const lp = THREE.MathUtils.lerp(2.2, drive ? 6 : 5, blend);
        dampV(cam.position, pos, lp, dt); dampV(s.look, look, lp + 2, dt);
        wantFov = drive ? 60 + Math.min(speed, 45) * 0.5 : 55;
      } else {
        // cinematic
        s.cin = (s.cin + dt / 120) % 1;
        const u = s.cin;
        curve.getPointAt(u, pos);
        pos.y += Math.sin(s.time * 0.7) * 0.8;
        pos.y = Math.max(pos.y, minAltitude(pos.x, pos.z));
        curve.getPointAt((u + 0.035) % 1, a);
        look.set(0, 22, 0).lerp(a.setY(a.y * 0.3), 0.25 + 0.2 * Math.sin(u * Math.PI * 6));
        const lp = THREE.MathUtils.lerp(1.2, 3, blend);
        dampV(cam.position, pos, lp, dt); dampV(s.look, look, lp, dt);
        wantFov = 38 + 6 * Math.sin(u * Math.PI * 4);
      }
      cam.lookAt(s.look);
    }

    s.fov = damp(s.fov, wantFov, 3, dt);
    if (Math.abs(cam.fov - s.fov) > 0.01) { cam.fov = s.fov; cam.updateProjectionMatrix(); }
  });

  return (
    <OrbitControls
      ref={controls}
      enableDamping dampingFactor={0.08} rotateSpeed={0.6} zoomSpeed={0.9} panSpeed={0.8}
      screenSpacePanning={false}
      minDistance={mode === 'cutaway' ? 8 : 25} maxDistance={mode === 'cutaway' ? 260 : 650}
      minPolarAngle={0.12} maxPolarAngle={Math.PI / 2 - 0.04}
    />
  );
};
