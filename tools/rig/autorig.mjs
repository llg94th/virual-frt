#!/usr/bin/env node
/**
 * autorig.mjs - auto-rig a static humanoid GLB (e.g. from Meshy) onto the Quaternius UE-style skeleton
 * so it can play the Quaternius Universal Animation Library clips (UAL1_Standard.glb) by bone NAME.
 *
 * Usage:  node tools/rig/autorig.mjs <in.glb> <out.glb> [male|female] [--height=1.82] [--no-fit] [--keep-fingers]
 *         [--reach=0.14] hand weight reach from sleeve (m; 0 = pin pocket hands)  [--passes=3] smoothing passes  [--arm-min-y=Y] no arm weights below Y
 * Needs:  npm i --no-save @gltf-transform/core @gltf-transform/extensions   (run from the repo root)
 * Env:    RIG_DONOR_DIR  directory holding Superhero_{Male,Female}_FullBody.gltf (default: public/models/quaternius/base)
 *
 * Pipeline
 *  1. Align the Meshy mesh to the donor body in bind space (uniform scale to donor height, feet on donor feet, x/z centred on
 *     the feet centroid, +Z facing). The alignment is baked into the vertex positions.
 *  2. The donor is a T-pose; Meshy figures usually are not. For each arm a 2-bone pose fit (world direction of upperarm and
 *     lowerarm, grid search + coordinate descent on a donor->Meshy chamfer distance) bends the donor skeleton/mesh into the
 *     figure's arm pose. The fitted pose becomes the BIND pose: inverseBindMatrices = inverse(posed joint world matrices) and
 *     the node rest rotations are the posed ones, so the rest pose renders exactly like the static mesh. UAL clips (absolute
 *     local rotations) then move the posed bind pose correctly.
 *  3. Weight transfer: every Meshy vertex copies the joint weights of the best of its 16 nearest posed-donor vertices
 *     (distance + normal-disagreement penalty). Finger weights are collapsed onto hand_l/r (Meshy hands are mitten-like).
 *  4. Weights are welded over coincident positions, Laplacian smoothed (3 passes over mesh neighbours), top-4 kept, renormalised.
 *  5. Output = original primitive (+ JOINTS_0/WEIGHTS_0), original materials/textures (EXT_texture_webp kept), a skin whose
 *     joints are the donor nodes (same names/hierarchy, under an 'Armature' node), no animations.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const flags = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => { const [k, v] = a.slice(2).split('='); return [k, v ?? true]; }));
if (args.length < 2) { console.error('usage: autorig.mjs <in.glb> <out.glb> [male|female] [--height=1.82] [--no-fit] [--keep-fingers]'); process.exit(1); }
const [inPath, outPath, sex = 'male'] = args;
const donorDir = process.env.RIG_DONOR_DIR || path.resolve(here, '../../public/models/quaternius/base');
const donorPath = path.join(donorDir, sex === 'female' ? 'Superhero_Female_FullBody.gltf' : 'Superhero_Male_FullBody.gltf');

// ------------------------------------------------------------------ tiny math (column-major mat4, xyzw quats)
const V = {
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  len: (a) => Math.hypot(a[0], a[1], a[2]),
  norm: (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
};
const qmul = (a, b) => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
const qconj = (q) => [-q[0], -q[1], -q[2], q[3]];
const qrot = (q, v) => { const t = V.cross([q[0], q[1], q[2]], v).map((x) => 2 * x); const c = V.cross([q[0], q[1], q[2]], t); return [v[0] + q[3] * t[0] + c[0], v[1] + q[3] * t[1] + c[1], v[2] + q[3] * t[2] + c[2]]; };
const qnorm = (q) => { const l = Math.hypot(...q) || 1; return q.map((x) => x / l); };
function qfromTo(u, v) { // shortest rotation u->v (unit vectors)
  const d = V.dot(u, v);
  if (d < -0.999999) { let ax = V.cross([1, 0, 0], u); if (V.len(ax) < 1e-6) ax = V.cross([0, 1, 0], u); ax = V.norm(ax); return [ax[0], ax[1], ax[2], 0]; }
  const c = V.cross(u, v); return qnorm([c[0], c[1], c[2], 1 + d]);
}
function m4fromTQ(t, q) {
  const [x, y, z, w] = q;
  return [1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w), 0, 2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w), 0,
    2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y), 0, t[0], t[1], t[2], 1];
}
function m4mul(a, b) { const o = new Array(16); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s; } return o; }
function m4rigidInv(m) { // rotation+translation only
  const o = [m[0], m[4], m[8], 0, m[1], m[5], m[9], 0, m[2], m[6], m[10], 0, 0, 0, 0, 1];
  o[12] = -(o[0] * m[12] + o[4] * m[13] + o[8] * m[14]); o[13] = -(o[1] * m[12] + o[5] * m[13] + o[9] * m[14]); o[14] = -(o[2] * m[12] + o[6] * m[13] + o[10] * m[14]); return o;
}

// ------------------------------------------------------------------ spatial grid (nearest / k-nearest)
class Grid {
  constructor(pts, cell = 0.05) {
    this.p = pts; this.cell = cell; this.map = new Map();
    for (let i = 0; i < pts.length / 3; i++) { const k = this.key(Math.floor(pts[i * 3] / cell), Math.floor(pts[i * 3 + 1] / cell), Math.floor(pts[i * 3 + 2] / cell)); let a = this.map.get(k); if (!a) this.map.set(k, a = []); a.push(i); }
  }
  key(cx, cy, cz) { return ((cx + 1024) * 2048 + (cy + 1024)) * 2048 + (cz + 1024); }
  knn(x, y, z, k, maxR = 12) {
    const c = this.cell, cx = Math.floor(x / c), cy = Math.floor(y / c), cz = Math.floor(z / c); let found = [];
    for (let R = 0; R <= maxR; R++) {
      for (let i = -R; i <= R; i++) for (let j = -R; j <= R; j++) for (let l = -R; l <= R; l++) {
        if (Math.max(Math.abs(i), Math.abs(j), Math.abs(l)) !== R) continue;
        const a = this.map.get(this.key(cx + i, cy + j, cz + l)); if (!a) continue;
        for (const id of a) { const dx = this.p[id * 3] - x, dy = this.p[id * 3 + 1] - y, dz = this.p[id * 3 + 2] - z; found.push([dx * dx + dy * dy + dz * dz, id]); }
      }
      if (found.length >= k) { found.sort((a, b) => a[0] - b[0]); found = found.slice(0, k); if (Math.sqrt(found[k - 1][0]) <= R * c) break; }
    }
    found.sort((a, b) => a[0] - b[0]); return found.slice(0, k);
  }
  nearestDist(x, y, z, cap = 0.12) { // distance to nearest point, capped
    const c = this.cell, cx = Math.floor(x / c), cy = Math.floor(y / c), cz = Math.floor(z / c); let best = cap * cap; const maxR = Math.ceil(cap / c);
    for (let R = 0; R <= maxR; R++) {
      for (let i = -R; i <= R; i++) for (let j = -R; j <= R; j++) for (let l = -R; l <= R; l++) {
        if (Math.max(Math.abs(i), Math.abs(j), Math.abs(l)) !== R) continue;
        const a = this.map.get(this.key(cx + i, cy + j, cz + l)); if (!a) continue;
        for (const id of a) { const dx = this.p[id * 3] - x, dy = this.p[id * 3 + 1] - y, dz = this.p[id * 3 + 2] - z; const d = dx * dx + dy * dy + dz * dz; if (d < best) best = d; }
      }
      if (Math.sqrt(best) <= R * c) break;
    }
    return Math.sqrt(best);
  }
}

// ------------------------------------------------------------------ donor
async function loadDonor(p) {
  const json = JSON.parse(fs.readFileSync(p, 'utf8'));
  delete json.images; delete json.textures; delete json.samplers; // geometry only
  for (const m of json.materials || []) for (const k of Object.keys(m)) if (k !== 'name') delete m[k];
  const resources = {}; for (const b of json.buffers) resources[b.uri] = new Uint8Array(fs.readFileSync(path.join(path.dirname(p), b.uri)));
  return new NodeIO().readJSON({ json, resources });
}
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const donorDoc = await loadDonor(donorPath);
const dRoot = donorDoc.getRoot();
const dSkin = dRoot.listSkins()[0];
const joints = dSkin.listJoints();
const J = joints.length;
const jIndex = new Map(joints.map((n, i) => [n, i]));
const names = joints.map((n) => n.getName());
const jid = (n) => { const i = names.indexOf(n); if (i < 0) throw new Error('missing joint ' + n); return i; };
const parent = joints.map((n) => { const p = n.getParentNode(); return p && jIndex.has(p) ? jIndex.get(p) : -1; });
const tLoc = joints.map((n) => n.getTranslation()), qLoc = joints.map((n) => n.getRotation());
// topological order
const order = []; { const seen = new Set(); const visit = (i) => { if (seen.has(i)) return; if (parent[i] >= 0) visit(parent[i]); seen.add(i); order.push(i); }; for (let i = 0; i < J; i++) visit(i); }
// armature (non-joint ancestor) world matrix is identity in the donor; assert
for (const n of joints) { const p = n.getParentNode(); if (p && !jIndex.has(p)) { const w = p.getWorldMatrix(); if (Math.abs(w[0] - 1) + Math.abs(w[5] - 1) + Math.abs(w[12]) + Math.abs(w[13]) + Math.abs(w[14]) > 1e-5) throw new Error('donor armature not identity'); } }

function fk(dirOverride = {}) {
  const Qw = new Array(J), Tw = new Array(J), ql = new Array(J);
  for (const j of order) {
    const p = parent[j]; let Q, T;
    if (p < 0) { Q = qLoc[j]; T = tLoc[j]; } else { Q = qmul(Qw[p], qLoc[j]); T = V.add(Tw[p], qrot(Qw[p], tLoc[j])); }
    if (dirOverride[j]) { const rs = qfromTo(restDir[j], dirOverride[j]); Q = qnorm(qmul(rs, restQ[j])); }
    Qw[j] = Q; Tw[j] = T; ql[j] = p < 0 ? Q : qnorm(qmul(qconj(Qw[p]), Q));
  }
  return { Qw, Tw, ql, W: Qw.map((q, j) => m4fromTQ(Tw[j], q)) };
}
let restQ = [], restDir = {};
const rest = fk(); restQ = rest.Qw;
const ibmRest = rest.W.map(m4rigidInv);
for (const s of ['l', 'r']) {
  restDir[jid('upperarm_' + s)] = V.norm(V.sub(rest.Tw[jid('lowerarm_' + s)], rest.Tw[jid('upperarm_' + s)]));
  restDir[jid('lowerarm_' + s)] = V.norm(V.sub(rest.Tw[jid('hand_' + s)], rest.Tw[jid('lowerarm_' + s)]));
}
// donor body mesh = biggest mesh
const dMesh = dRoot.listMeshes().sort((a, b) => b.listPrimitives()[0].getAttribute('POSITION').getCount() - a.listPrimitives()[0].getAttribute('POSITION').getCount())[0];
const dPrim = dMesh.listPrimitives()[0];
const dPos = Float64Array.from(dPrim.getAttribute('POSITION').getArray()), dNrm = Float64Array.from(dPrim.getAttribute('NORMAL').getArray());
const dJ = dPrim.getAttribute('JOINTS_0').getArray(), dWt = dPrim.getAttribute('WEIGHTS_0').getArray();
const dN = dPos.length / 3;
// collapse fingers into the hand
const fingerRe = /^(thumb|index|middle|ring|pinky)_/;
const collapse = new Array(J).fill(0).map((_, i) => i);
if (!flags['keep-fingers']) for (let i = 0; i < J; i++) if (fingerRe.test(names[i])) collapse[i] = jid('hand_' + names[i].slice(-1));
const dW = Array.from({ length: dN }, (_, v) => { const m = new Map(); for (let k = 0; k < 4; k++) { const w = dWt[v * 4 + k]; if (w > 0) { const j = collapse[dJ[v * 4 + k]]; m.set(j, (m.get(j) || 0) + w); } } return m; });
let dMin = [1e9, 1e9, 1e9], dMax = [-1e9, -1e9, -1e9];
for (let i = 0; i < dN; i++) for (let a = 0; a < 3; a++) { dMin[a] = Math.min(dMin[a], dPos[i * 3 + a]); dMax[a] = Math.max(dMax[a], dPos[i * 3 + a]); }

function skinVerts(pose, ids) { // returns Float64Array of posed positions (and normals) for vertex ids
  const M = pose.W.map((w, j) => m4mul(w, ibmRest[j]));
  const P = new Float64Array(ids.length * 3), N = new Float64Array(ids.length * 3);
  ids.forEach((v, o) => {
    const x = dPos[v * 3], y = dPos[v * 3 + 1], z = dPos[v * 3 + 2], nx = dNrm[v * 3], ny = dNrm[v * 3 + 1], nz = dNrm[v * 3 + 2];
    for (const [j, w] of dW[v]) { const m = M[j];
      P[o * 3] += w * (m[0] * x + m[4] * y + m[8] * z + m[12]); P[o * 3 + 1] += w * (m[1] * x + m[5] * y + m[9] * z + m[13]); P[o * 3 + 2] += w * (m[2] * x + m[6] * y + m[10] * z + m[14]);
      N[o * 3] += w * (m[0] * nx + m[4] * ny + m[8] * nz); N[o * 3 + 1] += w * (m[1] * nx + m[5] * ny + m[9] * nz); N[o * 3 + 2] += w * (m[2] * nx + m[6] * ny + m[10] * nz); }
    const l = Math.hypot(N[o * 3], N[o * 3 + 1], N[o * 3 + 2]) || 1; N[o * 3] /= l; N[o * 3 + 1] /= l; N[o * 3 + 2] /= l;
  });
  return { P, N };
}

// ------------------------------------------------------------------ meshy input
const inDoc = await io.read(inPath);
const inRoot = inDoc.getRoot();
const meshNode = inRoot.listNodes().find((n) => n.getMesh());
const mesh = meshNode.getMesh();
if (mesh.listPrimitives().length !== 1) throw new Error('expected a single primitive mesh');
const prim = mesh.listPrimitives()[0];
const aPos = prim.getAttribute('POSITION'), aNrm = prim.getAttribute('NORMAL');
const N = aPos.getCount();
const nw = meshNode.getWorldMatrix(); // bake node transform (normally identity)
const pos = new Float64Array(N * 3), nrm = new Float64Array(N * 3);
{ const pa = aPos.getArray(), na = aNrm ? aNrm.getArray() : null;
  for (let i = 0; i < N; i++) { const x = pa[i * 3], y = pa[i * 3 + 1], z = pa[i * 3 + 2];
    pos[i * 3] = nw[0] * x + nw[4] * y + nw[8] * z + nw[12]; pos[i * 3 + 1] = nw[1] * x + nw[5] * y + nw[9] * z + nw[13]; pos[i * 3 + 2] = nw[2] * x + nw[6] * y + nw[10] * z + nw[14];
    if (na) { const a = na[i * 3], b = na[i * 3 + 1], c = na[i * 3 + 2]; const v = V.norm([nw[0] * a + nw[4] * b + nw[8] * c, nw[1] * a + nw[5] * b + nw[9] * c, nw[2] * a + nw[6] * b + nw[10] * c]); nrm.set(v, i * 3); } } }
// 1. align
let mMin = [1e9, 1e9, 1e9], mMax = [-1e9, -1e9, -1e9];
for (let i = 0; i < N; i++) for (let a = 0; a < 3; a++) { mMin[a] = Math.min(mMin[a], pos[i * 3 + a]); mMax[a] = Math.max(mMax[a], pos[i * 3 + a]); }
const dH = flags.height ? +flags.height + dMin[1] : dMax[1];
const scale = (dH - dMin[1]) / (mMax[1] - mMin[1]);
const feetC = (P, n, y0, y1) => { let x = 0, z = 0, c = 0; for (let i = 0; i < n; i++) if (P[i * 3 + 1] >= y0 && P[i * 3 + 1] <= y1) { x += P[i * 3]; z += P[i * 3 + 2]; c++; } return [x / c, z / c]; };
const dFeet = feetC(dPos, dN, dMin[1], dMin[1] + 0.12);
for (let i = 0; i < N; i++) for (let a = 0; a < 3; a++) pos[i * 3 + a] *= scale;
const mFeet = feetC(pos, N, mMin[1] * scale, mMin[1] * scale + 0.12);
const off = [dFeet[0] - mFeet[0], dMin[1] - mMin[1] * scale, dFeet[1] - mFeet[1]];
for (let i = 0; i < N; i++) for (let a = 0; a < 3; a++) pos[i * 3 + a] += off[a];
console.log(`scale ${scale.toFixed(4)} offset ${off.map((v) => v.toFixed(3))}  donor H ${(dMax[1] - dMin[1]).toFixed(3)} (y ${dMin[1].toFixed(3)}..${dMax[1].toFixed(3)})`);
const mGrid = new Grid(Float32Array.from(pos), 0.04);

// 2. arm pose fit
const D2R = Math.PI / 180;
const dirFrom = (sx, a, b) => [sx * Math.cos(a) * Math.cos(b), Math.sin(a) * Math.cos(b), Math.sin(b)];
const groupOf = (set) => { const ids = []; for (let v = 0; v < dN; v++) { let s = 0; for (const [j, w] of dW[v]) if (set.has(j)) s += w; if (s > 0.5) ids.push(v); } return ids; };
const costOf = (pose, ids) => { const { P } = skinVerts(pose, ids); let s = 0; for (let o = 0; o < ids.length; o++) s += mGrid.nearestDist(P[o * 3], P[o * 3 + 1], P[o * 3 + 2], 0.12); return s / ids.length; };
const dirs = {};
if (!flags['no-fit']) for (const [s, sx] of [['l', 1], ['r', -1]]) {
  const up = jid('upperarm_' + s), lo = jid('lowerarm_' + s);
  const gU = groupOf(new Set([up])), gL = groupOf(new Set([lo, jid('hand_' + s)]));
  const sub = (v, st) => v.filter((_, i) => i % st === 0);
  const gUs = sub(gU, 3), gLs = sub(gL, 3);
  let best = { c: 1e9 };
  for (let a = -110; a <= 70; a += 10) for (let b = -50; b <= 90; b += 10) {
    const c = costOf(fk({ [up]: dirFrom(sx, a * D2R, b * D2R) }), gUs); if (c < best.c) best = { c, a, b };
  }
  const pu = { a: best.a, b: best.b }; console.log(s, 'upper init', pu, best.c.toFixed(4));
  best = { c: 1e9 };
  for (let a = -150; a <= 100; a += 10) for (let b = -90; b <= 90; b += 10) {
    const c = costOf(fk({ [up]: dirFrom(sx, pu.a * D2R, pu.b * D2R), [lo]: dirFrom(sx, a * D2R, b * D2R) }), gLs); if (c < best.c) best = { c, a, b };
  }
  const pl = { a: best.a, b: best.b }; console.log(s, 'lower init', pl, best.c.toFixed(4));
  const total = (pu, pl) => { const pose = fk({ [up]: dirFrom(sx, pu.a * D2R, pu.b * D2R), [lo]: dirFrom(sx, pl.a * D2R, pl.b * D2R) }); return costOf(pose, gUs) + costOf(pose, gLs); };
  let cur = total(pu, pl);
  for (let step = 8; step >= 1; step /= 2) for (let it = 0; it < 6; it++) { let improved = false;
    for (const t of [pu, pl]) for (const k of ['a', 'b']) for (const d of [-step, step]) { const old = t[k]; t[k] += d; const c = total(pu, pl); if (c < cur - 1e-6) { cur = c; improved = true; } else t[k] = old; }
    if (!improved) break; }
  console.log(s, 'fit', pu, pl, 'cost', cur.toFixed(4));
  dirs[up] = dirFrom(sx, pu.a * D2R, pu.b * D2R); dirs[lo] = dirFrom(sx, pl.a * D2R, pl.b * D2R);
}
const pose = fk(dirs);
const all = Array.from({ length: dN }, (_, i) => i);
const posed = skinVerts(pose, all);
const dGrid = new Grid(Float32Array.from(posed.P), 0.04);

// 3a. weld coincident vertices (UV seams) and build adjacency
const wkey = new Map(); const canon = new Int32Array(N); const reps = [];
for (let i = 0; i < N; i++) { const k = `${Math.round(pos[i * 3] * 1e4)},${Math.round(pos[i * 3 + 1] * 1e4)},${Math.round(pos[i * 3 + 2] * 1e4)}`; let c = wkey.get(k); if (c === undefined) { c = reps.length; reps.push(i); wkey.set(k, c); } canon[i] = c; }
const C = reps.length;
const adj = Array.from({ length: C }, () => new Set());
const idx = prim.getIndices().getArray();
for (let t = 0; t < idx.length; t += 3) for (let e = 0; e < 3; e++) { const a = canon[idx[t + e]], b = canon[idx[t + (e + 1) % 3]]; if (a !== b) { adj[a].add(b); adj[b].add(a); } }
// 3. weight transfer
const LAMBDA = 0.05;
const W = new Float32Array(N * J);
const transfer = (i, ban) => { // ban: Set of joints whose weight must stay < 0.25 in the chosen donor vertex
  const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
  const cand = dGrid.knn(x, y, z, ban ? 64 : 16); let bestV = -1, bestC = 1e9;
  for (const [d2, v] of cand) {
    if (ban) { let b = 0; for (const [j, w] of dW[v]) if (ban.has(j)) b += w; if (b >= 0.25) continue; }
    const dn = nrm[i * 3] * posed.N[v * 3] + nrm[i * 3 + 1] * posed.N[v * 3 + 1] + nrm[i * 3 + 2] * posed.N[v * 3 + 2];
    const c = Math.sqrt(d2) + LAMBDA * (1 - dn); if (c < bestC) { bestC = c; bestV = v; } }
  if (bestV < 0) bestV = cand[0][1];
  for (let j = 0; j < J; j++) W[i * J + j] = 0;
  for (const [j, w] of dW[bestV]) W[i * J + j] += w;
};
for (let i = 0; i < N; i++) transfer(i, null);
// 3b. arm clean-up: arm-classified vertices must be connected to a sleeve (upperarm/lowerarm dominated) and hands may only
//     extend HAND_REACH metres from it; everything else (pocket cloth, belt, hip) is re-assigned with the arm joints banned.
const HAND_REACH = +(flags.reach ?? 0.14);
const ARM_MIN_Y = +(flags['arm-min-y'] ?? -1e9); // arms raised/spread: no arm weights below this height (shirt hems, skirts)
for (const s of ['l', 'r']) {
  const up = jid('upperarm_' + s), lo = jid('lowerarm_' + s), hd = jid('hand_' + s); const armSet = new Set([up, lo, hd]);
  const cls = new Uint8Array(C), sleeve = new Uint8Array(C);
  for (let c = 0; c < C; c++) { const r = reps[c]; const a = W[r * J + up], l = W[r * J + lo], h = W[r * J + hd]; cls[c] = a + l + h > 0.5 ? 1 : 0; sleeve[c] = cls[c] && a + l > 0.5 ? 1 : 0; }
  const dist = new Float32Array(C).fill(1e9); const queue = []; for (let c = 0; c < C; c++) if (sleeve[c]) { dist[c] = 0; queue.push(c); }
  // Dijkstra-lite (label-correcting) through arm-classified vertices
  const cpos = (c) => [pos[reps[c] * 3], pos[reps[c] * 3 + 1], pos[reps[c] * 3 + 2]];
  while (queue.length) { const c = queue.shift(); for (const b of adj[c]) { if (!cls[b]) continue; const nd = dist[c] + V.len(V.sub(cpos(c), cpos(b))); if (nd < dist[b]) { dist[b] = nd; queue.push(b); } } }
  let moved = 0;
  for (let c = 0; c < C; c++) {
    if (!cls[c]) continue; const isHand = !sleeve[c];
    if (dist[c] > (isHand ? HAND_REACH : 1e8) || pos[reps[c] * 3 + 1] < ARM_MIN_Y) { moved++; for (let i = 0; i < N; i++) if (canon[i] === c) transfer(i, armSet); }
  }
  console.log(s, 'arm clean-up reassigned', moved, 'of', cls.reduce((t, v) => t + v, 0));
}
// 5. smooth (welded)
let cw = new Float32Array(C * J);
{ const cnt = new Float32Array(C); for (let i = 0; i < N; i++) { const c = canon[i]; cnt[c]++; for (let j = 0; j < J; j++) cw[c * J + j] += W[i * J + j]; } for (let c = 0; c < C; c++) for (let j = 0; j < J; j++) cw[c * J + j] /= cnt[c]; }
const PASSES = +(flags.passes ?? 3), ALPHA = 0.5;
for (let p = 0; p < PASSES; p++) {
  const nw2 = new Float32Array(C * J);
  for (let c = 0; c < C; c++) { const nb = [...adj[c]]; if (!nb.length) { for (let j = 0; j < J; j++) nw2[c * J + j] = cw[c * J + j]; continue; }
    for (let j = 0; j < J; j++) { let s = 0; for (const b of nb) s += cw[b * J + j]; nw2[c * J + j] = (1 - ALPHA) * cw[c * J + j] + ALPHA * s / nb.length; } }
  cw = nw2;
}
const jOut = new Uint8Array(N * 4), wOut = new Float32Array(N * 4);
for (let i = 0; i < N; i++) {
  const c = canon[i]; const arr = []; for (let j = 0; j < J; j++) if (cw[c * J + j] > 1e-4) arr.push([j, cw[c * J + j]]);
  arr.sort((a, b) => b[1] - a[1]); const top = arr.slice(0, 4); const s = top.reduce((t, a) => t + a[1], 0) || 1;
  if (!top.length) top.push([jid('pelvis'), 1]);
  for (let k = 0; k < 4; k++) { jOut[i * 4 + k] = top[k] ? top[k][0] : 0; wOut[i * 4 + k] = top[k] ? top[k][1] / (top.length ? s : 1) : 0; }
}

// 6. write
const outDoc = inDoc; const root = outDoc.getRoot();
const scene = root.listScenes()[0];
const buf = root.listBuffers()[0];
prim.setAttribute('POSITION', outDoc.createAccessor().setType('VEC3').setArray(Float32Array.from(pos)).setBuffer(buf));
prim.setAttribute('JOINTS_0', outDoc.createAccessor().setType('VEC4').setArray(jOut).setBuffer(buf));
prim.setAttribute('WEIGHTS_0', outDoc.createAccessor().setType('VEC4').setArray(wOut).setBuffer(buf));
const jn = joints.map((n, i) => outDoc.createNode(names[i]).setTranslation(tLoc[i]).setRotation(pose.ql[i]));
joints.forEach((n, i) => { if (parent[i] >= 0) jn[parent[i]].addChild(jn[i]); });
const arm = outDoc.createNode('Armature');
const rootJoint = jn[parent.findIndex((p) => p < 0)];
const newMeshNode = outDoc.createNode(path.basename(outPath, '.glb')).setMesh(mesh);
arm.addChild(newMeshNode); arm.addChild(rootJoint);
for (const ch of scene.listChildren()) scene.removeChild(ch);
meshNode.dispose(); scene.addChild(arm);
const ibmArr = new Float32Array(J * 16); pose.W.forEach((w, j) => ibmArr.set(m4rigidInv(w), j * 16));
const skin = outDoc.createSkin('Skin').setSkeleton(rootJoint).setInverseBindMatrices(outDoc.createAccessor().setType('MAT4').setArray(ibmArr).setBuffer(buf));
jn.forEach((n) => skin.addJoint(n));
newMeshNode.setSkin(skin);
for (const a of root.listAnimations()) a.dispose();
await io.write(outPath, outDoc);
console.log('wrote', outPath, (fs.statSync(outPath).size / 1024).toFixed(0) + ' KB', 'verts', N);
