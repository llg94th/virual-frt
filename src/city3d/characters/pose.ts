import type { CharacterPose } from '../shared';
// ---------------------------------------------------------------- pose model
export const J = { HY: 0, SPX: 1, HDX: 2, HDY: 3, LTH: 4, RTH: 5, LKN: 6, RKN: 7, LAX: 8, RAX: 9, LEL: 10, REL: 11, LAZ: 12, RAZ: 13, BRE: 14, HZ: 15, N: 16 };
export const HIP_Y = 0.9;
export const tgt = new Float32Array(J.N);

export function computeTarget(pose: CharacterPose, ph: number, t: number, off: number) {
  tgt.fill(0);
  tgt[J.HY] = HIP_Y; tgt[J.LAZ] = 0.08; tgt[J.RAZ] = -0.08; tgt[J.LEL] = -0.15; tgt[J.REL] = -0.15;
  tgt[J.BRE] = Math.sin(t * 1.8 + off) * 0.012;
  switch (pose) {
    case 'idle':
      tgt[J.HDY] = Math.sin(t * 0.5 + off) * 0.5 * Math.max(0, Math.sin(t * 0.17 + off * 2));
      tgt[J.HDX] = Math.sin(t * 0.3 + off) * 0.06;
      tgt[J.LAX] = Math.sin(t * 1.8 + off) * 0.03; tgt[J.RAX] = -tgt[J.LAX];
      break;
    case 'walk': case 'run': {
      const run = pose === 'run';
      const A = run ? 0.95 : 0.55, K = run ? 1.5 : 0.85, s = Math.sin(ph), c = Math.cos(ph);
      tgt[J.LTH] = -s * A; tgt[J.RTH] = s * A;
      tgt[J.LKN] = Math.max(0, c) * K + 0.05; tgt[J.RKN] = Math.max(0, -c) * K + 0.05;
      tgt[J.LAX] = s * A * 0.9; tgt[J.RAX] = -s * A * 0.9;
      tgt[J.LEL] = run ? -1.2 : -0.3; tgt[J.REL] = run ? -1.2 : -0.3;
      tgt[J.SPX] = run ? 0.22 : 0.05; tgt[J.HDX] = run ? -0.15 : 0;
      tgt[J.HY] = HIP_Y - (run ? 0.05 : 0.02) + Math.abs(Math.cos(ph)) * (run ? 0.07 : 0.035);
      tgt[J.HZ] = s * (run ? 0.08 : 0.05);
      break;
    }
    case 'sit': case 'type': case 'drive': {
      tgt[J.HY] = 0.5;
      tgt[J.LTH] = tgt[J.RTH] = -Math.PI / 2 + 0.03; tgt[J.LKN] = tgt[J.RKN] = Math.PI / 2 - 0.05;
      tgt[J.SPX] = 0.05;
      if (pose === 'sit') {
        tgt[J.LAX] = tgt[J.RAX] = -0.5; tgt[J.LEL] = tgt[J.REL] = -0.9;
        tgt[J.HDY] = Math.sin(t * 0.4 + off) * 0.25;
      } else if (pose === 'type') {
        tgt[J.SPX] = 0.12; tgt[J.HDX] = 0.12;
        tgt[J.LAX] = -0.85; tgt[J.RAX] = -0.85;
        tgt[J.LEL] = -1.35 + Math.sin(t * 17 + off) * 0.12; tgt[J.REL] = -1.35 + Math.sin(t * 14 + off + 2) * 0.12;
        tgt[J.LAZ] = 0.1; tgt[J.RAZ] = -0.1;
      } else {
        tgt[J.LAX] = tgt[J.RAX] = -1.15; tgt[J.LEL] = tgt[J.REL] = -0.45;
        tgt[J.LAZ] = 0.15; tgt[J.RAZ] = -0.15; tgt[J.SPX] = 0;
        tgt[J.HDY] = Math.sin(t * 0.6 + off) * 0.08;
      }
      break;
    }
    case 'wave':
      tgt[J.RAX] = -0.2; tgt[J.RAZ] = -2.5 + Math.sin(t * 9) * 0.3; tgt[J.REL] = -0.6;
      tgt[J.HDY] = 0.2; tgt[J.LAX] = Math.sin(t * 1.8) * 0.03;
      break;
  }
}

