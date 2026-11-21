import React, { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import {
  PITCH, BLOCK_SIZE, GRID_HALF, ROAD_W, CITY_EXTENT, ROAD_LINES, SIDEWALK_W, live, useCity, type Quality,
} from '../shared';
import {
  buildings, blockKind, PARK_BLOCK, lamps, trees, POND, PLAZA, buildingFootprints, isOnRoad,
} from './layout';
import { buildBlockGeometry, buildProps } from './geometry';
import { createWindowMaterial, winUniforms, makeAsphaltTexture, makeSignAtlas } from './materials';

export { buildingFootprints, isOnRoad };
export * from './layout';

const D = new THREE.Object3D();
const H_ROAD = ROAD_W / 2;

function instanced(geo: THREE.BufferGeometry, mat: THREE.Material, n: number, fn: (i: number, o: THREE.Object3D, col: THREE.Color) => void, colors = false) {
  const m = new THREE.InstancedMesh(geo, mat, n);
  const col = new THREE.Color();
  for (let i = 0; i < n; i++) {
    D.position.set(0, 0, 0); D.rotation.set(0, 0, 0); D.scale.set(1, 1, 1);
    fn(i, D, col); D.updateMatrix(); m.setMatrixAt(i, D.matrix);
    if (colors) m.setColorAt(i, col);
  }
  m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true;
  m.frustumCulled = false; m.matrixAutoUpdate = false;
  return m;
}

/** Flat road paint: [x, z, sx, sz]. */
function paintLists() {
  const white: number[][] = [], yellow: number[][] = [], zebra: number[][] = [];
  const lim = CITY_EXTENT + H_ROAD - 1;
  for (const L of ROAD_LINES) {
    for (let a = 0; a < ROAD_LINES.length - 1; a++) {
      const t0 = ROAD_LINES[a] + 12.5, t1 = ROAD_LINES[a + 1] - 12.5, len = t1 - t0, mid = (t0 + t1) / 2;
      for (const axis of [0, 1]) {
        const P = (t: number, o: number, sl: number, sw: number, list: number[][]) =>
          list.push(axis === 0 ? [t, L + o, sl, sw] : [L + o, t, sw, sl]);
        for (const o of [-0.25, 0.25]) P(mid, o, len, 0.16, yellow);
        for (const o of [-6.6, 6.6]) P(mid, o, len, 0.15, white);
        for (const o of [-3.5, 3.5]) for (let t = t0 + 1.5; t < t1 - 1.5; t += 6) P(t + 1.5, o, 3, 0.15, white);
      }
    }
    for (const c of ROAD_LINES) for (const sgn of [-1, 1]) {
      const t = c + sgn * 9.5; if (Math.abs(t) > lim) continue;
      for (let o = -5.6; o <= 5.7; o += 1.6) { zebra.push([t, L + o, 3, 0.8]); zebra.push([L + o, t, 0.8, 3]); }
    }
  }
  // mid-block pedestrian crossing from the tower's south forecourt across the road
  for (let o = -5.6; o <= 5.7; o += 1.6) zebra.push([0, PLAZA.crosswalkZ + o, 3.2, 0.8]);
  return { white, yellow, zebra };
}

const mats = () => {
  const asphaltTex = makeAsphaltTexture(); asphaltTex.repeat.set(63, 63);
  const sign = makeSignAtlas();
  return {
    asphaltTex, signTex: sign,
    ground: new THREE.MeshStandardMaterial({ color: new THREE.Color(0.1, 0.15, 0.1), roughness: 1 }),
    asphalt: new THREE.MeshStandardMaterial({ map: asphaltTex, roughness: 0.92, metalness: 0 }),
    slab: new THREE.MeshStandardMaterial({ roughness: 0.9 }),
    paint: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    yellow: new THREE.MeshStandardMaterial({ color: 0xf2c200, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    win: createWindowMaterial(),
    sign: new THREE.MeshStandardMaterial({ map: sign, emissiveMap: sign, emissive: 0xffffff, emissiveIntensity: 0.15, roughness: 0.6 }),
    pole: new THREE.MeshStandardMaterial({ color: 0x2a2d31, roughness: 0.6, metalness: 0.5 }),
    head: new THREE.MeshStandardMaterial({ color: 0x222222, emissive: new THREE.Color(1, 0.8, 0.5), emissiveIntensity: 0 }),
    pool: new THREE.MeshBasicMaterial({ map: null, color: new THREE.Color(1, 0.75, 0.4), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }),
    trunk: new THREE.MeshStandardMaterial({ color: 0x5a3d26, roughness: 1 }),
    leaf: new THREE.MeshStandardMaterial({ roughness: 0.95, flatShading: true }),
    water: new THREE.MeshStandardMaterial({ color: 0x1d5f86, roughness: 0.05, metalness: 0.3 }),
  };
};
type Mats = ReturnType<typeof mats>;

function poolTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const x = c.getContext('2d')!; const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,0.9)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

const Ground: React.FC<{ m: Mats; quality: Quality }> = ({ m }) => {
  const objs = useMemo(() => {
    const out: THREE.Object3D[] = [];
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000).rotateX(-Math.PI / 2), m.ground); ground.position.y = -0.08; ground.receiveShadow = true;
    const S = (CITY_EXTENT + H_ROAD) * 2;
    const road = new THREE.Mesh(new THREE.PlaneGeometry(S, S).rotateX(-Math.PI / 2), m.asphalt); road.position.y = -0.01; road.receiveShadow = true;
    out.push(ground, road);
    const blocks: [number, number][] = [];
    for (let i = -GRID_HALF; i <= GRID_HALF; i++) for (let j = -GRID_HALF; j <= GRID_HALF; j++) blocks.push([i, j]);
    const sw = instanced(new THREE.BoxGeometry(BLOCK_SIZE, 0.18, BLOCK_SIZE), m.slab, blocks.length, (n, o, c) => {
      o.position.set(blocks[n][0] * PITCH, 0.09, blocks[n][1] * PITCH); c.setRGB(0.6, 0.6, 0.58);
    }, true);
    const inner = BLOCK_SIZE - 2 * SIDEWALK_W;
    const pad = instanced(new THREE.BoxGeometry(inner, 0.03, inner), m.slab, blocks.length, (n, o, c) => {
      o.position.set(blocks[n][0] * PITCH, 0.195, blocks[n][1] * PITCH);
      const k = blockKind(blocks[n][0], blocks[n][1]);
      if (k === 'park' || k === 'tower') c.setRGB(0.16, 0.36, 0.14); else c.setRGB(0.4, 0.4, 0.4);
    }, true);
    for (const x of [sw, pad]) { x.receiveShadow = true; out.push(x); }
    const { white, yellow, zebra } = paintLists();
    const box = new THREE.BoxGeometry(1, 0.02, 1);
    const mk = (list: number[][], mat: THREE.Material) => {
      const me = instanced(box, mat, list.length, (n, o) => { o.position.set(list[n][0], 0.03, list[n][1]); o.scale.set(list[n][2], 1, list[n][3]); });
      me.receiveShadow = true; return me;
    };
    out.push(mk(white, m.paint), mk(zebra, m.paint), mk(yellow, m.yellow));
    const pond = new THREE.Mesh(new THREE.CircleGeometry(POND.r, 32).rotateX(-Math.PI / 2), m.water); pond.position.set(POND.x, 0.32, POND.z); out.push(pond);
    return out;
  }, [m]);
  useEffect(() => () => objs.forEach((o) => { (o as THREE.Mesh).geometry?.dispose(); }), [objs]);
  return <>{objs.map((o, i) => <primitive key={i} object={o} />)}</>;
};

const Buildings: React.FC<{ m: Mats; quality: Quality }> = ({ m, quality }) => {
  const meshes = useMemo(() => {
    const byBlock = new Map<string, typeof buildings>();
    for (const b of buildings) { const k = b.block.join(','); (byBlock.get(k) ?? byBlock.set(k, []).get(k)!).push(b); }
    const out: THREE.Mesh[] = [];
    byBlock.forEach((list) => {
      const me = new THREE.Mesh(buildBlockGeometry(list, quality), m.win);
      me.castShadow = quality !== 'low'; me.receiveShadow = true; out.push(me);
    });
    const { geo, signs } = buildProps(quality);
    const props = new THREE.Mesh(geo, m.win); props.castShadow = quality !== 'low'; props.receiveShadow = true; out.push(props);
    const sg = new THREE.Mesh(signs, m.sign); out.push(sg);
    return out;
  }, [m, quality]);
  useEffect(() => () => meshes.forEach((x) => x.geometry.dispose()), [meshes]);
  return <>{meshes.map((o, i) => <primitive key={i} object={o} />)}</>;
};

const Street: React.FC<{ m: Mats; quality: Quality }> = ({ m, quality }) => {
  const objs = useMemo(() => {
    const out: THREE.Object3D[] = [];
    const poolTex = poolTexture(); (m.pool as THREE.MeshBasicMaterial).map = poolTex; m.pool.needsUpdate = true;
    const poleG = new THREE.CylinderGeometry(0.07, 0.1, 7, 6).translate(0, 3.5, 0);
    const poles = instanced(poleG, m.pole, lamps.length, (i, o) => o.position.set(lamps[i].x, 0.18, lamps[i].z));
    const armG = new THREE.BoxGeometry(1.6, 0.1, 0.1).translate(0.8, 7, 0);
    const headG = new THREE.BoxGeometry(0.8, 0.14, 0.4).translate(1.4, 6.93, 0);
    const rot = (i: number, o: THREE.Object3D) => { o.position.set(lamps[i].x, 0.18, lamps[i].z); o.rotation.y = -Math.atan2(lamps[i].oz, lamps[i].ox); };
    const arms = instanced(armG, m.pole, lamps.length, rot);
    const heads = instanced(headG, m.head, lamps.length, rot);
    const poolG = new THREE.PlaneGeometry(13, 13).rotateX(-Math.PI / 2);
    const pools = instanced(poolG, m.pool, lamps.length, (i, o) => {
      o.position.set(lamps[i].x + lamps[i].ox * 1.4, 0.24, lamps[i].z + lamps[i].oz * 1.4);
    });
    pools.name = 'pools'; pools.visible = false;
    out.push(poles, arms, heads, pools);
    const tl = trees.filter((t) => quality !== 'low' || t.lod === 0);
    const trunk = instanced(new THREE.CylinderGeometry(0.15, 0.22, 3, 5).translate(0, 1.5, 0), m.trunk, tl.length, (i, o) => { o.position.set(tl[i].x, 0.18, tl[i].z); o.scale.setScalar(tl[i].s); });
    const geoLeaf = new THREE.IcosahedronGeometry(1.7, quality === 'low' ? 0 : 1).translate(0, 4.2, 0);
    const leaf = instanced(geoLeaf, m.leaf, tl.length, (i, o, c) => {
      o.position.set(tl[i].x, 0.18, tl[i].z); o.scale.set(tl[i].s, tl[i].s * 1.1, tl[i].s); c.setRGB(...tl[i].c);
    }, true);
    leaf.castShadow = trunk.castShadow = quality !== 'low';
    out.push(trunk, leaf);
    return out;
  }, [m, quality]);
  useEffect(() => () => objs.forEach((o) => (o as THREE.Mesh).geometry?.dispose()), [objs]);
  return <>{objs.map((o, i) => <primitive key={i} object={o} />)}</>;
};

const Dynamics: React.FC<{ m: Mats }> = ({ m }) => {
  const st = useMemo(() => ({ wet: 0, night: -1 }), []);
  const base = useMemo(() => new THREE.Color(1, 1, 1), []);
  useFrame((_, dt) => {
    const n = live.nightFactor;
    winUniforms.uNight.value = n; winUniforms.uDay.value = 1 - n;
    if (Math.abs(n - st.night) > 0.002) {
      st.night = n;
      m.head.emissiveIntensity = n * 4;
      m.pool.opacity = n * 0.5;
      m.sign.emissiveIntensity = 0.12 + n * 1.7;
    }
    const target = Math.min(1, live.rain * 1.5);
    st.wet += (target - st.wet) * Math.min(1, dt * 1.5);
    const w = st.wet;
    m.asphalt.roughness = 0.92 - 0.68 * w; m.asphalt.metalness = 0.3 * w;
    m.asphalt.color.copy(base).multiplyScalar(1 - 0.35 * w);
    m.paint.roughness = m.yellow.roughness = 0.7 - 0.4 * w;
    m.slab.roughness = 0.9 - 0.4 * w;
  });
  return null;
};

export const CityWorld: React.FC = () => {
  const quality = useCity((s) => s.quality);
  const m = useMemo(mats, []);
  useEffect(() => () => {
    m.asphaltTex.dispose(); m.signTex.dispose();
    Object.values(m).forEach((v) => { if ((v as THREE.Material).dispose) (v as THREE.Material).dispose(); });
  }, [m]);
  const pools = React.useRef<THREE.Group>(null);
  useFrame(() => { // toggle night light pools visibility
    const g = pools.current; if (!g) return;
    g.traverse((o) => { if (o.name === 'pools') o.visible = live.nightFactor > 0.02; });
  });
  return (
    <group ref={pools}>
      <Ground m={m} quality={quality} />
      <Buildings m={m} quality={quality} />
      <Street m={m} quality={quality} />
      <Dynamics m={m} />
    </group>
  );
};
export default CityWorld;
