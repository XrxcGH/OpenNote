// Traffic, highways, surveying, and site planning: the methods behind the calculations in ./calcs. Speeds in km/h,
// densities in veh/km, flows in veh/h, lengths in m, and angles in degrees.
import { need } from '../core/types';

// ---------------------------------------------------------------------------------------------------------------
// Traffic flow

export type FlowModel = 'greenshields' | 'greenberg' | 'underwood';

/** Speed at density k. Greenshields needs v_f and k_j; Greenberg needs v_0 (speed at capacity) and k_j; Underwood
 * needs v_f and k_0 (density at capacity). */
export function speedAt(model: FlowModel, a: number, b: number, k: number): number {
  need(a > 0 && b > 0, 'errors.positive', { name: '~transport.f.vf' });
  need(k >= 0, 'errors.nonNegative', { name: '~transport.f.k' });
  if (model === 'greenshields') return Math.max(0, a * (1 - k / b));
  if (model === 'greenberg') return k > 0 && k < b ? a * Math.log(b / k) : k >= b ? 0 : Infinity;
  return a * Math.exp(-k / b);
}

/** Capacity and the density and speed at which it occurs. */
export function capacity(model: FlowModel, a: number, b: number) {
  speedAt(model, a, b, 0);
  if (model === 'greenshields') return { q: (a * b) / 4, k: b / 2, v: a / 2 };
  // Greenberg: q = v0 k ln(kj/k), largest at k = kj/e with v = v0. Underwood: q = vf k e^(-k/k0), at k = k0.
  if (model === 'greenberg') return { q: (a * b) / Math.E, k: b / Math.E, v: a };
  return { q: (a * b) / Math.E, k: b, v: a / Math.E };
}

/** The speed of the shockwave between two traffic states (q, k). */
export function shockwave(q1: number, k1: number, q2: number, k2: number): number {
  need(q1 >= 0 && q2 >= 0 && k1 >= 0 && k2 >= 0, 'errors.nonNegative', { name: '~transport.f.q1' });
  need(k1 !== k2, 'transport.errors.sameDensity');
  return (q2 - q1) / (k2 - k1);
}

/** A bottleneck: arrivals at λ, capacity μ that drops to μr for a time t_r (veh/h, h). */
export function bottleneck(lambda: number, mu: number, muR: number, tr: number) {
  need(lambda > 0 && mu > 0, 'errors.positive', { name: '~transport.f.lambda' });
  need(muR >= 0 && tr >= 0, 'errors.nonNegative', { name: '~transport.f.muR' });
  need(lambda < mu, 'transport.errors.overCapacity');
  if (muR >= lambda) return { queueMax: 0, clear: 0, delay: 0, vehicles: 0, tEnd: 0 };
  const queueMax = (lambda - muR) * tr;
  const clear = tr + queueMax / (mu - lambda);
  // Total delay is the area between the arrival and departure curves (veh·h).
  const delay = (queueMax * clear) / 2;
  return { queueMax, clear, delay, vehicles: lambda * clear, tEnd: clear };
}

/** M/M/c queue (c = 1 for M/M/1): utilization, chance of waiting, mean queue, and mean times (Little's law). */
export function mmc(lambda: number, mu: number, c: number) {
  need(lambda > 0 && mu > 0, 'errors.positive', { name: '~transport.f.lambda' });
  need(Number.isInteger(c) && c >= 1 && c <= 200, 'transport.errors.servers');
  const a = lambda / mu;
  const rho = a / c;
  need(rho < 1, 'transport.errors.overCapacity');
  let sum = 0;
  let term = 1;
  for (let n = 0; n < c; n++) {
    if (n > 0) term *= a / n;
    sum += term;
  }
  const last = (term * a) / c / (1 - rho);
  const P0 = 1 / (sum + last);
  const Pwait = last * P0;
  const Lq = (Pwait * rho) / (1 - rho);
  const Wq = Lq / lambda;
  const W = Wq + 1 / mu;
  return { rho, P0, Pwait, Lq, Wq, W, L: lambda * W };
}

// ---------------------------------------------------------------------------------------------------------------
// Signals

/** Webster's optimum cycle and green splits from the critical flow ratios and the lost time per cycle. */
export function webster(ratios: readonly number[], lost: number) {
  need(ratios.length >= 2, 'errors.fewPoints', { count: 2 });
  need(
    ratios.every((y) => y > 0),
    'transport.errors.ratio',
  );
  need(lost >= 0, 'errors.nonNegative', { name: '~transport.f.lost' });
  const Y = ratios.reduce((s, y) => s + y, 0);
  need(Y < 1, 'transport.errors.oversaturated');
  const C = (1.5 * lost + 5) / (1 - Y);
  const green = C - lost;
  return { Y, C, greens: ratios.map((y) => (y / Y) * green) };
}

/** Webster's delay per vehicle (s) on an approach with flow q, saturation flow s, green g, and cycle C. */
export function websterDelay(q: number, s: number, g: number, C: number) {
  need(q > 0 && s > 0 && g > 0 && C > g, 'transport.errors.delayInputs');
  const lam = g / C;
  const x = q / (lam * s);
  need(x < 1, 'transport.errors.oversaturated');
  const qs = q / 3600;
  const uniform = (C * (1 - lam) ** 2) / (2 * (1 - lam * x));
  const random = (x * x) / (2 * qs * (1 - x));
  const total = 0.9 * (uniform + random);
  return { x, uniform, random, total };
}

// ---------------------------------------------------------------------------------------------------------------
// Highway geometry

/** Stopping sight distance, m, at V km/h with reaction time t (s) and deceleration a (m/s²), on grade G. */
export function stoppingSight(V: number, t: number, a: number, G = 0): number {
  need(V > 0, 'errors.positive', { name: '~transport.f.V' });
  need(t >= 0, 'errors.nonNegative', { name: '~transport.f.t' });
  need(a > 0, 'errors.positive', { name: '~transport.f.a' });
  // A grade G (rise over run) adds g·G to the deceleration going up and takes it away going down.
  const decel = a + 9.81 * G;
  need(decel > 0, 'transport.errors.grade');
  return 0.278 * V * t + (0.039 * V * V) / decel;
}

/** The least radius for speed V with superelevation e and side friction f. */
export function minRadius(V: number, e: number, f: number): number {
  need(V > 0, 'errors.positive', { name: '~transport.f.V' });
  need(e + f > 0, 'transport.errors.friction');
  return (V * V) / (127 * (e + f));
}

/** A circular curve of radius R and deflection Δ from the PI station: tangent, length, and stations. */
export function horizontalCurve(R: number, delta: number, piStation: number) {
  need(R > 0, 'errors.positive', { name: '~transport.f.R' });
  need(delta > 0 && delta < 180, 'transport.errors.delta');
  const d = (delta * Math.PI) / 180;
  const T = R * Math.tan(d / 2);
  const L = R * d;
  const E = R * (1 / Math.cos(d / 2) - 1);
  const M = R * (1 - Math.cos(d / 2));
  const LC = 2 * R * Math.sin(d / 2);
  const PC = piStation - T;
  return { T, L, E, M, LC, PC, PT: PC + L };
}

/** Deflection angles (degrees) from the PC to each full station along the curve. */
export function deflections(R: number, PC: number, PT: number, interval = 20) {
  need(interval > 0, 'errors.positive', { name: '~transport.f.interval' });
  const out: { station: number; angle: number }[] = [];
  let s = Math.ceil(PC / interval) * interval;
  for (; s < PT; s += interval) out.push({ station: s, angle: ((s - PC) / (2 * R)) * (180 / Math.PI) });
  out.push({ station: PT, angle: ((PT - PC) / (2 * R)) * (180 / Math.PI) });
  return out;
}

/**
 * The least length of a vertical curve for sight distance S, grade change A (%), eye and object heights h1 and h2.
 * A sag curve uses headlight height h1 and beam angle β (degrees) instead.
 */
export function verticalCurve(kind: 'crest' | 'sag', A: number, S: number, h1: number, h2: number, beta = 1) {
  need(A > 0, 'errors.positive', { name: '~transport.f.A' });
  need(S > 0, 'errors.positive', { name: '~transport.f.S' });
  need(h1 >= 0 && h2 >= 0, 'errors.nonNegative', { name: '~transport.f.h1' });
  const tb = Math.tan((beta * Math.PI) / 180);
  if (kind === 'crest') {
    const root = (Math.sqrt(2 * h1) + Math.sqrt(2 * h2)) ** 2;
    need(root > 0, 'transport.errors.heights');
    const long = (A * S * S) / (100 * root);
    if (long >= S) return { L: long, case: 'longer' as const };
    return { L: Math.max(0, 2 * S - (200 * root) / A), case: 'shorter' as const };
  }
  const long = (A * S * S) / (200 * (h1 + S * tb));
  if (long >= S) return { L: long, case: 'longer' as const };
  return { L: Math.max(0, 2 * S - (200 * (h1 + S * tb)) / A), case: 'shorter' as const };
}

// ---------------------------------------------------------------------------------------------------------------
// Travel demand

/** Multinomial logit shares from utilities, with the direct elasticity of each share to one attribute. */
export function logit(utilities: readonly number[]) {
  need(utilities.length >= 2, 'errors.fewPoints', { count: 2 });
  const top = Math.max(...utilities);
  const e = utilities.map((u) => Math.exp(u - top));
  const sum = e.reduce((s, v) => s + v, 0);
  return e.map((v) => v / sum);
}

/** Reads a square matrix typed as rows separated by semicolons or new lines, numbers by spaces or commas. */
export function readMatrix(text: string): number[][] {
  const rows = text
    .split(/[;\n]/)
    .map((r) => r.trim())
    .filter(Boolean)
    .map((r) => r.split(/[\s,]+/).map(Number));
  need(rows.length >= 2 && rows.length <= 30, 'transport.errors.matrix');
  need(
    rows.every((r) => r.length === rows.length && r.every((v) => Number.isFinite(v) && v > 0)),
    'transport.errors.matrix',
  );
  return rows;
}

/** A doubly constrained gravity model with friction F = t^(−b), balanced by Furness iteration. */
export function gravity(P: readonly number[], A: readonly number[], times: readonly (readonly number[])[], b: number) {
  const n = P.length;
  need(n >= 2 && A.length === n && times.length === n, 'transport.errors.zones');
  need(P.every((v) => v >= 0) && A.every((v) => v >= 0), 'errors.nonNegative', { name: '~transport.f.PCol' });
  const totalP = P.reduce((s, v) => s + v, 0);
  const totalA = A.reduce((s, v) => s + v, 0);
  need(totalP > 0, 'errors.positive', { name: '~transport.f.PCol' });
  // Attractions are scaled to the productions, as is usual before distribution.
  const Aadj = A.map((v) => (v * totalP) / totalA);
  const F = times.map((row) => row.map((t) => t ** -b));
  const a = new Array<number>(n).fill(1);
  const bb = new Array<number>(n).fill(1);
  let iterations = 0;
  for (; iterations < 1000; iterations++) {
    for (let i = 0; i < n; i++) a[i] = 1 / F[i]!.reduce((s, f, j) => s + bb[j]! * Aadj[j]! * f, 0);
    let change = 0;
    for (let j = 0; j < n; j++) {
      const next = 1 / F.reduce((s, row, i) => s + a[i]! * P[i]! * row[j]!, 0);
      change = Math.max(change, Math.abs(next - bb[j]!) / next);
      bb[j] = next;
    }
    if (change < 1e-12) break;
  }
  const T = P.map((p, i) => Aadj.map((aj, j) => a[i]! * p * bb[j]! * aj * F[i]![j]!));
  return { T, iterations: iterations + 1, Aadj };
}

/** Buses needed for a route of round-trip time (min) at headway h (min), and the line's capacity (per hour). */
export function transit(roundTrip: number, headway: number, seats: number) {
  need(roundTrip > 0 && headway > 0, 'errors.positive', { name: '~transport.f.headway' });
  need(seats > 0, 'errors.positive', { name: '~transport.f.seats' });
  const fleet = Math.ceil(roundTrip / headway - 1e-12);
  return { fleet, frequency: 60 / headway, capacity: (60 / headway) * seats, cycle: fleet * headway };
}

// ---------------------------------------------------------------------------------------------------------------
// Surveying

export interface Leg {
  length: number;
  /** Azimuth from north, clockwise, degrees. */
  azimuth: number;
}

/** A closed traverse: latitudes and departures, misclosure, precision, compass-rule coordinates, and the area. */
export function traverse(legs: readonly Leg[], start: readonly [number, number] = [1000, 1000]) {
  need(legs.length >= 3, 'errors.fewPoints', { count: 3 });
  need(
    legs.every((l) => l.length > 0),
    'errors.positive',
    { name: '~transport.f.lengthCol' },
  );
  const raw = legs.map((l) => {
    const a = (l.azimuth * Math.PI) / 180;
    return { lat: l.length * Math.cos(a), dep: l.length * Math.sin(a) };
  });
  const sumLat = raw.reduce((s, r) => s + r.lat, 0);
  const sumDep = raw.reduce((s, r) => s + r.dep, 0);
  const perimeter = legs.reduce((s, l) => s + l.length, 0);
  const mis = misclosure(sumLat, sumDep, perimeter);
  const adjusted = raw.map((r, i) => ({
    lat: r.lat - (sumLat * legs[i]!.length) / perimeter,
    dep: r.dep - (sumDep * legs[i]!.length) / perimeter,
  }));
  const coords: [number, number][] = [[start[0], start[1]]];
  for (const r of adjusted.slice(0, -1)) {
    const [N, E] = coords[coords.length - 1]!;
    coords.push([N + r.lat, E + r.dep]);
  }
  return {
    raw,
    adjusted,
    coords,
    sumLat,
    sumDep,
    perimeter,
    ...mis,
    area: polygonArea(coords.map(([N, E]) => [E, N])),
  };
}

export function misclosure(sumLat: number, sumDep: number, perimeter: number) {
  need(perimeter > 0, 'errors.positive', { name: '~transport.f.perimeter' });
  const linear = Math.hypot(sumLat, sumDep);
  return { linear, precision: linear > 0 ? perimeter / linear : Infinity };
}

/** Area by coordinates (the shoelace formula), always positive. */
export function polygonArea(points: readonly (readonly number[])[]): number {
  need(points.length >= 3, 'errors.fewPoints', { count: 3 });
  let twice = 0;
  points.forEach((p, i) => {
    const q = points[(i + 1) % points.length]!;
    twice += p[0]! * q[1]! - q[0]! * p[1]!;
  });
  return Math.abs(twice) / 2;
}

/** Differential leveling: backsights and foresights from a known benchmark, with closure spread evenly by setup. */
export function leveling(rows: readonly (readonly number[])[], start: number, closeOn: number | null) {
  need(rows.length >= 1, 'errors.noRows');
  let elev = start;
  const raw = rows.map(([bs, fs]) => {
    const HI = elev + bs!;
    elev = HI - fs!;
    return { HI, elev };
  });
  const misclose = closeOn === null ? 0 : elev - closeOn;
  const adjusted = raw.map((r, i) => r.elev - (misclose * (i + 1)) / rows.length);
  return { raw, misclose, adjusted, end: elev };
}

// ---------------------------------------------------------------------------------------------------------------
// Earthwork and site

export const averageEndArea = (A1: number, A2: number, L: number): number => {
  need(L > 0, 'errors.positive', { name: '~transport.f.L' });
  return (L * (A1 + A2)) / 2;
};

export const prismoidal = (A1: number, Am: number, A2: number, L: number): number => {
  need(L > 0, 'errors.positive', { name: '~transport.f.L' });
  return (L / 6) * (A1 + 4 * Am + A2);
};

/** A mass diagram from stations and net areas (cut positive, fill negative), with fill swollen by 1/shrink. */
export function massDiagram(rows: readonly (readonly number[])[], shrink: number) {
  need(rows.length >= 2, 'errors.fewPoints', { count: 2 });
  need(shrink > 0 && shrink <= 2, 'transport.errors.shrink');
  let mass = 0;
  const points: [number, number][] = [[rows[0]![0]!, 0]];
  let cut = 0;
  let fill = 0;
  for (let i = 1; i < rows.length; i++) {
    const [s0, a0] = rows[i - 1]!;
    const [s1, a1] = rows[i]!;
    need(s1! > s0!, 'transport.errors.stations');
    const v = averageEndArea(a0!, a1!, s1! - s0!);
    if (v >= 0) cut += v;
    else fill -= v;
    mass += v >= 0 ? v : v / shrink;
    points.push([s1!, mass]);
  }
  return { points, cut, fill, net: mass };
}

/** Floor-area ratio, coverage, density, parking ratio, and the buildable area inside setbacks. */
export function site(input: {
  lot: number;
  floor: number;
  footprint: number;
  units: number;
  parking: number;
  width: number;
  depth: number;
  front: number;
  side: number;
  rear: number;
  height: number;
  street: number;
}) {
  need(input.lot > 0, 'errors.positive', { name: '~transport.f.lot' });
  need(input.footprint <= input.lot, 'transport.errors.footprint');
  const buildW = input.width - 2 * input.side;
  const buildD = input.depth - input.front - input.rear;
  need(buildW > 0 && buildD > 0, 'transport.errors.setbacks');
  return {
    FAR: input.floor / input.lot,
    coverage: input.footprint / input.lot,
    // The lot area is in m²: an acre is 4046.8564224 m², a hectare 10 000 m².
    perAcre: input.units / (input.lot / 4046.8564224),
    perHectare: input.units / (input.lot / 10000),
    parkingPerUnit: input.units > 0 ? input.parking / input.units : 0,
    envelope: buildW * buildD,
    hw: input.street > 0 ? input.height / input.street : 0,
  };
}
