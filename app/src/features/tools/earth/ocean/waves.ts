// Linear surface gravity waves: the dispersion relation ω² = gk tanh(kh) solved by Newton's method, phase and group
// speeds, energy and power, shoaling and refraction toward a beach, and the breaking depth and wave setup.
import { check } from '../core/problem';
import { G0 } from './rotating';

export interface Dispersion {
  k: number;
  length: number;
  phase: number;
  group: number;
  /** cg / c, from 1/2 in deep water to 1 in shallow water. */
  n: number;
  regime: 'deep' | 'intermediate' | 'shallow';
  /** The Newton iterates of kh, for the steps. */
  iterates: number[];
}

/** Solves ω² = gk tanh(kh) for k by Newton's method on x = kh, from the deep-water guess. */
export function dispersion(period: number, depth: number, g = G0): Dispersion {
  check(period > 0, 'period');
  check(depth > 0, 'depth');
  const omega = (2 * Math.PI) / period;
  const y = (omega * omega * depth) / g;
  // Solve x tanh x = y; the starting guess max(y, √y) lies above the root, so Newton's steps fall to it.
  let x = Math.max(y, Math.sqrt(y));
  const iterates = [x];
  for (let i = 0; i < 50; i++) {
    const th = Math.tanh(x);
    const fx = x * th - y;
    const dfx = th + x * (1 - th * th);
    const next = x - fx / dfx;
    iterates.push(next);
    if (Math.abs(next - x) < 1e-14 * Math.max(1, x)) {
      x = next;
      break;
    }
    x = next;
  }
  const k = x / depth;
  const phase = omega / k;
  const n = 0.5 * (1 + (2 * x) / Math.sinh(2 * x));
  const ratio = depth / ((2 * Math.PI) / k);
  return {
    k,
    length: (2 * Math.PI) / k,
    phase,
    group: n * phase,
    n: Number.isFinite(n) ? n : 0.5,
    regime: ratio > 0.5 ? 'deep' : ratio < 0.05 ? 'shallow' : 'intermediate',
    iterates,
  };
}

/** The deep-water length gT²/2π and speed gT/2π. */
export function deepWater(period: number, g = G0): { length: number; phase: number; group: number } {
  check(period > 0, 'period');
  const length = (g * period * period) / (2 * Math.PI);
  return { length, phase: length / period, group: length / period / 2 };
}

export const shallowSpeed = (depth: number, g = G0): number => {
  check(depth > 0, 'depth');
  return Math.sqrt(g * depth);
};

/** Energy per unit area ρgH²/8 and power per unit crest length E·cg. */
export function energy(height: number, group: number, density = 1025, g = G0): { energy: number; power: number } {
  check(height > 0, 'height');
  const e = (density * g * height * height) / 8;
  return { energy: e, power: e * group };
}

export interface Shoaling {
  ks: number;
  kr: number;
  height: number;
  angle: number;
  local: Dispersion;
}

/** A deep-water wave of height H0 and angle θ0 to the depth contours, carried to depth h by Snell's law. */
export function shoal(period: number, height0: number, angle0: number, depth: number, g = G0): Shoaling {
  check(height0 > 0, 'height');
  check(Math.abs(angle0) < 90, 'angle');
  const deep = deepWater(period, g);
  const local = dispersion(period, depth, g);
  const sin = (Math.sin((angle0 * Math.PI) / 180) * local.phase) / deep.phase;
  const angle = (Math.asin(sin) * 180) / Math.PI;
  const ks = Math.sqrt(deep.group / local.group);
  const kr = Math.sqrt(Math.cos((angle0 * Math.PI) / 180) / Math.cos((angle * Math.PI) / 180));
  return { ks, kr, height: height0 * ks * kr, angle, local };
}

/** The depth at which a wave of height H breaks (H/d = γ), and the setdown and shoreline setup (Bowen et al.). */
export function breaking(height: number, gamma = 0.78): { depth: number; setdown: number; setup: number } {
  check(height > 0, 'height');
  check(gamma > 0 && gamma <= 1.2, 'gamma');
  const depth = height / gamma;
  const setdown = (-gamma * height) / 16;
  const share = (3 * gamma * gamma) / 8;
  return { depth, setdown, setup: setdown + (share / (1 + share)) * depth };
}
