import React, { useEffect } from 'react';
import { Canvas } from '@react-three/fiber';
import { CityWorld } from './world';
import { FrtTower } from './tower';
import { Crowd, Player, setObstacles } from './characters';
import { Atmosphere, PostFx, CameraRig, onThunder } from './atmosphere';
import { Traffic, CityAudio, setVehicleObstacles } from './vehicles';
import { buildingFootprints } from './world/layout';
import { CityHud } from './hud';
import { useCity, cityStore } from './shared';

export interface CityAppProps { onExit: () => void; }
const CityApp: React.FC<CityAppProps> = ({ onExit }) => {
  const quality = useCity((s) => s.quality);
  useEffect(() => {
    setObstacles(buildingFootprints.map((b) => ({ x: b.cx, z: b.cz, w: b.w, d: b.d })));
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
      </Canvas>
      <CityAudio />
      <CityHud onExit={onExit} />
    </div>
  );
};
export default CityApp;
