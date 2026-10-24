// Routh-Hurwitz and the root locus. The Routh array handles both special cases: a zero in the first column is
// replaced by a small ε > 0, and a row of zeros by the derivative of the auxiliary polynomial above it. Entries that
// depend on ε are shown by their leading term, such as −10/ε, found by running the array at two values of ε. The
// root locus rules give the centroid, the asymptote angles, the break points, and the imaginary-axis crossings.
// Departure angles at complex poles and arrival angles at complex zeros come from the angle condition. The gain for
// a point or a damping ratio comes from the magnitude condition.
import { ControlError } from '../lib/errors';
import { boundaryCrossings, breakPoints, closedPoly, gainAt, stableRanges, trackLocus, type Locus } from '../lib/locus';
import { rootsOnGrid } from '../lib/num';
import { step, type Step } from '../lib/steps';
import {
  cabs,
  cdiv,
  complexText,
  cx,
  fmt,
  order,
  pevalC,
  polyTex,
  rootsOf,
  type Complex,
  type Poly,
  type TF,
} from '../lib/tf';

export const MAX_ORDER = 12;

export interface RouthRow {
  /** The power of s the row starts at. */
  readonly power: number;
  /** Each entry as shown: a number, ε, or a leading term in ε such as −10/ε. */
  readonly cells: readonly string[];
  /** The sign of the first entry as ε → 0⁺. */
  readonly sign: number;
  /** How the row was made when a special case arose. */
  readonly special?: 'epsilon' | 'auxiliary';
}

export interface Routh {
  readonly rows: RouthRow[];
  readonly signChanges: number;
  readonly rhp: number;
  readonly axis: number;
  readonly lhp: number;
  /** Repeated roots on the imaginary axis: the system is unstable, not marginal. */
  readonly repeatedAxis: boolean;
  /** The auxiliary polynomials of rows of zeros, lowest power first. */
  readonly auxiliary: Poly[];
  readonly roots: Complex[];
  readonly steps: Step[];
}

interface RawRow {
  readonly power: number;
  readonly cells: number[];
  readonly special?: 'epsilon' | 'auxiliary';
}

/** The array for one value of ε, with the coefficients highest power first. */
function routhRows(a: readonly number[], eps: number, aux: Poly[] | null): RawRow[] {
  const n = a.length - 1;
  const width = Math.floor(n / 2) + 1;
  const pad = (xs: number[]) => [...xs, ...new Array<number>(width - xs.length).fill(0)];
  const rows: RawRow[] = [
    { power: n, cells: pad(a.filter((_, i) => i % 2 === 0)) },
    { power: n - 1, cells: pad(a.filter((_, i) => i % 2 === 1)) },
  ];
  const tiny = (x: number, scale: number) => Math.abs(x) <= 1e-9 * scale;
  const fix = (row: RawRow, above: RawRow): RawRow => {
    const scale = Math.max(1e-300, ...above.cells.map(Math.abs));
    if (row.cells.every((x) => tiny(x, scale))) {
      // A row of zeros: differentiate the auxiliary polynomial made from the row above.
      const k = above.power;
      aux?.push(auxPoly(above));
      return {
        power: row.power,
        cells: pad(above.cells.map((c, i) => c * (k - 2 * i)).slice(0, width)),
        special: 'auxiliary',
      };
    }
    if (tiny(row.cells[0], scale)) return { power: row.power, cells: [eps, ...row.cells.slice(1)], special: 'epsilon' };
    return row;
  };
  rows[1] = fix(rows[1], rows[0]);
  for (let p = n - 2; p >= 0; p -= 1) {
    const r1 = rows[rows.length - 2].cells;
    const r2 = rows[rows.length - 1].cells;
    const cells = new Array<number>(width).fill(0);
    for (let j = 0; j + 1 < width; j += 1) cells[j] = (r2[0] * r1[j + 1] - r1[0] * r2[j + 1]) / r2[0];
    rows.push(fix({ power: p, cells }, rows[rows.length - 1]));
  }
  return rows;
}

/** The auxiliary polynomial of a row starting at sᵏ, lowest power first. */
function auxPoly(row: RawRow): Poly {
  const out = new Array<number>(row.power + 1).fill(0);
  row.cells.forEach((c, i) => {
    if (row.power - 2 * i >= 0) out[row.power - 2 * i] = c;
  });
  return out;
}

/** The leading term c·εᵖ of an entry seen as v1 at ε1 and v2 at ε2. */
function leading(v1: number, v2: number, e1: number, e2: number): { text: string; sign: number } {
  if (v1 === 0 && v2 === 0) return { text: '0', sign: 0 };
  if (Math.abs(v1 - v2) <= 1e-9 * Math.max(Math.abs(v1), Math.abs(v2))) return { text: fmt(v1), sign: Math.sign(v1) };
  const p = Math.round(Math.log(Math.abs(v1 / v2)) / Math.log(e1 / e2));
  // Richardson on v·ε⁻ᵖ = c(1 + dε) removes the first correction.
  const c1 = v1 * e1 ** -p;
  const c2 = v2 * e2 ** -p;
  const c = (c2 * e1 - c1 * e2) / (e1 - e2);
  const coef = (x: number) => (Math.abs(Math.abs(x) - 1) < 1e-6 ? (x < 0 ? '−' : '') : fmt(x));
  const text =
    p === 0
      ? fmt(c)
      : p === 1
        ? `${coef(c)}ε`
        : p === -1
          ? `${fmt(c)}/ε`
          : p > 0
            ? `${coef(c)}ε^${p}`
            : `${fmt(c)}/ε^${-p}`;
  return { text, sign: Math.sign(c) };
}

/** The Routh array of a polynomial (lowest power first) and what it says about the roots. */
export function routh(p: Poly): Routh {
  const t = [...p];
  while (t.length > 1 && t[t.length - 1] === 0) t.pop();
  const n = t.length - 1;
  if (n < 1) throw new ControlError('routhOrder');
  if (n > MAX_ORDER) throw new ControlError('orderTooHigh', { max: String(MAX_ORDER) });
  if (!t.every(Number.isFinite)) throw new ControlError('routhOrder');
  const flip = t[n] < 0 ? -1 : 1;
  const big = Math.max(...t.map(Math.abs));
  const a = t.map((c) => flip * c).reverse();
  // ε is small next to the coefficients, but in their units, so a leading term such as −10/ε reads as by hand.
  const e1 = 1e-4 * big;
  const e2 = 1e-5 * big;
  const auxiliary: Poly[] = [];
  const raw1 = routhRows(a, e1, auxiliary);
  const raw2 = routhRows(a, e2, null);
  const rows: RouthRow[] = raw1.map((r, i) => {
    const cells = r.cells.map((v, j) => leading(v, raw2[i].cells[j], e1, e2));
    const shown = cells.map((c, j) => (r.special === 'epsilon' && j === 0 ? 'ε' : c.text));
    // Trailing zeros past the row's length are left blank.
    const length = Math.floor(r.power / 2) + 1;
    return {
      power: r.power,
      cells: shown.slice(0, length),
      sign: r.special === 'epsilon' ? 1 : cells[0].sign,
      special: r.special,
    };
  });
  let signChanges = 0;
  for (let i = 1; i < rows.length; i += 1) if (rows[i].sign * rows[i - 1].sign < 0) signChanges += 1;
  const roots = rootsOf(t);
  const scale = Math.max(1, ...roots.map((r) => cabs(r)));
  // Later auxiliary polynomials are factors of the first, so only the first one's axis roots are counted.
  // Repeated roots are split by about √ε by the root finder, hence the looser tolerance.
  const axisRoots = auxiliary.length > 0 ? rootsOf(auxiliary[0]).filter((r) => Math.abs(r.re) < 1e-5 * scale) : [];
  const axis = Math.min(axisRoots.length, n - signChanges);
  const lhp = Math.max(0, n - signChanges - axis);
  const repeatedAxis = axisRoots.some((r, i) =>
    axisRoots.some((q, j) => j !== i && Math.abs(q.im - r.im) < 1e-4 * scale && Math.abs(q.re - r.re) < 1e-4 * scale),
  );
  const steps: Step[] = [
    step('routh.poly', {}, `P(s) = ${polyTex(t)}`),
    ...(flip < 0 ? [step('routh.flip')] : []),
    step('routh.build'),
  ];
  rows.forEach((r, i) => {
    if (r.special === 'epsilon') steps.push(step('routh.epsilon', { power: String(r.power) }));
    if (r.special === 'auxiliary') {
      const q = auxiliary[rows.slice(0, i).filter((x) => x.special === 'auxiliary').length];
      steps.push(
        step(
          'routh.auxiliary',
          {
            power: String(r.power),
            roots: rootsOf(q)
              .map((z) => complexText(z))
              .join(', '),
          },
          `A(s) = ${polyTex(q)}`,
        ),
      );
    }
  });
  steps.push(
    step('routh.count', {
      changes: String(signChanges),
      rhp: String(signChanges),
      axis: String(axis),
      lhp: String(lhp),
    }),
  );
  if (repeatedAxis) steps.push(step('routh.repeatedAxis'));
  return { rows, signChanges, rhp: signChanges, axis, lhp, repeatedAxis, auxiliary, roots, steps };
}

const deg = (z: Complex) => (Math.atan2(z.im, z.re) * 180) / Math.PI;
/** An angle in degrees brought into (−180°, 180°]. */
export const wrap = (a: number): number => {
  const w = ((((a + 180) % 360) + 360) % 360) - 180;
  return w === -180 ? 180 : w;
};

export interface Angle {
  readonly at: Complex;
  readonly angleDeg: number;
}

export interface Rules {
  readonly poles: Complex[];
  readonly zeros: Complex[];
  readonly centroid: number | null;
  readonly asymptotes: number[];
  readonly breaks: { point: Complex; k: number }[];
  readonly departures: Angle[];
  readonly arrivals: Angle[];
  readonly crossings: { at: number; k: number }[];
  readonly ranges: [number, number][];
  readonly locus: Locus;
  readonly steps: Step[];
}

const sameAs = (a: Complex, b: Complex) => cabs({ re: a.re - b.re, im: a.im - b.im }) < 1e-6 * Math.max(1, cabs(a));

/**
 * The angle of departure from a pole, or of arrival at a zero, for each simple complex one: from the angle condition
 * near x, θ = 180° + Σ∠(x − the other kind) − Σ∠(x − the others of its own kind).
 */
function angles(own: readonly Complex[], other: readonly Complex[]): Angle[] {
  const out: Angle[] = [];
  own.forEach((x, i) => {
    if (x.im <= 1e-9 * Math.max(1, cabs(x))) return;
    if (own.some((y, j) => j !== i && sameAs(x, y))) return;
    const ownSum = own.reduce((s, y, j) => (j === i ? s : s + deg({ re: x.re - y.re, im: x.im - y.im })), 0);
    const otherSum = other.reduce((s, y) => s + deg({ re: x.re - y.re, im: x.im - y.im }), 0);
    out.push({ at: x, angleDeg: wrap(180 + otherSum - ownSum) });
  });
  return out;
}

function checkLoop(g: TF): void {
  if (order(g.den) < 1) throw new ControlError('locusNoPoles');
  if (order(g.num) > order(g.den)) throw new ControlError('improper');
  if (g.num.every((c) => c === 0)) throw new ControlError('locusZeroGain');
}

/** Every root locus rule for 1 + K G(s) = 0 with K ≥ 0, and the tracked branches. */
export function locusRules(g: TF): Rules {
  checkLoop(g);
  const poles = rootsOf(g.den);
  const zeros = g.num.length > 1 ? rootsOf(g.num) : [];
  const n = poles.length;
  const m = zeros.length;
  const q = n - m;
  const sumP = poles.reduce((s, p) => s + p.re, 0);
  const sumZ = zeros.reduce((s, z) => s + z.re, 0);
  const centroid = q > 0 ? (sumP - sumZ) / q : null;
  const asymptotes = Array.from({ length: q }, (_, k) => wrap(((2 * k + 1) * 180) / q));
  const breaks = breakPoints(g.num, g.den).filter((b) => Math.abs(b.point.im) < 1e-7 * Math.max(1, cabs(b.point)));
  const departures = angles(poles, zeros);
  const arrivals = angles(zeros, poles);
  const crossings = boundaryCrossings(g.num, g.den, 's')
    .filter((c) => c.at > 0)
    .map((c) => ({ at: c.at, k: c.k }));
  const ranges = stableRanges(g.num, g.den, 's');
  const span = Math.max(1, ...[...poles, ...zeros].map(cabs));
  const top = Math.max(10, 4 * Math.max(0, ...crossings.map((c) => c.k), ...breaks.map((b) => b.k)));
  const locus = trackLocus(g.num, g.den, top * 50, span);
  const list = (zs: readonly Complex[]) => zs.map((z) => complexText(z)).join(', ') || '—';
  const steps: Step[] = [
    step('locus.equation', {}, `1 + K\\,\\frac{N(s)}{D(s)} = 0 \\iff ${polyTex(g.den)} + ${gainTerm(g)} = 0`),
    m
      ? step('locus.ends', { n: String(n), m: String(m), poles: list(poles), zeros: list(zeros) })
      : step('locus.endsNoZeros', { n: String(n), poles: list(poles) }),
    step('locus.realAxis'),
  ];
  if (centroid !== null) {
    steps.push(
      step(
        'locus.centroid',
        { q: String(q) },
        `\\sigma_a = \\frac{\\sum p - \\sum z}{n - m} = \\frac{${fmt(sumP)} - (${fmt(sumZ)})}{${q}} = ${fmt(centroid)}`,
      ),
      step(
        'locus.asymptotes',
        { angles: asymptotes.map((a) => `${fmt(a)}°`).join(', ') },
        `\\theta_k = \\frac{(2k + 1)\\,180^\\circ}{${q}}`,
      ),
    );
  }
  steps.push(
    step('locus.breakEquation', {}, `\\frac{d}{ds}\\left[-\\frac{D(s)}{N(s)}\\right] = 0 \\iff D'N - DN' = 0`),
    step('locus.breaks', {
      points: breaks.map((b) => `s = ${complexText(b.point)} (K = ${fmt(b.k)})`).join('; ') || '—',
    }),
  );
  departures.forEach((d) => steps.push(step('locus.departure', { at: complexText(d.at), angle: fmt(d.angleDeg) })));
  arrivals.forEach((d) => steps.push(step('locus.arrival', { at: complexText(d.at), angle: fmt(d.angleDeg) })));
  crossings.forEach((c) => steps.push(step('locus.crossing', { w: fmt(c.at), k: fmt(c.k) })));
  steps.push(step('locus.ranges', { ranges: rangesText(ranges) }));
  return { poles, zeros, centroid, asymptotes, breaks, departures, arrivals, crossings, ranges, locus, steps };
}

/** K N(s) in LaTeX: "K", "2\,K", or "K(s + 1)". */
function gainTerm(g: TF): string {
  if (g.num.length > 1) return `K\\left(${polyTex(g.num)}\\right)`;
  return Math.abs(g.num[0] - 1) < 1e-12 ? 'K' : `${polyTex(g.num)}\\,K`;
}

export const rangesText = (ranges: readonly [number, number][]): string =>
  ranges.map(([lo, hi]) => (Number.isFinite(hi) ? `${fmt(lo)} < K < ${fmt(hi)}` : `K > ${fmt(lo)}`)).join('; ') || '—';

export interface GainPoint {
  readonly point: Complex;
  readonly k: number;
  readonly closed: Complex[];
}

/** The closed-loop poles at gain K. */
export const closedAt = (g: TF, k: number): Complex[] => rootsOf(closedPoly(g.num, g.den, k));

/** The gain that puts a closed-loop pole at s₀; ControlError 'notOnLocus' when the angle condition fails. */
export function gainForPoint(g: TF, s0: Complex): GainPoint & { angleDeg: number; steps: Step[] } {
  checkLoop(g);
  const r = gainAt(g.num, g.den, s0);
  if (!Number.isFinite(r.k) || r.k <= 0) throw new ControlError('notOnLocus', { angle: fmt(r.angleDeg) });
  if (!r.onLocus) throw new ControlError('notOnLocus', { angle: fmt(r.angleDeg) });
  return {
    point: s0,
    k: r.k,
    angleDeg: r.angleDeg,
    closed: closedAt(g, r.k),
    steps: [
      step('locus.angleCondition', { angle: fmt(r.angleDeg) }, `\\angle G(s_0) = \\pm 180^\\circ`),
      step('locus.magnitude', { k: fmt(r.k) }, `K = \\frac{1}{|G(s_0)|} = ${fmt(r.k)}`),
    ],
  };
}

/** Where the locus meets the line of damping ratio ζ, s = ωₙ(−ζ + j√(1 − ζ²)), with the gain there. */
export function gainForDamping(g: TF, zeta: number): (GainPoint & { wn: number })[] {
  checkLoop(g);
  if (!(zeta > 0 && zeta < 1)) throw new ControlError('zetaRange');
  const dir = cx(-zeta, Math.sqrt(1 - zeta * zeta));
  const at = (r: number) => cx(r * dir.re, r * dir.im);
  const f = (r: number) => {
    const s = at(r);
    const d = pevalC(g.den, s);
    const nn = pevalC(g.num, s);
    return d.im * nn.re - d.re * nn.im;
  };
  const span = Math.max(1, ...[...rootsOf(g.den), ...(g.num.length > 1 ? rootsOf(g.num) : [])].map(cabs));
  const grid = Array.from({ length: 4001 }, (_, i) => span * 1e-4 * 1e6 ** (i / 4000));
  const out: (GainPoint & { wn: number })[] = [];
  for (const r of rootsOnGrid(f, grid)) {
    const s = at(r);
    const kc = cdiv(pevalC(g.den, s), pevalC(g.num, s));
    const k = -kc.re;
    if (k > 1e-12 && Math.abs(kc.im) <= 1e-6 * Math.max(1, k)) out.push({ point: s, k, wn: r, closed: closedAt(g, k) });
  }
  return out;
}
