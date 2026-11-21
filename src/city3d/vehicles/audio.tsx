import { useEffect } from 'react';
import { CITY_EXTENT, cityStore, live } from '../shared';

function noiseBuffer(ctx: AudioContext, kind: 'white' | 'brown', secs = 3): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * secs);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1;
    if (kind === 'white') d[i] = w;
    else { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
  }
  return buf;
}

/** Procedural WebAudio city soundscape. Renders nothing. Listens for window event 'city3d:thunder'. */
export const CityAudio = () => {
  useEffect(() => {
    let ctx: AudioContext | null = null;
    let master: GainNode;
    let amb: GainNode, hum: GainNode, rain: GainNode, eng: GainNode;
    let osc1: OscillatorNode, osc2: OscillatorNode;
    let brown: AudioBuffer, white: AudioBuffer;
    let raf = 0;
    let stepT = 0, honkT = 6 + Math.random() * 8;
    let last = performance.now();

    const loop = (buf: AudioBuffer, filt: BiquadFilterType, freq: number, q = 0.7): GainNode => {
      const c = ctx!;
      const src = c.createBufferSource(); src.buffer = buf; src.loop = true;
      const f = c.createBiquadFilter(); f.type = filt; f.frequency.value = freq; f.Q.value = q;
      const g = c.createGain(); g.gain.value = 0;
      src.connect(f); f.connect(g); g.connect(master); src.start();
      return g;
    };

    const ensure = () => {
      if (ctx) { if (ctx.state === 'suspended') void ctx.resume(); return; }
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      master = ctx.createGain(); master.gain.value = cityStore.get().muted ? 0 : 0.8; master.connect(ctx.destination);
      brown = noiseBuffer(ctx, 'brown'); white = noiseBuffer(ctx, 'white');
      amb = loop(brown, 'lowpass', 700);
      hum = loop(brown, 'lowpass', 220);
      rain = loop(white, 'bandpass', 3200, 0.5);
      eng = ctx.createGain(); eng.gain.value = 0; eng.connect(master);
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 600; lp.connect(eng);
      osc1 = ctx.createOscillator(); osc1.type = 'sawtooth'; osc1.frequency.value = 40; osc1.connect(lp); osc1.start();
      osc2 = ctx.createOscillator(); osc2.type = 'square'; osc2.frequency.value = 20; osc2.connect(lp); osc2.start();
      if (ctx.state === 'suspended') void ctx.resume();
    };

    const blip = (freq: number, q: number, dur: number, vol: number, pan = 0) => {
      const c = ctx!;
      const t = c.currentTime;
      const src = c.createBufferSource(); src.buffer = white;
      const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
      const g = c.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
      src.connect(f); f.connect(g);
      if (c.createStereoPanner) { const p = c.createStereoPanner(); p.pan.value = pan; g.connect(p); p.connect(master); } else g.connect(master);
      src.start(t, Math.random() * 2, dur + 0.05);
    };
    const honk = () => {
      const c = ctx!; const t = c.currentTime;
      const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.03 + Math.random() * 0.03, t + 0.03);
      g.gain.setValueAtTime(0.04, t + 0.25 + Math.random() * 0.2); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5 + Math.random() * 0.3);
      const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1400;
      for (const fr of [400 + Math.random() * 80, 500 + Math.random() * 80]) {
        const o = c.createOscillator(); o.type = 'square'; o.frequency.value = fr; o.connect(f); o.start(t); o.stop(t + 1);
      }
      f.connect(g);
      if (c.createStereoPanner) { const p = c.createStereoPanner(); p.pan.value = Math.random() * 2 - 1; g.connect(p); p.connect(master); } else g.connect(master);
    };
    const thunder = () => {
      if (!ctx || cityStore.get().muted) return;
      const c = ctx; const t = c.currentTime + 0.15;
      const src = c.createBufferSource(); src.buffer = brown;
      const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(320, t); f.frequency.exponentialRampToValueAtTime(70, t + 3);
      const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(1.2, t + 0.25);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 3.6);
      src.connect(f); f.connect(g); g.connect(master); src.start(t, Math.random() * 1.5, 4);
    };

    const tick = () => {
      raf = requestAnimationFrame(tick);
      const now = performance.now();
      const dt = Math.min(0.1, (now - last) / 1000); last = now;
      if (!ctx) return;
      const s = cityStore.get();
      const t = ctx.currentTime;
      master.gain.setTargetAtTime(s.muted ? 0 : 0.8, t, 0.08);
      if (s.muted) return;
      const p = live.player;
      const dist = Math.hypot(p.x, p.z);
      const density = Math.max(0.25, 1 - dist / (CITY_EXTENT * 1.3));
      amb.gain.setTargetAtTime(0.05 + 0.14 * density, t, 0.3);
      hum.gain.setTargetAtTime(0.05 + 0.1 * density, t, 0.3);
      rain.gain.setTargetAtTime(live.rain * 0.22, t, 0.3);
      const driving = s.playerMode === 'drive';
      const sp = Math.abs(p.speed);
      eng.gain.setTargetAtTime(driving ? 0.03 + 0.05 * Math.min(1, sp / 40) : 0, t, 0.1);
      const fq = 38 + sp * 3.2;
      osc1.frequency.setTargetAtTime(fq, t, 0.08); osc2.frequency.setTargetAtTime(fq * 0.5, t, 0.08);
      if (s.playerMode === 'walk' && sp > 0.3) {
        stepT -= dt * Math.min(2.2, 0.7 + sp * 0.18);
        if (stepT <= 0) { stepT = 0.5; blip(220 + Math.random() * 120, 1.2, 0.07, 0.12, Math.random() * 0.2 - 0.1); }
      } else stepT = 0;
      honkT -= dt;
      if (honkT <= 0) { honkT = 7 + Math.random() * 14; if (density > 0.35) honk(); }
    };

    const gesture = () => ensure();
    const onThunder = () => thunder();
    const unsub = cityStore.subscribe(() => { if (!cityStore.get().muted) ensure(); });
    window.addEventListener('pointerdown', gesture);
    window.addEventListener('keydown', gesture);
    window.addEventListener('touchstart', gesture);
    window.addEventListener('city3d:thunder', onThunder);
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf); unsub();
      window.removeEventListener('pointerdown', gesture);
      window.removeEventListener('keydown', gesture);
      window.removeEventListener('touchstart', gesture);
      window.removeEventListener('city3d:thunder', onThunder);
      if (ctx) void ctx.close();
      ctx = null;
    };
  }, []);
  return null;
};
