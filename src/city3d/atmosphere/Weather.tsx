import React, { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { live, useCity, mulberry32, Quality } from '../shared';
import { wx } from './weatherState';

const RAIN_COUNT: Record<Quality, number> = { low: 1200, medium: 3500, high: 8000 };
const CLOUD_CLUSTERS: Record<Quality, number> = { low: 6, medium: 10, high: 16 };

const rainVert = /* glsl */ `
uniform float uTime; uniform vec3 uCam; uniform vec3 uBox; uniform vec2 uWind; uniform float uLen;
attribute float aEnd;
varying float vA;
void main(){
  float speed = 34.0 + position.x * 14.0;
  vec3 p = position * uBox;
  p.y -= uTime * speed;
  p.xz += uWind * uTime;
  vec3 rel = mod(p - uCam + uBox * 0.5, uBox) - uBox * 0.5;
  vec3 w = uCam + rel;
  vec3 v = vec3(uWind.x, -speed, uWind.y);
  w -= v * (0.028 * uLen) * aEnd;
  vec3 q = abs(rel) / (uBox * 0.5);
  float edge = 1.0 - smoothstep(0.7, 1.0, max(max(q.x, q.y), q.z));
  vA = edge * (1.0 - 0.75 * aEnd) * step(0.0, w.y);
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
}`;
const rainFrag = /* glsl */ `
uniform vec3 uColor; uniform float uOpacity; varying float vA;
void main(){ gl_FragColor = vec4(uColor, vA * uOpacity); }`;

const splashVert = /* glsl */ `
uniform float uTime; uniform vec3 uCam; uniform float uBox; uniform float uScale;
varying float vA;
void main(){
  vec2 p = position.xz * uBox;
  vec2 rel = mod(p - uCam.xz + uBox * 0.5, uBox) - uBox * 0.5;
  float phase = fract(uTime * (1.4 + position.y) + position.y * 9.0);
  vec3 w = vec3(uCam.x + rel.x, 0.1, uCam.z + rel.y);
  float d = length(rel) / (uBox * 0.5);
  vA = (1.0 - phase) * (1.0 - phase) * (1.0 - smoothstep(0.6, 1.0, d));
  gl_PointSize = (2.0 + phase * 11.0) * uScale;
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
}`;
const splashFrag = /* glsl */ `
uniform vec3 uColor; uniform float uOpacity; varying float vA;
void main(){
  float d = length(gl_PointCoord - 0.5) * 2.0;
  float ring = smoothstep(0.55, 0.78, d) * (1.0 - smoothstep(0.85, 1.0, d));
  gl_FragColor = vec4(uColor, ring * vA * uOpacity);
}`;

export const Rain: React.FC = () => {
  const quality = useCity((s) => s.quality);
  const count = RAIN_COUNT[quality];
  const lines = useRef<THREE.LineSegments>(null);
  const pts = useRef<THREE.Points>(null);

  const { lineGeo, lineMat, ptsGeo, ptsMat } = useMemo(() => {
    const rnd = mulberry32(777);
    const pos = new Float32Array(count * 6);
    const end = new Float32Array(count * 2);
    for (let i = 0; i < count; i++) {
      const x = rnd(), y = rnd(), z = rnd();
      pos.set([x, y, z, x, y, z], i * 6);
      end[i * 2] = 0; end[i * 2 + 1] = 1;
    }
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    lg.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
    const lm = new THREE.ShaderMaterial({
      vertexShader: rainVert, fragmentShader: rainFrag, transparent: true, depthWrite: false,
      uniforms: {
        uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uBox: { value: new THREE.Vector3(80, 60, 80) },
        uWind: { value: new THREE.Vector2(-4, 1.5) }, uLen: { value: 1 },
        uColor: { value: new THREE.Color(0.7, 0.8, 1) }, uOpacity: { value: 0.4 },
      },
    });
    const n = Math.floor(count / 5);
    const sp = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) sp.set([rnd(), rnd(), rnd()], i * 3);
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    const pm = new THREE.ShaderMaterial({
      vertexShader: splashVert, fragmentShader: splashFrag, transparent: true, depthWrite: false,
      uniforms: {
        uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uBox: { value: 70 }, uScale: { value: 1 },
        uColor: { value: new THREE.Color(0.8, 0.88, 1) }, uOpacity: { value: 0.5 },
      },
    });
    return { lineGeo: lg, lineMat: lm, ptsGeo: pg, ptsMat: pm };
  }, [count]);

  useEffect(() => () => { lineGeo.dispose(); lineMat.dispose(); ptsGeo.dispose(); ptsMat.dispose(); }, [lineGeo, lineMat, ptsGeo, ptsMat]);

  useFrame(({ camera, clock, gl }) => {
    const r = live.rain;
    const on = r > 0.01;
    if (lines.current) lines.current.visible = on;
    if (pts.current) pts.current.visible = on;
    if (!on) return;
    const t = clock.elapsedTime;
    const cy = camera.position.y;
    const s = Math.min(3, 1 + cy / 80);
    const day = Math.max(0, live.daylight);
    lineGeo.setDrawRange(0, Math.floor(count * Math.min(1, r)) * 2);
    const u = lineMat.uniforms;
    u.uTime.value = t; u.uCam.value.copy(camera.position);
    u.uBox.value.set(80 * s, 60 * s, 80 * s); u.uLen.value = s;
    u.uWind.value.set(-3 - 4 * wx.dark, 1 + wx.dark);
    u.uOpacity.value = (0.3 + 0.3 * day) * (0.5 + 0.5 * r);
    u.uColor.value.setRGB(0.55 + 0.3 * day, 0.65 + 0.25 * day, 0.85 + 0.15 * day);
    ptsGeo.setDrawRange(0, Math.floor((count / 5) * Math.min(1, r)));
    const p = ptsMat.uniforms;
    p.uTime.value = t; p.uCam.value.copy(camera.position);
    p.uScale.value = gl.getPixelRatio();
    p.uOpacity.value = 0.55 * (1 - THREE.MathUtils.smoothstep(cy, 35, 90));
    p.uColor.value.setRGB(0.6 + 0.3 * day, 0.7 + 0.25 * day, 0.9);
  });

  return (
    <>
      <lineSegments ref={lines} geometry={lineGeo} material={lineMat} frustumCulled={false} renderOrder={5} />
      <points ref={pts} geometry={ptsGeo} material={ptsMat} frustumCulled={false} renderOrder={5} />
    </>
  );
};

function puffTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  const rnd = mulberry32(4242);
  const blobs: [number, number, number][] = [];
  for (let i = 0; i < 18; i++) blobs.push([128 + (rnd() - 0.5) * 120, 132 + (rnd() - 0.5) * 44, 28 + rnd() * 44]);
  // shaded base first, then lit tops offset upward => cheap volumetric look
  for (const [x, y, r] of blobs) {
    const gr = g.createRadialGradient(x, y + 6, 0, x, y + 6, r);
    gr.addColorStop(0, 'rgba(150,160,185,0.45)'); gr.addColorStop(0.65, 'rgba(150,160,185,0.16)'); gr.addColorStop(1, 'rgba(150,160,185,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
  }
  for (const [x, y, r] of blobs) {
    const gr = g.createRadialGradient(x, y - r * 0.28, 0, x, y - r * 0.28, r * 0.85);
    gr.addColorStop(0, 'rgba(255,255,255,0.55)'); gr.addColorStop(0.6, 'rgba(255,255,255,0.2)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const LAYERS = [
  { y: 210, spread: 70, speed: 0.004, scale: 1 },
  { y: 300, spread: 90, speed: 0.0025, scale: 1.4 },
  { y: 430, spread: 110, speed: 0.0014, scale: 1.9 },
];

export const CloudLayer: React.FC = () => {
  const quality = useCity((s) => s.quality);
  const groups = useRef<(THREE.Group | null)[]>([]);
  const tex = useMemo(puffTexture, []);
  const mat = useMemo(() => new THREE.SpriteMaterial({
    map: tex, transparent: true, depthWrite: false, fog: false, opacity: 0.6, toneMapped: false,
  }), [tex]);
  const lastCover = useRef(-1);
  const data = useMemo(() => {
    lastCover.current = -1;
    const rnd = mulberry32(31337);
    const per = CLOUD_CLUSTERS[quality];
    return LAYERS.map((L, li) => {
      const out: { p: [number, number, number]; s: number; th: number }[] = [];
      for (let i = 0; i < per; i++) {
        const a = rnd() * Math.PI * 2, rr = 150 + rnd() * 1000;
        const cx = Math.cos(a) * rr, cz = Math.sin(a) * rr, cy = L.y + (rnd() - 0.5) * L.spread;
        const th = rnd(); // cluster appears once cover exceeds this threshold
        const n = 4 + Math.floor(rnd() * 3);
        for (let k = 0; k < n; k++) {
          out.push({ p: [cx + (rnd() - 0.5) * 200 * L.scale, cy + (rnd() - 0.5) * 20, cz + (rnd() - 0.5) * 200 * L.scale], s: (170 + rnd() * 200) * L.scale, th });
        }
      }
      return out;
    });
  }, [quality]);

  useEffect(() => () => { tex.dispose(); mat.dispose(); }, [tex, mat]);

  useFrame(({ camera }, dt) => {
    const d = Math.min(dt, 0.1);
    groups.current.forEach((g, i) => {
      if (!g) return;
      g.rotation.y += d * LAYERS[i].speed;
      g.position.set(camera.position.x * (0.9 + 0.03 * i), 0, camera.position.z * (0.9 + 0.03 * i));
    });
    mat.color.copy(wx.tint);
    mat.opacity = 0.5 + 0.45 * wx.cover;
    if (Math.abs(wx.cover - lastCover.current) > 0.02) {
      lastCover.current = wx.cover;
      const lim = 0.12 + 0.88 * wx.cover; // clear: few clouds, cloudy: nearly all
      groups.current.forEach((g) => g?.children.forEach((c, j) => { c.visible = (c.userData.th ?? 0) < lim; void j; }));
    }
  });

  return (
    <>
      {data.map((layer, li) => (
        <group key={li + quality} ref={(g) => { groups.current[li] = g; }}>
          {layer.map((s, i) => <sprite key={i} material={mat} position={s.p} scale={[s.s, s.s * 0.45, 1]} userData={{ th: s.th }} />)}
        </group>
      ))}
    </>
  );
};
