/** Vietnamese street-life + ground detail: bikes, cafe sets, carts, banners, cables, tree pits, kerbs, manholes (all instanced/merged). */
import React, { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { PITCH, ROAD_LINES, CITY_EXTENT, ROAD_W, mulberry32, CITY_SEED, live } from '../shared';
import { bikes, cafes, carts, banners, cableLinks, trees } from './layout';
import { GeoBuilder } from './builder';
import { makeBannerAtlas } from './materials';

const D = new THREE.Object3D();
function inst(geo: THREE.BufferGeometry, mat: THREE.Material, n: number, fn: (i: number, o: THREE.Object3D, c: THREE.Color) => void) {
  const m = new THREE.InstancedMesh(geo, mat, n); const c = new THREE.Color();
  for (let i = 0; i < n; i++) {
    D.position.set(0, 0, 0); D.rotation.set(0, 0, 0); D.scale.set(1, 1, 1); c.setRGB(1, 1, 1);
    fn(i, D, c); D.updateMatrix(); m.setMatrixAt(i, D.matrix); m.setColorAt(i, c);
  }
  m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true;
  m.frustumCulled = false; m.matrixAutoUpdate = false; m.receiveShadow = true; return m;
}
const cyl = (g: GeoBuilder, r: number, h: number, x: number, y: number, z: number, c: number[], rotZ = false, seg = 8) => {
  const cg = new THREE.CylinderGeometry(r, r, h, seg); if (rotZ) cg.rotateZ(Math.PI / 2);
  g.geo(cg, new THREE.Matrix4().makeTranslation(x, y, z), c); cg.dispose();
};
function bikeGeo() {
  const g = new GeoBuilder();
  cyl(g, 0.28, 0.1, 0, 0.28, 0.65, [0.05, 0.05, 0.05], true); cyl(g, 0.28, 0.1, 0, 0.28, -0.65, [0.05, 0.05, 0.05], true);
  g.box(0, 0.3, -0.1, 0.34, 0.4, 0.8, [0.95, 0.95, 0.95]); g.box(0, 0.62, -0.35, 0.32, 0.1, 0.55, [0.1, 0.1, 0.1]);
  g.box(0, 0.35, 0.55, 0.12, 0.6, 0.12, [0.4, 0.4, 0.42]); g.box(0, 0.98, 0.55, 0.62, 0.06, 0.06, [0.15, 0.15, 0.15]);
  g.box(0, 0.5, 0.45, 0.3, 0.3, 0.25, [0.95, 0.95, 0.95]);
  return g.build();
}
function cafeGeo() {
  const g = new GeoBuilder();
  cyl(g, 0.04, 2.3, 0, 1.15, 0, [0.5, 0.5, 0.5], false, 5); cyl(g, 0.55, 0.05, 0, 0.78, 0, [0.4, 0.3, 0.2]); cyl(g, 0.06, 0.78, 0, 0.39, 0, [0.3, 0.3, 0.3], false, 5);
  const cone = new THREE.ConeGeometry(1.7, 0.55, 8); g.geo(cone, new THREE.Matrix4().makeTranslation(0, 2.55, 0), [1, 1, 1]); cone.dispose();
  for (let k = 0; k < 3; k++) { const a = k * 2.1; cyl(g, 0.22, 0.45, Math.cos(a) * 1.0, 0.22, Math.sin(a) * 1.0, [0.2, 0.2, 0.22]); }
  return g.build();
}
function cartGeo() {
  const g = new GeoBuilder();
  g.box(0, 0.45, 0, 1.5, 0.8, 0.85, [0.95, 0.95, 0.95]);
  cyl(g, 0.3, 0.08, 0.45, 0.3, 0.5, [0.1, 0.1, 0.1], true); cyl(g, 0.3, 0.08, -0.45, 0.3, 0.5, [0.1, 0.1, 0.1], true);
  g.box(0, 1.25, 0, 1.7, 0.7, 0.04, [0.8, 0.8, 0.8], 0, 0); // back panel
  g.box(0, 2.0, 0, 1.9, 0.08, 1.4, [1, 1, 1]);
  for (const [x, z] of [[-0.8, -0.5], [0.8, -0.5], [-0.8, 0.5], [0.8, 0.5]]) g.box(x, 0.85, z, 0.05, 1.15, 0.05, [0.3, 0.3, 0.3]);
  g.box(-0.3, 0.85, 0.1, 0.4, 0.25, 0.4, [0.9, 0.6, 0.1]); g.box(0.3, 0.85, 0.1, 0.4, 0.25, 0.4, [0.8, 0.15, 0.15]);
  return g.build();
}

export const Life: React.FC<{ win: THREE.Material; quality: string }> = ({ win, quality }) => {
  const banner = useMemo(() => {
    const tex = makeBannerAtlas();
    return new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0.1, roughness: 0.7, side: THREE.DoubleSide });
  }, []);
  const objs = useMemo(() => {
    const out: THREE.Object3D[] = [];
    const r = mulberry32(CITY_SEED ^ 0x1f3);
    const hi = quality !== 'low';
    out.push(inst(bikeGeo(), win, bikes.length, (i, o, c) => { o.position.set(bikes[i].x, 0.18, bikes[i].z); o.rotation.y = bikes[i].rot; c.setRGB(...bikes[i].c); }));
    if (hi) {
      out.push(inst(cafeGeo(), win, cafes.length, (i, o, c) => { o.position.set(cafes[i].x, 0.18, cafes[i].z); c.setRGB(...cafes[i].c); }));
      out.push(inst(cartGeo(), win, carts.length, (i, o, c) => { o.position.set(carts[i].x, 0.18, carts[i].z); o.rotation.y = carts[i].rot; c.setRGB(...carts[i].c); }));
    }
    // ground detail
    const flat = new THREE.MeshStandardMaterial({ roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
    const unit = new THREE.BoxGeometry(1, 0.02, 1);
    const pits = trees.filter((t) => { if (t.s < 0.5) return false; const dx = Math.abs(t.x - Math.round(t.x / PITCH) * PITCH), dz = Math.abs(t.z - Math.round(t.z / PITCH) * PITCH); const m = Math.max(dx, dz); return m > 25.5 && m < 28; });
    out.push(inst(unit, flat, pits.length, (i, o, c) => { o.position.set(pits[i].x, 0.19, pits[i].z); o.scale.set(1.3, 1, 1.3); c.setRGB(0.28, 0.24, 0.2); }));
    const kerbs: [number, number, number, number, number][] = [];
    for (let bi = -3; bi <= 3; bi++) for (let bj = -3; bj <= 3; bj++) for (const s of [-1, 1]) {
      kerbs.push([bi * PITCH, bj * PITCH + s * 27.85, 56, 0.3, 0.8], [bi * PITCH + s * 27.85, bj * PITCH, 0.3, 56, 0.8]);
      kerbs.push([bi * PITCH, bj * PITCH + s * 28.25, 56, 0.35, 0.1], [bi * PITCH + s * 28.25, bj * PITCH, 0.35, 56, 0.1]);
    }
    out.push(inst(unit, flat, kerbs.length, (i, o, c) => { const k = kerbs[i]; o.position.set(k[0], 0.19, k[1]); o.scale.set(k[2], 1, k[3]); if (k[4] < 0.5) { o.position.y = 0.02; } c.setRGB(k[4], k[4], k[4] * 0.97); }));
    const spots: [number, number, number, number][] = []; // x,z,rotY,kind
    for (let k = 0; k < 260; k++) {
      const L = ROAD_LINES[Math.floor(r() * ROAD_LINES.length)], seg = Math.floor(r() * (ROAD_LINES.length - 1));
      const t = ROAD_LINES[seg] + 14 + r() * (PITCH - 28), off = (r() - 0.5) * (ROAD_W - 3);
      const alongX = r() < 0.5;
      spots.push([alongX ? t : L + off, alongX ? L + off : t, alongX ? 0 : Math.PI / 2, k < 130 ? 0 : 1]);
    }
    const mh = spots.filter((s) => s[3] === 0), pt = spots.filter((s) => s[3] === 1);
    out.push(inst(new THREE.CylinderGeometry(0.5, 0.5, 0.02, 10), flat, mh.length, (i, o, c) => { o.position.set(mh[i][0], 0.03, mh[i][1]); c.setRGB(0.1, 0.1, 0.11); }));
    out.push(inst(unit, flat, pt.length, (i, o, c) => { o.position.set(pt[i][0], 0.025, pt[i][1]); o.rotation.y = pt[i][2]; o.scale.set(1.2 + (i % 3) * 0.7, 1, 1 + (i % 2) * 0.6); const v = 0.1 + (i % 4) * 0.03; c.setRGB(v, v, v + 0.01); }));
    // banners on lamp poles
    const pos: number[] = [], uv: number[] = [], idx: number[] = [], nor: number[] = [];
    banners.forEach((b, n) => {
      const tx = -b.oz, tz = b.ox, cx = b.x + b.ox * 0.55, cz = b.z + b.oz * 0.55;
      const u0 = b.cell / 6, u1 = (b.cell + 1) / 6;
      for (const [ls, ly, u, v] of [[-1, 3.0, u0, 0], [1, 3.0, u1, 0], [1, 5.4, u1, 1], [-1, 5.4, u0, 1]] as [number, number, number, number][]) {
        pos.push(cx + b.ox * ls * 0.45, ly, cz + b.oz * ls * 0.45); nor.push(tx, 0, tz); uv.push(u, v);
      }
      idx.push(n * 4, n * 4 + 1, n * 4 + 2, n * 4, n * 4 + 2, n * 4 + 3);
    });
    const bg = new THREE.BufferGeometry();
    bg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); bg.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    bg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); bg.setIndex(idx);
    out.push(new THREE.Mesh(bg, banner));
    // overhead cable bundles
    const lp: number[] = [];
    for (const [x1, z1, x2, z2] of cableLinks) {
      const len = Math.hypot(x2 - x1, z2 - z1);
      for (let w = 0; w < 3; w++) {
        const y0 = 6.8 - w * 0.22, sag = 0.12 * len / 4 * (0.8 + 0.2 * w);
        for (let k = 0; k < 6; k++) {
          const a = k / 6, b = (k + 1) / 6;
          lp.push(x1 + (x2 - x1) * a, y0 - sag * 4 * a * (1 - a), z1 + (z2 - z1) * a, x1 + (x2 - x1) * b, y0 - sag * 4 * b * (1 - b), z1 + (z2 - z1) * b);
        }
      }
    }
    const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3));
    const lines = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0x15171a })); lines.frustumCulled = false; out.push(lines);
    void CITY_EXTENT;
    return out;
  }, [win, quality]);
  useFrame(() => { banner.emissiveIntensity = 0.1 + live.nightFactor * 0.7; });
  useEffect(() => () => { objs.forEach((o) => (o as THREE.Mesh).geometry?.dispose()); }, [objs]);
  return <>{objs.map((o, i) => <primitive key={i} object={o} />)}</>;
};
