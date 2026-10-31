// Soundings: each level has a pressure, height, temperature, dew point, and wind. A parcel starts at the surface,
// as the mean of the lowest 100 hPa, or at the most unstable level. Its LCL, LFC, EL, CAPE, and CIN use virtual
// temperature. The sounding also gives stability indices, precipitable water, shear, storm motion, and helicity.
import { check } from '../core/problem';
import {
  G,
  KAPPA,
  RD,
  esWater,
  lclPressure,
  lclTemperatureBolton,
  mixingRatio,
  moistAdiabat,
  potentialTemperature,
  specificHumidity,
  thetaE,
  virtualTemperature,
} from './thermo';

export interface Level {
  p: number;
  z: number;
  t: number;
  td: number;
  /** Wind toward which components point: u east, v north, m/s; null when not given. */
  u: number | null;
  v: number | null;
}

/** Wind components from the direction it blows from (degrees) and its speed. */
export const components = (direction: number, speed: number): [number, number] => {
  const a = (direction * Math.PI) / 180;
  return [-speed * Math.sin(a), -speed * Math.cos(a)];
};

export function checkSounding(levels: readonly Level[]): Level[] {
  check(levels.length >= 3, 'soundingShort');
  const sorted = [...levels].sort((a, b) => b.p - a.p);
  for (let i = 0; i < sorted.length; i++) {
    const l = sorted[i];
    check(l.p > 0, 'pressure');
    check(l.td <= l.t + 1e-9, 'dewAbove');
    if (i > 0) check(l.p < sorted[i - 1].p && l.z > sorted[i - 1].z, 'soundingOrder');
  }
  return sorted;
}

/** Linear interpolation in ln p of a level property. */
export function atPressure(levels: readonly Level[], p: number, get: (l: Level) => number | null): number | null {
  for (let i = 1; i < levels.length; i++) {
    const a = levels[i - 1];
    const b = levels[i];
    if (p <= a.p && p >= b.p) {
      const va = get(a);
      const vb = get(b);
      if (va === null || vb === null) return null;
      const s = Math.log(a.p / p) / Math.log(a.p / b.p);
      return va + s * (vb - va);
    }
  }
  return null;
}

export function atHeight(levels: readonly Level[], z: number, get: (l: Level) => number | null): number | null {
  for (let i = 1; i < levels.length; i++) {
    const a = levels[i - 1];
    const b = levels[i];
    if (z >= a.z && z <= b.z) {
      const va = get(a);
      const vb = get(b);
      if (va === null || vb === null) return null;
      return va + ((z - a.z) / (b.z - a.z)) * (vb - va);
    }
  }
  return null;
}

export type ParcelKind = 'surface' | 'mixed' | 'unstable';

export interface Parcel {
  kind: ParcelKind;
  p: number;
  t: number;
  td: number;
  lcl: { p: number; t: number };
  lfc: number | null;
  el: number | null;
  cape: number;
  cin: number;
  /** The parcel's temperature (K) along the profile's pressures, for drawing. */
  path: [number, number][];
}

function startOf(levels: readonly Level[], kind: ParcelKind): { p: number; t: number; td: number } {
  const surface = levels[0];
  if (kind === 'surface') return surface;
  if (kind === 'mixed') {
    // Mean potential temperature and mixing ratio of the lowest 100 hPa, by equal steps in pressure.
    const top = surface.p - 1e4;
    const n = 50;
    let theta = 0;
    let w = 0;
    for (let k = 0; k <= n; k++) {
      const p = surface.p - (k / n) * (surface.p - top);
      const t = atPressure(levels, p, (l) => l.t) ?? surface.t;
      const td = atPressure(levels, p, (l) => l.td) ?? surface.td;
      theta += potentialTemperature(t, p) / (n + 1);
      w += mixingRatio(esWater(td), p) / (n + 1);
    }
    const t = theta * (surface.p / 1e5) ** KAPPA;
    const e = (w * surface.p) / (0.622 + w);
    const l = Math.log(e / 611.2);
    return { p: surface.p, t, td: Math.min(t, 273.15 + (243.5 * l) / (17.67 - l)) };
  }
  // Most unstable: the largest θe in the lowest 300 hPa.
  let best = surface;
  for (const l of levels)
    if (l.p >= surface.p - 3e4 && thetaE(l.t, l.td, l.p) > thetaE(best.t, best.td, best.p)) best = l;
  return best;
}

/** The parcel's temperature at pressure p: dry below its LCL with constant mixing ratio, pseudo-adiabatic above. */
function parcelT(start: { p: number; t: number }, lcl: { p: number; t: number }, p: number): number {
  return p >= lcl.p ? start.t * (p / start.p) ** KAPPA : moistAdiabat(lcl.t, lcl.p, p);
}

/** Lifts a parcel and integrates its buoyancy, Rd ∫ (Tv,parcel − Tv,env) d ln p, on a fine grid in ln p. */
export function liftParcel(levels: readonly Level[], kind: ParcelKind): Parcel {
  const start = startOf(levels, kind);
  const tl = lclTemperatureBolton(start.t, start.td);
  const lcl = { t: tl, p: lclPressure(start.t, start.p, tl) };
  const w0 = mixingRatio(esWater(start.td), start.p);
  const top = levels[levels.length - 1].p;
  const steps = 400;
  const grid = Array.from({ length: steps + 1 }, (_, k) => start.p * (top / start.p) ** (k / steps));
  const buoyancy = grid.map((p) => {
    const tp = parcelT(start, lcl, p);
    const wp = p >= lcl.p ? w0 : mixingRatio(esWater(tp), p);
    const te = atPressure(levels, p, (l) => l.t)!;
    const tde = atPressure(levels, p, (l) => l.td)!;
    return virtualTemperature(tp, wp) - virtualTemperature(te, mixingRatio(esWater(tde), p));
  });
  let lfc: number | null = null;
  let el: number | null = null;
  let cape = 0;
  let cin = 0;
  const crossing = (i: number) =>
    grid[i - 1] * (grid[i] / grid[i - 1]) ** (buoyancy[i - 1] / (buoyancy[i - 1] - buoyancy[i]));
  for (let i = 1; i <= steps; i++) {
    const area = (RD * (buoyancy[i] + buoyancy[i - 1]) * Math.log(grid[i - 1] / grid[i])) / 2;
    if (grid[i] <= lcl.p && lfc === null && buoyancy[i] > 0) lfc = buoyancy[i - 1] <= 0 ? crossing(i) : grid[i - 1];
    if (lfc === null) cin += Math.min(area, 0);
    else {
      if (area > 0) cape += area;
      if (buoyancy[i - 1] > 0 && buoyancy[i] <= 0) el = crossing(i);
      if (buoyancy[i] > 0) el = null;
    }
  }
  if (lfc === null) cin = 0;
  const path = levels.filter((l) => l.p <= start.p).map((l): [number, number] => [l.p, parcelT(start, lcl, l.p)]);
  path.unshift([start.p, start.t]);
  return { kind, p: start.p, t: start.t, td: start.td, lcl, lfc, el, cape, cin, path };
}

export interface Indices {
  lifted: number | null;
  k: number | null;
  totals: number | null;
  /** Precipitable water, kg/m² (= mm). */
  water: number;
}

export function indices(levels: readonly Level[], parcel: Parcel): Indices {
  const at = (p: number, get: (l: Level) => number) => atPressure(levels, p, get);
  const t850 = at(85000, (l) => l.t);
  const td850 = at(85000, (l) => l.td);
  const t700 = at(70000, (l) => l.t);
  const td700 = at(70000, (l) => l.td);
  const t500 = at(50000, (l) => l.t);
  const lcl = parcel.lcl;
  const lifted = t500 === null ? null : t500 - parcelT(parcel, lcl, 50000);
  const k =
    t850 === null || td850 === null || t700 === null || td700 === null || t500 === null
      ? null
      : t850 - t500 + (td850 - 273.15) - (t700 - td700);
  const totals = t850 === null || td850 === null || t500 === null ? null : t850 + td850 - 2 * t500;
  let water = 0;
  for (let i = 1; i < levels.length; i++) {
    const q = (l: Level) => specificHumidity(mixingRatio(esWater(l.td), l.p));
    water += ((q(levels[i - 1]) + q(levels[i])) / 2) * ((levels[i - 1].p - levels[i].p) / G);
  }
  return { lifted, k, totals, water };
}

export interface Winds {
  shear: number | null;
  mean: [number, number] | null;
  right: [number, number] | null;
  left: [number, number] | null;
  srh: number | null;
}

/** Bulk shear 0-6 km, the Bunkers (2000) storm motions, and 0-3 km storm-relative helicity for the right mover. */
export function winds(levels: readonly Level[]): Winds {
  const ground = levels[0].z;
  const uv = (z: number): [number, number] | null => {
    const u = atHeight(levels, ground + z, (l) => l.u);
    const v = atHeight(levels, ground + z, (l) => l.v);
    return u === null || v === null ? null : [u, v];
  };
  const low = uv(0);
  const six = uv(6000);
  const shear = low && six ? Math.hypot(six[0] - low[0], six[1] - low[1]) : null;
  const avg = (from: number, to: number): [number, number] | null => {
    let su = 0;
    let sv = 0;
    const n = Math.max(1, Math.round((to - from) / 250));
    for (let k = 0; k <= n; k++) {
      const w = uv(from + ((to - from) * k) / n);
      if (!w) return null;
      su += w[0] / (n + 1);
      sv += w[1] / (n + 1);
    }
    return [su, sv];
  };
  const mean = avg(0, 6000);
  const bottom = avg(0, 500);
  const head = avg(5500, 6000);
  let right: [number, number] | null = null;
  let left: [number, number] | null = null;
  if (mean && bottom && head) {
    const s = [head[0] - bottom[0], head[1] - bottom[1]];
    const size = Math.hypot(s[0], s[1]);
    if (size > 0) {
      // 7.5 m/s off the mean wind, at right angles to the shear: right of it for the right mover.
      const d = 7.5 / size;
      right = [mean[0] + d * s[1], mean[1] - d * s[0]];
      left = [mean[0] - d * s[1], mean[1] + d * s[0]];
    }
  }
  let srh: number | null = null;
  if (right) {
    srh = 0;
    for (let z = 0; z < 3000; z += 100) {
      const a = uv(z);
      const b = uv(z + 100);
      if (!a || !b) {
        srh = null;
        break;
      }
      srh += (b[0] - right[0]) * (a[1] - right[1]) - (a[0] - right[0]) * (b[1] - right[1]);
    }
  }
  return { shear, mean, right, left, srh };
}
