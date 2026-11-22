# mixamo/

`boy.glb`: Meshy character (boy, white T-shirt) rigged on Mixamo (65 bones, `mixamorig:*`; three.js reads them as `mixamorigHips`…), 1.2 m tall, base-color texture (WebP), mesh quantized (no Draco; GLTFLoader reads it without extra decoders).

Built with the `mixamo-to-glb` skill (`merge_mixamo_fbx.py --texture --height 1.2`); Mixamo clips were downloaded Without Skin at 30 fps and retargeted in world space (the uploaded model was not in T-pose).

| Clip | Mixamo source | Notes |
|---|---|---|
| `Idle` | Breathing Idle | loop, standing |
| `Walk` | Walking (Male Standard Walk), In Place | loop; move the character in code |
| `Typing` | Typing | loop, seated (hips 0.30 m), hands on keyboard |
| `SitToType` / `TypeToSit` | Sit To Type / Type To Sit | seated transitions, play once |
| `StandToSit` / `SitToStand` | Stand To Sit / Sit To Stand | once; hips 0.53 -> 0.30 m and ~0.26 m back towards the chair |
| `SitDesk` | Seated Idle (hands on a table) | loop, seated at a desk |
| `SitIdle` | Sitting Idle (breathing) | loop, seated |
| `Meeting` | Having A Meeting, Male | loop, seated talking (46 s) |
| `Waving` | Waving | short loop (0.6 s) |
| `Greeting` | Standing Greeting | once |
| `Handshake` | Shaking Hands 2 | once (partner faces the boy) |
| `Bow` | Quick Informal Bow | once |
| `Talking` | Talking | loop, standing |
| `Phone` | Talking On A Cell Phone | loop, standing (37 s) |

Seated clips assume a seat at hips height ~0.30 m for this 1.2 m character; there is no chair in the file.
