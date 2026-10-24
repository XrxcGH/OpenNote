// Integrals along curves: the line integral of a scalar function or a vector field along a parametrized curve, the
// check for a conservative field with the potential difference, and Green's theorem worked out on both sides.
import { fmt } from '../numeric';
import { line, numbers, type NumLine, type NumOut } from '../numerics/common';
import { KitError, step, type KitStep } from '../types';
import { checkNames, compiled, compiledMany, components, dotV, normV, partial, tex } from './field';
import { int1, int2 } from './quad';

const AXES = ['x', 'y', 'z'];

function interval(text: string, name: string): [number, number] {
  const r = numbers(text, name);
  if (r.length !== 2 || !(r[0] < r[1])) throw new KitError('vcInterval', name);
  return [r[0], r[1]];
}

interface Curve {
  r: (t: number) => number[];
  rp: (t: number) => number[];
  texts: string[];
  primes: string[];
}

function readCurve(curveText: string): Curve {
  const texts = components(curveText, [2, 3], 'r(t)');
  texts.forEach((c) => checkNames(c, ['t']));
  const primes = texts.map((c) => partial(c, 't'));
  const R = compiledMany(texts, ['t']);
  const RP = compiledMany(primes, ['t']);
  return { r: (t) => R([t]), rp: (t) => RP([t]), texts, primes };
}

/** The curl of F at a point is zero, for a field in the plane or in space (checked at the given points). */
function curlVanishes(comps: readonly string[], points: readonly number[][]): boolean {
  const dim = comps.length;
  const names = AXES.slice(0, dim);
  const P = (i: number, v: string) => compiled(partial(comps[i], v), names);
  const pairs: [number, string][] =
    dim === 2
      ? [
          [1, 'x'],
          [0, 'y'],
        ]
      : [
          [2, 'y'],
          [1, 'z'],
          [0, 'z'],
          [2, 'x'],
          [1, 'x'],
          [0, 'y'],
        ];
  const fns = pairs.map(([i, v]) => P(i, v));
  return points.every((p) => {
    const v = fns.map((f) => f(p));
    if (dim === 2) return Math.abs(v[0] - v[1]) < 1e-8 * (1 + Math.abs(v[0]));
    return [0, 2, 4].every((k) => Math.abs(v[k] - v[k + 1]) < 1e-8 * (1 + Math.abs(v[k])));
  });
}

/** The integral of F along the straight segment from a to b: the potential difference for a conservative field. */
function straightLine(F: (p: number[]) => number[], a: number[], b: number[]): number {
  const d = b.map((v, i) => v - a[i]);
  return int1((s) => dotV(F(a.map((v, i) => v + s * d[i])), d), 0, 1);
}

export function lineIntegral(
  kind: 'vector' | 'scalar',
  fieldText: string,
  curveText: string,
  rangeText: string,
): NumOut {
  const curve = readCurve(curveText);
  const dim = curve.texts.length;
  const [a, b] = interval(rangeText, 't');
  const names = AXES.slice(0, dim);
  const lines: NumLine[] = [];
  let integrand: (t: number) => number;
  let comps: string[] = [];
  const steps: KitStep[] = [
    step(
      'vcCurveStep',
      `\\mathbf{r}(t)=${rowTex(curve.texts)},\\ \\mathbf{r}'(t)=${rowTex(curve.primes)},\\ ${a === b ? '' : `t\\in[${fmt(a)},${fmt(b)}]`}`,
    ),
  ];
  if (kind === 'vector') {
    comps = components(fieldText, [dim], 'F');
    comps.forEach((c) => checkNames(c, names));
    const F = compiledMany(comps, names);
    integrand = (t) => dotV(F(curve.r(t)), curve.rp(t));
    steps.push(
      step(
        'vcLineVector',
        "\\int_C\\mathbf{F}\\cdot d\\mathbf{r}=\\int_a^b\\mathbf{F}(\\mathbf{r}(t))\\cdot\\mathbf{r}'(t)\\,dt",
      ),
    );
  } else {
    checkNames(fieldText, names);
    const f = compiled(fieldText, names);
    integrand = (t) => f(curve.r(t)) * normV(curve.rp(t));
    steps.push(step('vcLineScalar', "\\int_C f\\,ds=\\int_a^b f(\\mathbf{r}(t))\\,\\|\\mathbf{r}'(t)\\|\\,dt"));
  }
  const probe = integrand(a + (b - a) / 3);
  if (!Number.isFinite(probe)) throw new KitError('undefinedValue', 'integrand');
  const value = int1(integrand, a, b);
  lines.push(line(kind === 'vector' ? 'vcLineValue' : 'vcLineScalarValue', { value: fmt(value, 12) }));
  steps.push(step('numValue', `\\int=${fmt(value, 12)}`));
  if (kind === 'vector') addConservativeNotes(lines, steps, comps, curve, a, b, names);
  const ts = Array.from({ length: 161 }, (_, k) => a + ((b - a) * k) / 160);
  return {
    lines,
    tables: [],
    plots: [
      {
        label: 'curve',
        equal: true,
        series: [{ points: ts.map((t): [number, number] => [curve.r(t)[0], curve.r(t)[1]]) }],
      },
    ],
    fields: [],
    steps,
    latex: `\\int_C=${fmt(value, 12)}`,
  };
}

const rowTex = (v: readonly string[]) => `\\left(${v.map(tex).join(',\\ ')}\\right)`;

function addConservativeNotes(
  lines: NumLine[],
  steps: KitStep[],
  comps: string[],
  curve: Curve,
  a: number,
  b: number,
  names: string[],
): void {
  const samples = Array.from({ length: 9 }, (_, k) => curve.r(a + ((b - a) * (k + 0.5)) / 9));
  const start = curve.r(a);
  const end = curve.r(b);
  const closed = start.every((v, i) => Math.abs(v - end[i]) < 1e-9);
  if (closed) lines.push(line('vcClosedCurve'));
  if (!curlVanishes(comps, samples)) {
    lines.push(line('vcNotConservative'));
    return;
  }
  const F = compiledMany(comps, names);
  const alt = closed ? 0 : straightLine(F, start, end);
  lines.push(line('vcConservative', { alt: fmt(alt, 12) }));
  steps.push(
    step(
      'vcConservativeStep',
      `\\nabla\\times\\mathbf{F}=\\mathbf{0}\\Rightarrow\\int_C\\mathbf{F}\\cdot d\\mathbf{r}=\\varphi(B)-\\varphi(A)=${fmt(alt, 12)}`,
    ),
  );
}

/** The potential difference between two points for a conservative field, with the check that its gradient is F. */
export function potentialDifference(fieldText: string, fromText: string, toText: string): NumOut {
  const dim = numbers(fromText, 'start').length;
  const names = AXES.slice(0, dim);
  const comps = components(fieldText, [dim], 'F');
  comps.forEach((c) => checkNames(c, names));
  const A = numbers(fromText, 'start');
  const B = numbers(toText, 'end');
  if (B.length !== dim) throw new KitError('vcPointLength', names.join(', '));
  const mid = A.map((v, i) => (v + B[i]) / 2);
  const around = [A, B, mid, mid.map((v, i) => v + (i === 0 ? 0.3 : -0.2))];
  if (!curlVanishes(comps, around)) throw new KitError('vcNotConservative');
  const F = compiledMany(comps, names);
  const value = straightLine(F, A, B);
  // The potential from the origin along straight lines, checked by differences against F at the end point.
  const origin = new Array<number>(dim).fill(0);
  const phi = (p: number[]) => straightLine(F, origin, p);
  const h = 1e-5;
  const grad = B.map(
    (_, i) => (phi(B.map((v, j) => (j === i ? v + h : v))) - phi(B.map((v, j) => (j === i ? v - h : v)))) / (2 * h),
  );
  const err = normV(grad.map((g, i) => g - F(B)[i]));
  const steps = [
    step('vcCurlZero', `\\nabla\\times\\mathbf{F}=\\mathbf{0}`),
    step(
      'vcPotentialStep',
      `\\varphi(\\mathbf{p})=\\int_0^1\\mathbf{F}(s\\mathbf{p})\\cdot\\mathbf{p}\\,ds,\\ \\varphi(B)-\\varphi(A)=${fmt(value, 12)}`,
    ),
    step('vcPotentialCheck', `\\max|\\nabla\\varphi-\\mathbf{F}|=${fmt(err, 3)}`),
  ];
  return {
    lines: [
      line('vcPotentialDifference', { value: fmt(value, 12) }),
      line('vcPotentialAtB', { phi: fmt(phi(B), 12), err: fmt(err, 3) }),
    ],
    tables: [],
    plots: [],
    fields: [],
    steps,
    latex: `\\varphi(B)-\\varphi(A)=${fmt(value, 12)}`,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Green's theorem
// ---------------------------------------------------------------------------------------------------------------

export type GreenRegion = 'rect' | 'disk' | 'typeI';

interface Both {
  boundary: number;
  area: number;
}

export function greenTheorem(
  fieldText: string,
  region: GreenRegion,
  params: { rect: string; disk: string; lower: string; upper: string; xRange: string },
): NumOut {
  const [P, Q] = components(fieldText, [2], 'F');
  [P, Q].forEach((c) => checkNames(c, ['x', 'y']));
  const p = compiled(P, ['x', 'y']);
  const q = compiled(Q, ['x', 'y']);
  const curlText = `${partial(Q, 'x')} - (${partial(P, 'y')})`;
  const curl = compiled(curlText, ['x', 'y']);
  let both: Both;
  if (region === 'rect') both = greenRect(p, q, curl, params.rect);
  else if (region === 'disk') both = greenDisk(p, q, curl, params.disk);
  else both = greenTypeI(p, q, curl, params);
  const diff = Math.abs(both.boundary - both.area);
  const steps = [
    step(
      'vcGreenStatement',
      '\\oint_{C}P\\,dx+Q\\,dy=\\iint_{D}\\left(\\frac{\\partial Q}{\\partial x}-\\frac{\\partial P}{\\partial y}\\right)dA',
    ),
    step('vcGreenIntegrand', `\\frac{\\partial Q}{\\partial x}-\\frac{\\partial P}{\\partial y}=${tex(curlText)}`),
    step('vcGreenSides', `\\oint=${fmt(both.boundary, 12)},\\ \\iint=${fmt(both.area, 12)}`),
  ];
  return {
    lines: [line('vcGreen', { boundary: fmt(both.boundary, 12), area: fmt(both.area, 12), diff: fmt(diff, 3) })],
    tables: [],
    plots: [],
    fields: [],
    steps,
    latex: `\\oint_C P\\,dx+Q\\,dy=${fmt(both.boundary, 12)}`,
  };
}

type Fn2 = (v: readonly number[]) => number;

function greenRect(p: Fn2, q: Fn2, curl: Fn2, text: string): Both {
  const [a, b, c, d] = numbers(text, 'rectangle');
  if (!(a < b && c < d)) throw new KitError('vcRegion');
  const boundary =
    int1((x) => p([x, c]), a, b) +
    int1((y) => q([b, y]), c, d) -
    int1((x) => p([x, d]), a, b) -
    int1((y) => q([a, y]), c, d);
  return { boundary, area: int2((x, y) => curl([x, y]), a, b, c, d) };
}

function greenDisk(p: Fn2, q: Fn2, curl: Fn2, text: string): Both {
  const [cx, cy, R] = numbers(text, 'disk');
  if (!(R > 0)) throw new KitError('vcRegion');
  const boundary = int1(
    (t) => {
      const x = cx + R * Math.cos(t);
      const y = cy + R * Math.sin(t);
      return p([x, y]) * -R * Math.sin(t) + q([x, y]) * R * Math.cos(t);
    },
    0,
    2 * Math.PI,
  );
  const area = int1(
    (th) => int1((r) => curl([cx + r * Math.cos(th), cy + r * Math.sin(th)]) * r, 0, R),
    0,
    2 * Math.PI,
  );
  return { boundary, area };
}

function greenTypeI(p: Fn2, q: Fn2, curl: Fn2, params: { lower: string; upper: string; xRange: string }): Both {
  const [a, b] = interval(params.xRange, 'x');
  checkNames(params.lower, ['x']);
  checkNames(params.upper, ['x']);
  const g1 = compiled(params.lower, ['x']);
  const g2 = compiled(params.upper, ['x']);
  const d1 = compiled(partial(params.lower, 'x'), ['x']);
  const d2 = compiled(partial(params.upper, 'x'), ['x']);
  const bottom = int1((x) => p([x, g1([x])]) + q([x, g1([x])]) * d1([x]), a, b);
  const top = int1((x) => p([x, g2([x])]) + q([x, g2([x])]) * d2([x]), a, b);
  const right = int1((y) => q([b, y]), g1([b]), g2([b]));
  const left = int1((y) => q([a, y]), g1([a]), g2([a]));
  if (int1((x) => g2([x]) - g1([x]), a, b) < 0) throw new KitError('vcRegion');
  return {
    boundary: bottom + right - top - left,
    area: int2(
      (x, y) => curl([x, y]),
      a,
      b,
      (x) => g1([x]),
      (x) => g2([x]),
    ),
  };
}
