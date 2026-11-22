#!/usr/bin/env node
/** tris.mjs <dir> - triangle count per GLB (instanced props multiply this by their placement count) */
import { NodeIO } from '@gltf-transform/core'; import fs from 'fs';
const io = new NodeIO(); const d = process.argv[2];
const out = [];
for (const f of fs.readdirSync(d)) { const doc = await io.read(d + '/' + f); let t = 0; let bad = 0; for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) { t += p.getAttribute('POSITION').getCount() / 3; for (const k of ['POSITION', 'NORMAL', 'COLOR_0']) { const a = p.getAttribute(k); if (a) for (const v of a.getArray()) if (!Number.isFinite(v)) bad++; const n = p.getAttribute('NORMAL').getArray(); for (let i = 0; i < n.length; i += 3) if (Math.hypot(n[i], n[i + 1], n[i + 2]) < 1e-3) bad++; } } out.push(f.replace('.glb', '') + ':' + t + (bad ? ' BAD' + bad : '')); }
console.log(out.join(' '));
