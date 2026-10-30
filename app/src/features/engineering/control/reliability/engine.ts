// Reliability, quality, and inventory. System reliability comes from a block diagram typed as nested series,
// parallel, and k-out-of-n groups. Life models (exponential and Weibull) give the hazard and the MTTF, and a Weibull
// is fitted to failure times. Control charts (x̄–R, x̄–s, p, c) use constants computed from first principles. Also
// here: process capability, the operating characteristic of a single sampling plan, and the economic order quantity
// with safety stock.

import { ControlError } from '../lib/errors';
import { integrate, integrateToInfinity, linspace } from '../lib/num';
import { gammaFn, lnGamma, normalCdf, normalQuantile } from '../lib/special';
import { step, type Step } from '../lib/steps';
import { fmt, fmtTex } from '../lib/tf';
import { binomialCdf } from '../lib/special';

// ---------------------------------------------------------------------------------------------------------------
// Block diagrams

export type Block =
  | { readonly kind: 'fixed'; readonly r: number }
  | { readonly kind: 'exp'; readonly lambda: number }
  | { readonly kind: 'weibull'; readonly beta: number; readonly eta: number }
  | { readonly kind: 'series' | 'parallel'; readonly items: readonly Block[] }
  | { readonly kind: 'kofn'; readonly k: number; readonly items: readonly Block[] };

const MAX_BLOCKS = 200;

/**
 * Reads a diagram such as "series(0.9, parallel(0.95, 0.95), kofn(2, 0.9, 0.9, 0.9))". Leaves are a reliability
 * between 0 and 1, exp(λ) for a constant failure rate, or weibull(β, η). Throws 'diagram' errors with the place.
 */
export function readDiagram(text: string): Block {
  const src = text.replace(/\s+/g, '').toLowerCase().replace(/−/g, '-');
  if (!src) throw new ControlError('diagramEmpty');
  let pos = 0;
  let count = 0;
  const fail = (): never => {
    throw new ControlError('diagramSyntax', { at: String(pos + 1), near: src.slice(pos, pos + 12) || '…' });
  };
  const number = (): number => {
    const m = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/.exec(src.slice(pos));
    if (!m) return fail();
    pos += m[0].length;
    return Number(m[0]);
  };
  const expect = (ch: string) => {
    if (src[pos] !== ch) fail();
    pos += 1;
  };
  const list = (): Block[] => {
    const items = [node()];
    while (src[pos] === ',') {
      pos += 1;
      items.push(node());
    }
    return items;
  };
  const node = (): Block => {
    count += 1;
    if (count > MAX_BLOCKS) throw new ControlError('diagramTooBig', { max: String(MAX_BLOCKS) });
    const word = /^[a-z-]+/.exec(src.slice(pos))?.[0] ?? '';
    if (!word || word === '-') {
      const r = number();
      if (!(r >= 0 && r <= 1)) throw new ControlError('reliabilityRange', { value: fmt(r) });
      return { kind: 'fixed', r };
    }
    pos += word.length;
    expect('(');
    let out: Block;
    if (word === 'series' || word === 's') out = { kind: 'series', items: list() };
    else if (word === 'parallel' || word === 'p') out = { kind: 'parallel', items: list() };
    else if (word === 'kofn' || word === 'koon' || word === 'k-of-n') {
      const k = number();
      expect(',');
      const items = list();
      if (!Number.isInteger(k) || k < 1 || k > items.length)
        throw new ControlError('kRange', { k: fmt(k), n: String(items.length) });
      out = { kind: 'kofn', k, items };
    } else if (word === 'exp') {
      const lambda = number();
      if (!(lambda > 0)) throw new ControlError('ratePositive');
      out = { kind: 'exp', lambda };
    } else if (word === 'weibull') {
      const beta = number();
      expect(',');
      const eta = number();
      if (!(beta > 0) || !(eta > 0)) throw new ControlError('weibullPositive');
      out = { kind: 'weibull', beta, eta };
    } else return fail();
    expect(')');
    return out;
  };
  const root = node();
  if (pos !== src.length) fail();
  return root;
}

/** P(at least k of the components work), for components with different reliabilities. */
export function atLeastK(k: number, rs: readonly number[]): number {
  // dist[j] = P(exactly j work) among the components seen so far.
  let dist = [1];
  for (const r of rs) {
    const next = new Array<number>(dist.length + 1).fill(0);
    dist.forEach((p, j) => {
      next[j] += p * (1 - r);
      next[j + 1] += p * r;
    });
    dist = next;
  }
  return dist.slice(k).reduce((s, p) => s + p, 0);
}

/** The reliability of a block at time t (fixed leaves ignore t). */
export function blockReliability(b: Block, t = 0): number {
  switch (b.kind) {
    case 'fixed':
      return b.r;
    case 'exp':
      return Math.exp(-b.lambda * t);
    case 'weibull':
      return t <= 0 ? 1 : Math.exp(-((t / b.eta) ** b.beta));
    case 'series':
      return b.items.reduce((p, x) => p * blockReliability(x, t), 1);
    case 'parallel':
      return 1 - b.items.reduce((p, x) => p * (1 - blockReliability(x, t)), 1);
    case 'kofn':
      return atLeastK(
        b.k,
        b.items.map((x) => blockReliability(x, t)),
      );
  }
}

const isTimed = (b: Block): boolean =>
  b.kind === 'exp' ||
  b.kind === 'weibull' ||
  ((b.kind === 'series' || b.kind === 'parallel' || b.kind === 'kofn') && b.items.every(isTimed));
const hasTimed = (b: Block): boolean =>
  b.kind === 'exp' ||
  b.kind === 'weibull' ||
  ((b.kind === 'series' || b.kind === 'parallel' || b.kind === 'kofn') && b.items.some(hasTimed));

/** The diagram as a formula in LaTeX with its numbers, for the steps. */
export function diagramTex(b: Block, t?: number): string {
  switch (b.kind) {
    case 'fixed':
      return fmtTex(b.r);
    case 'exp':
      return t === undefined ? `e^{-${fmtTex(b.lambda)}t}` : fmtTex(blockReliability(b, t));
    case 'weibull':
      return t === undefined ? `e^{-(t/${fmtTex(b.eta)})^{${fmtTex(b.beta)}}}` : fmtTex(blockReliability(b, t));
    case 'series':
      return b.items
        .map((x) =>
          x.kind === 'fixed' || x.kind === 'series' ? diagramTex(x, t) : `\\left(${diagramTex(x, t)}\\right)`,
        )
        .join(' \\cdot ');
    case 'parallel':
      return `1 - ${b.items.map((x) => `\\left(1 - ${diagramTex(x, t)}\\right)`).join('')}`;
    case 'kofn':
      return `R_{${b.k}\\text{ of }${b.items.length}}\\left(${b.items.map((x) => diagramTex(x, t)).join(',\\ ')}\\right)`;
  }
}

export interface SystemResult {
  readonly reliability: number;
  readonly timed: boolean;
  /** Mean time to failure, when every component has a life distribution. */
  readonly mttf?: number;
  readonly curve?: { readonly t: readonly number[]; readonly r: readonly number[]; readonly h: readonly number[] };
  readonly steps: readonly Step[];
}

/** System reliability at time t, with MTTF and an R(t) curve when the components have life distributions. */
export function systemReliability(text: string, t = 0): SystemResult {
  if (!(t >= 0) || !Number.isFinite(t)) throw new ControlError('badTime');
  const b = readDiagram(text);
  const reliability = blockReliability(b, t);
  const steps: Step[] = [
    step(
      'rel.rules',
      {},
      'R_s = \\prod R_i,\\quad R_p = 1 - \\prod (1 - R_i),\\quad R_{k/n} = \\sum_{j \\ge k} P(j \\text{ work})',
    ),
  ];
  steps.push(
    step(
      'rel.system',
      { r: fmt(reliability) },
      `R = ${diagramTex(b, hasTimed(b) ? t : undefined)} = ${fmtTex(reliability)}`,
    ),
  );
  const timed = isTimed(b);
  if (!hasTimed(b)) return { reliability, timed: false, steps };
  let mttf: number | undefined;
  if (timed) {
    // Scale the substitution by the median life so the integrand has its width near t = 1/2.
    let half = 1e-9;
    for (let i = 0; i < 2000 && blockReliability(b, half) > 0.5; i += 1) half *= 1.2;
    mttf = integrateToInfinity((x) => blockReliability(b, x), 0, 1e-12, half);
    steps.push(step('rel.mttf', { mttf: fmt(mttf) }, `\\text{MTTF} = \\int_0^\\infty R(t)\\,dt = ${fmtTex(mttf)}`));
  }
  // The curve runs until R falls below 1% (or 4 MTTF).
  let end = mttf ? 4 * mttf : Math.max(1, t * 3);
  if (timed) {
    let hi = Math.max(1e-9, mttf ?? 1);
    for (let i = 0; i < 200 && blockReliability(b, hi) > 0.01; i += 1) hi *= 1.5;
    end = hi;
  }
  const ts = linspace(0, end, 201);
  const rs = ts.map((x) => blockReliability(b, x));
  const hs = ts.map((x) => {
    const dt = Math.max(1e-9, end * 1e-6);
    const r = blockReliability(b, x);
    const dr = (blockReliability(b, x + dt) - blockReliability(b, Math.max(0, x - dt))) / (x > dt ? 2 * dt : x + dt);
    return r > 1e-12 ? -dr / r : Number.NaN;
  });
  return { reliability, timed, mttf, curve: { t: ts, r: rs, h: hs }, steps };
}

// ---------------------------------------------------------------------------------------------------------------
// Life distributions

export interface LifeResult {
  readonly r: number;
  readonly f: number;
  readonly pdf: number;
  readonly hazard: number;
  readonly mttf: number;
  /** Time by which 10% have failed. */
  readonly b10: number;
  /** R(t + x | survived to t), when a further time x is given. */
  readonly conditional?: number;
  readonly steps: readonly Step[];
}

export function lifeModel(input: {
  readonly model: 'exp' | 'weibull';
  readonly lambda?: number;
  readonly beta?: number;
  readonly eta?: number;
  readonly t: number;
  readonly extra?: number;
}): LifeResult {
  const { t } = input;
  if (!(t >= 0) || !Number.isFinite(t)) throw new ControlError('badTime');
  const steps: Step[] = [];
  let R: (x: number) => number;
  let h: number;
  let mttf: number;
  let b10: number;
  if (input.model === 'exp') {
    const lambda = input.lambda ?? Number.NaN;
    if (!(lambda > 0)) throw new ControlError('ratePositive');
    R = (x) => Math.exp(-lambda * x);
    h = lambda;
    mttf = 1 / lambda;
    b10 = -Math.log(0.9) / lambda;
    steps.push(
      step('rel.expModel', {}, `R(t) = e^{-\\lambda t} = e^{-${fmtTex(lambda)} \\cdot ${fmtTex(t)}} = ${fmtTex(R(t))}`),
    );
    steps.push(
      step('rel.expMttf', {}, `h(t) = \\lambda = ${fmtTex(lambda)},\\quad \\text{MTTF} = 1/\\lambda = ${fmtTex(mttf)}`),
    );
  } else {
    const beta = input.beta ?? Number.NaN;
    const eta = input.eta ?? Number.NaN;
    if (!(beta > 0) || !(eta > 0)) throw new ControlError('weibullPositive');
    R = (x) => (x <= 0 ? 1 : Math.exp(-((x / eta) ** beta)));
    h = t === 0 && beta < 1 ? Infinity : (beta / eta) * (t / eta) ** (beta - 1);
    mttf = eta * gammaFn(1 + 1 / beta);
    b10 = eta * (-Math.log(0.9)) ** (1 / beta);
    steps.push(
      step(
        'rel.weibullModel',
        {},
        `R(t) = e^{-(t/\\eta)^{\\beta}} = e^{-(${fmtTex(t)}/${fmtTex(eta)})^{${fmtTex(beta)}}} = ${fmtTex(R(t))}`,
      ),
    );
    steps.push(
      step(
        'rel.weibullHazard',
        {},
        `h(t) = \\frac{\\beta}{\\eta}\\left(\\frac{t}{\\eta}\\right)^{\\beta - 1}` +
          ` = ${fmtTex(h)},\\quad \\text{MTTF} = \\eta\\,\\Gamma(1 + 1/\\beta) = ${fmtTex(mttf)}`,
      ),
    );
    steps.push(step(beta < 1 ? 'rel.infant' : beta > 1 ? 'rel.wearOut' : 'rel.random'));
  }
  const r = R(t);
  let conditional: number | undefined;
  if (input.extra !== undefined) {
    if (!(input.extra >= 0)) throw new ControlError('badTime');
    conditional = r > 0 ? R(t + input.extra) / r : Number.NaN;
    steps.push(
      step(
        'rel.conditional',
        {},
        `R(${fmtTex(input.extra)} \\mid ${fmtTex(t)}) = \\frac{R(${fmtTex(t + input.extra)})}{R(${fmtTex(t)})}` +
          ` = ${fmtTex(conditional)}`,
      ),
    );
  }
  return { r, f: 1 - r, pdf: h * r, hazard: h, mttf, b10, conditional, steps };
}

export interface WeibullFit {
  readonly beta: number;
  readonly eta: number;
  readonly r2: number;
  readonly points: readonly { readonly t: number; readonly f: number; readonly x: number; readonly y: number }[];
  readonly steps: readonly Step[];
}

/** Fits a Weibull to complete failure times by median ranks (Bernard's approximation) and least squares. */
export function fitWeibull(times: readonly number[]): WeibullFit {
  if (times.length < 3) throw new ControlError('needThree');
  if (times.some((x) => !(x > 0))) throw new ControlError('timesPositive');
  const sorted = [...times].sort((a, b) => a - b);
  const n = sorted.length;
  const points = sorted.map((t, i) => {
    const f = (i + 1 - 0.3) / (n + 0.4);
    return { t, f, x: Math.log(t), y: Math.log(-Math.log(1 - f)) };
  });
  const mx = points.reduce((s, p) => s + p.x, 0) / n;
  const my = points.reduce((s, p) => s + p.y, 0) / n;
  const sxy = points.reduce((s, p) => s + (p.x - mx) * (p.y - my), 0);
  const sxx = points.reduce((s, p) => s + (p.x - mx) ** 2, 0);
  const syy = points.reduce((s, p) => s + (p.y - my) ** 2, 0);
  if (sxx === 0) throw new ControlError('timesDistinct');
  const beta = sxy / sxx;
  const intercept = my - beta * mx;
  const eta = Math.exp(-intercept / beta);
  const r2 = (sxy * sxy) / (sxx * syy);
  return {
    beta,
    eta,
    r2,
    points,
    steps: [
      step('rel.medianRanks', { n: String(n) }, 'F_i \\approx \\frac{i - 0.3}{n + 0.4}'),
      step('rel.linearize', {}, '\\ln(-\\ln(1 - F)) = \\beta \\ln t - \\beta \\ln \\eta'),
      step(
        'rel.fit',
        { beta: fmt(beta), eta: fmt(eta), r2: fmt(r2, 4) },
        `\\beta = ${fmtTex(beta)},\\quad \\eta = ${fmtTex(eta)}`,
      ),
    ],
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Control chart constants, computed from the normal distribution

const cache = new Map<number, { d2: number; d3: number }>();

/**
 * d2 = E[W] and d3 = SD[W] for the range W of n standard normal values:
 * E[W] = ∫ [1 − Φⁿ − (1 − Φ)ⁿ] dx and E[W²] = 2 ∫∫_{x<y} [1 − Φ(y)ⁿ − (1 − Φ(x))ⁿ + (Φ(y) − Φ(x))ⁿ] dx dy.
 */
export function rangeConstants(n: number): { d2: number; d3: number } {
  if (!Number.isInteger(n) || n < 2 || n > 50) throw new ControlError('subgroupRange');
  const hit = cache.get(n);
  if (hit) return hit;
  const L = 9;
  const d2 = integrate(
    (x) => {
      const p = normalCdf(x);
      return 1 - p ** n - (1 - p) ** n;
    },
    -L,
    L,
    1e-13,
  );
  const ew2 =
    2 *
    integrate(
      (y) => {
        const py = normalCdf(y);
        return integrate(
          (x) => {
            const px = normalCdf(x);
            return 1 - py ** n - (1 - px) ** n + (py - px) ** n;
          },
          -L,
          y,
          1e-11,
        );
      },
      -L,
      L,
      1e-10,
    );
  const out = { d2, d3: Math.sqrt(Math.max(0, ew2 - d2 * d2)) };
  cache.set(n, out);
  return out;
}

/** c4 = √(2/(n − 1)) Γ(n/2)/Γ((n − 1)/2): E[s] = c4 σ for samples of n normal values. */
export function c4(n: number): number {
  if (!Number.isInteger(n) || n < 2) throw new ControlError('subgroupRange');
  return Math.sqrt(2 / (n - 1)) * Math.exp(lnGamma(n / 2) - lnGamma((n - 1) / 2));
}

export interface ChartConstants {
  readonly n: number;
  readonly d2: number;
  readonly d3: number;
  readonly c4: number;
  readonly a2: number;
  readonly a3: number;
  readonly d3Lower: number;
  readonly d4Upper: number;
  readonly b3: number;
  readonly b4: number;
}

export function chartConstants(n: number): ChartConstants {
  const { d2, d3 } = rangeConstants(n);
  const c = c4(n);
  const sc = (3 * Math.sqrt(1 - c * c)) / c;
  return {
    n,
    d2,
    d3,
    c4: c,
    a2: 3 / (d2 * Math.sqrt(n)),
    a3: 3 / (c * Math.sqrt(n)),
    d3Lower: Math.max(0, 1 - (3 * d3) / d2),
    d4Upper: 1 + (3 * d3) / d2,
    b3: Math.max(0, 1 - sc),
    b4: 1 + sc,
  };
}

export interface ChartSeries {
  /** 'xbar', 'r', 's', 'p', 'c' */
  readonly id: 'xbar' | 'r' | 's' | 'p' | 'c';
  readonly values: readonly number[];
  readonly center: number;
  /** Per-point limits (they vary for a p chart with unequal sample sizes). */
  readonly ucl: readonly number[];
  readonly lcl: readonly number[];
  readonly out: readonly number[];
}

export interface ChartResult {
  readonly charts: readonly ChartSeries[];
  readonly constants?: ChartConstants;
  readonly steps: readonly Step[];
}

const flagOut = (values: readonly number[], ucl: readonly number[], lcl: readonly number[]) =>
  values.map((v, i) => (v > ucl[i] + 1e-12 || v < lcl[i] - 1e-12 ? i : -1)).filter((i) => i >= 0);

/** x̄–R or x̄–s charts from subgroups of equal size (rows of the matrix). */
export function variablesChart(subgroups: readonly (readonly number[])[], kind: 'r' | 's'): ChartResult {
  if (subgroups.length < 2) throw new ControlError('needSubgroups');
  const n = subgroups[0].length;
  if (subgroups.some((g) => g.length !== n)) throw new ControlError('subgroupEqual');
  const k = chartConstants(n);
  const means = subgroups.map((g) => g.reduce((s, x) => s + x, 0) / n);
  const grand = means.reduce((s, x) => s + x, 0) / means.length;
  const m = means.length;
  const steps: Step[] = [
    step(
      'chart.constants',
      { n: String(n), d2: fmt(k.d2, 5), d3: fmt(k.d3, 5), c4: fmt(k.c4, 5) },
      `d_2 = \\int_{-\\infty}^{\\infty} \\left[1 - \\Phi^n - (1 - \\Phi)^n\\right] dx` +
        ` = ${fmtTex(k.d2, 5)},\\quad c_4 = \\sqrt{\\tfrac{2}{n-1}}\\,\\frac{\\Gamma(n/2)}{\\Gamma((n-1)/2)}` +
        ` = ${fmtTex(k.c4, 5)}`,
    ),
  ];
  if (kind === 'r') {
    const ranges = subgroups.map((g) => Math.max(...g) - Math.min(...g));
    const rbar = ranges.reduce((s, x) => s + x, 0) / m;
    const xu = grand + k.a2 * rbar;
    const xl = grand - k.a2 * rbar;
    steps.push(
      step(
        'chart.xbarR',
        {},
        `\\bar{\\bar{x}} \\pm A_2 \\bar{R} = ${fmtTex(grand)} \\pm ${fmtTex(k.a2, 5)} \\cdot ${fmtTex(rbar)}`,
      ),
    );
    steps.push(
      step(
        'chart.rLimits',
        {},
        `D_3 \\bar{R} = ${fmtTex(k.d3Lower * rbar)},\\quad D_4 \\bar{R} = ${fmtTex(k.d4Upper * rbar)}`,
      ),
    );
    const fill = (v: number) => new Array<number>(m).fill(v);
    const charts: ChartSeries[] = [
      {
        id: 'xbar',
        values: means,
        center: grand,
        ucl: fill(xu),
        lcl: fill(xl),
        out: flagOut(means, fill(xu), fill(xl)),
      },
      {
        id: 'r',
        values: ranges,
        center: rbar,
        ucl: fill(k.d4Upper * rbar),
        lcl: fill(k.d3Lower * rbar),
        out: flagOut(ranges, fill(k.d4Upper * rbar), fill(k.d3Lower * rbar)),
      },
    ];
    return { charts, constants: k, steps: [...steps, outStep(charts)] };
  }
  const sds = subgroups.map((g, i) => Math.sqrt(g.reduce((s, x) => s + (x - means[i]) ** 2, 0) / (n - 1)));
  const sbar = sds.reduce((s, x) => s + x, 0) / m;
  const fill = (v: number) => new Array<number>(m).fill(v);
  steps.push(
    step(
      'chart.xbarS',
      {},
      `\\bar{\\bar{x}} \\pm A_3 \\bar{s} = ${fmtTex(grand)} \\pm ${fmtTex(k.a3, 5)} \\cdot ${fmtTex(sbar)}`,
    ),
  );
  steps.push(
    step('chart.sLimits', {}, `B_3 \\bar{s} = ${fmtTex(k.b3 * sbar)},\\quad B_4 \\bar{s} = ${fmtTex(k.b4 * sbar)}`),
  );
  const charts: ChartSeries[] = [
    {
      id: 'xbar',
      values: means,
      center: grand,
      ucl: fill(grand + k.a3 * sbar),
      lcl: fill(grand - k.a3 * sbar),
      out: flagOut(means, fill(grand + k.a3 * sbar), fill(grand - k.a3 * sbar)),
    },
    {
      id: 's',
      values: sds,
      center: sbar,
      ucl: fill(k.b4 * sbar),
      lcl: fill(k.b3 * sbar),
      out: flagOut(sds, fill(k.b4 * sbar), fill(k.b3 * sbar)),
    },
  ];
  return { charts, constants: k, steps: [...steps, outStep(charts)] };
}

function outStep(charts: readonly ChartSeries[]): Step {
  const count = charts.reduce((s, c) => s + c.out.length, 0);
  return count
    ? step('chart.outOfControl', {
        points: charts
          .flatMap((c) => c.out.map((i) => String(i + 1)))
          .filter((v, i, a) => a.indexOf(v) === i)
          .join(', '),
      })
    : step('chart.inControl');
}

/** p chart from defectives and sample sizes (limits per sample when sizes differ). */
export function pChart(defectives: readonly number[], sizes: readonly number[]): ChartResult {
  if (defectives.length < 2) throw new ControlError('needSubgroups');
  if (sizes.length !== defectives.length) throw new ControlError('sizesLength');
  defectives.forEach((d, i) => {
    if (!(sizes[i] >= 1) || !Number.isInteger(sizes[i])) throw new ControlError('sizesWhole');
    if (!(d >= 0) || d > sizes[i] || !Number.isInteger(d)) throw new ControlError('defectivesRange');
  });
  const pbar = defectives.reduce((s, x) => s + x, 0) / sizes.reduce((s, x) => s + x, 0);
  const values = defectives.map((d, i) => d / sizes[i]);
  const half = sizes.map((n) => 3 * Math.sqrt((pbar * (1 - pbar)) / n));
  const ucl = half.map((h) => Math.min(1, pbar + h));
  const lcl = half.map((h) => Math.max(0, pbar - h));
  const charts: ChartSeries[] = [{ id: 'p', values, center: pbar, ucl, lcl, out: flagOut(values, ucl, lcl) }];
  return {
    charts,
    steps: [
      step(
        'chart.pLimits',
        {},
        `\\bar{p} \\pm 3\\sqrt{\\frac{\\bar{p}(1-\\bar{p})}{n_i}},\\quad \\bar{p} = ${fmtTex(pbar)}`,
      ),
      outStep(charts),
    ],
  };
}

/** c chart from defect counts per unit. */
export function cChart(counts: readonly number[]): ChartResult {
  if (counts.length < 2) throw new ControlError('needSubgroups');
  if (counts.some((c) => !(c >= 0))) throw new ControlError('countsPositive');
  const cbar = counts.reduce((s, x) => s + x, 0) / counts.length;
  const fill = (v: number) => new Array<number>(counts.length).fill(v);
  const u = cbar + 3 * Math.sqrt(cbar);
  const l = Math.max(0, cbar - 3 * Math.sqrt(cbar));
  const charts: ChartSeries[] = [
    { id: 'c', values: [...counts], center: cbar, ucl: fill(u), lcl: fill(l), out: flagOut(counts, fill(u), fill(l)) },
  ];
  return {
    charts,
    steps: [
      step(
        'chart.cLimits',
        {},
        `\\bar{c} \\pm 3\\sqrt{\\bar{c}} = ${fmtTex(cbar)} \\pm ${fmtTex(3 * Math.sqrt(cbar))}`,
      ),
      outStep(charts),
    ],
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Capability, sampling, inventory

export interface Capability {
  readonly cp: number;
  readonly cpk: number;
  readonly cpu: number;
  readonly cpl: number;
  /** Expected fraction outside the limits for a normal process. */
  readonly fractionOut: number;
  readonly steps: readonly Step[];
}

export function capability(input: {
  readonly usl: number;
  readonly lsl: number;
  readonly mean: number;
  readonly sigma: number;
}): Capability {
  const { usl, lsl, mean, sigma } = input;
  if (![usl, lsl, mean, sigma].every(Number.isFinite)) throw new ControlError('numbersNeeded');
  if (!(usl > lsl)) throw new ControlError('specOrder');
  if (!(sigma > 0)) throw new ControlError('sdPositive');
  const cp = (usl - lsl) / (6 * sigma);
  const cpu = (usl - mean) / (3 * sigma);
  const cpl = (mean - lsl) / (3 * sigma);
  const cpk = Math.min(cpu, cpl);
  const fractionOut = normalCdf((lsl - mean) / sigma) + (1 - normalCdf((usl - mean) / sigma));
  return {
    cp,
    cpk,
    cpu,
    cpl,
    fractionOut,
    steps: [
      step(
        'cap.cp',
        {},
        `C_p = \\frac{USL - LSL}{6\\sigma} = \\frac{${fmtTex(usl)} - ${fmtTex(lsl)}}{6 \\cdot ${fmtTex(sigma)}}` +
          ` = ${fmtTex(cp)}`,
      ),
      step(
        'cap.cpk',
        {},
        `C_{pk} = \\min\\left(\\frac{USL - \\mu}{3\\sigma}, \\frac{\\mu - LSL}{3\\sigma}\\right)` +
          ` = \\min(${fmtTex(cpu)}, ${fmtTex(cpl)}) = ${fmtTex(cpk)}`,
      ),
      step('cap.fraction', { ppm: fmt(fractionOut * 1e6, 4) }),
    ],
  };
}

export interface OcResult {
  readonly pa: number;
  readonly aoq: number;
  readonly curve: { readonly p: readonly number[]; readonly pa: readonly number[]; readonly aoq: readonly number[] };
  readonly aoql: number;
  readonly steps: readonly Step[];
}

/** Single sampling plan (n, c): P(accept) = P(X ≤ c) for X ~ Bin(n, p); AOQ with rectifying inspection. */
export function operatingCharacteristic(input: {
  readonly n: number;
  readonly c: number;
  readonly p: number;
  readonly lot?: number;
}): OcResult {
  const { n, c, p } = input;
  if (!Number.isInteger(n) || n < 1) throw new ControlError('nWhole');
  if (!Number.isInteger(c) || c < 0 || c > n) throw new ControlError('acceptRange');
  if (!(p >= 0 && p <= 1)) throw new ControlError('probabilityRange');
  const lot = input.lot;
  if (lot !== undefined && (!Number.isInteger(lot) || lot < n)) throw new ControlError('lotSize');
  const factor = lot ? (lot - n) / lot : 1;
  const pa = binomialCdf(c, n, p);
  const pmax = Math.min(1, Math.max(5 * (c + 1), 10) / n);
  const ps = linspace(0, pmax, 121);
  const pas = ps.map((x) => binomialCdf(c, n, x));
  const aoqs = ps.map((x, i) => pas[i] * x * factor);
  const terms = Array.from(
    { length: c + 1 },
    (_, d) => `\\binom{${n}}{${d}} ${fmtTex(p)}^{${d}} (${fmtTex(1 - p)})^{${n - d}}`,
  ).slice(0, 4);
  return {
    pa,
    aoq: pa * p * factor,
    curve: { p: ps, pa: pas, aoq: aoqs },
    aoql: Math.max(...aoqs),
    steps: [
      step(
        'oc.pa',
        { n: String(n), c: String(c) },
        `P_a = \\sum_{d=0}^{${c}} \\binom{n}{d} p^d (1-p)^{n-d}` +
          ` = ${terms.join(' + ')}${c > 3 ? ' + \\cdots' : ''} = ${fmtTex(pa)}`,
      ),
      step('oc.aoq', { aoq: fmt(pa * p * factor) }),
    ],
  };
}

export interface InventoryResult {
  readonly eoq: number;
  readonly orders: number;
  readonly cycle: number;
  readonly annualCost: number;
  readonly safetyStock?: number;
  readonly reorderPoint?: number;
  readonly z?: number;
  readonly steps: readonly Step[];
}

/**
 * EOQ = √(2DS/H). With a service level, daily demand mean, and standard deviation and a lead time in days:
 * safety stock = z σ_d √L and reorder point = d̄ L + safety stock.
 */
export function inventory(input: {
  readonly demand: number;
  readonly orderCost: number;
  readonly holdingCost: number;
  readonly service?: number;
  readonly dailyMean?: number;
  readonly dailySd?: number;
  readonly leadDays?: number;
}): InventoryResult {
  const { demand: D, orderCost: S, holdingCost: H } = input;
  if (!(D > 0) || !(S > 0) || !(H > 0)) throw new ControlError('inventoryPositive');
  const eoq = Math.sqrt((2 * D * S) / H);
  const orders = D / eoq;
  const annualCost = (D / eoq) * S + (H * eoq) / 2;
  const steps: Step[] = [
    step(
      'inv.eoq',
      {},
      `Q^* = \\sqrt{\\frac{2DS}{H}} = \\sqrt{\\frac{2 \\cdot ${fmtTex(D)} \\cdot ${fmtTex(S)}}{${fmtTex(H)}}}` +
        ` = ${fmtTex(eoq)}`,
    ),
    step('inv.cost', {}, `TC = \\frac{D}{Q}S + \\frac{Q}{2}H = ${fmtTex(annualCost)}`),
  ];
  let safetyStock: number | undefined;
  let reorderPoint: number | undefined;
  let z: number | undefined;
  if (input.service !== undefined && input.dailySd !== undefined && input.leadDays !== undefined) {
    if (!(input.service > 0 && input.service < 1)) throw new ControlError('serviceRange');
    if (!(input.dailySd >= 0) || !(input.leadDays >= 0)) throw new ControlError('inventoryPositive');
    z = normalQuantile(input.service);
    safetyStock = z * input.dailySd * Math.sqrt(input.leadDays);
    reorderPoint = (input.dailyMean ?? 0) * input.leadDays + safetyStock;
    steps.push(
      step(
        'inv.safety',
        {},
        `SS = z\\,\\sigma_d \\sqrt{L}` +
          ` = ${fmtTex(z)} \\cdot ${fmtTex(input.dailySd)} \\cdot \\sqrt{${fmtTex(input.leadDays)}}` +
          ` = ${fmtTex(safetyStock)}`,
      ),
    );
    steps.push(
      step(
        'inv.reorder',
        {},
        `ROP = \\bar{d} L + SS` +
          ` = ${fmtTex(input.dailyMean ?? 0)} \\cdot ${fmtTex(input.leadDays)} + ${fmtTex(safetyStock)}` +
          ` = ${fmtTex(reorderPoint)}`,
      ),
    );
  }
  return { eoq, orders, cycle: 1 / orders, annualCost, safetyStock, reorderPoint, z, steps };
}
