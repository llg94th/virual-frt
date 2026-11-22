/** Dev-only contact sheet: ?names=a,b,c&cols=8&cam=front|top|side. Shows each office prop on a cell with a red arrow = model front (+z). */
import * as THREE from 'three';
import { requestProps, getProp } from '../../src/city3d/tower/props';
const q = new URLSearchParams(location.search);
const names = (q.get('names') ?? '').split(',').filter(Boolean);
const cols = +(q.get('cols') ?? 8), cell = +(q.get('cell') ?? 1.6), view = q.get('cam') ?? 'front';
const r = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true }); r.setSize(innerWidth, innerHeight); document.body.appendChild(r.domElement);
const scene = new THREE.Scene(); scene.background = new THREE.Color('#cfd8dc');
scene.add(new THREE.HemisphereLight('#ffffff', '#778899', 1.6)); const dl = new THREE.DirectionalLight('#ffffff', 2); dl.position.set(3, 8, 6); scene.add(dl);
requestProps(names.map((n) => 'o:' + n));
const rows = Math.ceil(names.length / cols);
const W = cols * cell, D = rows * cell;
const cam = new THREE.PerspectiveCamera(35, innerWidth / innerHeight, 0.1, 200);
const cx = W / 2 - cell / 2, cz = D / 2 - cell / 2;
if (view === 'top') { cam.position.set(cx, Math.max(W, D) * 1.4, cz + 0.01); cam.lookAt(cx, 0, cz); }
else if (view === 'side') { cam.position.set(cx + W * 1.3, 2.5, cz + 2); cam.lookAt(cx, 0.8, cz); }
else { cam.position.set(cx, Math.max(W, D) * 0.85, cz + Math.max(W, D) * 1.15); cam.lookAt(cx, 0.6, cz); }
const done = new Set<string>();
const label = (t: string, x: number, z: number) => {
  const c = document.createElement('canvas'); c.width = 256; c.height = 48; const g = c.getContext('2d')!; g.fillStyle = '#fff'; g.fillRect(0, 0, 256, 48); g.fillStyle = '#000'; g.font = '28px sans-serif'; g.fillText(t, 6, 34);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(cell * 0.9, cell * 0.17), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c) })); m.rotation.x = -Math.PI / 2; m.position.set(x, 0.01, z + cell * 0.42); scene.add(m);
};
const bbox: string[] = [];
function tick() {
  names.forEach((n, i) => {
    if (done.has(n)) return; const p = getProp('o:' + n); if (!p) return; done.add(n);
    const x = (i % cols) * cell, z = Math.floor(i / cols) * cell;
    const mesh = new THREE.Mesh(p.main, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 })); mesh.position.set(x, 0, z); scene.add(mesh);
    p.main.computeBoundingBox(); const s = p.main.boundingBox!.getSize(new THREE.Vector3()); bbox.push(`${n}:${s.x.toFixed(2)}x${s.y.toFixed(2)}x${s.z.toFixed(2)}`);
    scene.add(new THREE.ArrowHelper(new THREE.Vector3(0, 0, 1), new THREE.Vector3(x, 0.02, z + s.z / 2), cell * 0.35, 0xff0000));
    label(n, x, z);
  });
  (window as any).__bbox = bbox; (window as any).__done = done.size;
  r.render(scene, cam); requestAnimationFrame(tick);
}
const grid = new THREE.GridHelper(Math.max(W, D) * 2, Math.max(W, D) * 2 / cell, 0x889999, 0xaabbbb); grid.position.set(cx, 0, cz); scene.add(grid);
tick();
