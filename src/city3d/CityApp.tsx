import React, { useEffect } from 'react';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { useProgress } from '@react-three/drei';
import { LoadingScreen } from './LoadingScreen';
import { CityWorld } from './world';
import { FrtTower } from './tower';
import { Crowd, Player, setObstacles } from './characters';
import { Atmosphere, PostFx, CameraRig, onThunder } from './atmosphere';
import { Traffic, CityAudio, setVehicleObstacles } from './vehicles';
import { buildingFootprints } from './world/layout';
import { officeSimulationEngine } from '../engine/simulationStore';
import { CityHud } from './hud';
import { useCity, cityStore, live, interior, FLOOR_H } from './shared';
import { FIGURES } from './tower/nav';

/** Exposes renderer stats on window.__city3d for profiling (cheap, 1 write/sec). */
const PerfProbe: React.FC = () => {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  React.useEffect(() => { (window as unknown as { __city3dScene?: unknown }).__city3dScene = scene; }, [scene]);
  const acc = React.useRef(0);
  React.useEffect(() => { gl.info.autoReset = false; return () => { gl.info.autoReset = true; }; }, [gl]);
  useFrame((_, dt) => {
    // runs before the frame's render: info holds the previous frame's totals (all composer passes)
    const i = gl.info;
    acc.current += dt;
    if (acc.current >= 1) {
      acc.current = 0;
      (window as unknown as { __city3d?: unknown }).__city3d = { calls: i.render.calls, triangles: i.render.triangles, geometries: i.memory.geometries, textures: i.memory.textures, dt };
    }
    i.reset();
  });
  return null;
};

/** Loader overlay: tracks three's loading manager; latches done once everything queued so far is loaded (or after a safety timeout). */
const Loader: React.FC = () => {
  const { progress, item, active } = useProgress();
  const [done, setDone] = React.useState(false);
  const [gone, setGone] = React.useState(false);
  React.useEffect(() => { if (!done && !active && progress >= 100) { const t = setTimeout(() => setDone(true), 400); return () => clearTimeout(t); } }, [active, progress, done]);
  React.useEffect(() => { const t = setTimeout(() => setDone(true), 30000); return () => clearTimeout(t); }, []);
  React.useEffect(() => { if (done) { const t = setTimeout(() => setGone(true), 700); return () => clearTimeout(t); } }, [done]);
  if (gone) return null;
  const name = item ? decodeURIComponent(item.split('/').pop() || '') : '';
  return <LoadingScreen progress={progress} label={name} done={done} />;
};

export interface CityAppProps { onExit: () => void; }
const CityApp: React.FC<CityAppProps> = ({ onExit }) => {
  const quality = useCity((s) => s.quality);
  useEffect(() => {
    /** QA helper: shot('fig:teacher'|'fig:professional'|'fig:open_arms'|'f2'|'tower'|'free', {hour, hud}) pins a deterministic camera. */
    const shot = (name: string, o: { hour?: number; hud?: boolean; dist?: number } = {}) => {
      cityStore.set({ timeOfDay: o.hour ?? 12, autoTime: false });
      const hud = document.querySelector<HTMLElement>('[data-c3d-hud]'); if (hud) hud.style.display = o.hud ? 'contents' : 'none';
      if (name === 'free') { live.debugCam = null; return 'free'; }
      if (name.startsWith('fig:')) {
        const f = FIGURES.find((g) => g.id === name.slice(4)); if (!f) return 'no such figure';
        const y = f.floor * FLOOR_H + 0.4, d = o.dist ?? 3.4;
        cityStore.set({ cameraMode: 'cutaway', selectedFloor: f.floor });
        live.debugCam = { pos: [f.x + Math.sin(f.yaw) * d, y + 1.45, f.z + Math.cos(f.yaw) * d], target: [f.x, y + f.height * 0.55, f.z], fov: 38 };
        return 'ok';
      }
      if (name === 'f2') { cityStore.set({ cameraMode: 'cutaway', selectedFloor: 1 }); live.debugCam = null; return 'ok'; }
      if (name === 'tower') { cityStore.set({ cameraMode: 'orbit', selectedFloor: null }); live.debugCam = null; return 'ok'; }
      return 'unknown';
    };
    (window as unknown as { __city3dDebug?: unknown }).__city3dDebug = { live, interior, cityStore, engine: officeSimulationEngine, shot };
    return () => { live.debugCam = null; };
  }, []);
  useEffect(() => {
    // The F-Town 3 tower is NOT an outer obstacle for walking: its walls/doors/furniture come from shared `interior`.
    setObstacles(buildingFootprints.filter((b) => !(b.cx === 0 && b.cz === 0)).map((b) => ({ x: b.cx, z: b.cz, w: b.w, d: b.d })));
    setVehicleObstacles(buildingFootprints);
    return onThunder(() => window.dispatchEvent(new Event('city3d:thunder')));
  }, []);
  return (
    <div className="absolute inset-0 z-50 bg-black">
      <Canvas shadows onPointerMissed={(e) => { if (((e as unknown as { delta?: number }).delta ?? 0) < 4) cityStore.set({ selectedFloor: null }); }} dpr={quality === 'low' ? 1 : quality === 'medium' ? [1, 1.5] : [1, 2]}
        camera={{ position: [90, 70, 90], fov: 55, near: 0.3, far: 2000 }} gl={{ antialias: true, powerPreference: 'high-performance' }}>
        <Atmosphere />
        <CityWorld />
        <FrtTower />
        <Crowd />
        <Player />
        <Traffic />
        <CameraRig />
        <PostFx />
        <PerfProbe />
      </Canvas>
      <CityAudio />
      <Loader />
      <div data-c3d-hud style={{ display: 'contents' }}><CityHud onExit={onExit} /></div>
    </div>
  );
};
export default CityApp;
