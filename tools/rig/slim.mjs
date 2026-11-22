// Drop normal / metallic-roughness / emissive textures (NPC bodies only use baseColor): node tools/rig/slim.mjs <in.glb> [out.glb]
import { NodeIO } from '@gltf-transform/core';
import { EXTTextureWebP } from '@gltf-transform/extensions';
const [inp, out = inp] = process.argv.slice(2);
const io = new NodeIO().registerExtensions([EXTTextureWebP]);
const doc = await io.read(inp);
for (const m of doc.getRoot().listMaterials()) { m.setNormalTexture(null); m.setMetallicRoughnessTexture(null); m.setEmissiveTexture(null); m.setOcclusionTexture(null); m.setEmissiveFactor([0, 0, 0]); m.setMetallicFactor(0); m.setRoughnessFactor(0.85); }
for (const t of doc.getRoot().listTextures()) if (t.listParents().filter((p) => p.propertyType !== 'Root').length === 0) t.dispose();
await io.write(out, doc);
