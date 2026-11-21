/** Static Meshy human figures (welcome host, receptionist, trainer). Missing files fall back to nothing. */
import React, { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { Html, useGLTF } from '@react-three/drei';
import { FLOOR_H, live, type Quality } from '../shared';
import { FT } from './furn';
import { FIGURES, type FigureSpot } from './nav';

const ROOT = `${(import.meta as any).env?.BASE_URL ?? '/'}models/meshy/`;
const exists = new Map<string, Promise<boolean>>();
const check = (url: string) => {
  let p = exists.get(url);
  if (!p) { p = fetch(url, { method: 'HEAD' }).then((r) => r.ok && !(r.headers.get('content-type') ?? '').includes('text/html')).catch(() => false); exists.set(url, p); }
  return p;
};
class Boundary extends React.Component<{ children: React.ReactNode }, { err: boolean }> {
  state = { err: false };
  static getDerivedStateFromError() { return { err: true }; }
  componentDidCatch() { /* nothing breaks if a figure is missing */ }
  render() { return this.state.err ? null : this.props.children; }
}

const Model: React.FC<{ url: string; height: number; shadow: boolean }> = ({ url, height, shadow }) => {
  const gltf = useGLTF(url, false, false) as unknown as { scene: THREE.Object3D };
  const obj = useMemo(() => {
    const o = gltf.scene.clone(true);
    const box = new THREE.Box3().setFromObject(o), size = new THREE.Vector3(), c = new THREE.Vector3();
    box.getSize(size); box.getCenter(c);
    const sc = size.y > 1e-4 ? height / size.y : 1;
    const wrap = new THREE.Group();
    o.position.set(-c.x, -box.min.y, -c.z); // feet on the floor, centred in x/z
    wrap.add(o); wrap.scale.setScalar(sc);
    o.traverse((m) => {
      const me = m as THREE.Mesh; if (!me.isMesh) return;
      me.castShadow = shadow; me.receiveShadow = true; me.frustumCulled = true;
      const mat = me.material as THREE.MeshStandardMaterial; if (mat) { mat.envMapIntensity = 0.35; mat.needsUpdate = true; }
    });
    return wrap;
  }, [gltf, height, shadow]);
  return <primitive object={obj} />;
};

const Figure: React.FC<{ f: FigureSpot; quality: Quality }> = ({ f, quality }) => {
  const [ok, setOk] = useState(false);
  const [chip, setChip] = useState(false);
  const hover = useRef(false), shown = useRef(false);
  const url = `${ROOT}${f.file}.glb`;
  useEffect(() => { let alive = true; check(url).then((v) => alive && setOk(v)); return () => { alive = false; }; }, [url]);
  useFrame(() => {
    const near = live.playerFloor === f.floor && Math.hypot(live.player.x - f.x, live.player.z - f.z) < 4;
    const want = near || hover.current;
    if (want !== shown.current) { shown.current = want; setChip(want); }
  });
  if (!ok) return null;
  return (
    <group position={[f.x, f.floor * FLOOR_H + FT, f.z]} rotation={[0, f.yaw, 0]}
      onPointerOver={(e) => { e.stopPropagation(); hover.current = true; }} onPointerOut={() => { hover.current = false; }}>
      <Boundary><Suspense fallback={null}><Model url={url} height={f.height} shadow={quality !== 'low'} /></Suspense></Boundary>
      {chip && (
        <Html position={[0, f.height + 0.3, 0]} center distanceFactor={9} zIndexRange={[20, 0]} style={{ pointerEvents: 'none' }}>
          <div style={{ padding: '2px 8px', borderRadius: 8, background: 'rgba(12,28,26,0.88)', color: '#fff', font: '600 11px system-ui', whiteSpace: 'nowrap' }}>{f.label}</div>
        </Html>
      )}
    </group>
  );
};

/** Mount only figures on visible/near floors; hidden on low quality. */
export const FiguresLayer: React.FC<{ sel: number | null; quality: Quality; near: boolean }> = ({ sel, quality, near }) => {
  if (quality === 'low') return null;
  return <>{FIGURES.filter((f) => (sel === null || sel >= f.floor) && (sel === f.floor || near)).map((f) => <Figure key={f.id} f={f} quality={quality} />)}</>;
};
