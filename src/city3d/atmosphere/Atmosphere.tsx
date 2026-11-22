import React, { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { cityStore, live, useCity, mulberry32, Quality, Weather } from '../shared';
import { wx, emitThunder } from './weatherState';
import { Rain, CloudLayer } from './Weather';

const SHADOW_RES: Record<Quality, number> = { low: 1024, medium: 2048, high: 4096 };
const WEATHER_TARGET: Record<Weather, { rain: number; cover: number; dark: number; fog: number }> = {
  clear: { rain: 0, cover: 0.05, dark: 0, fog: 0.00065 },
  cloudy: { rain: 0, cover: 0.85, dark: 0.25, fog: 0.0014 },
  rain: { rain: 0.75, cover: 1, dark: 0.55, fog: 0.0024 },
  storm: { rain: 1, cover: 1, dark: 1, fog: 0.0034 },
};

// Sky palette keyed by sun elevation (sin of sun angle).
const PAL = ([
  [-0.35, '#02040c', '#080e22'],
  [-0.12, '#060a1c', '#16204a'],
  [-0.03, '#2a2a68', '#ff5a40'],
  [0.07, '#3d4f9a', '#ff8e52'],
  [0.25, '#3f78c8', '#f6cf9e'],
  [0.6, '#1f68d6', '#b4d4f0'],
  [1.0, '#1559c8', '#b0d0ee'],
] as [number, string, string][]).map(([e, t, h]) => ({ e, top: new THREE.Color(t), hor: new THREE.Color(h) }));
const SUN_LOW = new THREE.Color('#ff7a3a');
const SUN_MID = new THREE.Color('#ffd7a0');
const SUN_HIGH = new THREE.Color('#fff4e2');
const MOON_COL = new THREE.Color('#9db4ff');
const DAWN_PINK = new THREE.Color('#ff9fa0');
const WHITE = new THREE.Color('#ffffff');
const NIGHT_CLOUD = new THREE.Color('#0a0e1c');
const HEMI_SKY_DAY = new THREE.Color('#e2ecf8'); // near-neutral so shaded walls are not blue
const HEMI_SKY_NIGHT = new THREE.Color('#1a2550');
const HEMI_GROUND_DAY = new THREE.Color('#6f685c'); // warm floor bounce for interiors
const HEMI_GROUND_NIGHT = new THREE.Color('#0b0d16');

const sstep = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

function samplePalette(e: number, top: THREE.Color, hor: THREE.Color) {
  if (e <= PAL[0].e) { top.copy(PAL[0].top); hor.copy(PAL[0].hor); return; }
  for (let i = 1; i < PAL.length; i++) {
    if (e <= PAL[i].e) {
      const a = PAL[i - 1], b = PAL[i];
      const t = (e - a.e) / (b.e - a.e);
      top.copy(a.top).lerp(b.top, t); hor.copy(a.hor).lerp(b.hor, t);
      return;
    }
  }
  const l = PAL[PAL.length - 1]; top.copy(l.top); hor.copy(l.hor);
}

const skyVert = /* glsl */ `
varying vec3 vDir;
void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const skyFrag = /* glsl */ `
uniform vec3 uTop; uniform vec3 uHor; uniform vec3 uSunDir; uniform vec3 uSunCol; uniform float uSunAmt; uniform float uFlash;
varying vec3 vDir;
void main(){
  vec3 d = normalize(vDir);
  float h = clamp(d.y, 0.0, 1.0);
  vec3 col = mix(uHor, uTop, pow(h, 0.55));
  if (d.y < 0.0) col = mix(uHor, uHor * 0.55, clamp(-d.y * 4.0, 0.0, 1.0));
  float sd = max(dot(d, uSunDir), 0.0);
  float glow = pow(sd, 6.0) * 0.28 + pow(sd, 64.0) * 0.5 + smoothstep(0.9993, 0.9996, sd) * 3.0;
  col += uSunCol * glow * uSunAmt;
  col += uSunCol * pow(sd, 3.0) * (1.0 - h) * 0.22 * uSunAmt;
  col += vec3(0.7, 0.75, 0.95) * uFlash * 0.7 * (0.4 + 0.6 * (1.0 - h));
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

function moonTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d')!;
  const halo = g.createRadialGradient(128, 128, 20, 128, 128, 128);
  halo.addColorStop(0, 'rgba(190,210,255,0.55)'); halo.addColorStop(0.35, 'rgba(150,180,255,0.15)'); halo.addColorStop(1, 'rgba(150,180,255,0)');
  g.fillStyle = halo; g.fillRect(0, 0, 256, 256);
  g.fillStyle = '#eef3ff'; g.beginPath(); g.arc(128, 128, 36, 0, Math.PI * 2); g.fill();
  const rnd = mulberry32(99);
  g.fillStyle = 'rgba(150,165,200,0.35)';
  for (let i = 0; i < 9; i++) { g.beginPath(); g.arc(128 + (rnd() - 0.5) * 44, 128 + (rnd() - 0.5) * 44, 3 + rnd() * 7, 0, Math.PI * 2); g.fill(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

const _tmpTop = new THREE.Color(), _tmpHor = new THREE.Color(), _grey = new THREE.Color();
const _sun = new THREE.Vector3(), _moon = new THREE.Vector3(), _dir = new THREE.Vector3();
const _right = new THREE.Vector3(), _up = new THREE.Vector3(), _focus = new THREE.Vector3(), _f2 = new THREE.Vector3();
const UPY = new THREE.Vector3(0, 1, 0);

export const Atmosphere: React.FC = () => {
  const quality = useCity((s) => s.quality);
  const { scene, gl } = useThree();
  const sunRef = useRef<THREE.DirectionalLight>(null);
  const hemiRef = useRef<THREE.HemisphereLight>(null);
  const domeRef = useRef<THREE.Mesh>(null);
  const starsRef = useRef<THREE.Points>(null);
  const moonRef = useRef<THREE.Sprite>(null);

  const S = useRef({
    t: cityStore.get().timeOfDay, lastWritten: cityStore.get().timeOfDay, acc: 0,
    rain: 0, cover: 0, dark: 0, fog: 0.001, focus: new THREE.Vector3(0, 10, 0), shadowS: 90,
    strikeIn: 4, strikeT: -1, strikeAmp: [1, 0.6, 0.9], timeouts: [] as number[],
  });

  const fog = useMemo(() => new THREE.FogExp2('#aabbcc', 0.001), []);
  useEffect(() => {
    const prev = scene.fog; scene.fog = fog;
    return () => { scene.fog = prev; };
  }, [scene, fog]);

  const skyMat = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: skyVert, fragmentShader: skyFrag, side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      uTop: { value: new THREE.Color() }, uHor: { value: new THREE.Color() }, uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunCol: { value: new THREE.Color() }, uSunAmt: { value: 1 }, uFlash: { value: 0 },
    },
  }), []);
  const starGeo = useMemo(() => {
    const rnd = mulberry32(2024); const n = 1600; const p = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const u = rnd() * 2 - 1 + 0.0, a = rnd() * Math.PI * 2; const y = Math.abs(u) * 0.95 + 0.03; const r = Math.sqrt(1 - y * y);
      p.set([Math.cos(a) * r * 950, y * 950, Math.sin(a) * r * 950], i * 3);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(p, 3)); return g;
  }, []);
  const starMat = useMemo(() => new THREE.PointsMaterial({ color: '#dfe8ff', size: 1.8, sizeAttenuation: false, transparent: true, depthWrite: false, fog: false, opacity: 0, toneMapped: false }), []);
  const moonTex = useMemo(moonTexture, []);
  const moonMat = useMemo(() => new THREE.SpriteMaterial({ map: moonTex, transparent: true, depthWrite: false, fog: false, toneMapped: false, opacity: 0 }), [moonTex]);

  // lightning screen flash (DOM overlay, no re-render)
  const flashEl = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const host = gl.domElement.parentElement;
    if (!host) return;
    const el = document.createElement('div');
    el.style.cssText = 'position:absolute;inset:0;pointer-events:none;background:#dfe8ff;opacity:0;mix-blend-mode:screen;';
    host.appendChild(el); flashEl.current = el;
    return () => { el.remove(); flashEl.current = null; };
  }, [gl]);
  useEffect(() => () => { S.current.timeouts.forEach(clearTimeout); }, []);
  useEffect(() => () => { skyMat.dispose(); starGeo.dispose(); starMat.dispose(); moonTex.dispose(); moonMat.dispose(); }, [skyMat, starGeo, starMat, moonTex, moonMat]);

  // Neutral studio-like environment map (one-off PMREM): soft reflections + interior fill on every PBR material.
  useEffect(() => {
    let tex: THREE.Texture | null = null;
    try {
      const pm = new THREE.PMREMGenerator(gl);
      const room = new RoomEnvironment();
      const rt = pm.fromScene(room, 0.04);
      tex = rt.texture; scene.environment = tex;
      room.dispose(); pm.dispose();
    } catch (e) { console.warn('[city3d] env map skipped', e); }
    return () => { if (scene.environment === tex) scene.environment = null; tex?.dispose(); };
  }, [scene, gl]);

  // sun target must live in the scene for the directional light direction
  useEffect(() => {
    const l = sunRef.current; if (!l) return;
    scene.add(l.target);
    return () => { scene.remove(l.target); };
  }, [scene, quality]);

  useFrame(({ camera }, rawDt) => {
    const dt = Math.min(rawDt, 0.1);
    const s = S.current;
    const st = cityStore.get();

    // ---- time ----
    if (!st.autoTime || Math.abs(st.timeOfDay - s.lastWritten) > 0.02) s.t = st.timeOfDay;
    if (st.autoTime) {
      s.t = (s.t + (dt * st.timeScale) / 60) % 24;
      s.acc += dt;
      if (s.acc > 0.25) { s.acc = 0; s.lastWritten = s.t; cityStore.set({ timeOfDay: s.t }); }
    } else s.lastWritten = st.timeOfDay;

    // ---- weather smoothing ----
    const tgt = WEATHER_TARGET[st.weather];
    const k = 1 - Math.exp(-dt * 0.6);
    s.rain += (tgt.rain - s.rain) * k; s.cover += (tgt.cover - s.cover) * k;
    s.dark += (tgt.dark - s.dark) * k; s.fog += (tgt.fog - s.fog) * k;
    live.rain = s.rain < 0.003 ? 0 : s.rain;
    wx.cover = s.cover; wx.dark = s.dark;

    // ---- lightning ----
    if (st.weather === 'storm') {
      s.strikeIn -= dt;
      if (s.strikeIn <= 0) {
        s.strikeIn = 4 + Math.random() * 9; s.strikeT = 0;
        s.strikeAmp = [0.8 + Math.random() * 0.2, 0.3 + Math.random() * 0.5, 0.6 + Math.random() * 0.4];
        const delay = 0.3 + Math.random() * 2.4;
        const id = window.setTimeout(() => emitThunder({ intensity: Math.max(0.15, 1 - delay / 3), delay }), delay * 1000);
        s.timeouts.push(id);
        if (s.timeouts.length > 12) s.timeouts.shift();
      }
    }
    let flash = 0;
    if (s.strikeT >= 0) {
      s.strikeT += dt;
      const p = [0, 0.13, 0.36];
      for (let i = 0; i < 3; i++) { const q = s.strikeT - p[i]; if (q >= 0) flash = Math.max(flash, s.strikeAmp[i] * Math.exp(-q * 9)); }
      if (s.strikeT > 1.4) s.strikeT = -1;
    }
    wx.flash = flash;
    if (flashEl.current) flashEl.current.style.opacity = String(flash * 0.4);

    // ---- sun / moon ----
    const a = ((s.t - 6) / 24) * Math.PI * 2;
    const elev = Math.sin(a);
    _sun.set(Math.cos(a), elev, 0.32).normalize();
    _moon.set(-_sun.x, -_sun.y, 0.25).normalize();
    wx.sunDir.copy(_sun); wx.elev = elev;
    const dayRaw = sstep(-0.08, 0.22, elev); // 0 night .. 1 day
    live.daylight = elev * (1 - 0.35 * s.dark);
    live.nightFactor = Math.min(1, 1 - dayRaw + s.dark * 0.4 * dayRaw);

    // ---- sky colours ----
    samplePalette(elev, _tmpTop, _tmpHor);
    if (s.t < 12) _tmpHor.lerp(DAWN_PINK, 0.25 * (1 - sstep(0.05, 0.35, elev)) * sstep(-0.1, 0, elev));
    const lumT = _tmpTop.r * 0.3 + _tmpTop.g * 0.59 + _tmpTop.b * 0.11;
    _grey.setRGB(lumT * 1.1, lumT * 1.15, lumT * 1.25);
    const ov = Math.min(1, s.cover * 0.85);
    _tmpTop.lerp(_grey, ov); _tmpHor.lerp(_grey, ov * 0.8);
    const wet = sstep(0.3, 0.75, s.rain);
    const dim = (1 - 0.6 * s.dark) * (1 - 0.22 * wet);
    _tmpTop.multiplyScalar(dim); _tmpHor.multiplyScalar(dim);
    const u = skyMat.uniforms;
    u.uTop.value.copy(_tmpTop); u.uHor.value.copy(_tmpHor);
    const sunVis = Math.max(0, elev + 0.06) < 0.0001 ? 0 : 1;
    u.uSunDir.value.copy(elev > -0.08 ? _sun : _moon);
    if (elev < 0.25) u.uSunCol.value.copy(SUN_LOW).lerp(SUN_MID, sstep(0, 0.25, elev)); else u.uSunCol.value.copy(SUN_MID).lerp(SUN_HIGH, sstep(0.25, 0.7, elev));
    u.uSunAmt.value = sunVis * (1 - ov * 0.95) * sstep(-0.1, 0.0, elev);
    u.uFlash.value = flash;

    // sky dome / stars / moon follow the camera
    const cp = camera.position;
    domeRef.current?.position.copy(cp);
    starsRef.current?.position.copy(cp);
    starMat.opacity = (1 - dayRaw) * (1 - s.cover * 0.95);
    if (moonRef.current) {
      moonRef.current.position.copy(cp).addScaledVector(_moon, 880);
      moonMat.opacity = (1 - dayRaw) * (1 - s.cover * 0.9) * sstep(-0.05, 0.1, -elev + 0.1);
    }

    // cloud tint
    wx.tint.copy(WHITE).lerp(u.uSunCol.value, 1 - sstep(0.02, 0.45, elev)).lerp(_tmpHor, 0.15);
    wx.tint.multiplyScalar(0.55 + 0.45 * dayRaw).lerp(NIGHT_CLOUD, (1 - dayRaw) * 0.85).multiplyScalar(1 - 0.5 * s.dark);

    // fog
    fog.color.copy(_tmpHor).lerp(_tmpTop, 0.12 + 0.3 * dayRaw * (1 - ov));
    if (flash > 0.01) fog.color.lerp(WHITE, flash * 0.35);
    fog.density = s.fog * (1 + 0.5 * (1 - dayRaw));

    // ---- lights ----
    const sun = sunRef.current;
    if (sun) {
      const moonMode = elev < -0.02;
      _dir.copy(moonMode ? _moon : _sun);
      const mode = cityStore.get().cameraMode;
      const wantS = mode === 'cinematic' ? 120 : mode === 'follow' || mode === 'drive' ? 55 : mode === 'cutaway' || mode === 'office' ? 52 : 95;
      s.shadowS += (wantS - s.shadowS) * (1 - Math.exp(-dt * 2));
      const S2 = s.shadowS;
      // focus point
      const useP = st.playerMode !== 'none' || mode === 'follow' || mode === 'drive';
      if (useP) _focus.set(live.player.x, 0, live.player.z); else _focus.set(0, 12, 0);
      s.focus.lerp(_focus, 1 - Math.exp(-dt * 4));
      // snap to shadow texels in light space to stop shimmering
      _right.crossVectors(UPY, _dir).normalize(); _up.crossVectors(_dir, _right).normalize();
      const texel = (2 * S2) / SHADOW_RES[quality];
      const fx = s.focus.dot(_right), fy = s.focus.dot(_up);
      _f2.copy(s.focus).addScaledVector(_right, Math.round(fx / texel) * texel - fx).addScaledVector(_up, Math.round(fy / texel) * texel - fy);
      sun.position.copy(_f2).addScaledVector(_dir, 220);
      sun.target.position.copy(_f2); sun.target.updateMatrixWorld();
      const cam = sun.shadow.camera;
      if (Math.abs(cam.right - S2) > 0.05) { cam.left = -S2; cam.right = S2; cam.top = S2; cam.bottom = -S2; cam.near = 5; cam.far = 460; cam.updateProjectionMatrix(); }
      const overcast = 1 - 0.6 * s.cover;
      if (moonMode) { sun.color.copy(MOON_COL); sun.intensity = 0.45 * (1 - dayRaw) * overcast; }
      else { sun.color.copy(u.uSunCol.value); sun.intensity = 3.4 * sstep(-0.02, 0.3, elev) * overcast * (1 - 0.4 * sstep(0.3, 0.75, s.rain)); }
      if (flash > 0.01) { sun.intensity += flash * 3; if (moonMode) sun.color.lerp(WHITE, flash); }
      sun.castShadow = sun.intensity > 0.05;
    }
    const hemi = hemiRef.current;
    if (hemi) {
      hemi.color.copy(HEMI_SKY_NIGHT).lerp(HEMI_SKY_DAY, dayRaw).lerp(_tmpHor, 0.25 * (1 - Math.abs(elev)));
      hemi.groundColor.copy(HEMI_GROUND_NIGHT).lerp(HEMI_GROUND_DAY, dayRaw);
      hemi.intensity = (0.22 + 0.5 * dayRaw) * (1 - 0.2 * s.dark) + flash * 4;
    }
    // env map = interior fill + reflections; fades with daylight/weather, never fully black
    {
      const sc = scene as THREE.Scene & { environmentIntensity?: number };
      sc.environmentIntensity = (0.1 + 0.42 * dayRaw) * (1 - 0.35 * s.dark) * (quality === 'low' ? 0.6 : 1) + flash * 0.6;
    }
  });

  const res = SHADOW_RES[quality];
  return (
    <>
      <mesh ref={domeRef} renderOrder={-100} frustumCulled={false} material={skyMat}>
        <sphereGeometry args={[1000, 32, 16]} />
      </mesh>
      <points ref={starsRef} geometry={starGeo} material={starMat} renderOrder={-99} frustumCulled={false} />
      <sprite ref={moonRef} material={moonMat} scale={[260, 260, 1]} renderOrder={-98} />
      <hemisphereLight ref={hemiRef} args={['#bcd8ff', '#5a5446', 1]} />
      <directionalLight
        key={quality} ref={sunRef} castShadow intensity={3} shadow-mapSize={[res, res]}
        shadow-bias={-0.0003} shadow-normalBias={quality === 'low' ? 0.12 : 0.07} shadow-radius={3}
      />
      <CloudLayer />
      <Rain />
    </>
  );
};
