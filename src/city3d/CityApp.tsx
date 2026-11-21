import React, { useEffect } from 'react';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { CityWorld } from './world';
import { FrtTower } from './tower';
import { Crowd, Player, setObstacles } from './characters';
import { Atmosphere, PostFx, CameraRig, onThunder } from './atmosphere';
import { Traffic, CityAudio, setVehicleObstacles } from './vehicles';
import { buildingFootprints } from './world/layout';
import { officeSimulationEngine } from '../engine/simulationStore';
import { CityHud } from './hud';
import { useCity, cityStore, live, interior } from './shared';

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

export interface CityAppProps { onExit: () => void; }
const CityApp: React.FC<CityAppProps> = ({ onExit }) => {
  const quality = useCity((s) => s.quality);
  useEffect(() => { (window as unknown as { __city3dDebug?: unknown }).__city3dDebug = { live, interior, cityStore, engine: officeSimulationEngine }; }, []);
  useEffect(() => {
    // The F-Town 3 tower is NOT an outer obstacle for walking: its walls/doors/furniture come from shared `interior`.
    setObstacles(buildingFootprints.filter((b) => !(b.cx === 0 && b.cz === 0)).map((b) => ({ x: b.cx, z: b.cz, w: b.w, d: b.d })));
    setVehicleObstacles(buildingFootprints);
    return onThunder(() => window.dispatchEvent(new Event('city3d:thunder')));
  }, []);
  return (
    <div className="absolute inset-0 z-50 bg-black">
      <Canvas shadows onPointerMissed={() => cityStore.set({ selectedFloor: null })} dpr={quality === 'low' ? 1 : quality === 'medium' ? [1, 1.5] : [1, 2]}
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
      <CityHud onExit={onExit} />
    </div>
  );
};
export default CityApp;
