import * as THREE from 'three';

/** Style codes (aInfo.y): 0 plain, 1 glass, 2 concrete, 3 brick, 4 emissive-at-night. */
export class GeoBuilder {
  pos: number[] = []; nor: number[] = []; col: number[] = []; uv: number[] = []; info: number[] = []; idx: number[] = [];
  private n = 0;
  private xf: { c: number; s: number; px: number; pz: number } | null = null;
  setXform(px: number, pz: number, theta: number) { this.xf = { c: Math.cos(theta), s: Math.sin(theta), px, pz }; }
  clearXform() { this.xf = null; }
  private vert(x: number, y: number, z: number, nx: number, ny: number, nz: number, c: number[], u: number, v: number, seed: number, style: number) {
    if (this.xf) {
      const { c: cs, s: sn, px, pz } = this.xf;
      const X = x * cs + z * sn + px, Z = -x * sn + z * cs + pz;
      const NX = nx * cs + nz * sn, NZ = -nx * sn + nz * cs;
      x = X; z = Z; nx = NX; nz = NZ;
    }
    this.pos.push(x, y, z); this.nor.push(nx, ny, nz); this.col.push(c[0], c[1], c[2]);
    this.uv.push(u, v); this.info.push(seed, style);
    return this.n++;
  }
  quad(p: number[][], nrm: number[], c: number[], uvs: number[][], seed: number, style: number) {
    const a = p.map((q, k) => this.vert(q[0], q[1], q[2], nrm[0], nrm[1], nrm[2], c, uvs[k][0], uvs[k][1], seed, style));
    this.idx.push(a[0], a[1], a[2], a[0], a[2], a[3]);
  }
  /** Axis-aligned (in local space) box; (cx,cz) centre, y0 bottom. Sides use windowed style, top is plain roof. */
  box(cx: number, y0: number, cz: number, w: number, h: number, d: number, color: number[], seed = 0, style = 0, roof?: number[]) {
    const x0 = cx - w / 2, x1 = cx + w / 2, z0 = cz - d / 2, z1 = cz + d / 2, y1 = y0 + h;
    const wy = this.xf ? 0 : 1; // windows need world-aligned uv
    const s = this.xf ? (style === 4 ? 4 : 0) : style;
    void wy;
    this.quad([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], [0, 0, 1], color, [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], seed, s);
    this.quad([[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], [0, 0, -1], color, [[x1, y0], [x0, y0], [x0, y1], [x1, y1]], seed, s);
    this.quad([[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], [1, 0, 0], color, [[z1, y0], [z0, y0], [z0, y1], [z1, y1]], seed, s);
    this.quad([[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], [-1, 0, 0], color, [[z0, y0], [z1, y0], [z1, y1], [z0, y1]], seed, s);
    const rc = roof ?? (style === 4 ? color : [color[0] * 0.55, color[1] * 0.55, color[2] * 0.55]);
    this.quad([[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]], [0, 1, 0], rc, [[0, 0], [0, 0], [0, 0], [0, 0]], seed, style === 4 ? 4 : 0);
  }
  geo(g: THREE.BufferGeometry, m: THREE.Matrix4, color: number[], style = 0) {
    const p = g.getAttribute('position'), nn = g.getAttribute('normal');
    const base = this.n;
    const v = new THREE.Vector3(), nv = new THREE.Vector3();
    const nm = new THREE.Matrix3().getNormalMatrix(m);
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(m); nv.fromBufferAttribute(nn, i).applyMatrix3(nm).normalize();
      this.vert(v.x, v.y, v.z, nv.x, nv.y, nv.z, color, 0, 0, 0, style);
    }
    const ix = g.getIndex();
    if (ix) for (let i = 0; i < ix.count; i++) this.idx.push(base + ix.getX(i));
    else for (let i = 0; i < p.count; i++) this.idx.push(base + i);
  }
  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aUv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('aInfo', new THREE.Float32BufferAttribute(this.info, 2));
    g.setIndex(this.n > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere(); g.computeBoundingBox();
    return g;
  }
  get empty() { return this.n === 0; }
}
