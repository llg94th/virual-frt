import * as THREE from 'three';
import { FLOOR_H } from '../shared';

export const winUniforms = { uNight: { value: 0 }, uDay: { value: 1 } };

/** Standard material with vertex colours + procedural lit-window grid (aUv/aInfo attributes). */
export function createWindowMaterial(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0.05 });
  m.customProgramCacheKey = () => 'cityWin1';
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uNight = winUniforms.uNight; sh.uniforms.uDay = winUniforms.uDay;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aUv;\nattribute vec2 aInfo;\nvarying vec2 vWuv;\nvarying vec2 vInfo;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWuv = aUv; vInfo = aInfo;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
uniform float uNight; uniform float uDay;
varying vec2 vWuv; varying vec2 vInfo;
float wHash(vec3 p){ p = fract(p*0.1031); p += dot(p, p.yzx+33.33); return fract((p.x+p.y)*p.z); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
float sd = floor(vInfo.x+0.5); float st = floor(vInfo.y+0.5);
vec2 wg = vec2(vWuv.x/2.4, vWuv.y/${FLOOR_H.toFixed(2)});
float wfw = max(fwidth(wg.x), fwidth(wg.y));
float wMask = 0.0; float wLit = 0.0; vec3 wEm = vec3(0.0); float wGlass = 0.0;
if (st > 0.5 && st < 3.5) {
  vec2 cell = floor(wg); vec2 f = fract(wg);
  vec2 lo = vec2(0.14,0.2); vec2 hi = vec2(0.86,0.78);
  if (st > 1.5 && st < 2.5) { lo = vec2(0.3,0.34); hi = vec2(0.7,0.76); }
  else if (st > 2.5) { lo = vec2(0.33,0.3); hi = vec2(0.67,0.76); }
  float ground = 1.0 - step(0.5, cell.y);
  if (ground > 0.5 && st < 1.5) { lo.y = 0.04; }
  vec2 s2 = step(lo, f) * step(f, hi);
  float m = s2.x * s2.y;
  float h1 = wHash(vec3(cell, sd)); float h2 = wHash(vec3(cell + 31.7, sd + 3.0)); float h3 = wHash(vec3(cell + 7.3, sd + 9.0));
  float bProb = 0.06 + 0.34 * wHash(vec3(sd, 7.0, 1.0));
  bProb = mix(bProb, 0.6, ground * 0.5);
  float lit = step(h2, bProb);
  float fade = smoothstep(0.4, 1.0, wfw);
  wMask = mix(m, (hi.x-lo.x)*(hi.y-lo.y), fade);
  wLit = mix(lit, bProb, fade);
  wGlass = st < 1.5 ? 1.0 : 0.6;
  vec3 warm = mix(vec3(1.0,0.78,0.45), vec3(0.75,0.88,1.0), step(0.75, h3));
  wEm = warm * (0.3 + 0.9*h1*h1);
  vec3 dayC = mix(vec3(0.10,0.16,0.22), vec3(0.38,0.52,0.64), 0.5+0.5*h1) * (0.35 + 0.65*uDay);
  vec3 nightC = vec3(0.02,0.03,0.05) * (0.5 + h1);
  diffuseColor.rgb = mix(diffuseColor.rgb, mix(nightC, dayC, uDay), wMask * 0.95);
}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor = mix(roughnessFactor, 0.1, wMask * wGlass);`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
metalnessFactor = mix(metalnessFactor, 0.5, wMask * wGlass);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
totalEmissiveRadiance += wEm * wLit * wMask * uNight * 0.7;
if (st > 3.5) totalEmissiveRadiance += diffuseColor.rgb * (0.4 + uNight * 1.8);`);
  };
  return m;
}

export function makeAsphaltTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const x = c.getContext('2d')!;
  x.fillStyle = '#34363a'; x.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 5000; i++) {
    const v = 40 + Math.random() * 40 | 0;
    x.fillStyle = `rgba(${v},${v},${v + 4},0.5)`; x.fillRect(Math.random() * 256, Math.random() * 256, 1 + Math.random() * 1.5, 1 + Math.random() * 1.5);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

export const SIGN_CELLS = 16;
export const SIGN_TEXT: [string, string, string][] = [
  ['Long Châu', '#0a8f4a', '#1c5fd0'], ['FPT Shop', '#f26a10', '#ffffff'],
  ['HOTEL', '#2b1a5a', '#ff3df0'], ['CAFÉ', '#1a2a2a', '#3dffd9'], ['RAMEN', '#4a0f0f', '#ff6a3d'], ['KARAOKE', '#12123a', '#ffd93d'],
  ['BANK', '#0f2a4a', '#6ac4ff'], ['PHỞ 24', '#3a1a0a', '#ffb347'], ['TECH', '#0a0a1e', '#7dffb0'], ['SALE 50%', '#3a0a2a', '#ff5ca8'],
  ['BAR', '#1a0a2a', '#b06aff'], ['24/7', '#0a2a1a', '#6aff6a'], ['PIZZA', '#2a0f0a', '#ff8a5c'], ['CINEMA', '#0a0a2a', '#ffe36a'],
  ['GYM', '#1a1a1a', '#ff4d4d'], ['SPA', '#0a2a2a', '#9dfcff'],
];
export function makeSignAtlas(): THREE.CanvasTexture {
  const W = 256, H = 128, c = document.createElement('canvas'); c.width = W * 4; c.height = H * 4;
  const x = c.getContext('2d')!;
  SIGN_TEXT.forEach(([txt, bg, fg], i) => {
    const ox = (i % 4) * W, oy = Math.floor(i / 4) * H;
    x.fillStyle = bg; x.fillRect(ox, oy, W, H);
    x.strokeStyle = fg; x.lineWidth = 6; x.strokeRect(ox + 6, oy + 6, W - 12, H - 12);
    if (i === 0) { x.fillStyle = '#1c5fd0'; x.fillRect(ox + 6, oy + H - 30, W - 12, 24); x.fillStyle = '#fff'; x.font = 'bold 14px sans-serif'; x.textAlign = 'center'; x.fillText('NHÀ THUỐC', ox + W / 2, oy + H - 12); }
    x.fillStyle = i < 2 ? '#fff' : fg; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.font = `bold ${txt.length > 7 ? 40 : 54}px sans-serif`; x.shadowColor = fg; x.shadowBlur = i < 2 ? 0 : 14;
    x.fillText(txt, ox + W / 2, oy + (i === 0 ? H / 2 - 12 : H / 2)); x.shadowBlur = 0;
  });
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

export const roadUniforms = { uWet: { value: 0 }, uNight: { value: 0 }, uDay: { value: 1 }, uTime: { value: 0 } };
/** Cheap fake wet reflections for asphalt: lamp streaks in world space + grazing-angle sky sheen + puddle roughness. */
export function patchWetRoad(m: THREE.MeshStandardMaterial) {
  m.customProgramCacheKey = () => 'cityRoadWet1';
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, roadUniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWp;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWp = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
uniform float uWet; uniform float uNight; uniform float uDay; uniform float uTime;
varying vec3 vWp;
float rHash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
float rNoise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(rHash(i),rHash(i+vec2(1,0)),f.x), mix(rHash(i+vec2(0,1)),rHash(i+vec2(1,1)),f.x), f.y); }
float lampStreak(float a, float b, float t) {
  float da = mod(a, 70.0) - 35.0;
  float db = mod(b + 35.0, 70.0) - 35.0;
  float dl = min(abs(db), min(abs(db - 27.2), abs(db + 27.2)));
  float across = exp(-pow((abs(da) - 6.4) / 0.55, 2.0));
  float along = exp(-pow(dl / 7.0, 2.0));
  return across * along * (0.75 + 0.25 * sin(b * 2.3 + t * 1.5));
}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
float puddle = smoothstep(0.35, 0.65, rNoise(vWp.xz * 0.35));
roughnessFactor = mix(roughnessFactor, 0.1, uWet * (0.5 + 0.5 * puddle));`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
{
  float fres = pow(1.0 - clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0), 3.0);
  vec3 sky = mix(vec3(0.12,0.15,0.25), vec3(0.45,0.55,0.7), uDay);
  float wetAmt = uWet * (0.5 + 0.5 * puddle);
  totalEmissiveRadiance += sky * fres * wetAmt * 0.35;
  float st = lampStreak(vWp.x, vWp.z, uTime) + lampStreak(vWp.z, vWp.x, uTime);
  totalEmissiveRadiance += vec3(1.0,0.75,0.42) * st * wetAmt * uNight * 1.1 * (0.4 + 0.6 * fres + 0.3);
}`);
  };
}

/** Tileable normal map for gentle water ripples. */
export function makeWaterNormal(): THREE.CanvasTexture {
  const N = 128, h = new Float32Array(N * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const u = (x / N) * Math.PI * 2, v = (y / N) * Math.PI * 2;
    h[y * N + x] = Math.sin(u * 3 + Math.sin(v * 2) * 1.2) * 0.5 + Math.sin(v * 4 + u * 2) * 0.35 + Math.sin((u + v) * 5) * 0.2;
  }
  const c = document.createElement('canvas'); c.width = c.height = N;
  const x2 = c.getContext('2d')!, img = x2.createImageData(N, N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const dx = h[y * N + (x + 1) % N] - h[y * N + (x + N - 1) % N], dy = h[((y + 1) % N) * N + x] - h[((y + N - 1) % N) * N + x];
    const nx = -dx * 0.6, ny = -dy * 0.6, nz = 1, l = Math.hypot(nx, ny, nz), i = (y * N + x) * 4;
    img.data[i] = (nx / l * 0.5 + 0.5) * 255; img.data[i + 1] = (ny / l * 0.5 + 0.5) * 255; img.data[i + 2] = (nz / l * 0.5 + 0.5) * 255; img.data[i + 3] = 255;
  }
  x2.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
}
