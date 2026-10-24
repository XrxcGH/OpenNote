// Complex analysis: values in rectangular and polar form, roots, the principal logarithm, poles with residues,
// contour integrals checked two ways (by the residue theorem and by numerical integration along the contour),
// real integrals by residues, and conformal maps of a grid.
import { integrate, fmt } from '../numeric';
import { KitError, step, type KitStep } from '../types';
import {
  ONE,
  ZERO,
  abs,
  add,
  arg,
  c,
  div,
  evaluateTree,
  exp,
  formatC,
  latexC,
  log,
  mul,
  readComplex,
  scale,
  sub,
  type C,
  type Tree,
} from './cmath';

// ---------------------------------------------------------------------------------------------------------------
// A value
// ---------------------------------------------------------------------------------------------------------------

export interface ValueResult {
  value: C;
  modulus: number;
  argument: number;
  rect: string;
  polar: string;
  principalLog: C | null;
  steps: KitStep[];
}

export function evaluateValue(text: string): ValueResult {
  const value = evaluateTree(readComplex(text, []), {});
  if (!Number.isFinite(value.re) || !Number.isFinite(value.im)) throw new KitError('undefinedValue', text);
  const modulus = abs(value);
  const argument = arg(value);
  const steps: KitStep[] = [step('cxValue', `${latexC(value, 10)}`, { rect: formatC(value, 10) })];
  steps.push(
    step('cxPolar', modulus === 0 ? '0' : `${fmt(modulus, 10)}\\,e^{i(${fmt(argument, 10)})}`, {
      modulus: fmt(modulus, 10),
      argument: fmt(argument, 10),
    }),
  );
  let principalLog: C | null = null;
  if (modulus > 0) {
    principalLog = log(value);
    steps.push(step('cxLog', `\\operatorname{Log} z=\\ln|z|+i\\operatorname{Arg}z=${latexC(principalLog, 10)}`));
  }
  return {
    value,
    modulus,
    argument,
    rect: formatC(value, 10),
    polar: `${fmt(modulus, 10)} (cos ${fmt(argument, 8)} + i sin ${fmt(argument, 8)})`,
    principalLog,
    steps,
  };
}

export interface RootsResult {
  roots: C[];
  steps: KitStep[];
}

/** The n roots of w, from the principal one, going counter-clockwise. */
export function nthRoots(text: string, n: number): RootsResult {
  if (!Number.isInteger(n) || n < 1 || n > 360) throw new KitError('badRootCount');
  const w = evaluateTree(readComplex(text, []), {});
  if (abs(w) === 0) throw new KitError('zeroRoots');
  const r = Math.pow(abs(w), 1 / n);
  const theta = arg(w);
  const roots: C[] = [];
  for (let k = 0; k < n; k++)
    roots.push(c(r * Math.cos((theta + 2 * Math.PI * k) / n), r * Math.sin((theta + 2 * Math.PI * k) / n)));
  const steps: KitStep[] = [
    step('cxRootFormula', `z_k=\\sqrt[${n}]{|w|}\\,e^{i(\\operatorname{Arg}w+2\\pi k)/${n}},\\; k=0,\\dots,${n - 1}`, {
      n: String(n),
      modulus: fmt(abs(w), 10),
      argument: fmt(theta, 10),
    }),
    ...roots.map((root, k) => step('cxRootItem', latexC(root, 10), { k: String(k), root: formatC(root, 10) })),
  ];
  return { roots, steps };
}

// ---------------------------------------------------------------------------------------------------------------
// Polynomials and rational functions
// ---------------------------------------------------------------------------------------------------------------

type Poly = C[];

const trim = (p: Poly): Poly => {
  const out = p.slice();
  const biggest = Math.max(...out.map(abs), 1e-300);
  while (out.length > 1 && abs(out[out.length - 1]) <= 1e-13 * biggest) out.pop();
  return out;
};
const padd = (a: Poly, b: Poly): Poly => {
  const out: Poly = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) out.push(add(a[i] ?? ZERO, b[i] ?? ZERO));
  return trim(out);
};
const pscale = (a: Poly, k: C): Poly => trim(a.map((x) => mul(x, k)));
const pmul = (a: Poly, b: Poly): Poly => {
  const out: Poly = new Array<C>(a.length + b.length - 1).fill(ZERO);
  for (let i = 0; i < a.length; i++) for (let j = 0; j < b.length; j++) out[i + j] = add(out[i + j], mul(a[i], b[j]));
  return trim(out);
};
const peval = (p: Poly, z: C): C => p.reduceRight((acc, k) => add(mul(acc, z), k), ZERO);
const degree = (p: Poly): number => trim(p).length - 1;

interface Rational {
  n: Poly;
  d: Poly;
}

function hasVariable(tree: Tree): boolean {
  if (tree.t === 'var') return true;
  if (tree.t === 'num') return false;
  if (tree.t === 'neg' || tree.t === 'call') return hasVariable(tree.a);
  return hasVariable(tree.a) || hasVariable(tree.b);
}

/** The tree as a quotient of polynomials in z, or null when it uses anything else. */
function toRational(tree: Tree): Rational | null {
  switch (tree.t) {
    case 'num':
      return { n: [tree.v], d: [ONE] };
    case 'var':
      return { n: [ZERO, ONE], d: [ONE] };
    case 'neg': {
      const a = toRational(tree.a);
      return a && { n: pscale(a.n, c(-1)), d: a.d };
    }
    case 'call':
      return null;
    case 'bin': {
      const a = toRational(tree.a);
      if (!a) return null;
      if (tree.op === '^') {
        if (hasVariable(tree.b)) return null;
        const e = evaluateTree(tree.b, {});
        if (e.im !== 0 || !Number.isInteger(e.re) || Math.abs(e.re) > 60) return null;
        let n: Poly = [ONE];
        let d: Poly = [ONE];
        for (let i = 0; i < Math.abs(e.re); i++) {
          n = pmul(n, a.n);
          d = pmul(d, a.d);
        }
        return e.re >= 0 ? { n, d } : { n: d, d: n };
      }
      const b = toRational(tree.b);
      if (!b) return null;
      if (tree.op === '+') return { n: padd(pmul(a.n, b.d), pmul(b.n, a.d)), d: pmul(a.d, b.d) };
      if (tree.op === '-') return { n: padd(pmul(a.n, b.d), pscale(pmul(b.n, a.d), c(-1))), d: pmul(a.d, b.d) };
      if (tree.op === '*') return { n: pmul(a.n, b.n), d: pmul(a.d, b.d) };
      return { n: pmul(a.n, b.d), d: pmul(a.d, b.n) };
    }
  }
}

/** The roots of a polynomial (Durand-Kerner, polished by Newton), grouped into distinct points with multiplicity. */
function rootClusters(poly: Poly): { at: C; multiplicity: number }[] {
  const p = trim(poly);
  const n = p.length - 1;
  if (n < 1) return [];
  const lead = p[n];
  const monic = p.map((k) => div(k, lead));
  const bound = 1 + Math.max(...monic.slice(0, n).map(abs));
  let z: C[] = Array.from({ length: n }, (_, k) =>
    scale(c(Math.cos(0.4 + (2 * Math.PI * k) / n), Math.sin(0.4 + (2 * Math.PI * k) / n)), bound * 0.6),
  );
  for (let iteration = 0; iteration < 2000; iteration++) {
    let change = 0;
    z = z.map((zi, i) => {
      let denominator = ONE;
      for (let j = 0; j < n; j++) if (j !== i) denominator = mul(denominator, sub(zi, z[j]));
      const delta = div(peval(monic, zi), denominator);
      change = Math.max(change, abs(delta));
      return sub(zi, delta);
    });
    if (change < 1e-15 * bound) break;
  }
  const clusters: { sum: C; count: number }[] = [];
  const tolerance = 1e-3;
  for (const root of z) {
    const hit = clusters.find((k) => abs(sub(scale(k.sum, 1 / k.count), root)) < tolerance * (1 + abs(root)));
    if (hit) {
      hit.sum = add(hit.sum, root);
      hit.count++;
    } else clusters.push({ sum: root, count: 1 });
  }
  return clusters.map((k) => ({ at: scale(k.sum, 1 / k.count), multiplicity: k.count }));
}

export interface Pole {
  at: C;
  order: number;
  residue: C;
}

/** The residue of f at `a`: the mean of f(z)(z - a) on a small circle that holds no other pole. */
function residueAt(f: (z: C) => C, a: C, radius: number): C {
  const N = 256;
  let total = ZERO;
  for (let k = 0; k < N; k++) {
    const w = c(radius * Math.cos((2 * Math.PI * k) / N), radius * Math.sin((2 * Math.PI * k) / N));
    total = add(total, mul(f(add(a, w)), w));
  }
  return scale(total, 1 / N);
}

function orderAt(f: (z: C) => C, a: C): number {
  const r1 = 1e-3;
  const r2 = 2e-3;
  const at = (r: number) => {
    let biggest = 0;
    for (let k = 0; k < 8; k++) {
      const w = c(r * Math.cos((Math.PI * k) / 4 + 0.3), r * Math.sin((Math.PI * k) / 4 + 0.3));
      biggest = Math.max(biggest, abs(f(add(a, w))));
    }
    return biggest;
  };
  return Math.round(Math.log(at(r1) / at(r2)) / Math.log(2));
}

/** Poles found by Newton's method on 1/f from a grid of starting points. */
function scanPoles(f: (z: C) => C, box: [number, number, number, number]): C[] {
  const found: C[] = [];
  const g = (z: C) => div(ONE, f(z));
  const [x0, x1, y0, y1] = box;
  const steps = 24;
  for (let i = 0; i <= steps; i++) {
    for (let j = 0; j <= steps; j++) {
      let z = c(x0 + ((x1 - x0) * i) / steps + 0.0137, y0 + ((y1 - y0) * j) / steps + 0.0291);
      let ok = false;
      for (let iteration = 0; iteration < 80; iteration++) {
        const h = 1e-6 * (1 + abs(z));
        const value = g(z);
        if (!Number.isFinite(value.re) || !Number.isFinite(value.im)) break;
        const slope = div(sub(g(add(z, c(h))), g(sub(z, c(h)))), c(2 * h));
        if (abs(slope) < 1e-300) break;
        const next = sub(z, div(value, slope));
        const moved = abs(sub(next, z));
        z = next;
        if (moved < 1e-9 * (1 + abs(z))) {
          ok = true;
          break;
        }
      }
      if (!ok || abs(g(z)) > 1e-5) continue;
      if (abs(f(add(z, c(1e-4, 1e-4)))) < 1e3) continue;
      if (!found.some((other) => abs(sub(other, z)) < 1e-4 * (1 + abs(z)))) found.push(z);
    }
  }
  return found;
}

/** The poles of an expression in z with their orders and residues, in the box when it is not rational. */
export function findPoles(
  text: string,
  box: [number, number, number, number] = [-5, 5, -5, 5],
): { poles: Pole[]; rational: boolean } {
  const tree = readComplex(text, ['z']);
  const f = (z: C) => evaluateTree(tree, { z });
  const rational = toRational(tree);
  let candidates: C[];
  if (rational && degree(rational.d) >= 1) {
    candidates = rootClusters(rational.d).map((k) => k.at);
  } else {
    candidates = scanPoles(f, box);
  }
  const poles: Pole[] = [];
  for (const at of candidates) {
    const near = candidates.filter((o) => o !== at).map((o) => abs(sub(o, at)));
    const radius = Math.min(0.3 * Math.min(...near, 10), 0.5);
    const order = orderAt(f, at);
    if (order < 1) continue;
    poles.push({ at, order, residue: residueAt(f, at, radius) });
  }
  poles.sort((p, q) => p.at.re - q.at.re || p.at.im - q.at.im);
  return { poles, rational: rational !== null };
}

// ---------------------------------------------------------------------------------------------------------------
// Contours
// ---------------------------------------------------------------------------------------------------------------

export type Contour = { kind: 'circle'; center: C; radius: number } | { kind: 'polygon'; points: C[] };

function winding(points: C[], p: C): number {
  let total = 0;
  for (let k = 0; k < points.length; k++) {
    const a = sub(points[k], p);
    const b = sub(points[(k + 1) % points.length], p);
    total += Math.atan2(a.re * b.im - a.im * b.re, a.re * b.re + a.im * b.im);
  }
  return Math.round(total / (2 * Math.PI));
}

function distanceToSegment(a: C, b: C, p: C): number {
  const d = sub(b, a);
  const len2 = d.re * d.re + d.im * d.im;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.re - a.re) * d.re + (p.im - a.im) * d.im) / len2));
  return abs(sub(p, c(a.re + t * d.re, a.im + t * d.im)));
}

function integrateComplex(g: (s: number) => C, a: number, b: number): C {
  return c(
    integrate((s) => g(s).re, a, b, 1e-13),
    integrate((s) => g(s).im, a, b, 1e-13),
  );
}

function pathIntegral(f: (z: C) => C, contour: Contour): C {
  if (contour.kind === 'circle') {
    const { center, radius } = contour;
    return integrateComplex(
      (s) => {
        const w = c(radius * Math.cos(s), radius * Math.sin(s));
        return mul(f(add(center, w)), c(-radius * Math.sin(s), radius * Math.cos(s)));
      },
      0,
      2 * Math.PI,
    );
  }
  let total = ZERO;
  for (let k = 0; k < contour.points.length; k++) {
    const a = contour.points[k];
    const b = contour.points[(k + 1) % contour.points.length];
    const d = sub(b, a);
    total = add(
      total,
      integrateComplex((s) => mul(f(add(a, scale(d, s))), d), 0, 1),
    );
  }
  return total;
}

export interface ContourResult {
  inside: Pole[];
  byResidues: C;
  numeric: C;
  /** The answer to give: the residue sum, unless the quadrature disagrees with it, and then the quadrature. */
  value: C;
  /** True when the two disagree, which means f is not analytic inside or has a singularity that is not a pole. */
  disagree: boolean;
  steps: KitStep[];
}

/** The integral of the expression in z once around the contour, counter-clockwise, by residues and by quadrature. */
export function contourIntegral(text: string, contour: Contour): ContourResult {
  if (contour.kind === 'circle' && !(contour.radius > 0)) throw new KitError('badContour');
  if (contour.kind === 'polygon' && contour.points.length < 3) throw new KitError('badContour');
  const tree = readComplex(text, ['z']);
  const f = (z: C) => evaluateTree(tree, { z });
  const box: [number, number, number, number] =
    contour.kind === 'circle'
      ? [
          contour.center.re - contour.radius * 1.05,
          contour.center.re + contour.radius * 1.05,
          contour.center.im - contour.radius * 1.05,
          contour.center.im + contour.radius * 1.05,
        ]
      : [
          Math.min(...contour.points.map((p) => p.re)) - 0.1,
          Math.max(...contour.points.map((p) => p.re)) + 0.1,
          Math.min(...contour.points.map((p) => p.im)) - 0.1,
          Math.max(...contour.points.map((p) => p.im)) + 0.1,
        ];
  const rational = toRational(tree);
  // A rational function can have poles outside the box; widen the search by finding them all, then filtering.
  const { poles } = findPoles(text, rational ? [-1, 1, -1, 1] : box);
  const edgeDistance = (p: C) =>
    contour.kind === 'circle'
      ? Math.abs(abs(sub(p, contour.center)) - contour.radius)
      : Math.min(
          ...contour.points.map((a, k) => distanceToSegment(a, contour.points[(k + 1) % contour.points.length], p)),
        );
  if (poles.some((p) => edgeDistance(p.at) < 1e-6)) throw new KitError('poleOnContour');
  // Each residue counts as many times as the contour winds around its pole: -1 for a clockwise polygon.
  const turns = (p: Pole) =>
    contour.kind === 'circle'
      ? abs(sub(p.at, contour.center)) < contour.radius
        ? 1
        : 0
      : winding(contour.points, p.at);
  const inside = poles.filter((p) => turns(p) !== 0);
  let total = ZERO;
  for (const p of inside) total = add(total, scale(p.residue, turns(p)));
  const byResidues = mul(c(0, 2 * Math.PI), total);
  const numeric = pathIntegral(f, contour);
  const steps: KitStep[] = [step('cxContour', `\\oint f(z)\\,dz,\\quad f(z)=${text}`)];
  if (poles.length === 0) steps.push(step('cxNoPoles'));
  for (const p of poles) {
    const place = formatC(p.at, 8);
    steps.push(step(inside.includes(p) ? 'cxPoleIn' : 'cxPoleOut', undefined, { at: place, order: String(p.order) }));
    if (inside.includes(p)) {
      steps.push(
        step('cxResidue', `\\operatorname{Res}_{z=${latexC(p.at, 6)}}f=${latexC(p.residue, 10)}`, {
          at: place,
          residue: formatC(p.residue, 10),
        }),
      );
    }
  }
  steps.push(
    step('cxResidueSum', `\\oint f\\,dz=2\\pi i\\sum\\operatorname{Res}=${latexC(byResidues, 10)}`, {
      value: formatC(byResidues, 10),
    }),
    step('cxNumeric', undefined, { value: formatC(numeric, 10) }),
  );
  const disagree = abs(sub(byResidues, numeric)) > 1e-8 * (1 + abs(numeric));
  if (disagree) steps.push(step('cxDisagree', undefined, { value: formatC(numeric, 10) }));
  return { inside, byResidues, numeric, value: disagree ? numeric : byResidues, disagree, steps };
}

// ---------------------------------------------------------------------------------------------------------------
// Real integrals by residues
// ---------------------------------------------------------------------------------------------------------------

export interface RealIntegralResult {
  /** The integral as LaTeX, up to the equals sign. */
  integral: string;
  value: number;
  poles: Pole[];
  numeric: number;
  steps: KitStep[];
}

/** The integral over the whole real line of a rational function of x, closing the contour in the upper half plane. */
export function improperIntegral(text: string): RealIntegralResult {
  const source = text.replace(/\bx\b/g, 'z');
  const tree = readComplex(source, ['z']);
  const r = toRational(tree);
  if (!r) throw new KitError('notRational');
  if (degree(r.d) < degree(r.n) + 2) throw new KitError('degreeTooLow');
  const clusters = rootClusters(r.d);
  if (clusters.some((k) => Math.abs(k.at.im) < 1e-7)) throw new KitError('realPole');
  const { poles } = findPoles(source);
  const upper = poles.filter((p) => p.at.im > 0);
  let total = ZERO;
  for (const p of upper) total = add(total, p.residue);
  const value = mul(c(0, 2 * Math.PI), total).re;
  const f = (x: number) => evaluateTree(tree, { z: c(x) }).re;
  const numeric = integrate((u) => f(Math.tan(u)) / Math.cos(u) ** 2, -Math.PI / 2 + 1e-12, Math.PI / 2 - 1e-12, 1e-12);
  const steps: KitStep[] = [
    step('cxRealSetup', `\\int_{-\\infty}^{\\infty} ${source.replace(/z/g, 'x')}\\,dx`),
    step('cxRealClose', undefined, { n: String(degree(r.n)), d: String(degree(r.d)) }),
  ];
  for (const p of upper) {
    steps.push(
      step('cxResidue', `\\operatorname{Res}_{z=${latexC(p.at, 6)}}f=${latexC(p.residue, 10)}`, {
        at: formatC(p.at, 8),
        residue: formatC(p.residue, 10),
      }),
    );
  }
  steps.push(
    step('cxRealResult', `2\\pi i\\sum\\operatorname{Res}=${fmt(value, 10)}`, { value: fmt(value, 10) }),
    step('cxRealCheck', undefined, { value: fmt(numeric, 10) }),
  );
  return {
    integral: `\\int_{-\\infty}^{\\infty} ${source.replace(/z/g, 'x')}\\,dx`,
    value,
    poles: upper,
    numeric,
    steps,
  };
}

export interface TrigIntegralResult {
  integral: string;
  value: number;
  poles: Pole[];
  numeric: number;
  steps: KitStep[];
}

/** The integral of f(cos t, sin t) from 0 to 2 pi, by the substitution z = e^(it) and the residues in the unit disk. */
export function trigIntegral(text: string): TrigIntegralResult {
  const tree = readComplex(text, ['t']);
  const f = (t: C) => evaluateTree(tree, { t });
  // The substitution needs f to have period 2 pi in t, so the branch of the logarithm cannot matter.
  for (const t0 of [0.37, 1.9, -2.2]) {
    const a = f(c(t0));
    const b = f(c(t0 + 2 * Math.PI));
    if (!Number.isFinite(a.re) || abs(sub(a, b)) > 1e-9 * (1 + abs(a))) throw new KitError('trigForm');
  }
  const F = (z: C): C => div(f(mul(c(0, -1), log(z))), mul(c(0, 1), z));
  const all = scanPoles(F, [-1.3, 1.3, -1.3, 1.3]);
  if (all.some((a) => Math.abs(abs(a) - 1) < 1e-7)) throw new KitError('poleOnContour');
  const poles = all
    .filter((a) => abs(a) < 1)
    .map((at) => {
      const near = all.filter((o) => abs(sub(o, at)) > 1e-4).map((o) => abs(sub(o, at)));
      const radius = Math.min(0.3 * Math.min(...near, 10), 0.3, (1 - abs(at)) * 0.5);
      return { at, order: Math.max(1, orderAt(F, at)), residue: residueAt(F, at, radius) } satisfies Pole;
    });
  let total = ZERO;
  for (const p of poles) total = add(total, p.residue);
  const value = mul(c(0, 2 * Math.PI), total).re;
  const numeric = integrate((t) => f(c(t)).re, 0, 2 * Math.PI, 1e-13);
  const steps: KitStep[] = [
    step('cxTrigSetup', `\\int_0^{2\\pi} ${text}\\,dt`),
    step('cxTrigSub', `\\cos t=\\tfrac12(z+z^{-1}),\\; \\sin t=\\tfrac1{2i}(z-z^{-1}),\\; dt=\\frac{dz}{iz}`),
    ...poles.flatMap((p) => [
      step('cxPoleIn', undefined, { at: formatC(p.at, 8), order: String(p.order) }),
      step('cxResidue', `\\operatorname{Res}=${latexC(p.residue, 10)}`, {
        at: formatC(p.at, 8),
        residue: formatC(p.residue, 10),
      }),
    ]),
    step('cxRealResult', `2\\pi i\\sum\\operatorname{Res}=${fmt(value, 10)}`, { value: fmt(value, 10) }),
    step('cxRealCheck', undefined, { value: fmt(numeric, 10) }),
  ];
  return { integral: `\\int_0^{2\\pi} ${text}\\,dt`, value, poles, numeric, steps };
}

// ---------------------------------------------------------------------------------------------------------------
// Conformal maps
// ---------------------------------------------------------------------------------------------------------------

export const MAPS = ['square', 'inverse', 'exp', 'mobius', 'joukowski', 'sin'] as const;
export type MapName = (typeof MAPS)[number];

const MAP_FUNCTIONS: Record<MapName, (z: C) => C> = {
  square: (z) => mul(z, z),
  inverse: (z) => div(ONE, z),
  exp: (z) => exp(z),
  mobius: (z) => div(sub(z, ONE), add(z, ONE)),
  joukowski: (z) => add(z, div(ONE, z)),
  sin: (z) => c(Math.sin(z.re) * Math.cosh(z.im), Math.cos(z.re) * Math.sinh(z.im)),
};

export interface MapResult {
  /** Images of the vertical grid lines, then the horizontal ones. */
  lines: [number, number][][];
  count: number;
}

/** The image of a rectangle's grid of lines under a map. Points where the map is undefined break the line. */
export function mapGrid(name: MapName, x0: number, x1: number, y0: number, y1: number, lines = 9): MapResult {
  if (!(x1 > x0) || !(y1 > y0)) throw new KitError('badRegion');
  const f = MAP_FUNCTIONS[name];
  const out: [number, number][][] = [];
  const samples = 80;
  const clip = 1e3;
  const push = (points: C[]) => {
    const line: [number, number][] = [];
    for (const z of points) {
      const w = f(z);
      if (Number.isFinite(w.re) && Number.isFinite(w.im) && Math.abs(w.re) < clip && Math.abs(w.im) < clip)
        line.push([w.re, w.im]);
    }
    out.push(line);
  };
  for (let i = 0; i < lines; i++) {
    const x = x0 + ((x1 - x0) * i) / (lines - 1);
    push(Array.from({ length: samples + 1 }, (_, k) => c(x, y0 + ((y1 - y0) * k) / samples)));
  }
  for (let j = 0; j < lines; j++) {
    const y = y0 + ((y1 - y0) * j) / (lines - 1);
    push(Array.from({ length: samples + 1 }, (_, k) => c(x0 + ((x1 - x0) * k) / samples, y)));
  }
  return { lines: out, count: lines };
}
