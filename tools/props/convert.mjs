#!/usr/bin/env node
/** convert.mjs <packDir> <outDir> - Office Pack OBJ/FBX -> small flat-colour GLB props (one primitive per material colour),
 *  normalised to a target height, bottom-centre origin. Textures are ignored (colour = material Kd / diffuse). */
import fs from 'fs'; import path from 'path';
import * as THREE from 'three';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { Document, NodeIO } from '@gltf-transform/core';
const [pack, out] = process.argv.slice(2);
// slug: [folder, file, targetHeight(m)]  (height 0 = fit longest side to `w`)
const LIST = {
  plant_white: ['Plant - White Pot', 'model.obj', 1.0], plant_a: ['Houseplant', 'Houseplant_2.fbx', 1.2], plant_b: ['Potted Plant', 'Potted_Plant.000.fbx', 0.8],
  cooler: ['Water Cooler', 'WaterCooler.obj', 1.15], vending: ['Vending Machine', 'vendo.fbx', 1.85], bookshelf: ['Medium Book Shelf', 'MediumBookShelf1.fbx', 1.7],
  couch: ['Couch Medium', 'Couch_Medium1.fbx', 0.85], coffee_table: ['Coffee Table', 'model.obj', 0.4], round_table: ['Table Large Circular', 'Table_large_circular.fbx', 0.75],
  lamp: ['Lamp', 'Lamp1.fbx', 1.5], floor_light: ['Light Floor', 'Light_Floor1.fbx', 1.6], bin: ['Trashcan', 'Trashcan_Cylindric.fbx', 0.5],
  printer: ['Printer', 'Printer.fbx', 0.55], cabinet: ['File Cabinet', 'FileCabinet.fbx', 1.3], extinguisher: ['Fire Extinguisher', 'Extinguisher.obj', 0.5],
  coat_rack: ['Coat rack', 'Coat_rack_01.obj', 1.75], whiteboard: ['Whiteboard', 'WhiteBoard_01.obj', 1.2], art2: ['Wall Art 02', 'model.obj', 0.9], art3: ['Wall Art 03', 'model.obj', 0.9], art5: ['Wall Art 05', 'model.obj', 0.9],
};
function loadObj(dir, file) {
  const base = file.replace(/\.obj$/, '');
  const mtlFile = fs.existsSync(path.join(dir, base + '.mtl')) ? base + '.mtl' : fs.readdirSync(dir).find((f) => f.endsWith('.mtl'));
  const loader = new OBJLoader();
  if (mtlFile) { const m = new MTLLoader().parse(fs.readFileSync(path.join(dir, mtlFile), 'utf8'), ''); m.preload(); loader.setMaterials(m); }
  return loader.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
}
function loadFbx(dir, file) { const b = fs.readFileSync(path.join(dir, file)); return new FBXLoader().parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), dir + '/'); }
fs.mkdirSync(out, { recursive: true });
for (const [slug, [folder, file, H]] of Object.entries(LIST)) {
  try {
    const dir = path.join(pack, folder);
    const root = file.endsWith('.obj') ? loadObj(dir, file) : loadFbx(dir, file);
    root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(root); const size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
    const up = size.y; const s = H / (up || 1);
    const doc = new Document(); const buf = doc.createBuffer(); const mesh = doc.createMesh(slug);
    const groups = new Map();
    root.traverse((o) => {
      if (!o.isMesh) return;
      const g = o.geometry.clone().applyMatrix4(o.matrixWorld); const pos = g.attributes.position;
      if (!g.attributes.normal) g.computeVertexNormals();
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      const ranges = g.groups.length ? g.groups : [{ start: 0, count: g.index ? g.index.count : pos.count, materialIndex: 0 }];
      for (const r of ranges) {
        const m = mats[r.materialIndex] ?? mats[0]; const col = m.color ?? new THREE.Color('#bbbbbb');
        const key = '#' + col.getHexString(); let gr = groups.get(key); if (!gr) groups.set(key, gr = { col, p: [], n: [] });
        for (let i = r.start; i < r.start + r.count; i++) { const v = g.index ? g.index.getX(i) : i; gr.p.push((pos.getX(v) - c.x) * s, (pos.getY(v) - box.min.y) * s, (pos.getZ(v) - c.z) * s); gr.n.push(g.attributes.normal.getX(v), g.attributes.normal.getY(v), g.attributes.normal.getZ(v)); }
      }
    });
    for (const [, gr] of groups) {
      const mat = doc.createMaterial().setBaseColorFactor([gr.col.r, gr.col.g, gr.col.b, 1]).setRoughnessFactor(0.8).setMetallicFactor(0);
      const prim = doc.createPrimitive().setMaterial(mat)
        .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(gr.p)).setBuffer(buf))
        .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(new Float32Array(gr.n)).setBuffer(buf));
      mesh.addPrimitive(prim);
    }
    doc.createScene().addChild(doc.createNode(slug).setMesh(mesh));
    await new NodeIO().write(path.join(out, slug + '.glb'), doc);
    console.log(slug, 'ok', size.toArray().map((v) => +v.toFixed(2)).join('x'), 'groups', groups.size);
  } catch (e) { console.log(slug, 'FAIL', String(e.message ?? e).slice(0, 80)); }
}
