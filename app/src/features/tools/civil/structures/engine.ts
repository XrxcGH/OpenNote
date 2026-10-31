// Indeterminate structures and influence lines: the methods behind the calculations in ./calcs. Forces in kN,
// lengths in m, moments in kN·m. End moments follow the clockwise-positive sign convention of moment distribution.
import { solveLinear } from '../core/num';
import { CivilError, need } from '../core/types';

// ---------------------------------------------------------------------------------------------------------------
// Fixed-end moments

export interface SpanLoad {
  /** Uniform load over the whole span, kN/m. */
  w: number;
  /** A point load P at distance a from the left end. */
  P: number;
  a: number;
}

/** Fixed-end moments of a span (clockwise positive): [M_left, M_right]. */
export function fixedEnd(L: number, load: SpanLoad): [number, number] {
  need(L > 0, 'errors.positive', { name: '~structures.f.L' });
  need(load.a >= 0 && load.a <= L, 'structures.errors.position');
  const b = L - load.a;
  const left = -(load.w * L * L) / 12 - (load.P * load.a * b * b) / (L * L);
  const right = (load.w * L * L) / 12 + (load.P * load.a * load.a * b) / (L * L);
  return [left, right];
}

/** Fixed-end moments for a load that rises linearly from 0 at the left to w at the right. */
export const triangularFixedEnd = (L: number, w: number): [number, number] => [-(w * L * L) / 30, (w * L * L) / 20];

// ---------------------------------------------------------------------------------------------------------------
// Continuous beams

export interface Span extends SpanLoad {
  L: number;
  /** Relative flexural stiffness EI. */
  EI: number;
}

export type EndSupport = 'pinned' | 'fixed';

export interface BeamSolution {
  /** End moments [left, right] of each span, clockwise positive. */
  moments: [number, number][];
  /** Upward reaction at each support, left to right. */
  reactions: number[];
  /** Shear just right of the left end of each span. */
  shears: [number, number][];
  /** Distribution factors at each joint for the span to its left and right. */
  factors: [number, number][];
  /** The first cycles of the moment distribution table: end moments after each cycle. */
  table: number[][];
  cycles: number;
  /** End moments by slope-deflection, as a check. */
  check: [number, number][];
  fem: [number, number][];
}

function validateSpans(spans: readonly Span[]): void {
  need(spans.length >= 1 && spans.length <= 20, 'structures.errors.spans');
  for (const s of spans) {
    need(s.L > 0, 'errors.positive', { name: '~structures.f.LCol' });
    need(s.EI > 0, 'errors.positive', { name: '~structures.f.EICol' });
    need(s.a >= 0 && s.a <= s.L, 'structures.errors.position');
  }
}

/** Hardy Cross moment distribution for a continuous beam on simple interior supports. */
export function momentDistribution(
  spans: readonly Span[],
  left: EndSupport,
  right: EndSupport,
  tol = 1e-10,
): BeamSolution {
  validateSpans(spans);
  const n = spans.length;
  const k = spans.map((s) => (4 * s.EI) / s.L);
  // Joint j sits between span j-1 (on its left) and span j (on its right).
  const factors: [number, number][] = [];
  for (let j = 0; j <= n; j++) {
    const kl = j > 0 ? k[j - 1]! : 0;
    const kr = j < n ? k[j]! : 0;
    const fixedJoint = (j === 0 && left === 'fixed') || (j === n && right === 'fixed');
    factors.push(fixedJoint ? [0, 0] : [kl / (kl + kr), kr / (kl + kr)]);
  }
  const fem = spans.map((s) => fixedEnd(s.L, s));
  const M = fem.map((pair) => [...pair] as [number, number]);
  const table: number[][] = [M.flat()];
  let cycles = 0;
  for (; cycles < 10000; cycles++) {
    let biggest = 0;
    const carry: [number, number][] = spans.map(() => [0, 0]);
    for (let j = 0; j <= n; j++) {
      const unbalanced = (j > 0 ? M[j - 1]![1] : 0) + (j < n ? M[j]![0] : 0);
      biggest = Math.max(biggest, Math.abs(unbalanced) * (factors[j]![0] + factors[j]![1]));
      const [dl, dr] = factors[j]!;
      if (j > 0 && dl) {
        const d = -unbalanced * dl;
        M[j - 1]![1] += d;
        carry[j - 1]![0] += d / 2;
      }
      if (j < n && dr) {
        const d = -unbalanced * dr;
        M[j]![0] += d;
        carry[j]![1] += d / 2;
      }
    }
    carry.forEach(([a, b], i) => {
      M[i]![0] += a;
      M[i]![1] += b;
    });
    if (table.length < 8) table.push(M.flat());
    if (biggest < tol) break;
  }
  need(cycles < 10000, 'errors.noConvergence');
  const moments = M;
  const shears: [number, number][] = [];
  const reactions = new Array<number>(n + 1).fill(0);
  spans.forEach((s, i) => {
    const total = s.w * s.L + s.P;
    const simpleLeft = (s.w * s.L) / 2 + (s.P * (s.L - s.a)) / s.L;
    const Vl = simpleLeft - (moments[i]![0] + moments[i]![1]) / s.L;
    const Vr = total - Vl;
    shears.push([Vl, -Vr]);
    reactions[i]! += Vl;
    reactions[i + 1]! += Vr;
  });
  return {
    moments,
    reactions,
    shears,
    factors,
    table,
    cycles: cycles + 1,
    check: slopeDeflection(spans, left, right),
    fem,
  };
}

/** Slope-deflection: M_ij = (2EI/L)(2θ_i + θ_j) + FEM_ij, with ΣM = 0 at each joint that can rotate. */
export function slopeDeflection(spans: readonly Span[], left: EndSupport, right: EndSupport): [number, number][] {
  validateSpans(spans);
  const n = spans.length;
  const free = Array.from(
    { length: n + 1 },
    (_, j) => !((j === 0 && left === 'fixed') || (j === n && right === 'fixed')),
  );
  const index = new Map<number, number>();
  free.forEach((f, j) => f && index.set(j, index.size));
  const size = index.size;
  const fem = spans.map((s) => fixedEnd(s.L, s));
  const A = Array.from({ length: size }, () => new Array<number>(size).fill(0));
  const b = new Array<number>(size).fill(0);
  spans.forEach((s, i) => {
    const c = (2 * s.EI) / s.L;
    const ends: [number, number, number][] = [
      [i, i + 1, fem[i]![0]],
      [i + 1, i, fem[i]![1]],
    ];
    for (const [near, far, f] of ends) {
      const row = index.get(near);
      if (row === undefined) continue;
      A[row]![row]! += 2 * c;
      const col = index.get(far);
      if (col !== undefined) A[row]![col]! += c;
      b[row]! -= f;
    }
  });
  const theta = size ? solveLinear(A, b) : [];
  const at = (j: number) => (index.has(j) ? theta[index.get(j)!]! : 0);
  return spans.map((s, i) => {
    const c = (2 * s.EI) / s.L;
    return [c * (2 * at(i) + at(i + 1)) + fem[i]![0], c * (2 * at(i + 1) + at(i)) + fem[i]![1]];
  });
}

/** Bending moment (sagging positive) and shear along each span, for the diagrams. */
export function beamDiagrams(spans: readonly Span[], sol: BeamSolution, per = 40) {
  const points: { x: number; V: number; M: number }[] = [];
  let x0 = 0;
  spans.forEach((s, i) => {
    const [Ml] = sol.moments[i]!;
    const Vl = sol.shears[i]![0];
    for (let k = 0; k <= per; k++) {
      const x = (s.L * k) / per;
      const past = x > s.a ? s.P : 0;
      points.push({
        x: x0 + x,
        V: Vl - s.w * x - past,
        M: Ml + Vl * x - (s.w * x * x) / 2 - (x > s.a ? s.P * (x - s.a) : 0),
      });
    }
    x0 += s.L;
  });
  return points;
}

// ---------------------------------------------------------------------------------------------------------------
// Influence lines and moving loads on a simple span

export type Effect = 'RA' | 'RB' | 'V' | 'M';

/** The influence ordinate at load position ξ for an effect at section x on a simple span L. */
export function influence(effect: Effect, L: number, x: number, xi: number): number {
  need(L > 0, 'errors.positive', { name: '~structures.f.L' });
  need(x >= 0 && x <= L && xi >= 0 && xi <= L, 'structures.errors.position');
  switch (effect) {
    case 'RA':
      return 1 - xi / L;
    case 'RB':
      return xi / L;
    case 'V':
      return xi < x ? -xi / L : xi > x ? 1 - xi / L : 0.5 - xi / L;
    case 'M':
      return xi <= x ? (xi * (L - x)) / L : (x * (L - xi)) / L;
  }
}

export interface Axle {
  P: number;
  /** Distance from the first axle. */
  d: number;
}

/** The moment at a section x of a simple span from axles whose first axle sits at s. */
function momentAt(axles: readonly Axle[], L: number, s: number, x: number): number {
  return axles.reduce((sum, ax) => {
    const pos = s + ax.d;
    return pos >= 0 && pos <= L ? sum + ax.P * influence('M', L, x, pos) : sum;
  }, 0);
}

/** The absolute largest moment of an axle train on a simple span, by the resultant rule checked by a fine scan. */
export function absoluteMaxMoment(axles: readonly Axle[], L: number) {
  need(L > 0, 'errors.positive', { name: '~structures.f.L' });
  need(axles.length >= 1, 'errors.noRows');
  need(
    axles.every((a) => a.P >= 0 && a.d >= 0),
    'structures.errors.axles',
  );
  let best = { M: -Infinity, s: 0, axle: 0, x: 0 };
  const consider = (s: number, k: number) => {
    const x = s + axles[k]!.d;
    if (x < 0 || x > L) return;
    const M = momentAt(axles, L, s, x);
    if (M > best.M + 1e-12) best = { M, s, axle: k, x };
  };
  // The resultant rule: midspan halves the distance between the axle and the resultant of the axles on the span.
  axles.forEach((ax, k) => {
    let s = L / 2 - ax.d;
    for (let pass = 0; pass < 4; pass++) {
      const on = axles.filter((a) => s + a.d >= 0 && s + a.d <= L);
      const R = on.reduce((t, a) => t + a.P, 0);
      if (!R) break;
      const xr = on.reduce((t, a) => t + a.P * a.d, 0) / R;
      s = L / 2 - (ax.d + xr) / 2;
    }
    consider(s, k);
  });
  const span = Math.max(...axles.map((a) => a.d));
  for (let i = 0; i <= 4000; i++) {
    const s = -span + ((L + span) * i) / 4000;
    axles.forEach((_, k) => consider(s, k));
  }
  return best;
}

/** The train as given and turned around, so it can travel either way. */
const bothWays = (axles: readonly Axle[]): [readonly Axle[], boolean][] => [
  [axles, false],
  [reversed(axles), true],
];

function reversed(axles: readonly Axle[]): Axle[] {
  const span = Math.max(...axles.map((a) => a.d));
  return axles.map((a) => ({ P: a.P, d: span - a.d })).reverse();
}

/** The largest end shear (left reaction) from an axle train in either direction: each axle in turn at the support. */
export function maxEndShear(axles: readonly Axle[], L: number) {
  need(L > 0, 'errors.positive', { name: '~structures.f.L' });
  need(axles.length >= 1, 'errors.noRows');
  let best = { V: 0, axle: 0, reversed: false };
  for (const [train, flipped] of bothWays(axles))
    train.forEach((ax, k) => {
      const s = -ax.d;
      const V = train.reduce((sum, a) => {
        const pos = s + a.d;
        return pos >= 0 && pos <= L ? sum + a.P * (1 - pos / L) : sum;
      }, 0);
      if (V > best.V + 1e-12) best = { V, axle: flipped ? axles.length - 1 - k : k, reversed: flipped };
    });
  return best;
}

/** The largest moment at section x from an axle train in either direction: each axle in turn over the section. */
export function maxMomentAtSection(axles: readonly Axle[], L: number, x: number) {
  need(x >= 0 && x <= L, 'structures.errors.position');
  need(axles.length >= 1, 'errors.noRows');
  let best = { M: 0, axle: 0, reversed: false };
  for (const [train, flipped] of bothWays(axles))
    train.forEach((ax, k) => {
      const M = momentAt(train, L, x - ax.d, x);
      if (M > best.M + 1e-12) best = { M, axle: flipped ? axles.length - 1 - k : k, reversed: flipped };
    });
  return best;
}

// ---------------------------------------------------------------------------------------------------------------
// Truss influence lines

export interface TrussInput {
  joints: readonly { x: number; y: number; support: number }[];
  members: readonly { a: number; b: number }[];
}

/** A truss's joints: 1 is a pin, 2 a roller that pushes up, anything else free. */
type TrussJoint = TrussInput['joints'][number];

/**
 * The member forces (tension positive) of a statically determinate truss by the method of joints: two equilibrium
 * equations at each joint, with a member force and each support reaction as the unknowns. A count that differs from
 * two per joint, or equations with no single answer, give the truss's status instead.
 */
function jointForces(
  joints: readonly TrussJoint[],
  members: readonly { a: number; b: number }[],
  load: number,
): number[] | 'none' | 'unstable' | 'indeterminate' {
  const reactions = joints.flatMap((j, i) =>
    j.support === 1
      ? [
          [i, 1, 0],
          [i, 0, 1],
        ]
      : j.support === 2
        ? [[i, 0, 1]]
        : [],
  );
  if (!reactions.length || !joints.length) return 'none';
  const unknowns = members.length + reactions.length;
  if (unknowns < 2 * joints.length) return 'unstable';
  if (unknowns > 2 * joints.length) return 'indeterminate';
  const a = Array.from({ length: unknowns }, () => new Array<number>(unknowns).fill(0));
  members.forEach((m, k) => {
    const [p, q] = [joints[m.a - 1]!, joints[m.b - 1]!];
    const l = Math.hypot(q.x - p.x, q.y - p.y);
    if (l < 1e-9) return;
    const [c, s] = [(q.x - p.x) / l, (q.y - p.y) / l];
    // Tension pulls each end toward the other.
    a[2 * (m.a - 1)]![k] = c;
    a[2 * (m.a - 1) + 1]![k] = s;
    a[2 * (m.b - 1)]![k] = -c;
    a[2 * (m.b - 1) + 1]![k] = -s;
  });
  reactions.forEach(([joint, cx, cy], n) => {
    a[2 * joint!]![members.length + n] = cx!;
    a[2 * joint! + 1]![members.length + n] = cy!;
  });
  // The unit load acts downward at the load joint; equilibrium moves it to the right side as +1 upward.
  const rhs = new Array<number>(unknowns).fill(0);
  rhs[2 * (load - 1) + 1] = 1;
  try {
    return solveLinear(a, rhs).slice(0, members.length);
  } catch (error) {
    if (error instanceof CivilError) return 'unstable';
    throw error;
  }
}

/** The force in one member (tension positive) for a unit downward load at each of the deck joints. */
export function trussInfluence(input: TrussInput, member: number, deck: readonly number[]): number[] {
  need(input.joints.length >= 3 && input.members.length >= 3, 'structures.errors.truss');
  need(Number.isInteger(member) && member >= 1 && member <= input.members.length, 'structures.errors.member');
  for (const m of input.members)
    need(
      m.a >= 1 && m.a <= input.joints.length && m.b >= 1 && m.b <= input.joints.length,
      'structures.errors.memberJoints',
    );
  return deck.map((load) => {
    need(load >= 1 && load <= input.joints.length, 'structures.errors.memberJoints');
    const forces = jointForces(input.joints, input.members, load);
    if (!Array.isArray(forces))
      throw new CivilError('structures.errors.status', { status: `~structures.status.${forces}` });
    return Math.abs(forces[member - 1]!) < 1e-12 ? 0 : forces[member - 1]!;
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Approximate lateral analysis

export interface PortalStory {
  /** Shear in the story (the sum of lateral loads at and above it), its height. */
  V: number;
  h: number;
}

/** The portal method for a frame of `bays` equal bays: interior columns carry twice the shear of exterior ones. */
export function portal(stories: readonly PortalStory[], bays: number, bayWidth: number) {
  need(Number.isInteger(bays) && bays >= 1 && bays <= 20, 'structures.errors.bays');
  need(bayWidth > 0, 'errors.positive', { name: '~structures.f.bay' });
  need(stories.length >= 1, 'errors.noRows');
  const rows = stories.map((s) => {
    need(s.h > 0, 'errors.positive', { name: '~structures.f.hCol' });
    const ext = s.V / (2 * bays);
    const int = s.V / bays;
    return { V: s.V, h: s.h, ext, int, Mext: (ext * s.h) / 2, Mint: (int * s.h) / 2 };
  });
  // The beam over each story: its end moment balances the exterior joint, from the columns above and below.
  const beams = rows.map((r, i) => {
    const above = rows[i - 1];
    const M = r.Mext + (above ? above.Mext : 0);
    return { M, V: (2 * M) / bayWidth, axial: (2 * M) / bayWidth };
  });
  return { rows, beams };
}

/**
 * The cantilever method: at each story's mid-height, the overturning moment of the floor loads above is carried by
 * column axial forces in proportion to their distance from the centroid of equal columns. Stories run top down.
 */
export function cantilever(stories: readonly PortalStory[], xs: readonly number[]) {
  need(xs.length >= 2, 'errors.fewPoints', { count: 2 });
  need(stories.length >= 1, 'errors.noRows');
  const c = xs.reduce((s, x) => s + x, 0) / xs.length;
  const d = xs.map((x) => x - c);
  const I = d.reduce((s, v) => s + v * v, 0);
  need(I > 0, 'structures.errors.columns');
  const loads = stories.map((s, i) => (i === 0 ? s.V : s.V - stories[i - 1]!.V));
  return stories.map((s, i) => {
    let Mo = 0;
    for (let j = 0; j <= i; j++) {
      let arm = s.h / 2;
      for (let k = j; k < i; k++) arm += stories[k]!.h;
      Mo += loads[j]! * arm;
    }
    return { Mo, axial: d.map((di) => (Mo * di) / I) };
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Dynamics

/** Newmark average-acceleration integration of m u'' + c u' + k u = p(t), from rest. */
export function newmark(m: number, c: number, k: number, p: readonly number[], dt: number) {
  need(m > 0 && k > 0, 'errors.positive', { name: '~structures.f.mass' });
  need(c >= 0, 'errors.nonNegative', { name: '~structures.f.zeta' });
  need(dt > 0, 'errors.positive', { name: '~structures.f.dt' });
  const beta = 0.25;
  const gamma = 0.5;
  const u = [0];
  const v = [0];
  const a = [(p[0]! - c * 0 - k * 0) / m];
  const kHat = k + (gamma / (beta * dt)) * c + m / (beta * dt * dt);
  const A1 = m / (beta * dt) + (gamma / beta) * c;
  const A2 = m / (2 * beta) + dt * (gamma / (2 * beta) - 1) * c;
  for (let i = 0; i + 1 < p.length; i++) {
    const dp = p[i + 1]! - p[i]! + A1 * v[i]! + A2 * a[i]!;
    const du = dp / kHat;
    const dv = (gamma / (beta * dt)) * du - (gamma / beta) * v[i]! + dt * (1 - gamma / (2 * beta)) * a[i]!;
    const da = du / (beta * dt * dt) - v[i]! / (beta * dt) - a[i]! / (2 * beta);
    u.push(u[i]! + du);
    v.push(v[i]! + dv);
    a.push(a[i]! + da);
  }
  return { u, v, a };
}

/** The elastic response spectrum of a ground acceleration record (m/s²) at damping ζ. */
export function responseSpectrum(ag: readonly number[], dt: number, zeta: number, periods: readonly number[]) {
  need(ag.length >= 3, 'errors.fewPoints', { count: 3 });
  need(zeta >= 0 && zeta < 1, 'structures.errors.zeta');
  return periods.map((T) => {
    need(T > 0, 'errors.positive', { name: '~structures.f.T' });
    const w = (2 * Math.PI) / T;
    // Subdivide the record so each step is at most T/20, with the ground acceleration linear in between.
    const sub = Math.max(1, Math.ceil((20 * dt) / T));
    const h = dt / sub;
    const p: number[] = [];
    for (let i = 0; i + 1 < ag.length; i++)
      for (let j = 0; j < sub; j++) p.push(-(ag[i]! + ((ag[i + 1]! - ag[i]!) * j) / sub));
    p.push(-ag[ag.length - 1]!);
    const r = newmark(1, 2 * zeta * w, w * w, p, h);
    const Sd = Math.max(...r.u.map(Math.abs));
    return { T, Sd, Sv: w * Sd, Sa: w * w * Sd };
  });
}

/** SRSS and CQC (Der Kiureghian) combinations of modal peaks with their periods and one damping ratio. */
export function modalCombination(peaks: readonly number[], periods: readonly number[], zeta: number) {
  need(peaks.length >= 1 && peaks.length === periods.length, 'errors.noRows');
  need(
    periods.every((T) => T > 0),
    'errors.positive',
    { name: '~structures.f.T' },
  );
  need(zeta > 0 && zeta < 1, 'structures.errors.zeta');
  const srss = Math.sqrt(peaks.reduce((s, r) => s + r * r, 0));
  const w = periods.map((T) => (2 * Math.PI) / T);
  let cqc = 0;
  for (let i = 0; i < peaks.length; i++)
    for (let j = 0; j < peaks.length; j++) {
      const b = w[j]! / w[i]!;
      const rho = (8 * zeta * zeta * (1 + b) * b ** 1.5) / ((1 - b * b) ** 2 + 4 * zeta * zeta * b * (1 + b) ** 2);
      cqc += peaks[i]! * rho * peaks[j]!;
    }
  return { srss, cqc: Math.sqrt(Math.max(0, cqc)) };
}
