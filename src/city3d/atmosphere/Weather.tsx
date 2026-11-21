import React, { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { live, useCity, mulberry32, Quality } from '../shared';
import { wx } from './weatherState';

const RAIN_COUNT: Record<Quality, number> = { low: 1200, medium: 3500, high: 8000 };
const CLOUD_CLUSTERS: Record<Quality, number> = { low: 8, medium: 16, high: 26 };

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
  for (let i = 0; i < 16; i++) {
    const r = 30 + rnd() * 50;
    const x = 128 + (rnd() - 0.5) * 100, y = 128 + (rnd() - 0.5) * 50;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, 'rgba(255,255,255,0.5)');
    gr.addColorStop(0.6, 'rgba(255,255,255,0.18)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 256, 256);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export const CloudLayer: React.FC = () => {
  const quality = useCity((s) => s.quality);
  const group = useRef<THREE.Group>(null);
  const tex = useMemo(puffTexture, []);
  const mat = useMemo(() => new THREE.SpriteMaterial({
    map: tex, transparent: true, depthWrite: false, fog: false, opacity: 0.2, toneMapped: false,
  }), [tex]);
  const sprites = useMemo(() => {
    const rnd = mulberry32(31337);
    const out: { p: [number, number, number]; s: number }[] = [];
    const clusters = CLOUD_CLUSTERS[quality];
    for (let i = 0; i < clusters; i++) {
      const a = rnd() * Math.PI * 2, rr = 200 + rnd() * 900;
      const cx = Math.cos(a) * rr, cz = Math.sin(a) * rr, cy = 190 + rnd() * 80;
      const n = 4 + Math.floor(rnd() * 3);
      for (let k = 0; k < n; k++) {
        out.push({ p: [cx + (rnd() - 0.5) * 180, cy + (rnd() - 0.5) * 24, cz + (rnd() - 0.5) * 180], s: 180 + rnd() * 200 });
      }
    }
    return out;
  }, [quality]);

  useEffect(() => () => { tex.dispose(); mat.dispose(); }, [tex, mat]);

  useFrame(({ camera }, dt) => {
    const g = group.current;
    if (g) {
      g.rotation.y += Math.min(dt, 0.1) * 0.004;
      g.position.set(camera.position.x * 0.92, 0, camera.position.z * 0.92);
    }
    mat.color.copy(wx.tint);
    mat.opacity = 0.12 + 0.8 * wx.cover;
  });

  return (
    <group ref={group} renderOrder={-1}>
      {sprites.map((s, i) => <sprite key={i} material={mat} position={s.p} scale={[s.s, s.s * 0.5, 1]} />)}
    </group>
  );
};
