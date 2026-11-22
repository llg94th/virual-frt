/**
 * City vegetation layer: street trees, palms, park trees, lawn bushes and flower clumps from buildPlacements().
 * One InstancedMesh per (variant, LOD) = a fixed, small number of draw calls regardless of how many trees exist.
 * Instances are re-binned into LOD 0/1/2 by camera distance (and frustum-culled by hand) a few times per second.
 * Replaces the Kenney nature tree/palm/bush/flower models (kept out of MODEL_KEYS) and the old procedural icosahedron trees.
 */
import React, { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { live, mulberry32, CITY_SEED, type Quality } from '../shared';
import { buildPlacements } from './decor';
import { getVeg, vegMaterial, vegUniforms, VARIANT_COUNT, type VegKind } from './vegetation';

interface Item { x: number; y: number; z: number; rot: number; sx: number; sy: number; tint: [number, number, number]; r: number }
interface Group { kind: VegKind; variant: number; items: Item[]; meshes: THREE.InstancedMesh[]; matrices: Float32Array; colors: Float32Array; h: number }

const KIND_OF = (key: string): VegKind | null => {
  if (/tree_palm/.test(key)) return 'palm';
  if (/\/tree_/.test(key)) return 'broad';
  if (/plant_bush/.test(key)) return 'bush';
  if (/flower_/.test(key)) return 'flower';
  return null;
};
/** LOD switch distances (m) and the cull distance */
const D0 = 38, D1 = 95, DFAR = 300;

/** QA only: window.__city3dVeg.hide(true) hides all street vegetation (to measure its draw-call / triangle cost) */
let hidden = false, dirty = false;
if (typeof window !== 'undefined') (window as unknown as { __city3dVeg?: unknown }).__city3dVeg = { hide: (h: boolean) => { hidden = h; dirty = true; } };

export const Vegetation: React.FC<{ quality: Quality }> = ({ quality }) => {
  const camera = useThree((s) => s.camera);
  const frame = React.useRef(0);
  const mat = useMemo(() => vegMaterial(), []);
  const groups = useMemo(() => {
    const rnd = mulberry32(CITY_SEED ^ 0x7ee5);
    const map = new Map<string, Group>();
    for (const p of buildPlacements()) {
      const kind = KIND_OF(p.key); if (!kind) continue;
      const u = rnd(), variant = kind === 'broad' ? (u < 0.42 ? 0 : u < 0.84 ? 1 : 2) : Math.floor(u * VARIANT_COUNT[kind]); // umbrella (pinnate) crowns are the rarest
      const v = getVeg(kind, variant), id = v.id;
      let g = map.get(id);
      if (!g) { g = { kind, variant, items: [], meshes: [], matrices: new Float32Array(0), colors: new Float32Array(0), h: v.h }; map.set(id, g); }
      const sy = (kind === 'flower' ? p.h / 0.55 : p.h / v.h) * (0.92 + rnd() * 0.16);
      const wide = kind === 'palm' ? 1 : 0.9 + rnd() * 0.25;
      const warm = rnd() < 0.18; // a few yellower / older trees
      const k = 0.84 + rnd() * 0.22;
      g.items.push({ x: p.x, y: p.y, z: p.z, rot: p.rot, sy, sx: sy * wide, tint: warm ? [k * 1.12, k * 1.0, k * 0.72] : [k * (0.92 + rnd() * 0.14), k * (0.98 + rnd() * 0.08), k * (0.86 + rnd() * 0.14)], r: v.r * sy });
    }
    const list = [...map.values()];
    const dummy = new THREE.Object3D();
    for (const g of list) {
      const n = g.items.length; g.matrices = new Float32Array(n * 16); g.colors = new Float32Array(n * 3);
      g.items.forEach((it, i) => {
        dummy.position.set(it.x, it.y, it.z); dummy.rotation.set(0, it.rot, 0); dummy.scale.set(it.sx, it.sy, it.sx); dummy.updateMatrix();
        dummy.matrix.toArray(g.matrices, i * 16); g.colors.set(it.tint, i * 3);
      });
      const v = getVeg(g.kind, g.variant);
      g.meshes = [0, 1, 2].map((l) => {
        const m = new THREE.InstancedMesh(v.geos[l], mat, n);
        m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.count = 0; m.frustumCulled = false;
        m.setColorAt(0, new THREE.Color(1, 1, 1)); m.instanceColor!.setUsage(THREE.DynamicDrawUsage);
        m.castShadow = quality === 'high' && l < 2; m.receiveShadow = true; m.matrixAutoUpdate = false;
        return m;
      });
    }
    return list;
  }, [mat, quality]);

  const tmp = useMemo(() => ({ f: new THREE.Frustum(), m: new THREE.Matrix4(), s: new THREE.Sphere(), last: new THREE.Vector3(1e9, 0, 0), lastDir: new THREE.Vector3() }), []);
  const dir = useMemo(() => new THREE.Vector3(), []);
  useFrame((st) => {
    vegUniforms.uTime.value = st.clock.elapsedTime;
    vegUniforms.uWind.value = 1 + live.rain * 1.6;
    // re-bin only when the camera moved / turned noticeably (or on the first frames)
    camera.getWorldDirection(dir);
    const moved = dirty || camera.position.distanceToSquared(tmp.last) > 2.5 || dir.distanceToSquared(tmp.lastDir) > 0.0008; dirty = false;
    if (!moved && (frame.current++ > 4)) return;
    if (moved) frame.current = 0;
    tmp.last.copy(camera.position); tmp.lastDir.copy(dir);
    tmp.m.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); tmp.f.setFromProjectionMatrix(tmp.m);
    const cp = camera.position, low = quality === 'low';
    for (const g of groups) {
      const cnt = [0, 0, 0];
      const items = g.items;
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        const dx = it.x - cp.x, dz = it.z - cp.z, dy = it.y - cp.y, d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > DFAR * DFAR) continue;
        tmp.s.center.set(it.x, it.y + g.h * it.sy * 0.5, it.z); tmp.s.radius = Math.max(it.r, g.h * it.sy * 0.55);
        if (!tmp.f.intersectsSphere(tmp.s)) continue;
        const d = Math.sqrt(d2) - it.r;
        let l = d < D0 ? 0 : d < D1 ? 1 : 2; if (low && l === 0) l = 1;
        const m = g.meshes[l];
        (m.instanceMatrix.array as Float32Array).set(g.matrices.subarray(i * 16, i * 16 + 16), cnt[l] * 16);
        (m.instanceColor!.array as Float32Array).set(g.colors.subarray(i * 3, i * 3 + 3), cnt[l] * 3);
        cnt[l]++;
      }
      for (let l = 0; l < 3; l++) {
        const m = g.meshes[l]; m.count = cnt[l];
        m.instanceMatrix.needsUpdate = true; m.instanceColor!.needsUpdate = true;
        m.visible = cnt[l] > 0 && !hidden;
      }
    }
  });
  useEffect(() => () => { groups.forEach((g) => g.meshes.forEach((m) => m.dispose())); }, [groups]);
  return <>{groups.flatMap((g) => g.meshes.map((m, i) => <primitive key={`${g.kind}${g.variant}-${i}`} object={m} />))}</>;
};
