#!/usr/bin/env node
/** convert.mjs <packDir> <outDir> [slug,slug..] - Office Pack OBJ/FBX -> small flat-colour GLB props, one primitive per material colour,
 *  bottom-centre origin, front on +z. Textured OBJ materials (map_Kd *.png) are baked to per-triangle COLOR_0 sampled at the
 *  triangle centroid UV, so mugs / rugs / clock faces keep their look without any texture.
 *  entry: slug: [folder, file, height(m), {ry: yaw fix (rad), long: target longest horizontal side (m, replaces height), noflip}] */
import fs from 'fs'; import path from 'path'; import zlib from 'zlib';
import * as THREE from 'three';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { Document, NodeIO } from '@gltf-transform/core';
// FBXLoader touches window/document even for textureless parsing: stub the minimum
globalThis.window ??= globalThis; globalThis.self ??= globalThis;
globalThis.document ??= { createElementNS: () => ({ style: {}, addEventListener() {}, removeEventListener() {} }), createElement: () => ({ style: {}, getContext: () => null }) };
const [pack, out, only] = process.argv.slice(2);
const R = Math.PI / 2;
const LIST = {
  plant_white: ['Plant - White Pot', 'model.obj', 1.0], plant_a: ['Houseplant', 'Houseplant_2.fbx', 1.2], plant_b: ['Potted Plant', 'Potted_Plant.000.fbx', 0.8],
  cooler: ['Water Cooler', 'WaterCooler.obj', 1.15], vending: ['Vending Machine', 'vendo.fbx', 1.85], bookshelf: ['Medium Book Shelf', 'MediumBookShelf1.fbx', 1.7],
  couch: ['Couch Medium', 'Couch_Medium1.fbx', 0.85], coffee_table: ['Coffee Table', 'model.obj', 0.4], round_table: ['Table Large Circular', 'Table_large_circular.fbx', 0.75],
  lamp: ['Lamp', 'Lamp1.fbx', 1.5], floor_light: ['Light Floor', 'Light_Floor1.fbx', 1.6], bin: ['Trashcan', 'Trashcan_Cylindric.fbx', 0.5],
  printer: ['Printer', 'Printer.fbx', 0.55], cabinet: ['File Cabinet', 'FileCabinet.fbx', 1.3], extinguisher: ['Fire Extinguisher', 'Extinguisher.obj', 0.5],
  coat_rack: ['Coat rack', 'Coat_rack_01.obj', 1.75], whiteboard: ['Whiteboard', 'WhiteBoard_01.obj', 1.2],
  // --- batch 2 (orientation fixes verified on tools/props/sheet.html) ---
  mug: ['Mug', '496 Mugs.obj', 0.095, { long: 0.12 }], monitor: ['Monitor', '1337 iMac.obj', 0.42], keyboard: ['Keyboard', '1329_Keyboard.obj', 0.02, { long: 0.44 }], notebook: ['Notebook', 'Notebook_01.obj', 0.02, { long: 0.3 }],
  stapler: ['Stapler', 'Stapler.obj', 0.06, { long: 0.15 }], desk_light: ['Light Desk', 'Light_Desk.fbx', 0.4], bin2: ['Trash Bin', 'Trashbin.fbx', 0.45], bin_small: ['Trashcan Small', 'Trashcan_Small1.fbx', 0.3],
  shelf: ['Shelf', 'model.obj', 1.2, { ry: R }], wall_shelf: ['Wall Shelf', 'WallShelf.obj', 0.25, { ry: R }], rug: ['Rug', '512 Rug.obj', 0.02, { long: 3 }], rug_round: ['Rug Round', 'rugRound.obj', 0.02, { long: 1.8 }],
  blinds: ['Window Blinds', 'model.obj', 1.3], clock: ['Analog clock', '1345 Analog Clock.obj', 0.3, { ry: -R }], ceiling_light: ['Ceiling Light', 'Light_Ceiling2.fbx', 0.2],
  clipboard: ['clipboard', 'model.obj', 0.3, { ry: -R }], exit_sign: ['Fire Exit Sign', 'FireExitSign.fbx', 0.25, { ry: R }], paper_stack: ['Small Stack of Paper', 'model.obj', 0.05, { long: 0.3 }],
  sticky: ['Sticky Notes', 'Sticky notes.fbx', 0.03, { long: 0.08 }], coffee_cup: ['Coffee cup', 'CHAHIN_COFFEE_CUP.obj', 0.1], office_chair: ['Office Chair', 'OfficeChair.fbx', 1.0],
  phone: ['Office Phone', 'Phone.fbx', 0.1, { long: 0.22 }], books: ['Book Stack', 'model.obj', 0.15], box: ['Cardboard Box', 'Cardboard Box.fbx', 0.4], mouse: ['Mouse', 'Mouse.fbx', 0.035, { long: 0.1 }],
  msgboard: ['Message board', '1344 Message Board 02.obj', 0.8, { ry: -R }], tissue: ['Tissue Box', 'Tissue Box.fbx', 0.12], binder: ['Binder', 'Binder.obj', 0.3], pens: ['Pens', 'Pens.obj', 0.12, { long: 0.16 }],
  couch_small: ['Couch Small', 'Couch_Small1.fbx', 0.85], cushions: ['Cushions', 'cushions.obj', 0.2, { ry: R }], curtains: ['Curtains Double', 'Curtains_Double.fbx', 2.6], bins3: ['Bins', 'model.obj', 0.5],
  air_vent: ['Air Vent', 'AirVent.obj', 0.3, { ry: -R }], webcam: ['Webcam', 'webcam.fbx', 0.05], calendar: ['Calendar', 'Calender_01.obj', 0.35],
};
/** minimal PNG decoder (8-bit, non-interlaced, RGB/RGBA/gray) -> {w,h,px(x,y)->[r,g,b] 0..1 sRGB} */
function readPng(file) {
  const b = fs.readFileSync(file); let o = 8, w = 0, h = 0, ct = 2; const idat = [];
  while (o < b.length) { const len = b.readUInt32BE(o), t = b.toString('ascii', o + 4, o + 8), d = b.subarray(o + 8, o + 8 + len); if (t === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); ct = d[9]; } if (t === 'IDAT') idat.push(d); o += 12 + len; }
  const bpp = { 0: 1, 2: 3, 4: 2, 6: 4 }[ct]; if (!bpp) throw new Error('png type ' + ct);
  const raw = zlib.inflateSync(Buffer.concat(idat)), st = w * bpp, img = Buffer.alloc(h * st);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (st + 1)], line = raw.subarray(y * (st + 1) + 1, (y + 1) * (st + 1));
    for (let x = 0; x < st; x++) {
      const a = x >= bpp ? img[y * st + x - bpp] : 0, up = y ? img[(y - 1) * st + x] : 0, c = x >= bpp && y ? img[(y - 1) * st + x - bpp] : 0;
      let v = line[x];
      if (f === 1) v += a; else if (f === 2) v += up; else if (f === 3) v += (a + up) >> 1;
      else if (f === 4) { const p = a + up - c, pa = Math.abs(p - a), pb = Math.abs(p - up), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? up : c; }
      img[y * st + x] = v & 255;
    }
  }
  return { w, h, px: (u, v) => { const x = Math.min(w - 1, Math.max(0, Math.floor((((u % 1) + 1) % 1) * w))), y = Math.min(h - 1, Math.max(0, Math.floor((1 - (((v % 1) + 1) % 1)) * h))); const i = y * st + x * bpp; return bpp < 3 ? [img[i] / 255, img[i] / 255, img[i] / 255] : [img[i] / 255, img[i + 1] / 255, img[i + 2] / 255]; } };
}
function loadObj(dir, file) {
  const base = file.replace(/\.obj$/, '');
  const mtlFile = fs.existsSync(path.join(dir, base + '.mtl')) ? base + '.mtl' : fs.readdirSync(dir).find((f) => f.endsWith('.mtl'));
  const loader = new OBJLoader(); const tex = {};
  if (mtlFile) {
    const txt = fs.readFileSync(path.join(dir, mtlFile), 'utf8');
    const m = new MTLLoader().parse(txt.replace(/^\s*map_\w+.*$/gm, ''), ''); m.preload(); loader.setMaterials(m);
    let cur = ''; for (const ln of txt.split(/\r?\n/)) { const t = ln.trim().split(/\s+/); if (t[0] === 'newmtl') cur = t.slice(1).join(' '); if (t[0] === 'map_Kd' && /\.png$/i.test(ln)) { try { tex[cur] = readPng(path.join(dir, ln.trim().replace(/^map_Kd\s+/, ''))); } catch (e) { console.log('  tex', e.message); } } }
  }
  const root = loader.parse(fs.readFileSync(path.join(dir, file), 'utf8')); root.userData.tex = tex; return root;
}
function loadFbx(dir, file) { const b = fs.readFileSync(path.join(dir, file)); return new FBXLoader().parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), dir + '/'); }
fs.mkdirSync(out, { recursive: true });
const want = only ? only.split(',') : null;
for (const [slug, [folder, file, H, opt = {}]] of Object.entries(LIST)) {
  if (want && !want.includes(slug)) continue;
  try {
    const dir = path.join(pack, folder);
    const root = file.endsWith('.obj') ? loadObj(dir, file) : loadFbx(dir, file);
    const tex = root.userData.tex ?? {};
    if (opt.ry) root.rotation.y = opt.ry;
    root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(root); const size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
    const s = opt.long ? opt.long / Math.max(size.x, size.z, 1e-6) : H / (size.y || 1);
    const doc = new Document(); const buf = doc.createBuffer(); const mesh = doc.createMesh(slug);
    const groups = new Map();
    root.traverse((o) => {
      if (!o.isMesh) return;
      const g = o.geometry.clone().applyMatrix4(o.matrixWorld); const pos = g.attributes.position, uv = g.attributes.uv;
      if (!g.attributes.normal) g.computeVertexNormals();
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      const ranges = g.groups.length ? g.groups : [{ start: 0, count: g.index ? g.index.count : pos.count, materialIndex: 0 }];
      for (const r of ranges) {
        const m = mats[r.materialIndex] ?? mats[0]; const t = uv && tex[m.name]; const col = t ? new THREE.Color(1, 1, 1) : (m.color ?? new THREE.Color('#bbbbbb'));
        const key = t ? 'tex:' + m.name : '#' + col.getHexString(); let gr = groups.get(key); if (!gr) groups.set(key, gr = { col, p: [], n: [], c: t ? [] : null });
        for (let i = r.start; i < r.start + r.count; i += 3) {
          let cc = null;
          if (t) { let u = 0, v = 0; for (let k = 0; k < 3; k++) { const vi = g.index ? g.index.getX(i + k) : i + k; u += uv.getX(vi) / 3; v += uv.getY(vi) / 3; } const [pr, pg, pb] = t.px(u, v); cc = new THREE.Color().setRGB(pr, pg, pb, THREE.SRGBColorSpace); }
          for (let k = 0; k < 3; k++) {
            const v = g.index ? g.index.getX(i + k) : i + k;
            gr.p.push((pos.getX(v) - c.x) * s, (pos.getY(v) - box.min.y) * s, (pos.getZ(v) - c.z) * s); gr.n.push(g.attributes.normal.getX(v), g.attributes.normal.getY(v), g.attributes.normal.getZ(v));
            if (cc) gr.c.push(cc.r, cc.g, cc.b);
          }
        }
      }
    });
    for (const [, gr] of groups) {
      const mat = doc.createMaterial().setBaseColorFactor([gr.col.r, gr.col.g, gr.col.b, 1]).setRoughnessFactor(0.8).setMetallicFactor(0);
      const prim = doc.createPrimitive().setMaterial(mat)
        .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(gr.p)).setBuffer(buf))
        .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(new Float32Array(gr.n)).setBuffer(buf));
      if (gr.c) prim.setAttribute('COLOR_0', doc.createAccessor().setType('VEC3').setArray(new Float32Array(gr.c)).setBuffer(buf));
      mesh.addPrimitive(prim);
    }
    doc.createScene().addChild(doc.createNode(slug).setMesh(mesh));
    await new NodeIO().write(path.join(out, slug + '.glb'), doc);
    console.log(slug, 'ok', size.toArray().map((v) => +v.toFixed(2)).join('x'), 'groups', groups.size, [...groups.keys()].filter((k) => k.startsWith('tex')).length ? 'textured' : '');
  } catch (e) { console.log(slug, 'FAIL', String(e.message ?? e).slice(0, 80)); }
}
