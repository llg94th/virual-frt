# Meshy figures rigged to the Quaternius skeleton

`professional_rigged.glb`, `teacher_rigged.glb`, `open_arms_rigged.glb` are the static Meshy figures
(`../professional.glb`, `../teacher.glb`, `../open_arms.glb`) skinned onto the Quaternius UE-mannequin skeleton
(same node names/hierarchy as `quaternius/base/Superhero_*_FullBody.gltf`), so they play the clips of
`quaternius/UAL1_Standard.glb` by bone name. The files contain NO animations, only the mesh (PBR + EXT_texture_webp kept) and one skin (65 joints).

## Pipeline (`tools/rig/autorig.mjs`, plain Node, no Blender)
1. Align the Meshy mesh to the donor body: uniform scale to donor height (1.82 m), feet on donor feet (y=-0.01), x/z centred on the feet centroid, +Z faces front. Baked into the vertex positions.
2. The donor skeleton is a T-pose; the Meshy poses are not. A per-arm 2-bone fit (upperarm/lowerarm world directions, grid search + coordinate descent on a donor->Meshy chamfer distance) bends the donor into the figure's arm pose. That posed skeleton is the BIND pose: inverseBindMatrices = inverse(posed joint world matrices) and node rest rotations are the posed ones, so the rest pose renders exactly like the static mesh and UAL clips (absolute local rotations) move it correctly.
3. Weight transfer from the posed donor body: nearest of the 16 closest donor vertices (distance + normal-disagreement penalty), finger weights collapsed onto `hand_l/r`. Arm-classified vertices not connected to a sleeve, or further than `--reach` from it (pocket cloth, belts), are re-assigned with arm joints banned.
4. Weld coincident vertices, Laplacian smoothing (`--passes`, default 3), keep 4 strongest influences, renormalise.

## Re-run
```
npm i --no-save @gltf-transform/core @gltf-transform/extensions
node tools/rig/autorig.mjs public/models/meshy/professional.glb public/models/meshy/rigged/professional_rigged.glb male --reach=0 --passes=6
node tools/rig/autorig.mjs public/models/meshy/teacher.glb      public/models/meshy/rigged/teacher_rigged.glb      female
node tools/rig/autorig.mjs public/models/meshy/open_arms.glb    public/models/meshy/rigged/open_arms_rigged.glb    male --arm-min-y=1.2
```
Flags: `--reach=0.14` (hand reach from sleeve, 0 pins pocket hands), `--passes=3`, `--arm-min-y=Y`, `--height=1.82`, `--no-fit` (skip arm fit), `--keep-fingers`. `RIG_DONOR_DIR` overrides the donor folder.

## Facts for integration
- Bind/rest pose of the *output* skeleton = fitted figure pose (arms down / forward / spread); the donor itself is a T-pose (arms along +/-X at y=1.455).
- Facing +Z, +X = character's left (`*_l`), Y up, feet at y~0, height ~1.82 m (scale the node if you need 1.7-1.8 m).
- Root bone `root` -> `pelvis` -> `spine_01..03` -> `neck_01` -> `Head`; mesh node and `root` sit under an `Armature` node.
- Known artefacts: hands-in-pockets (professional) pull pocket cloth when arms are raised (Interact / Sitting_Talking); loose shirt/jacket hems and the armpit web stretch with arms; skirts stretch in Jog; high-heel feet rotate with the flat donor foot; hair is not separately rigged (follows Head/neck/shoulders).
