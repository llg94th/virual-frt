# 3D asset credits (city3d)

All third-party models below are CC0 / public domain (no attribution required, credited out of courtesy).

| Folder | Source | License |
|---|---|---|
| `kenney/car-kit`, `kenney/city-*`, `kenney/furniture`, `kenney/urban`, `kenney/nature` | Kenney (https://kenney.nl) – Car Kit, City Kit (Commercial/Roads/Suburban), Furniture Kit, Retro Urban Kit, Nature Kit | CC0 1.0 |
| `kaykit/furniture` | Kay Lousberg – KayKit Furniture Bits (free, CC0; home-style furniture, currently not wired into the scene) | CC0 1.0 |
| `meshy/shipper.glb` | Provided by the project owner (Meshy: 'GiaoHangNhanh Deliver…' – delivery rider on a motorbike); decimated + WebP textures. Static mesh. Brand (Giao Hàng Nhanh) belongs to its owner – demo use | owner-provided |
| `longchau.glb` | Generated with Meshy (image-to-3D) from the Long Châu mascot reference photo in `public/mascot-refs/` – brand mascot belongs to FPT Retail / Long Châu | internal demo use |

Photo reference of the real F-Town 3 atrium (SGGP, 2019) was used only as a visual guide for the procedural facade; no image is redistributed.

| `office/*.glb` | "Office Pack" provided by the project owner (OBJ/FBX converted by `tools/props/convert.mjs`, flat material colours only) – licence stated by the owner as free to use | owner-provided |


| `plants/ficus.glb`, `plants/alocasia.glb`, `plants/haworthia.glb`, `plants/pachira.glb`, `plants/calathea.glb`, `plants/fern.glb` | Poly Haven (https://polyhaven.com) 3D models `potted_plant_01`, `potted_plant_02`, `potted_plant_04`, `pachira_aquatica_01` (variant b), `calathea_orbifolia_01` (variant b), `fern_02` – photogrammetry scans by Rob Tuytel / Rico Cilliers et al. Downloaded via https://api.polyhaven.com/files/<id> (1k glTF), decimated with meshoptimizer to ~2.5-10k tris, base-colour only, 512 px WebP (pipeline: gltf-transform `weld`/`simplify`/`textureCompress`). Pachira/calathea/fern get a procedural pot in `src/city3d/tower/vegProps.ts` | CC0 1.0 |
| street / park / courtyard / rooftop trees, palms, bushes, flower clumps | Procedural (no download): `src/city3d/world/vegetation.ts` paints its own leaf / bark / frond / blossom atlas on a canvas at runtime and builds leaf-card canopies. Replaces the Kenney Nature Kit tree/palm/bush/flower models (still shipped in `kenney/nature/` for rocks, lily pads, fences, paths). Tried and rejected as too heavy for ~1000 street trees: Poly Haven `island_tree_01/02`, `jacaranda_tree`, `tree_small_02` (0.9-3.9 M tris each, leaf geometry does not survive decimation) | n/a |

| `mixamo/boy.glb` | The one human model of the project: Meshy boy rigged on Mixamo with Mixamo clips (see mixamo/README.md). All earlier human models (Quaternius, Meshy open_arms/professional/teacher, RPM avatars) were removed | owner-provided |