// The beam solver (item 7): reactions, and shear and bending moment along a straight beam with pin, roller, and fixed
// supports under point loads, moments, and uniform or linearly varying distributed loads. Reactions come from the
// stiffness method with Euler–Bernoulli beam elements (exact for these loads), so propped cantilevers and continuous
// beams work too; a statically determinate beam's answer does not depend on EI. An internal hinge releases the
// rotation between its two sides, so it carries no moment, and stiffness segments scale EI over part of the beam for
// indeterminate beams whose section changes. Shear and moment then follow from statics, walking from the left end, in
// closed form.
//
// Signs follow Hibbeler and Gere. Loads and distributed loads point down when positive, and an applied moment turns
// counterclockwise when positive. Reactions are positive up, and a fixed end's moment counterclockwise. Shear is
// positive when the part left of a cut is pushed up, and moment is positive when the beam sags.
import { clean, solveLinear, zeros } from '../linalg';

/** A hinge is not a support: it joins two parts of the beam so they turn freely, carrying no moment. */
export type BeamSupportKind = 'pin' | 'roller' | 'fixed' | 'hinge';

export interface BeamSupport {
  id: string;
  kind: BeamSupportKind;
  x: number;
}

export type BeamLoad =
  | { id: string; kind: 'point'; x: number; value: number }
  | { id: string; kind: 'moment'; x: number; value: number }
  | { id: string; kind: 'distributed'; x1: number; x2: number; w1: number; w2: number };

/** EI between x1 and x2 is `factor` times the beam's EI elsewhere. Where segments overlap, the last one wins. */
export interface BeamSegment {
  id: string;
  x1: number;
  x2: number;
  factor: number;
}

export interface BeamModel {
  length: number;
  supports: BeamSupport[];
  loads: BeamLoad[];
  segments?: BeamSegment[];
  forceUnit: string;
  lengthUnit: string;
}

export interface BeamReaction {
  support: string;
  x: number;
  /** Up is positive. */
  force: number;
  /** Counterclockwise is positive; only a fixed support has one. */
  moment?: number;
}

export type BeamStatus = 'determinate' | 'indeterminate' | 'unstable' | 'none';

export interface Extreme {
  x: number;
  value: number;
}

export interface BeamSample {
  x: number;
  shear: number;
  moment: number;
}

export interface BeamResult {
  status: BeamStatus;
  reactions: BeamReaction[];
  /** Shear and moment just right of x (or just left when `left`). */
  shear(x: number, left?: boolean): number;
  moment(x: number, left?: boolean): number;
  /** Along the beam, with both sides of every jump, for drawing the diagrams. */
  samples: BeamSample[];
  maxShear: Extreme;
  maxMoment: Extreme;
  /** Where the shear crosses zero inside a span: the places a moment peaks. */
  zeroShear: number[];
}

const EPS = 1e-9;

interface Statics {
  forces: { x: number; value: number }[];
  couples: { x: number; value: number }[];
  spreads: { x1: number; x2: number; w1: number; w2: number }[];
}

function shearAt(s: Statics, x: number, left: boolean): number {
  let v = 0;
  for (const f of s.forces) if (left ? f.x < x - EPS : f.x <= x + EPS) v += f.value;
  for (const d of s.spreads) {
    const b = Math.min(x, d.x2) - d.x1;
    if (b <= 0) continue;
    const k = (d.w2 - d.w1) / (d.x2 - d.x1);
    v -= d.w1 * b + (k * b * b) / 2;
  }
  return v;
}

function momentAt(s: Statics, x: number, left: boolean): number {
  let m = 0;
  for (const f of s.forces) if (f.x < x) m += f.value * (x - f.x);
  // A counterclockwise couple on the part left of a cut lowers the sagging moment there.
  for (const c of s.couples) if (left ? c.x < x - EPS : c.x <= x + EPS) m -= c.value;
  for (const d of s.spreads) {
    const b = Math.min(x, d.x2) - d.x1;
    if (b <= 0) continue;
    const span = x - d.x1;
    const k = (d.w2 - d.w1) / (d.x2 - d.x1);
    m -= d.w1 * (span * b - (b * b) / 2) + k * ((span * b * b) / 2 - (b * b * b) / 3);
  }
  return m;
}

function elementStiffness(l: number): number[][] {
  const l2 = l * l;
  const l3 = l2 * l;
  return [
    [12 / l3, (6 * l) / l3, -12 / l3, (6 * l) / l3],
    [(6 * l) / l3, (4 * l2) / l3, (-6 * l) / l3, (2 * l2) / l3],
    [-12 / l3, (-6 * l) / l3, 12 / l3, (-6 * l) / l3],
    [(6 * l) / l3, (2 * l2) / l3, (-6 * l) / l3, (4 * l2) / l3],
  ];
}

/** Clamps every position onto the beam and drops loads of no length or no size. */
export function tidyBeam(model: BeamModel): BeamModel {
  const length = Math.max(0.1, model.length);
  const on = (x: number) => Math.min(length, Math.max(0, x));
  return {
    ...model,
    length,
    supports: model.supports.map((s) => ({ ...s, x: on(s.x) })),
    loads: model.loads
      .map((load): BeamLoad => {
        if (load.kind !== 'distributed') return { ...load, x: on(load.x) };
        const [x1, x2] = [on(load.x1), on(load.x2)];
        return x1 <= x2 ? { ...load, x1, x2 } : { ...load, x1: x2, x2: x1, w1: load.w2, w2: load.w1 };
      })
      .filter((load) => load.kind !== 'distributed' || load.x2 - load.x1 > EPS),
    segments: (model.segments ?? [])
      .map((seg) => ({ ...seg, x1: on(Math.min(seg.x1, seg.x2)), x2: on(Math.max(seg.x1, seg.x2)) }))
      .filter((seg) => seg.x2 - seg.x1 > EPS && seg.factor > 0 && Number.isFinite(seg.factor)),
  };
}

/**
 * Numbers the unknowns: each node has a deflection and a rotation, and an interior hinge gives the beam right of it a
 * rotation of its own. A hinge at either end of the beam releases nothing, so it is ignored.
 */
function numberDofs(model: BeamModel, count: number, nodeOf: (x: number) => number) {
  const hinged = new Set(
    model.supports
      .filter((s) => s.kind === 'hinge')
      .map((s) => nodeOf(s.x))
      .filter((n) => n > 0 && n < count - 1),
  );
  const index = [...Array(count).keys()];
  const deflection = index.map((n) => 2 * n);
  const turnLeft = index.map((n) => 2 * n + 1);
  let size = count * 2;
  const turnRight = index.map((n) => (hinged.has(n) ? size++ : turnLeft[n]));
  return { hinged, deflection, turnLeft, turnRight, size };
}

export function solveBeam(input: BeamModel): BeamResult {
  const model = tidyBeam(input);
  const L = model.length;
  const segments = model.segments ?? [];
  const xs = [0, L, ...model.supports.map((s) => s.x), ...segments.flatMap((seg) => [seg.x1, seg.x2])];
  for (const load of model.loads) {
    if (load.kind === 'distributed') xs.push(load.x1, load.x2);
    else xs.push(load.x);
  }
  const nodes = [...new Set(xs.map((x) => Number(x.toFixed(9))))].sort((a, b) => a - b);
  const nodeOf = (x: number) => nodes.findIndex((n) => Math.abs(n - x) < 1e-8);
  const { hinged, deflection, turnLeft, turnRight, size } = numberDofs(model, nodes.length, nodeOf);
  const K = zeros(size, size);
  const F = new Array<number>(size).fill(0);

  for (let e = 0; e < nodes.length - 1; e++) {
    const a = nodes[e];
    const l = nodes[e + 1] - a;
    const k = elementStiffness(l);
    const middle = a + l / 2;
    const factor = segments.reduce((f, seg) => (seg.x1 <= middle && middle <= seg.x2 ? seg.factor : f), 1);
    const dofs = [deflection[e], turnRight[e], deflection[e + 1], turnLeft[e + 1]];
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) K[dofs[i]][dofs[j]] += factor * k[i][j];
    for (const load of model.loads) {
      if (load.kind !== 'distributed' || a < load.x1 - EPS || a + l > load.x2 + EPS) continue;
      const slope = (load.w2 - load.w1) / (load.x2 - load.x1);
      const q = load.w1 + slope * (a - load.x1);
      const p = slope * l;
      const equivalent = [
        -(q * l) / 2 - (3 * p * l) / 20,
        -(q * l * l) / 12 - (p * l * l) / 30,
        -(q * l) / 2 - (7 * p * l) / 20,
        (q * l * l) / 12 + (p * l * l) / 20,
      ];
      for (let i = 0; i < 4; i++) F[dofs[i]] += equivalent[i];
    }
  }
  for (const load of model.loads) {
    if (load.kind === 'point') F[deflection[nodeOf(load.x)]] -= load.value;
    else if (load.kind === 'moment') F[turnLeft[nodeOf(load.x)]] += load.value;
  }

  const restrained = new Set<number>();
  const holds = model.supports.filter((s) => s.kind !== 'hinge');
  for (const support of holds) {
    const n = nodeOf(support.x);
    restrained.add(deflection[n]);
    if (support.kind === 'fixed') restrained.add(turnLeft[n]).add(turnRight[n]);
  }

  const statics = (reactions: BeamReaction[]): Statics => ({
    forces: [
      ...reactions.map((r) => ({ x: r.x, value: r.force })),
      ...model.loads.flatMap((l) => (l.kind === 'point' ? [{ x: l.x, value: -l.value }] : [])),
    ],
    couples: [
      ...reactions.flatMap((r) => (r.moment ? [{ x: r.x, value: r.moment }] : [])),
      ...model.loads.flatMap((l) => (l.kind === 'moment' ? [{ x: l.x, value: l.value }] : [])),
    ],
    spreads: model.loads.flatMap((l) => (l.kind === 'distributed' ? [l] : [])),
  });

  const empty = (status: BeamStatus): BeamResult => finish(status, [], statics([]), nodes, L);
  if (holds.length === 0) return empty('none');

  const free = [...Array(size).keys()].filter((i) => !restrained.has(i));
  const solution = solveLinear(
    free.map((i) => free.map((j) => K[i][j])),
    free.map((i) => F[i]),
  );
  if (!solution) return empty('unstable');
  const u = new Array<number>(size).fill(0);
  free.forEach((i, n) => (u[i] = solution[n]));
  const reactionAt = (dof: number) => clean(K[dof].reduce((sum, kij, j) => sum + kij * u[j], 0) - F[dof]);

  const seen = new Set<number>();
  const reactions: BeamReaction[] = [];
  for (const support of holds) {
    const n = nodeOf(support.x);
    if (seen.has(n)) continue;
    seen.add(n);
    const fixed = holds.some((s) => s.kind === 'fixed' && nodeOf(s.x) === n);
    const turning = hinged.has(n) ? reactionAt(turnLeft[n]) + reactionAt(turnRight[n]) : reactionAt(turnLeft[n]);
    reactions.push({
      support: support.id,
      x: nodes[n],
      force: reactionAt(deflection[n]),
      ...(fixed ? { moment: clean(turning) } : {}),
    });
  }
  // Statics gives two equations for the whole beam and one more (zero moment) at each hinge.
  const unknowns = restrained.size - [...hinged].filter((n) => restrained.has(turnRight[n])).length;
  const equations = 2 + hinged.size;
  return finish(unknowns > equations ? 'indeterminate' : 'determinate', reactions, statics(reactions), nodes, L);
}

function finish(status: BeamStatus, reactions: BeamReaction[], s: Statics, nodes: number[], L: number): BeamResult {
  const shear = (x: number, left = false) => clean(shearAt(s, x, left));
  const moment = (x: number, left = false) => clean(momentAt(s, x, left));
  const xs = new Set<number>(nodes);
  for (let i = 0; i <= 200; i++) xs.add((i / 200) * L);
  const zeroShear: number[] = [];
  const scale = 1 + Math.max(...nodes.map((x) => Math.abs(shearAt(s, x, false))));
  const tiny = 1e-9 * scale;
  for (let e = 0; e < nodes.length - 1; e++) {
    const [a, b] = [nodes[e], nodes[e + 1]];
    const parts = 64;
    for (let i = 0; i < parts; i++) {
      let lo = a + ((b - a) * i) / parts;
      let hi = a + ((b - a) * (i + 1)) / parts;
      let vlo = shearAt(s, lo, false);
      const vhi = shearAt(s, hi, true);
      if (Math.abs(vlo) <= tiny) {
        // The shear is zero right on a sample point; a whole stretch of zero shear counts once, where it starts.
        if (i > 0 && Math.abs(shearAt(s, lo - (b - a) / parts, false)) > tiny) zeroShear.push(clean(lo));
        continue;
      }
      if (vlo * vhi > 0 || Math.abs(vhi) <= tiny) continue;
      for (let n = 0; n < 60; n++) {
        const mid = (lo + hi) / 2;
        const vm = shearAt(s, mid, false);
        if (vm * vlo > 0) {
          lo = mid;
          vlo = vm;
        } else hi = mid;
      }
      zeroShear.push(clean((lo + hi) / 2));
    }
  }
  for (const x of zeroShear) xs.add(x);
  const samples: BeamSample[] = [];
  for (const x of [...xs].sort((p, q) => p - q)) {
    if (nodes.includes(x) && x > 0) samples.push({ x, shear: shear(x, true), moment: moment(x, true) });
    if (x < L || !nodes.includes(x)) samples.push({ x, shear: shear(x), moment: moment(x) });
  }
  const largest = (key: 'shear' | 'moment'): Extreme => {
    let best: Extreme = { x: 0, value: 0 };
    for (const sample of samples) {
      if (Math.abs(sample[key]) > Math.abs(best.value) + 1e-12) best = { x: sample.x, value: sample[key] };
    }
    return best;
  };
  return {
    status,
    reactions,
    shear,
    moment,
    samples,
    maxShear: largest('shear'),
    maxMoment: largest('moment'),
    zeroShear,
  };
}

/** A new beam: 6 m on a pin and a roller, with a point load and a uniform load. */
export function starterBeam(): BeamModel {
  return {
    length: 6,
    supports: [
      { id: 'a', kind: 'pin', x: 0 },
      { id: 'b', kind: 'roller', x: 6 },
    ],
    loads: [
      { id: 'p1', kind: 'point', x: 2, value: 10 },
      { id: 'w1', kind: 'distributed', x1: 3, x2: 6, w1: 4, w2: 4 },
    ],
    forceUnit: 'kN',
    lengthUnit: 'm',
  };
}

const num = (value: unknown, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;
const str = (value: unknown, fallback: string) => (typeof value === 'string' ? value.slice(0, 40) : fallback);

export function readBeam(raw: unknown): BeamModel {
  const start = starterBeam();
  if (typeof raw !== 'object' || raw === null) return start;
  const data = raw as Record<string, unknown>;
  const supports: BeamSupport[] = [];
  for (const item of Array.isArray(data.supports) ? data.supports.slice(0, 50) : []) {
    const s = (item ?? {}) as Record<string, unknown>;
    if (s.kind === 'pin' || s.kind === 'roller' || s.kind === 'fixed' || s.kind === 'hinge')
      supports.push({ id: str(s.id, `s${supports.length + 1}`), kind: s.kind, x: num(s.x, 0) });
  }
  const loads: BeamLoad[] = [];
  for (const item of Array.isArray(data.loads) ? data.loads.slice(0, 100) : []) {
    const l = (item ?? {}) as Record<string, unknown>;
    const id = str(l.id, `l${loads.length + 1}`);
    if (l.kind === 'point' || l.kind === 'moment')
      loads.push({ id, kind: l.kind, x: num(l.x, 0), value: num(l.value, 0) });
    else if (l.kind === 'distributed')
      loads.push({ id, kind: 'distributed', x1: num(l.x1, 0), x2: num(l.x2, 1), w1: num(l.w1, 1), w2: num(l.w2, 1) });
  }
  const segments: BeamSegment[] = [];
  for (const item of Array.isArray(data.segments) ? data.segments.slice(0, 50) : []) {
    const g = (item ?? {}) as Record<string, unknown>;
    const factor = num(g.factor, 1);
    if (factor > 0)
      segments.push({ id: str(g.id, `e${segments.length + 1}`), x1: num(g.x1, 0), x2: num(g.x2, 1), factor });
  }
  return {
    length: Math.max(0.1, num(data.length, start.length)),
    supports,
    loads,
    ...(segments.length > 0 ? { segments } : {}),
    forceUnit: str(data.forceUnit, 'kN'),
    lengthUnit: str(data.lengthUnit, 'm'),
  };
}
