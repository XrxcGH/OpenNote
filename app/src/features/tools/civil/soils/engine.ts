// Soil mechanics: phase relations, gradation, Atterberg limits, soil classes, compaction, permeability, effective
// stress, stresses under loads, one-dimensional consolidation, and shear strength. Stresses are in kPa, unit weights
// in kN/m³, and lengths in m. Water contents are in percent unless a name says otherwise.
import { deg, rad } from '../core/format';
import { brent, lineFit, maximize, polyAt, polyFit } from '../core/num';
import { need } from '../core/types';
import type { Msg } from '../core/types';

// ---------------------------------------------------------------------------------------------------------------
// Phase relations

export interface PhaseKnown {
  e?: number | null;
  n?: number | null;
  /** Water content as a ratio, not percent. */
  w?: number | null;
  S?: number | null;
  gamma?: number | null;
  gammaD?: number | null;
}

export interface Phases {
  e: number;
  n: number;
  w: number;
  S: number;
  gamma: number;
  gammaD: number;
  gammaSat: number;
  gammaSub: number;
  /** Volumes of solids, water, and air in 1 m³ of soil. */
  Vs: number;
  Vw: number;
  Va: number;
  /** Which pair of the unknowns fixed the void ratio, for the steps. */
  route: 'void' | 'wS' | 'wGamma' | 'sGamma';
}

/**
 * Every phase quantity from the specific gravity and two independent ones of e, n, w, S, γ, and γ_d. Two that each
 * fix the void ratio (such as e and n) are not independent.
 */
export function phases(Gs: number, known: PhaseKnown, gw: number): Phases {
  need(Gs > 0, 'errors.positive', { name: 'G_s' });
  need(gw > 0, 'errors.positive', { name: 'γ_w' });
  const has = (v: number | null | undefined): v is number => typeof v === 'number';
  const count = [known.e, known.n, known.w, known.S, known.gamma, known.gammaD].filter(has).length;
  need(count === 2, 'soils.errors.twoKnown');
  if (has(known.e)) need(known.e > 0, 'errors.positive', { name: 'e' });
  if (has(known.n)) need(known.n > 0 && known.n < 1, 'soils.errors.porosity');
  if (has(known.w)) need(known.w >= 0, 'errors.nonNegative', { name: 'w' });
  if (has(known.S)) need(known.S >= 0 && known.S <= 1, 'soils.errors.saturation');
  if (has(known.gamma)) need(known.gamma > 0, 'errors.positive', { name: 'γ' });
  if (has(known.gammaD)) need(known.gammaD > 0, 'errors.positive', { name: 'γ_d' });
  const fromVoids = [known.e, known.n, known.gammaD].filter(has).length;
  need(fromVoids < 2, 'soils.errors.dependent');
  let e: number;
  let S: number;
  let route: Phases['route'] = 'void';
  if (fromVoids === 1) {
    e = has(known.e) ? known.e : has(known.n) ? known.n / (1 - known.n) : (Gs * gw) / known.gammaD! - 1;
    need(e > 0, 'soils.errors.inconsistent');
    if (has(known.S)) S = known.S;
    else if (has(known.w)) S = (known.w * Gs) / e;
    else S = ((known.gamma! * (1 + e)) / gw - Gs) / e;
  } else if (has(known.w) && has(known.S)) {
    need(known.S > 0, 'soils.errors.dependent');
    route = 'wS';
    S = known.S;
    e = (known.w * Gs) / known.S;
  } else if (has(known.w)) {
    route = 'wGamma';
    e = (Gs * (1 + known.w) * gw) / known.gamma! - 1;
    S = e > 0 ? (known.w * Gs) / e : NaN;
  } else {
    route = 'sGamma';
    S = known.S!;
    const below = known.gamma! - S * gw;
    need(Math.abs(below) > 1e-12, 'soils.errors.dependent');
    e = (Gs * gw - known.gamma!) / below;
  }
  need(e > 0 && Number.isFinite(e), 'soils.errors.inconsistent');
  need(S >= -1e-9 && S <= 1 + 1e-9, 'soils.errors.inconsistent');
  S = Math.min(1, Math.max(0, S));
  const Vs = 1 / (1 + e);
  return {
    e,
    n: e / (1 + e),
    w: (S * e) / Gs,
    S,
    gamma: ((Gs + S * e) * gw) / (1 + e),
    gammaD: (Gs * gw) / (1 + e),
    gammaSat: ((Gs + e) * gw) / (1 + e),
    gammaSub: ((Gs + e) * gw) / (1 + e) - gw,
    Vs,
    Vw: S * e * Vs,
    Va: (1 - S) * e * Vs,
    route,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Gradation and Atterberg limits

/** Sieve data as (opening in mm, percent passing), sorted coarse to fine, with passing never rising as sizes fall. */
function sieves(rows: readonly (readonly number[])[]): (readonly [number, number])[] {
  need(rows.length >= 2, 'errors.fewPoints', { count: 2 });
  const data = rows.map((r) => [r[0]!, r[1]!] as const).sort((a, b) => b[0] - a[0]);
  need(
    data.every(([d, p]) => d > 0 && p >= 0 && p <= 100),
    'soils.errors.sieveRow',
  );
  for (let i = 1; i < data.length; i++) need(data[i]![1] <= data[i - 1]![1] + 1e-9, 'soils.errors.sieveOrder');
  return data;
}

/** The size (mm) that `percent` of the soil passes, by straight lines on the log-size grading curve; null off the curve. */
export function sizeAt(rows: readonly (readonly number[])[], percent: number): number | null {
  const data = sieves(rows);
  for (let i = 0; i + 1 < data.length; i++) {
    const [d1, p1] = data[i]!;
    const [d2, p2] = data[i + 1]!;
    if (percent <= p1 && percent >= p2) {
      if (p1 === p2) return d2;
      return 10 ** (Math.log10(d2) + ((percent - p2) / (p1 - p2)) * (Math.log10(d1) - Math.log10(d2)));
    }
  }
  return null;
}

/** The percent passing a size (mm), interpolated on the log-size curve; null outside the sieves used. */
export function passingAt(rows: readonly (readonly number[])[], size: number): number | null {
  const data = sieves(rows);
  if (size > data[0]![0]) return data[0]![1] >= 100 - 1e-9 ? 100 : null;
  for (let i = 0; i + 1 < data.length; i++) {
    const [d1, p1] = data[i]!;
    const [d2, p2] = data[i + 1]!;
    if (size <= d1 && size >= d2)
      return p2 + ((Math.log10(size) - Math.log10(d2)) / (Math.log10(d1) - Math.log10(d2))) * (p1 - p2);
  }
  return null;
}

export function gradation(rows: readonly (readonly number[])[]) {
  const D10 = sizeAt(rows, 10);
  const D30 = sizeAt(rows, 30);
  const D60 = sizeAt(rows, 60);
  const p4 = passingAt(rows, 4.75);
  const p200 = passingAt(rows, 0.075);
  return {
    D10,
    D30,
    D60,
    Cu: D10 !== null && D60 !== null ? D60 / D10 : null,
    Cc: D10 !== null && D30 !== null && D60 !== null ? (D30 * D30) / (D10 * D60) : null,
    gravel: p4 === null ? null : 100 - p4,
    sand: p4 === null || p200 === null ? null : p4 - p200,
    fines: p200,
  };
}

/**
 * The diameter (mm) of the largest particle still in suspension at the hydrometer's depth by Stokes' law, and the
 * percent finer from a 152H reading, whose scale is grams of soil per liter for G_s = 2.65.
 */
export function hydrometer(
  Gs: number,
  mu: number,
  L: number,
  t: number,
  rhoW: number,
  reading?: number | null,
  Ws?: number | null,
) {
  need(Gs > 1, 'soils.errors.gs');
  need(mu > 0 && L > 0 && t > 0 && rhoW > 0, 'errors.positive', { name: 'μ, L, t, ρ_w' });
  const D = Math.sqrt((18 * mu * L) / ((Gs - 1) * rhoW * 9.81 * t)) * 1000;
  const a = (1.65 * Gs) / (2.65 * (Gs - 1));
  let finer: number | null = null;
  if (typeof reading === 'number' && typeof Ws === 'number') {
    need(Ws > 0, 'errors.positive', { name: 'W_s' });
    finer = ((a * reading) / Ws) * 100;
  }
  return { D, a, finer };
}

/** The liquid limit from the flow curve: water content against log blows, read at 25 blows. */
export function flowCurve(rows: readonly (readonly number[])[]) {
  need(rows.length >= 2, 'errors.fewPoints', { count: 2 });
  need(
    rows.every(([N, w]) => N! > 0 && w! > 0),
    'soils.errors.flowRow',
  );
  const line = lineFit(
    rows.map(([N]) => Math.log10(N!)),
    rows.map(([, w]) => w!),
  );
  need(line.slope < 0, 'soils.errors.flowSlope');
  return { LL: line.intercept + line.slope * Math.log10(25), flowIndex: -line.slope, a: line.intercept, r2: line.r2 };
}

export function indices(LL: number, PL: number, w: number | null, clay: number | null) {
  need(LL > 0 && PL >= 0, 'errors.positive', { name: 'LL' });
  need(PL <= LL, 'soils.errors.plastic');
  const PI = LL - PL;
  return {
    PI,
    LI: w === null || PI === 0 ? null : (w - PL) / PI,
    CI: w === null || PI === 0 ? null : (LL - w) / PI,
    activity: clay === null || clay <= 0 ? null : PI / clay,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Classification

export const aLine = (LL: number) => 0.73 * (LL - 20);
export const uLine = (LL: number) => 0.9 * (LL - 8);

/** The fine-grained group symbol from the plasticity chart (inorganic soils). */
export function finesSymbol(LL: number, PI: number): 'CL' | 'ML' | 'CL-ML' | 'CH' | 'MH' {
  const above = PI >= aLine(LL);
  if (LL >= 50) return above ? 'CH' : 'MH';
  if (PI > 7 && above) return 'CL';
  if (PI >= 4 && above) return 'CL-ML';
  return 'ML';
}

export interface UscsInput {
  /** Percent passing the No. 200 (0.075 mm) sieve. */
  fines: number;
  /** Percent passing the No. 4 (4.75 mm) sieve. */
  passing4: number;
  LL: number | null;
  PL: number | null;
  Cu: number | null;
  Cc: number | null;
}

export interface Classification {
  symbol: string;
  /** The key of the group name. */
  name: string;
  path: Msg[];
  notes: Msg[];
}

/** The Unified Soil Classification System group symbol and name, with the decisions taken in order. */
export function uscs(input: UscsInput): Classification {
  const { fines, passing4, LL, PL, Cu, Cc } = input;
  need(fines >= 0 && fines <= 100 && passing4 >= fines && passing4 <= 100, 'soils.errors.percents');
  const path: Msg[] = [];
  const notes: Msg[] = [];
  const plastic = () => {
    need(LL !== null, 'soils.errors.needLimits');
    const PI = PL === null ? 0 : LL - PL;
    need(LL > 0 && PI >= 0, 'soils.errors.plastic');
    const symbol = finesSymbol(LL, PI);
    path.push({ key: 'soils.uscs.chart', vars: { LL, PI, A: aLine(LL), symbol } });
    if (PI > uLine(LL)) notes.push({ key: 'soils.uscs.uLine', vars: { U: uLine(LL) } });
    return symbol;
  };
  if (fines >= 50) {
    path.push({ key: 'soils.uscs.fine', vars: { F: fines } });
    const symbol = plastic();
    notes.push({ key: 'soils.uscs.organic' });
    return { symbol, name: `soils.names.${symbol.replace(/-/g, '_')}`, path, notes };
  }
  const coarse = 100 - fines;
  const gravelPart = 100 - passing4;
  const letter = gravelPart > coarse / 2 ? 'G' : 'S';
  path.push({
    key: 'soils.uscs.coarse',
    vars: { F: fines, G: gravelPart, half: coarse / 2, kind: `~soils.uscs.${letter}` },
  });
  const graded = () => {
    need(Cu !== null && Cc !== null, 'soils.errors.needGrading');
    need(Cu >= 1 && Cc > 0, 'soils.errors.grading');
    const cuMin = letter === 'G' ? 4 : 6;
    const well = Cu >= cuMin && Cc >= 1 && Cc <= 3;
    path.push({ key: well ? 'soils.uscs.well' : 'soils.uscs.poor', vars: { Cu, Cc, min: cuMin } });
    return well ? 'W' : 'P';
  };
  let symbol: string;
  if (fines < 5) {
    path.push({ key: 'soils.uscs.clean', vars: { F: fines } });
    symbol = letter + graded();
  } else if (fines > 12) {
    path.push({ key: 'soils.uscs.dirty', vars: { F: fines } });
    const f = plastic();
    symbol = f === 'CL-ML' ? `${letter}C-${letter}M` : letter + (f === 'ML' || f === 'MH' ? 'M' : 'C');
  } else {
    path.push({ key: 'soils.uscs.dual', vars: { F: fines } });
    const g = graded();
    const f = plastic();
    if (f === 'CL-ML') notes.push({ key: 'soils.uscs.clml' });
    symbol = `${letter}${g}-${letter}${f === 'ML' || f === 'MH' ? 'M' : 'C'}`;
  }
  notes.push({ key: 'soils.uscs.modifiers' });
  return { symbol, name: `soils.names.${symbol.replace(/-/g, '_')}`, path, notes };
}

export interface AashtoInput {
  p10: number;
  p40: number;
  p200: number;
  LL: number;
  PI: number;
}

/** The AASHTO M 145 group, found left to right in the table, with its group index. */
export function aashto(input: AashtoInput) {
  const { p10, p40, p200, LL, PI } = input;
  need([p10, p40, p200].every((p) => p >= 0 && p <= 100) && p10 >= p40 && p40 >= p200, 'soils.errors.percents');
  need(LL >= 0 && PI >= 0, 'errors.nonNegative', { name: 'LL, PI' });
  let group: string;
  if (p10 <= 50 && p40 <= 30 && p200 <= 15 && PI <= 6) group = 'A-1-a';
  else if (p40 <= 50 && p200 <= 25 && PI <= 6) group = 'A-1-b';
  else if (p40 > 50 && p200 <= 10 && PI === 0) group = 'A-3';
  else if (p200 <= 35) group = LL <= 40 ? (PI <= 10 ? 'A-2-4' : 'A-2-6') : PI <= 10 ? 'A-2-5' : 'A-2-7';
  else if (LL <= 40) group = PI <= 10 ? 'A-4' : 'A-6';
  else if (PI <= 10) group = 'A-5';
  else group = PI <= LL - 30 ? 'A-7-5' : 'A-7-6';
  const first = (p200 - 35) * (0.2 + 0.005 * (LL - 40));
  const second = 0.01 * (p200 - 15) * (PI - 10);
  let raw: number;
  if (['A-1-a', 'A-1-b', 'A-2-4', 'A-2-5', 'A-3'].includes(group)) raw = 0;
  else if (group === 'A-2-6' || group === 'A-2-7') raw = second;
  else raw = first + second;
  return { group, GI: Math.max(0, Math.round(raw)), raw, first, second };
}

// ---------------------------------------------------------------------------------------------------------------
// Compaction and permeability

/** The zero-air-voids dry unit weight at a water content (ratio), and the line for any degree of saturation. */
export const dryUnitWeightAt = (w: number, Gs: number, gw: number, S = 1) => (Gs * gw) / (1 + (w * Gs) / S);

/** The Proctor curve: a polynomial through (water content %, dry unit weight), its peak, and the optimum. */
export function proctor(rows: readonly (readonly number[])[], degree: 2 | 3) {
  need(rows.length >= degree + 1, 'errors.fewPoints', { count: degree + 1 });
  need(
    rows.every(([w, g]) => w! >= 0 && g! > 0),
    'soils.errors.proctorRow',
  );
  const x = rows.map(([w]) => w!);
  const y = rows.map(([, g]) => g!);
  const fit = polyFit(x, y, degree);
  const lo = Math.min(...x);
  const hi = Math.max(...x);
  const wOpt = maximize((w) => polyAt(fit, w), lo, hi);
  const span = hi - lo;
  need(wOpt > lo + span * 1e-3 && wOpt < hi - span * 1e-3, 'soils.errors.noPeak');
  return { fit, wOpt, gammaMax: polyAt(fit, wOpt), lo, hi };
}

export const constantHead = (V: number, L: number, A: number, h: number, t: number) => {
  need(V > 0 && L > 0 && A > 0 && h > 0 && t > 0, 'errors.positive', { name: 'V, L, A, h, t' });
  return (V * L) / (A * h * t);
};

export const fallingHead = (a: number, L: number, A: number, t: number, h1: number, h2: number) => {
  need(a > 0 && L > 0 && A > 0 && t > 0, 'errors.positive', { name: 'a, L, A, t' });
  need(h1 > h2 && h2 > 0, 'soils.errors.heads');
  return ((a * L) / (A * t)) * Math.log(h1 / h2);
};

/** Equivalent conductivities of a layered soil: along the layers (arithmetic) and across them (harmonic). */
export function layeredK(rows: readonly (readonly number[])[]) {
  need(rows.length >= 1, 'errors.noRows');
  need(
    rows.every(([h, k]) => h! > 0 && k! > 0),
    'soils.errors.layerRow',
  );
  const H = rows.reduce((s, [h]) => s + h!, 0);
  return {
    H,
    kx: rows.reduce((s, [h, k]) => s + h! * k!, 0) / H,
    kz: H / rows.reduce((s, [h, k]) => s + h! / k!, 0),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Effective stress

export interface StressPoint {
  z: number;
  sigma: number;
  u: number;
  eff: number;
}

/**
 * Total stress, pore pressure, and effective stress with depth. Layers are (thickness, unit weight above the water
 * table, saturated unit weight); soil in the capillary rise above the water table is saturated, with suction.
 */
export function stressProfile(
  layers: readonly (readonly number[])[],
  zw: number,
  hc: number,
  gw: number,
  surcharge = 0,
) {
  need(layers.length >= 1, 'errors.noRows');
  need(
    layers.every(([h, g, gs]) => h! > 0 && g! > 0 && gs! > 0),
    'soils.errors.stressRow',
  );
  need(zw >= 0 && hc >= 0, 'errors.nonNegative', { name: 'z_w, h_c' });
  const capTop = Math.max(0, zw - hc);
  const bottom = layers.reduce((s, [h]) => s + h!, 0);
  const tops: number[] = [0];
  layers.forEach(([h]) => tops.push(tops[tops.length - 1]! + h!));
  const weightAt = (z: number) => {
    const i = Math.min(layers.length - 1, tops.findIndex((t) => t > z) - 1);
    const layer = layers[i < 0 ? layers.length - 1 : i]!;
    return z >= capTop ? layer[2]! : layer[1]!;
  };
  const marks = [...new Set([...tops, zw, capTop].filter((z) => z >= 0 && z <= bottom))].sort((a, b) => a - b);
  const at = (z: number): StressPoint => {
    let sigma = surcharge;
    for (let i = 0; i + 1 < marks.length && marks[i]! < z; i++) {
      const a = marks[i]!;
      const b = Math.min(marks[i + 1]!, z);
      sigma += weightAt((a + b) / 2) * (b - a);
    }
    if (z > bottom) sigma += weightAt(bottom - 1e-9) * (z - bottom);
    const u = z >= zw ? gw * (z - zw) : z >= capTop ? -gw * (zw - z) : 0;
    return { z, sigma, u, eff: sigma - u };
  };
  return { at, marks, bottom };
}

/** Upward seepage through a layer: the gradient, the critical gradient, and the factor of safety against boiling. */
export function quickCondition(gammaSat: number, dh: number, L: number, gw: number) {
  need(gammaSat > gw, 'soils.errors.lighter');
  need(L > 0 && dh >= 0, 'errors.positive', { name: 'L' });
  const i = dh / L;
  const ic = (gammaSat - gw) / gw;
  return { i, ic, FS: i === 0 ? Infinity : ic / i, eff: (gammaSat - gw) * L - i * gw * L };
}

// ---------------------------------------------------------------------------------------------------------------
// Stresses under loads (Boussinesq)

/** Vertical stress under a point load Q at depth z and radial distance r. */
export function pointLoad(Q: number, r: number, z: number) {
  need(z > 0, 'errors.positive', { name: 'z' });
  need(r >= 0, 'errors.nonNegative', { name: 'r' });
  const R = Math.hypot(r, z);
  return (3 * Q * z ** 3) / (2 * Math.PI * R ** 5);
}

export function lineLoad(q: number, x: number, z: number) {
  need(z > 0, 'errors.positive', { name: 'z' });
  return (2 * q * z ** 3) / (Math.PI * (x * x + z * z) ** 2);
}

/** A uniform strip load of width B, with x measured from its centerline. */
export function stripLoad(q: number, B: number, x: number, z: number) {
  need(z > 0 && B > 0, 'errors.positive', { name: 'z, B' });
  const delta = Math.atan((x - B / 2) / z);
  const alpha = Math.atan((x + B / 2) / z) - delta;
  return (q / Math.PI) * (alpha + Math.sin(alpha) * Math.cos(alpha + 2 * delta));
}

/** A uniform circle of radius a, on its axis. */
export function circleLoad(q: number, a: number, z: number) {
  need(z > 0 && a > 0, 'errors.positive', { name: 'z, a' });
  return q * (1 - (1 / (1 + (a / z) ** 2)) ** 1.5);
}

/** The influence factor under the corner of a uniform B by L rectangle (Newmark's integration). */
export function cornerFactor(B: number, L: number, z: number) {
  need(z > 0 && B > 0 && L > 0, 'errors.positive', { name: 'z, B, L' });
  const m = B / z;
  const n = L / z;
  const m2 = m * m;
  const n2 = n * n;
  const root = Math.sqrt(m2 + n2 + 1);
  const first = ((2 * m * n * root) / (m2 + n2 + m2 * n2 + 1)) * ((m2 + n2 + 2) / (m2 + n2 + 1));
  const den = m2 + n2 + 1 - m2 * n2;
  let angle = Math.atan2(2 * m * n * root, den);
  if (angle < 0) angle += Math.PI;
  return (first + angle) / (4 * Math.PI);
}

export function twoToOne(q: number, B: number, L: number, z: number) {
  need(z >= 0 && B > 0 && L > 0, 'errors.positive', { name: 'B, L' });
  return (q * B * L) / ((B + z) * (L + z));
}

// ---------------------------------------------------------------------------------------------------------------
// Consolidation

/** The average degree of consolidation for a time factor, by Terzaghi's series. */
export function degreeOf(Tv: number): number {
  need(Tv >= 0, 'errors.nonNegative', { name: 'T_v' });
  if (Tv === 0) return 0;
  if (Tv < 1e-4) return Math.sqrt((4 * Tv) / Math.PI);
  let sum = 0;
  for (let m = 0; m < 100000; m++) {
    const M = (Math.PI * (2 * m + 1)) / 2;
    const term = (2 / (M * M)) * Math.exp(-M * M * Tv);
    sum += term;
    if (term < 1e-17) break;
  }
  return 1 - sum;
}

/** The time factor for a degree of consolidation: by the series, and by the usual approximations. */
export function timeFactor(U: number) {
  need(U > 0 && U < 1, 'soils.errors.degree');
  const exact = brent((Tv) => degreeOf(Tv) - U, 0, 10);
  const approx = U < 0.6 ? (Math.PI / 4) * U * U : 1.781 - 0.933 * Math.log10(100 - 100 * U);
  return { exact, approx };
}

/** Excess pore pressure as a fraction of the initial at depth ratio Z = z/H_dr. */
export function isochrone(Z: number, Tv: number): number {
  let sum = 0;
  for (let m = 0; m < 2000; m++) {
    const M = (Math.PI * (2 * m + 1)) / 2;
    const decay = Math.exp(-M * M * Tv);
    sum += (2 / M) * Math.sin(M * Z) * decay;
    if (decay < 1e-16) break;
  }
  return sum;
}

export interface SettlementInput {
  Cc: number;
  Cr: number | null;
  e0: number;
  H: number;
  s0: number;
  ds: number;
  /** Preconsolidation pressure; null treats the clay as normally consolidated. */
  sp: number | null;
}

/** Primary consolidation settlement of a clay layer, normally consolidated (NC) and overconsolidated (OC) alike. */
export function settlement({ Cc, Cr, e0, H, s0, ds, sp }: SettlementInput) {
  need(Cc > 0 && e0 > 0 && H > 0 && s0 > 0, 'errors.positive', { name: 'C_c, e₀, H, σ′₀' });
  need(ds > 0, 'errors.positive', { name: 'Δσ' });
  const sf = s0 + ds;
  const k = H / (1 + e0);
  if (sp === null) {
    const S = k * Cc * Math.log10(sf / s0);
    return { S, sf, case: 'nc' as const, recompression: 0, virgin: S, de: Cc * Math.log10(sf / s0) };
  }
  need(sp >= s0 - 1e-9, 'soils.errors.preconsolidation');
  need(Cr !== null && Cr > 0, 'soils.errors.needCr');
  if (sf <= sp) {
    const S = k * Cr * Math.log10(sf / s0);
    return { S, sf, case: 'ocBelow' as const, recompression: S, virgin: 0, de: Cr * Math.log10(sf / s0) };
  }
  const recompression = k * Cr * Math.log10(sp / s0);
  const virgin = k * Cc * Math.log10(sf / sp);
  return {
    S: recompression + virgin,
    sf,
    case: 'ocAbove' as const,
    recompression,
    virgin,
    de: Cr * Math.log10(sp / s0) + Cc * Math.log10(sf / sp),
  };
}

export const secondary = (Ca: number, H: number, ep: number, t1: number, t2: number) => {
  need(Ca > 0 && H > 0 && ep > 0 && t1 > 0, 'errors.positive', { name: 'C_α, H, e_p, t₁' });
  need(t2 > t1, 'soils.errors.times');
  return ((Ca * H) / (1 + ep)) * Math.log10(t2 / t1);
};

/** Linear interpolation of y at x along data sorted by x. */
function interp(xs: readonly number[], ys: readonly number[], x: number): number {
  if (x <= xs[0]!) return ys[0]!;
  for (let i = 1; i < xs.length; i++)
    if (x <= xs[i]!) return ys[i - 1]! + ((x - xs[i - 1]!) / (xs[i]! - xs[i - 1]!)) * (ys[i]! - ys[i - 1]!);
  return ys[ys.length - 1]!;
}

function readings(rows: readonly (readonly number[])[]) {
  need(rows.length >= 5, 'errors.fewPoints', { count: 5 });
  const data = rows.map((r) => [r[0]!, r[1]!] as const).sort((a, b) => a[0] - b[0]);
  need(
    data.every(([t]) => t >= 0),
    'soils.errors.timeRow',
  );
  for (let i = 1; i < data.length; i++) need(data[i]![0] > data[i - 1]![0], 'soils.errors.timeRow');
  // Readings may rise or fall as the sample compresses; work with compression as a positive change.
  const sign = data[data.length - 1]![1] >= data[0]![1] ? 1 : -1;
  return { data, sign };
}

/**
 * Taylor's root-time fit: a line through the first readings (count `early`) on a √t plot, a second line with 1.15
 * times its abscissae, and t₉₀ where the second line meets the readings.
 */
export function taylor(rows: readonly (readonly number[])[], early: number) {
  const { data, sign } = readings(rows);
  need(early >= 2 && early < data.length, 'soils.errors.early');
  const roots = data.map(([t]) => Math.sqrt(t));
  const d = data.map(([, r]) => sign * r);
  const line = lineFit(roots.slice(0, early), d.slice(0, early));
  need(line.slope > 0, 'soils.errors.noCompression');
  const gap = (i: number) => d[i]! - (line.intercept + (line.slope / 1.15) * roots[i]!);
  let index = -1;
  for (let i = Math.max(1, early - 1); i + 1 < data.length; i++)
    if (gap(i) >= 0 && gap(i + 1) < 0) {
      index = i;
      break;
    }
  need(index >= 0, 'soils.errors.noT90');
  const f = (s: number) => interp(roots, d, s) - (line.intercept + (line.slope / 1.15) * s);
  const root90 = brent(f, roots[index]!, roots[index + 1]!);
  return {
    t90: root90 * root90,
    d0: sign * line.intercept,
    slope: sign * line.slope,
    d90: sign * interp(roots, d, root90),
  };
}

/**
 * Casagrande's log-time fit: d₀ from two early readings a time ratio of 4 apart, d₁₀₀ where the tangent at the
 * steepest point meets the line through the last `late` readings, and t₅₀ halfway between.
 */
export function casagrande(rows: readonly (readonly number[])[], late: number) {
  const { data, sign } = readings(rows);
  const pos = data.filter(([t]) => t > 0);
  need(pos.length >= 5, 'errors.fewPoints', { count: 5 });
  need(late >= 2 && late < pos.length - 2, 'soils.errors.late');
  const logs = pos.map(([t]) => Math.log10(t));
  const d = pos.map(([, r]) => sign * r);
  const t1 = pos[0]![0];
  need(4 * t1 <= pos[pos.length - 1]![0], 'soils.errors.early');
  const d1 = d[0]!;
  const d4 = interp(logs, d, Math.log10(4 * t1));
  const d0 = d1 - (d4 - d1);
  // The steepest chord before the late readings gives the tangent through the inflection.
  let best = 0;
  let k = 0;
  for (let i = 0; i + 1 < pos.length - late; i++) {
    const slope = (d[i + 1]! - d[i]!) / (logs[i + 1]! - logs[i]!);
    if (slope > best) {
      best = slope;
      k = i;
    }
  }
  need(best > 0, 'soils.errors.noCompression');
  const xm = (logs[k]! + logs[k + 1]!) / 2;
  const ym = (d[k]! + d[k + 1]!) / 2;
  const tail = lineFit(logs.slice(-late), d.slice(-late));
  need(best > tail.slope, 'soils.errors.noT90');
  const x100 = (tail.intercept - ym + best * xm) / (best - tail.slope);
  const d100 = tail.intercept + tail.slope * x100;
  const d50 = (d0 + d100) / 2;
  need(d50 > d[0]! && d50 < d[d.length - 1]!, 'soils.errors.noT90');
  let j = 0;
  while (j + 1 < d.length && d[j + 1]! < d50) j++;
  const x50 = logs[j]! + ((d50 - d[j]!) / (d[j + 1]! - d[j]!)) * (logs[j + 1]! - logs[j]!);
  return {
    t50: 10 ** x50,
    d0: sign * d0,
    d100: sign * d100,
    d50: sign * d50,
    t100: 10 ** x100,
    Calpha: tail.slope,
  };
}

/**
 * Preconsolidation pressure by Casagrande's construction on an e-log σ′ curve: at the point of sharpest curvature,
 * the bisector of the horizontal and the tangent meets the virgin line fitted through the last `virgin` points. The
 * curvature depends on how the plot is scaled, so the answer is approximate.
 */
export function preconsolidation(rows: readonly (readonly number[])[], virgin: number) {
  need(rows.length >= 5, 'errors.fewPoints', { count: 5 });
  const data = rows.map((r) => [r[0]!, r[1]!] as const).sort((a, b) => a[0] - b[0]);
  need(
    data.every(([s, e]) => s > 0 && e > 0),
    'soils.errors.elogRow',
  );
  need(virgin >= 2 && virgin <= data.length - 3, 'soils.errors.late');
  const x = data.map(([s]) => Math.log10(s));
  const e = data.map(([, v]) => v);
  const line = lineFit(x.slice(-virgin), e.slice(-virgin));
  need(line.slope < 0, 'soils.errors.noCompression');
  let best = -Infinity;
  let at = 1;
  let tangent = 0;
  for (let i = 1; i < data.length - virgin; i++) {
    const fit = polyFit(x.slice(i - 1, i + 2), e.slice(i - 1, i + 2), 2);
    const d1 = fit.c[1]! + 2 * fit.c[2]! * (x[i]! - fit.center);
    const d2 = 2 * fit.c[2]!;
    const kappa = Math.abs(d2) / (1 + d1 * d1) ** 1.5;
    if (d2 < 0 && kappa > best) {
      best = kappa;
      at = i;
      tangent = d1;
    }
  }
  need(best > -Infinity, 'soils.errors.noBend');
  const bisector = Math.tan(Math.atan(tangent) / 2);
  const x0 = x[at]!;
  const y0 = e[at]!;
  need(Math.abs(bisector - line.slope) > 1e-12, 'soils.errors.noBend');
  const xp = (line.intercept - y0 + bisector * x0) / (bisector - line.slope);
  const Cr = -lineFit(x.slice(0, 2), e.slice(0, 2)).slope;
  return { sp: 10 ** xp, Cc: -line.slope, Cr, bend: data[at]!, tangent, bisector, line, xp };
}

// ---------------------------------------------------------------------------------------------------------------
// Shear strength

/** c′ and φ′ from triaxial failures (σ₃, σ₁) by a line through the p-q points; one test gives an undrained φ = 0 strength. */
export function triaxial(rows: readonly (readonly number[])[]) {
  need(rows.length >= 1, 'errors.noRows');
  need(
    rows.every(([s3, s1]) => s3! >= 0 && s1! > s3!),
    'soils.errors.triaxialRow',
  );
  const p = rows.map(([s3, s1]) => (s1! + s3!) / 2);
  const q = rows.map(([s3, s1]) => (s1! - s3!) / 2);
  if (rows.length === 1) return { phi: 0, c: q[0]!, p, q, a: q[0]!, tanAlpha: 0, undrained: true };
  const line = lineFit(p, q);
  need(line.slope > -1 && line.slope < 1, 'soils.errors.envelope');
  const phi = Math.asin(line.slope);
  return {
    phi: deg(phi),
    c: line.intercept / Math.cos(phi),
    p,
    q,
    a: line.intercept,
    tanAlpha: line.slope,
    undrained: false,
  };
}

export function directShear(rows: readonly (readonly number[])[]) {
  need(rows.length >= 2, 'errors.fewPoints', { count: 2 });
  need(
    rows.every(([s, t]) => s! >= 0 && t! > 0),
    'soils.errors.shearRow',
  );
  const line = lineFit(
    rows.map(([s]) => s!),
    rows.map(([, t]) => t!),
  );
  need(line.slope > 0, 'soils.errors.envelope');
  return { phi: deg(Math.atan(line.slope)), c: line.intercept, r2: line.r2 };
}

/** The major principal stress at failure for a confining stress, from the Mohr-Coulomb envelope. */
export function failureStress(c: number, phi: number, s3: number) {
  need(phi >= 0 && phi < 90, 'soils.errors.phi');
  const t = Math.tan(rad(45 + phi / 2));
  return s3 * t * t + 2 * c * t;
}

/** Skempton's pore-pressure parameters from the cell and shearing stages of a triaxial test. */
export function skempton(ds3: number, du3: number, dsd: number, dud: number) {
  need(ds3 > 0 && dsd > 0, 'errors.positive', { name: 'Δσ₃, Δσ_d' });
  const B = du3 / ds3;
  need(B > 0, 'soils.errors.skemptonB');
  return { B, A: dud / (B * dsd) };
}
