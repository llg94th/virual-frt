/**
 * Procedural vegetation for the city: leaf-card canopies, barked trunks with branches, curved palm fronds, bushes and flower clumps.
 * Everything shares ONE material (a canvas-painted atlas: leaf sprigs, pinnate leaves, palm frond, bark, blossoms, grass, dense foliage),
 * so one InstancedMesh per variant/LOD is one draw call. Wind sway is done in the vertex shader (aSway attribute, global uTime).
 * Canopy normals point outwards from each lump (soft, volumetric lighting) and are NOT flipped on back faces.
 * Heights/radii are in metres at scale 1 (see VARIANTS).
 */
import * as THREE from 'three';
import { mulberry32 } from '../shared';

// ---------------------------------------------------------------- atlas
type Cell = [number, number, number, number]; // x, y, w, h in px (canvas origin top-left)
const AT = 1024;
const CELLS = {
  leafA: [0, 0, 512, 512], pinnate: [512, 0, 512, 512], frond: [0, 512, 256, 512], bark: [256, 512, 256, 512],
  flower: [512, 512, 256, 256], grass: [768, 512, 256, 256], bush: [512, 768, 256, 256], mass: [768, 768, 256, 256],
} satisfies Record<string, Cell>;
type CellName = keyof typeof CELLS;
const uvRect = (c: CellName, inset = 3): [number, number, number, number] => {
  const [x, y, w, h] = CELLS[c];
  return [(x + inset) / AT, 1 - (y + h - inset) / AT, (x + w - inset) / AT, 1 - (y + inset) / AT]; // u0, v0(bottom), u1, v1(top)
};

function paintAtlas(): HTMLCanvasElement {
  const cv = document.createElement('canvas'); cv.width = cv.height = AT;
  const g = cv.getContext('2d')!;
  const r = mulberry32(0x7ee5);
  const R = (a: number, b: number) => a + (b - a) * r();
  const hsl = (h: number, s: number, l: number, a = 1) => `hsla(${h.toFixed(0)},${s.toFixed(0)}%,${l.toFixed(0)}%,${a})`;
  /** leaf pointing along +x from the origin; ang in radians from +x */
  const leaf = (x: number, y: number, ang: number, len: number, wid: number, h: number, dark = 0) => {
    g.save(); g.translate(x, y); g.rotate(ang);
    const gr = g.createLinearGradient(0, 0, len, 0);
    gr.addColorStop(0, hsl(h + R(-4, 4), 42, 24 + dark)); gr.addColorStop(0.55, hsl(h - 8, 46, 34 + dark)); gr.addColorStop(1, hsl(h - 22, 50, 45 + dark));
    g.fillStyle = gr; g.beginPath(); g.moveTo(0, 0);
    g.bezierCurveTo(len * 0.22, -wid, len * 0.72, -wid * 0.85, len, 0); g.bezierCurveTo(len * 0.72, wid * 0.85, len * 0.22, wid, 0, 0); g.fill();
    g.strokeStyle = hsl(h - 25, 40, 52, 0.55); g.lineWidth = Math.max(1, wid * 0.07); g.beginPath(); g.moveTo(0, 0); g.lineTo(len * 0.94, 0); g.stroke();
    g.strokeStyle = hsl(h - 20, 40, 45, 0.22); g.lineWidth = 1;
    for (let k = 1; k < 5; k++) { const t = k / 5.5; g.beginPath(); g.moveTo(len * t, 0); g.lineTo(len * (t + 0.16), -wid * 0.55 * (1 - t)); g.moveTo(len * t, 0); g.lineTo(len * (t + 0.16), wid * 0.55 * (1 - t)); g.stroke(); }
    g.strokeStyle = 'rgba(8,24,8,0.35)'; g.lineWidth = 1; g.stroke();
    g.restore();
  };
  const seed = (c: CellName, col: string) => { const [x, y, w, h] = CELLS[c]; g.fillStyle = col; g.fillRect(x, y, w, h); };
  const clip = (c: CellName) => { const [x, y, w, h] = CELLS[c]; g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip(); g.translate(x, y); };

  // A: broadleaf sprig (stem with alternate leaves)
  seed('leafA', 'rgba(40,80,30,0.012)'); clip('leafA');
  const sprig = (bx: number, by: number, tipx: number, tipy: number, n: number, size: number, hue: number) => {
    g.strokeStyle = hsl(28, 30, 22); g.lineWidth = 5; g.lineCap = 'round'; g.beginPath(); g.moveTo(bx, by); g.quadraticCurveTo((bx + tipx) / 2 + 24, (by + tipy) / 2, tipx, tipy); g.stroke();
    const base = Math.atan2(tipy - by, tipx - bx);
    for (let i = 0; i < n; i++) {
      const t = 0.15 + (0.8 * i) / n, px = bx + (tipx - bx) * t + 12 * Math.sin(t * 3), py = by + (tipy - by) * t, side = i % 2 ? 1 : -1;
      leaf(px, py, base + side * R(0.7, 1.25), size * R(0.8, 1.15) * (1 - t * 0.35), size * R(0.34, 0.42), hue + R(-6, 6), R(-3, 5));
    }
    leaf(tipx, tipy, base, size * 0.8, size * 0.32, hue, 2);
  };
  sprig(256, 505, 250, 70, 12, 150, 118); sprig(250, 330, 90, 150, 6, 110, 122); sprig(256, 300, 430, 170, 6, 110, 114);
  g.restore();

  // B: pinnate (rain-tree / flamboyant style) leaves, three rachises
  seed('pinnate', 'rgba(60,110,40,0.012)'); clip('pinnate');
  const rachis = (ang: number, len: number, hue: number) => {
    const bx = 256, by = 505; g.strokeStyle = hsl(60, 25, 28); g.lineWidth = 4; g.lineCap = 'round';
    const pt = (t: number): [number, number, number] => { const a = ang + t * 0.5 * Math.sign(ang + Math.PI / 2 + 0.001); return [bx + Math.cos(ang) * len * t + t * t * 36 * Math.sign(Math.cos(ang) || 1), by + Math.sin(ang) * len * t, a]; };
    g.beginPath(); for (let i = 0; i <= 24; i++) { const [x, y] = pt(i / 24); i ? g.lineTo(x, y) : g.moveTo(x, y); } g.stroke();
    for (let i = 3; i < 26; i++) {
      const t = i / 26, [x, y] = pt(t), sz = 44 * (1 - t * 0.5);
      for (const s of [-1, 1]) leaf(x, y, ang + s * R(1.0, 1.35), sz * R(0.85, 1.1), sz * 0.34, hue + R(-6, 6), R(0, 8));
    }
  };
  rachis(-Math.PI / 2, 430, 108); rachis(-Math.PI / 2 - 0.62, 350, 114); rachis(-Math.PI / 2 + 0.62, 350, 104); rachis(-Math.PI / 2 - 1.15, 260, 110); rachis(-Math.PI / 2 + 1.15, 260, 112);
  g.restore();

  // C: palm frond (portrait): arching rib, swept leaflets
  seed('frond', 'rgba(50,100,30,0.012)'); clip('frond');
  g.strokeStyle = hsl(70, 30, 36); g.lineWidth = 4; g.beginPath(); g.moveTo(128, 510); g.quadraticCurveTo(122, 260, 130, 14); g.stroke();
  for (let i = 0; i < 58; i++) {
    const t = 0.02 + (i / 58) * 0.95, y = 510 - 496 * t, x = 128 + (t - 0.5) * 4 * (t > 0.5 ? 1 : -0.6) * 0, len = (t < 0.15 ? 40 + t * 400 : 120 * (1 - Math.max(0, t - 0.3) * 1.25)) * R(0.88, 1.08);
    for (const s of [-1, 1]) {
      const a = -Math.PI / 2 + s * (1.25 - 0.55 * t) + R(-0.05, 0.05);
      g.save(); g.translate(x, y); g.rotate(a); g.fillStyle = hsl(112 - 26 * t + R(-4, 4), 46, 27 + 14 * t + R(-2, 4)); g.beginPath(); g.moveTo(0, 0);
      g.quadraticCurveTo(len * 0.45, -13, len, 0); g.quadraticCurveTo(len * 0.45, 11, 0, 0); g.fill(); g.restore();
    }
  }
  g.restore();

  // D: bark (portrait), seamless horizontally; vertical fissures
  clip('bark'); const bw = 256, bh = 512;
  g.fillStyle = hsl(28, 16, 40); g.fillRect(0, 0, bw, bh);
  for (let i = 0; i < 160; i++) { const x = R(0, bw), y = R(-60, bh), len = R(60, 320), lw = R(1.2, 6), dk = r() < 0.65; g.strokeStyle = dk ? hsl(24, 24, R(14, 24), R(0.4, 0.75)) : hsl(32, 14, R(38, 52), R(0.18, 0.4)); g.lineWidth = lw; g.lineCap = 'round';
    for (const ox of [-bw, 0, bw]) { g.beginPath(); g.moveTo(x + ox, y); for (let k = 1; k <= 6; k++) g.lineTo(x + ox + Math.sin(k * 1.7 + i) * 4, y + (len * k) / 6); g.stroke(); } }
  for (let i = 0; i < 40; i++) { g.fillStyle = hsl(R(70, 100), 14, R(30, 44), 0.18); const x = R(0, bw), y = R(0, bh); for (const ox of [-bw, 0, bw]) { g.beginPath(); g.ellipse(x + ox, y, R(6, 22), R(4, 14), 0, 0, 7); g.fill(); } }
  g.restore();

  // E: blossom sprig (leaves + five-petal flowers)
  seed('flower', 'rgba(200,60,100,0.012)'); clip('flower');
  for (let i = 0; i < 14; i++) leaf(128 + R(-18, 18), 240, -Math.PI / 2 + R(-1.4, 1.4), R(60, 100), R(14, 22), 118, R(0, 6));
  const pal = [[336, 70, 52], [340, 78, 66], [14, 82, 52], [48, 95, 58], [0, 0, 96], [320, 62, 48]];
  for (let i = 0; i < 26; i++) {
    const a = R(0, 6.28), d = Math.sqrt(r()) * 98, x = 128 + Math.cos(a) * d * 0.95, y = 120 + Math.sin(a) * d * 0.8, rad = R(9, 17), c = pal[Math.floor(r() * 5.4) % pal.length], rot = R(0, 6.28);
    for (let p = 0; p < 5; p++) { const pa = rot + (p * Math.PI * 2) / 5; g.fillStyle = hsl(c[0] + R(-5, 5), c[1], c[2] + R(-4, 4)); g.beginPath(); g.ellipse(x + Math.cos(pa) * rad * 0.6, y + Math.sin(pa) * rad * 0.6, rad * 0.62, rad * 0.46, pa, 0, 7); g.fill(); }
    g.fillStyle = hsl(46, 90, 62); g.beginPath(); g.arc(x, y, rad * 0.22, 0, 7); g.fill();
  }
  g.restore();

  // F: grass tuft
  seed('grass', 'rgba(90,130,50,0.012)'); clip('grass');
  for (let i = 0; i < 30; i++) {
    const x0 = 128 + R(-40, 40), h = R(110, 235), lean = R(-70, 70), w = R(5, 10);
    const gr = g.createLinearGradient(0, 255, 0, 255 - h); gr.addColorStop(0, hsl(105, 45, 18)); gr.addColorStop(0.6, hsl(90, 48, 33)); gr.addColorStop(1, hsl(70, 50, 46));
    g.fillStyle = gr; g.beginPath(); g.moveTo(x0 - w, 256); g.quadraticCurveTo(x0 - w * 0.4 + lean * 0.3, 256 - h * 0.6, x0 + lean, 256 - h); g.quadraticCurveTo(x0 + w * 0.5 + lean * 0.35, 256 - h * 0.55, x0 + w, 256); g.fill();
  }
  g.restore();

  // G: dense small-leaf shrub cluster
  seed('bush', 'rgba(40,90,30,0.012)'); clip('bush');
  g.fillStyle = hsl(120, 38, 15); g.beginPath(); g.arc(128, 132, 92, 0, 7); g.fill();
  for (let i = 0; i < 90; i++) { const a = R(0, 6.28), d = Math.sqrt(r()) * 108; leaf(128 + Math.cos(a) * d, 130 + Math.sin(a) * d, R(0, 6.28), R(34, 56), R(13, 20), 122, R(-2, 9)); }
  g.restore();

  // H: opaque foliage mass (mottled), used for canopy cores
  clip('mass'); g.fillStyle = hsl(120, 40, 14); g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 260; i++) { const x = R(0, 256), y = R(0, 256), a = R(0, 6.28); for (const ox of [-256, 0, 256]) for (const oy of [-256, 0, 256]) leaf(x + ox, y + oy, a, R(30, 54), R(12, 18), 120, R(-3, 8)); }
  g.restore();
  return cv;
}

// ---------------------------------------------------------------- shared material
export const vegUniforms = { uTime: { value: 0 }, uWind: { value: 1 } };
let _mat: THREE.MeshStandardMaterial | null = null;
export function vegMaterial(): THREE.MeshStandardMaterial {
  if (_mat) return _mat;
  const tex = new THREE.CanvasTexture(paintAtlas());
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4; tex.generateMipmaps = true; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.needsUpdate = true;
  const m = new THREE.MeshStandardMaterial({ map: tex, vertexColors: true, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.82, metalness: 0 });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = vegUniforms.uTime; sh.uniforms.uWind = vegUniforms.uWind;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aSway;\nuniform float uTime;\nuniform float uWind;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        {
          #ifdef USE_INSTANCING
            float ph = instanceMatrix[3][0] * 0.23 + instanceMatrix[3][2] * 0.19;
          #else
            float ph = 0.0;
          #endif
          float t = uTime * 1.6 + ph;
          float fl = position.x * 3.1 + position.y * 2.3 + position.z * 2.7;
          transformed.x += (sin(t + position.y * 0.5) * 0.7 + sin(t * 2.7 + fl) * 0.3) * aSway * uWind;
          transformed.z += (cos(t * 0.83 + position.y * 0.4) * 0.7 + cos(t * 2.3 + fl) * 0.3) * aSway * uWind;
          transformed.y += sin(t * 3.1 + fl) * aSway * uWind * 0.25;
        }`);
    // canopy normals are authored (outward from each lump): do not flip them on back faces
    sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_begin>', THREE.ShaderChunk.normal_fragment_begin.replace('float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;', 'float faceDirection = 1.0;'));
  };
  m.customProgramCacheKey = () => 'veg1';
  return (_mat = m);
}

// ---------------------------------------------------------------- geometry building
type V3 = THREE.Vector3;
const v3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
class VB {
  pos: number[] = []; nor: number[] = []; uv: number[] = []; col: number[] = []; sw: number[] = []; idx: number[] = [];
  vert(p: V3, n: V3, u: number, v: number, c: number, sway: number, tint?: [number, number, number]) {
    this.pos.push(p.x, p.y, p.z); this.nor.push(n.x, n.y, n.z); this.uv.push(u, v);
    this.col.push(c * (tint?.[0] ?? 1), c * (tint?.[1] ?? 1), c * (tint?.[2] ?? 1)); this.sw.push(sway);
    return this.pos.length / 3 - 1;
  }
  tri(a: number, b: number, c: number) { this.idx.push(a, b, c); }
  /** quad card: centre c, right/up unit vectors, size w x h; shading normal blends `out` (outward dir) with the card's face normal */
  card(c: V3, right: V3, up: V3, w: number, h: number, cell: CellName, out: V3, shade: number, sway: number, bottom = false, tint?: [number, number, number]) {
    const [u0, v0, u1, v1] = uvRect(cell);
    const ctr = bottom ? c.clone().addScaledVector(up, h / 2) : c;
    const f = new THREE.Vector3().crossVectors(right, up).normalize(); if (f.dot(out) < 0) f.negate();
    const n = out.clone().multiplyScalar(0.78).addScaledVector(f, 0.22).normalize();
    const hx = right.clone().multiplyScalar(w / 2), hy = up.clone().multiplyScalar(h / 2);
    const a = this.vert(ctr.clone().sub(hx).sub(hy), n, u0, v0, shade, sway * 0.7, tint);
    const b = this.vert(ctr.clone().add(hx).sub(hy), n, u1, v0, shade, sway * 0.7, tint);
    const cc = this.vert(ctr.clone().add(hx).add(hy), n, u1, v1, shade, sway, tint);
    const d = this.vert(ctr.clone().sub(hx).add(hy), n, u0, v1, shade, sway, tint);
    this.tri(a, b, cc); this.tri(a, cc, d);
  }
  /** tube along a polyline with per-point radii; bark UVs: circumference once around the bark cell, v along the whole length */
  tube(pts: V3[], radii: number[], sides: number, shade: [number, number, number], swayBase: number, swayTop: number, tint?: [number, number, number]) {
    const [u0, v0, u1, v1] = uvRect('bark', 4);
    let nrm = new THREE.Vector3(1, 0, 0);
    const rings: number[][] = [];
    for (let i = 0; i < pts.length; i++) {
      const t = (pts[Math.min(i + 1, pts.length - 1)].clone().sub(pts[Math.max(i - 1, 0)])).normalize();
      if (i === 0) { nrm = Math.abs(t.y) > 0.9 ? v3(1, 0, 0) : v3(0, 1, 0).cross(t).normalize(); }
      nrm = nrm.clone().sub(t.clone().multiplyScalar(nrm.dot(t))).normalize();
      const bi = new THREE.Vector3().crossVectors(t, nrm).normalize();
      const row: number[] = [];
      for (let k = 0; k <= sides; k++) {
        const a = (k / sides) * Math.PI * 2, d = nrm.clone().multiplyScalar(Math.cos(a)).addScaledVector(bi, Math.sin(a));
        const p = pts[i].clone().addScaledVector(d, radii[i]);
        const f = i / (pts.length - 1);
        row.push(this.vert(p, d, u0 + (k / sides) * (u1 - u0), v0 + f * (v1 - v0), shade[0] + (shade[1] - shade[0]) * f, swayBase + (swayTop - swayBase) * f, tint));
      }
      rings.push(row);
    }
    for (let i = 0; i + 1 < rings.length; i++) for (let k = 0; k < sides; k++) {
      const a = rings[i][k], b = rings[i][k + 1], c = rings[i + 1][k + 1], d = rings[i + 1][k];
      this.tri(a, b, c); this.tri(a, c, d);
    }
  }
  /** low-poly lumpy ball of dense foliage (uses the opaque `mass` cell) */
  core(c: V3, rx: number, ry: number, rz: number, rnd: () => number, shade: number, sway: number, detail = 1) {
    const g = new THREE.IcosahedronGeometry(1, detail); const p = g.attributes.position, ix = g.index;
    const [u0, v0, u1, v1] = uvRect('mass', 8); const base = this.pos.length / 3;
    const jit: number[] = []; for (let i = 0; i < p.count; i++) jit.push(0.82 + rnd() * 0.3);
    // merge duplicate vertices' jitter by position so the ball stays closed
    const key = new Map<string, number>();
    for (let i = 0; i < p.count; i++) { const k = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`; if (key.has(k)) jit[i] = key.get(k)!; else key.set(k, jit[i]); }
    for (let i = 0; i < p.count; i++) {
      const d = v3(p.getX(i), p.getY(i), p.getZ(i)).normalize();
      const q = v3(c.x + d.x * rx * jit[i], c.y + d.y * ry * jit[i], c.z + d.z * rz * jit[i]);
      this.vert(q, d, u0 + (d.x * 0.5 + 0.5) * (u1 - u0), v0 + (d.z * 0.5 + 0.5 + d.y * 0.3) * (v1 - v0), shade, sway);
    }
    const nI = ix ? ix.count : p.count;
    for (let i = 0; i < nI; i += 3) this.tri(base + (ix ? ix.getX(i) : i), base + (ix ? ix.getX(i + 1) : i + 1), base + (ix ? ix.getX(i + 2) : i + 2));
    g.dispose();
  }
  geo(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2)); g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aSway', new THREE.Float32BufferAttribute(this.sw, 1)); g.setIndex(this.idx);
    g.computeBoundingBox(); g.computeBoundingSphere();
    return g;
  }
}

/** random unit-ish tangent frame for a card whose face points along n */
function frameFor(n: V3, rnd: () => number): [V3, V3] {
  const ref = Math.abs(n.y) > 0.9 ? v3(1, 0, 0) : v3(0, 1, 0);
  const right = new THREE.Vector3().crossVectors(ref, n).normalize();
  const up = new THREE.Vector3().crossVectors(n, right).normalize();
  const a = (rnd() - 0.5) * 1.6; // roll of the card around its face normal
  const r2 = right.clone().multiplyScalar(Math.cos(a)).addScaledVector(up, Math.sin(a));
  const u2 = up.clone().multiplyScalar(Math.cos(a)).addScaledVector(right, -Math.sin(a));
  // leaf sprigs grow upward: bias "up" towards +y
  if (u2.y < 0) { u2.negate(); r2.negate(); }
  return [r2, u2];
}

export type LOD = 0 | 1 | 2;
interface LodCfg { cards: number; size: number; sides: number; branches: boolean }
const BROAD_LOD: LodCfg[] = [{ cards: 34, size: 1.0, sides: 8, branches: true }, { cards: 10, size: 1.55, sides: 6, branches: true }, { cards: 4, size: 2.4, sides: 4, branches: false }];

interface BroadSpec { trunkH: number; trunkR: number; lumps: [number, number, number, number][]; /* x,y,z,radius */ cell: CellName; seed: number; hue: [number, number, number] }
const BROAD: BroadSpec[] = [
  // round crown (mango / ficus like)
  { trunkH: 2.3, trunkR: 0.2, seed: 11, cell: 'leafA', hue: [1, 1, 1], lumps: [[0, 4.5, 0, 1.55], [1.5, 3.9, 0.3, 1.2], [-1.4, 4.0, -0.5, 1.25], [0.2, 3.9, 1.5, 1.15], [-0.3, 4.2, -1.5, 1.15], [0.3, 5.6, 0.1, 1.0]] },
  // tall oval crown
  { trunkH: 2.6, trunkR: 0.17, seed: 23, cell: 'leafA', hue: [0.95, 1.05, 0.95], lumps: [[0, 4.2, 0, 1.3], [0.5, 5.4, 0.2, 1.2], [-0.4, 6.4, -0.1, 1.0], [0.9, 3.7, -0.7, 1.0], [-0.9, 3.9, 0.7, 1.0], [0, 7.2, 0, 0.7]] },
  // wide umbrella crown (rain tree): pinnate leaves
  { trunkH: 3.0, trunkR: 0.24, seed: 37, cell: 'pinnate', hue: [1.05, 1.05, 0.9], lumps: [[0, 4.6, 0, 1.6], [2.0, 4.2, 0.4, 1.4], [-2.0, 4.3, -0.3, 1.4], [0.5, 4.3, 2.1, 1.4], [-0.4, 4.2, -2.1, 1.4], [1.5, 4.0, -1.6, 1.2], [-1.5, 4.1, 1.6, 1.2]] },
];

export function buildBroadleaf(variant: number, lod: LOD): THREE.BufferGeometry {
  const sp = BROAD[variant % BROAD.length], cf = BROAD_LOD[lod], rnd = mulberry32(sp.seed * 977 + lod * 13);
  const b = new VB();
  const trunk: V3[] = [], rad: number[] = [], n = lod === 0 ? 7 : lod === 1 ? 4 : 2;
  const top = sp.lumps[0];
  for (let i = 0; i <= n; i++) {
    const t = i / n; trunk.push(v3(Math.sin(t * 2.4 + sp.seed) * 0.12 * t * 2, t * sp.trunkH, Math.cos(t * 2.1 + sp.seed) * 0.1 * t * 2));
    rad.push(sp.trunkR * (1 + 0.55 * Math.exp(-t * 9)) * (1 - 0.35 * t));
  }
  b.tube(trunk, rad, cf.sides, [0.95, 0.8, 0.8].slice(0, 3) as [number, number, number], 0, 0.02);
  const tt = trunk[trunk.length - 1];
  // branches from the trunk top into each lump
  if (cf.branches) sp.lumps.forEach(([x, y, z, rr], li) => {
    const e = v3(x * 0.85, y - rr * 0.3, z * 0.85), s = tt.clone().add(v3(0, -0.2 - (li % 3) * 0.15, 0));
    const mid = s.clone().lerp(e, 0.5).add(v3(0, 0.25, 0));
    b.tube([s, mid, e], [sp.trunkR * 0.55, sp.trunkR * 0.38, sp.trunkR * 0.18], Math.max(4, cf.sides - 2), [0.8, 0.75, 0.75], 0.01, 0.05);
  });
  // canopy lumps: dense core + outward-facing leaf cards
  sp.lumps.forEach(([x, y, z, rr]) => {
    const c = v3(x, y, z);
    b.core(c, rr * 0.68, rr * 0.56, rr * 0.68, rnd, 0.7, 0.05, lod === 0 ? 1 : 0);
    const m = Math.max(2, Math.round(cf.cards * (rr / 1.3) * (lod === 0 ? 1 : 1)));
    for (let i = 0; i < m; i++) {
      // fibonacci-ish spread on the upper 3/4 of a sphere, with radial jitter
      const t = (i + 0.5) / m, phi = i * 2.399963 + rnd(), yy = 1 - 1.7 * t, rr2 = Math.sqrt(Math.max(0, 1 - yy * yy));
      const d = v3(Math.cos(phi) * rr2, yy, Math.sin(phi) * rr2).normalize();
      const dist = rr * (0.62 + rnd() * 0.42);
      const pos = c.clone().addScaledVector(d, dist);
      const out = d.clone().add(v3((rnd() - 0.5) * 0.5, (rnd() - 0.5) * 0.4, (rnd() - 0.5) * 0.5)).normalize();
      const [right, up] = frameFor(out, rnd);
      const size = cf.size * (0.85 + rnd() * 0.4) * (sp.cell === 'pinnate' ? 0.8 : 1);
      const shade = 0.78 + 0.3 * Math.min(1, dist / rr) + 0.1 * d.y;
      b.card(pos, right, up, size, size, sp.cell, d, shade, 0.07 + 0.05 * rnd());
    }
  });
  return b.geo();
}

interface PalmCfg { fronds: number; segs: number; trunkPts: number; sides: number }
const PALM_LOD: PalmCfg[] = [{ fronds: 14, segs: 6, trunkPts: 18, sides: 8 }, { fronds: 9, segs: 4, trunkPts: 7, sides: 6 }, { fronds: 7, segs: 2, trunkPts: 3, sides: 4 }];
const PALM_SPEC = [{ h: 8, lean: 0.9, seed: 5 }, { h: 6.5, lean: -0.5, seed: 9 }, { h: 9, lean: 1.5, seed: 14 }];

export function buildPalm(variant: number, lod: LOD): THREE.BufferGeometry {
  const sp = PALM_SPEC[variant % PALM_SPEC.length], cf = PALM_LOD[lod], rnd = mulberry32(sp.seed * 313 + lod);
  const b = new VB();
  const pts: V3[] = [], rad: number[] = [];
  for (let i = 0; i < cf.trunkPts; i++) {
    const t = i / (cf.trunkPts - 1);
    pts.push(v3(sp.lean * t * t, t * sp.h, 0.25 * Math.sin(t * 2.2) * t));
    const ring = lod === 0 ? 1 + 0.07 * Math.pow(Math.max(0, Math.sin(t * sp.h * 5.2)), 2) : 1;
    rad.push(0.21 * (1 + 0.7 * Math.exp(-t * 14)) * (1 - 0.32 * t) * ring);
  }
  b.tube(pts, rad, cf.sides, [1.7, 1.45, 1.2].slice(0, 3) as [number, number, number], 0, 0.02, [1.1, 1.0, 0.85]);
  const crown = pts[pts.length - 1].clone();
  // fronds: V-folded arching ribbons
  const [fu0, fv0, fu1, fv1] = uvRect('frond');
  for (let i = 0; i < cf.fronds; i++) {
    const az = (i / cf.fronds) * Math.PI * 2 + rnd() * 0.4, ring = i % 3;
    const e0 = [1.25, 0.65, 0.3][ring] + (rnd() - 0.5) * 0.25; // initial elevation (rad)
    const len = (3.3 + rnd() * 0.8) * (ring === 0 ? 0.8 : 1), wid = len * 0.62, droop = 0.9 + rnd() * 0.5 + (ring === 2 ? 0.5 : 0);
    const dir = v3(Math.cos(az), 0, Math.sin(az)), side = v3(-Math.sin(az), 0, Math.cos(az));
    let p = crown.clone().add(v3(0, 0.05, 0)); const rows: number[][] = [];
    for (let s = 0; s <= cf.segs; s++) {
      const t = s / cf.segs, ang = e0 - droop * t, fold = 0.5 * Math.min(1, t * 2);
      if (s > 0) p = p.clone().addScaledVector(dir, Math.cos(ang) * len / cf.segs).addScaledVector(v3(0, 1, 0), Math.sin(ang) * len / cf.segs);
      const wv = wid * 0.5 * Math.sin(Math.PI * Math.min(1, 0.28 + t * 0.8)) * 1.1 + 0.001;
      const nrm = v3(0, 1, 0).addScaledVector(dir, -Math.sin(ang) * 0.6).normalize();
      const out = nrm.clone().multiplyScalar(0.7).addScaledVector(dir, 0.3).normalize();
      const L = p.clone().addScaledVector(side, -wv * Math.cos(fold)).addScaledVector(v3(0, -1, 0), wv * Math.sin(fold));
      const Rr = p.clone().addScaledVector(side, wv * Math.cos(fold)).addScaledVector(v3(0, -1, 0), wv * Math.sin(fold));
      const vv = fv0 + t * (fv1 - fv0), sh = 0.78 + 0.22 * t, sw = 0.05 + 0.22 * t * t;
      rows.push([b.vert(L, out, fu0, vv, sh, sw), b.vert(p, out, (fu0 + fu1) / 2, vv, sh, sw), b.vert(Rr, out, fu1, vv, sh, sw)]);
    }
    for (let s = 0; s < cf.segs; s++) for (let k = 0; k < 2; k++) {
      const a = rows[s][k], c = rows[s][k + 1], d = rows[s + 1][k + 1], e = rows[s + 1][k]; b.tri(a, c, d); b.tri(a, d, e);
    }
  }
  if (lod < 2) for (let i = 0; i < 5; i++) { // coconut / date bunch
    const a = (i / 5) * 6.28 + rnd(); b.core(crown.clone().add(v3(Math.cos(a) * 0.22, -0.28 - rnd() * 0.12, Math.sin(a) * 0.22)), 0.11, 0.13, 0.11, rnd, 0.7, 0.03, 0);
  }
  return b.geo();
}

const BUSH_LOD = [{ cards: 24, size: 0.62 }, { cards: 10, size: 0.95 }, { cards: 4, size: 1.4 }];
export function buildBush(variant: number, lod: LOD): THREE.BufferGeometry {
  const rnd = mulberry32(777 + variant * 31 + lod), cf = BUSH_LOD[lod], b = new VB(), flowers = variant % 2 === 1;
  const c = v3(0, 0.5, 0);
  b.core(c, 0.62, 0.5, 0.62, rnd, 0.68, 0.03, lod === 0 ? 1 : 0);
  for (let i = 0; i < cf.cards; i++) {
    const t = (i + 0.5) / cf.cards, phi = i * 2.399963 + rnd(), yy = 0.05 + 0.95 * t, rr = Math.sqrt(Math.max(0, 1 - yy * yy));
    const d = v3(Math.cos(phi) * rr, yy, Math.sin(phi) * rr).normalize(), dist = 0.55 + rnd() * 0.3;
    const pos = c.clone().add(v3(d.x * dist * 1.05, d.y * dist * 0.85, d.z * dist * 1.05)); pos.y = Math.max(0.12, pos.y);
    const [right, up] = frameFor(d, rnd), size = cf.size * (0.85 + rnd() * 0.35);
    b.card(pos, right, up, size, size, 'bush', d, 0.62 + 0.38 * (d.y * 0.5 + 0.5), 0.04);
  }
  if (flowers) for (let i = 0; i < (lod === 0 ? 11 : lod === 1 ? 6 : 3); i++) {
    const a = rnd() * 6.28, yy = 0.35 + rnd() * 0.65, rr = Math.sqrt(1 - yy * yy), d = v3(Math.cos(a) * rr, yy, Math.sin(a) * rr);
    const [right, up] = frameFor(d, rnd); b.card(c.clone().addScaledVector(d, 0.82), right, up, 0.42 * (lod + 1) ** 0.5, 0.42 * (lod + 1) ** 0.5, 'flower', d, 1, 0.05);
  }
  return b.geo();
}

/** small flower clump (ground bed): leaves + blossom sprigs, ~0.55 m tall */
export function buildFlowerClump(variant: number, lod: LOD): THREE.BufferGeometry {
  const rnd = mulberry32(4242 + variant * 17), b = new VB(), nL = lod === 0 ? 6 : 3, nF = lod === 0 ? 5 : lod === 1 ? 3 : 2;
  for (let i = 0; i < nL; i++) { const a = (i / nL) * 6.28 + rnd(), d = v3(Math.cos(a), 0.6, Math.sin(a)).normalize(), [r, u] = frameFor(d, rnd); b.card(v3(Math.cos(a) * 0.12, 0.08, Math.sin(a) * 0.12), r, u, 0.5, 0.5, 'bush', d, 0.7, 0.06, true); }
  for (let i = 0; i < nF; i++) { const a = (i / nF) * 6.28 + rnd(), d = v3(Math.cos(a), 0.9, Math.sin(a)).normalize(), [r, u] = frameFor(d, rnd); b.card(v3(Math.cos(a) * 0.1, 0.22, Math.sin(a) * 0.1), r, u, 0.42, 0.42, 'flower', d, 1, 0.08, true); }
  return b.geo();
}

/** grass tuft: three crossed blade cards */
export function buildGrass(lod: LOD): THREE.BufferGeometry {
  const b = new VB(); const n = lod === 0 ? 3 : 2;
  for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI, right = v3(Math.cos(a), 0, Math.sin(a)), d = v3(-Math.sin(a), 0.3, Math.cos(a)).normalize(); b.card(v3(0, 0, 0), right, v3(0, 1, 0), 0.7, 0.55, 'grass', d, 0.9, 0.12, true); }
  return b.geo();
}

// ---------------------------------------------------------------- catalogue
export type VegKind = 'broad' | 'palm' | 'bush' | 'flower' | 'grass';
export interface VegVariant { id: string; kind: VegKind; variant: number; /** natural size at scale 1 (m) */ h: number; r: number; geos: THREE.BufferGeometry[] }
const _cache = new Map<string, VegVariant>();
const BUILDERS: Record<VegKind, (v: number, l: LOD) => THREE.BufferGeometry> = {
  broad: buildBroadleaf, palm: buildPalm, bush: buildBush, flower: buildFlowerClump, grass: (_v, l) => buildGrass(l),
};
export const VARIANT_COUNT: Record<VegKind, number> = { broad: 3, palm: 3, bush: 2, flower: 1, grass: 1 };
/** id `broad:0`..; geos[0..2] are LOD 0..2 (built lazily, shared by street, courtyards and rooftops) */
export function getVeg(kind: VegKind, variant: number): VegVariant {
  const id = `${kind}:${variant}`; let v = _cache.get(id); if (v) return v;
  const geos = [0, 1, 2].map((l) => BUILDERS[kind](variant, l as LOD));
  const bb = geos[0].boundingBox!;
  v = { id, kind, variant, h: bb.max.y - Math.min(0, bb.min.y), r: Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z) / 2, geos };
  _cache.set(id, v); return v;
}
