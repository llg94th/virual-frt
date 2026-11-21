/**
 * Long Chau mascot: loads the Meshy GLB if it exists (public/models/longchau.glb), otherwise falls back to the
 * procedural Character3D 'longchau' mascot. Auto-normalised to a target height via bounding box.
 */
import React, { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import { FLOOR_H } from '../shared';
import { Character3D, appearanceFor } from '../characters';
import { FT, K } from './furn';

export const LONGCHAU_URL = `${(import.meta as any).env?.BASE_URL ?? '/'}models/longchau.glb`;

const exists = new Map<string, Promise<boolean>>();
function checkExists(url: string): Promise<boolean> {
  let p = exists.get(url);
  if (!p) {
    p = fetch(url, { method: 'HEAD' })
      .then((r) => r.ok && !(r.headers.get('content-type') ?? '').includes('text/html'))
      .catch(() => false);
    exists.set(url, p);
  }
  return p;
}

class Boundary extends React.Component<{ fallback: React.ReactNode; children: React.ReactNode }, { err: boolean }> {
  state = { err: false };
  static getDerivedStateFromError() { return { err: true }; }
  componentDidCatch() { /* fall back silently */ }
  render() { return this.state.err ? this.props.fallback : this.props.children; }
}

const Glb: React.FC<{ url: string; height: number }> = ({ url, height }) => {
  const gltf = useGLTF(url) as unknown as { scene: THREE.Object3D };
  const { obj, scale } = useMemo(() => {
    const o = gltf.scene.clone(true);
    const box = new THREE.Box3().setFromObject(o); const size = new THREE.Vector3(); box.getSize(size);
    const sc = size.y > 1e-4 ? height / size.y : 1;
    const c = new THREE.Vector3(); box.getCenter(c);
    o.position.set(-c.x, -box.min.y, -c.z); // origin at bottom-centre
    o.traverse((m) => { const me = m as THREE.Mesh; if (me.isMesh) { me.castShadow = true; me.frustumCulled = true; } });
    return { obj: o, scale: sc };
  }, [gltf, height]);
  return <group scale={scale}><primitive object={obj} /></group>;
};

const Fallback: React.FC = () => {
  const look = useMemo(() => ({ ...appearanceFor('longchau-greeter'), mascot: 'longchau' as const }), []);
  return <Character3D appearance={look} pose="wave" />;
};

/** Reusable: GLB when available, else procedural mascot. Origin at feet. */
export const LongChauModel: React.FC<{ height?: number; url?: string } & Omit<React.ComponentProps<'group'>, 'ref'>> = ({ height = 1.8, url = LONGCHAU_URL, ...rest }) => {
  const [ok, setOk] = useState<boolean | null>(null);
  useEffect(() => { let live = true; checkExists(url).then((v) => live && setOk(v)); return () => { live = false; }; }, [url]);
  return (
    <group {...rest}>
      {ok === true ? (
        <Boundary fallback={<Fallback />}><Suspense fallback={<Fallback />}><Glb url={url} height={height} /></Suspense></Boundary>
      ) : <Fallback />}
    </group>
  );
};

/** Greeter in the F1 lobby beside reception, gentle bob + sway. */
export const LongChauGreeter: React.FC = () => {
  const g = useRef<THREE.Group>(null!);
  useFrame(({ clock }) => {
    if (!g.current) return;
    const t = clock.elapsedTime;
    g.current.position.y = FT + Math.abs(Math.sin(t * 1.6)) * 0.05;
    g.current.rotation.y = -0.45 + Math.sin(t * 0.5) * 0.35;
  });
  void FLOOR_H;
  return <group ref={g} position={[8.5, FT, 17.6]}><LongChauModel height={1.8} /></group>;
};
