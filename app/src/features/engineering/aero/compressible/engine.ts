// Compressible flow relations as a calculator: pick a family, give gamma and one known value, and get every ratio of
// the family. Inverses run Brent's method on the branch the student picks. For an oblique shock, that is the weak or
// the strong solution.
import {
  eq,
  AeroError,
  DEG,
  brent,
  checkGamma,
  finite,
  num,
  sample,
  step,
  tex,
  type AeroStep,
  type XY,
} from '../common';
import {
  M_MAX,
  M_MIN,
  areaRatio,
  betaOf,
  fanno,
  isentropicP,
  isentropicRho,
  isentropicT,
  machAngle,
  normalShock,
  nuMax,
  prandtlMeyer,
  rayleigh,
  thetaMax,
  thetaOf,
  type Branch,
} from './relations';

export type Family = 'isentropic' | 'normal' | 'oblique' | 'expansion' | 'fanno' | 'rayleigh';

export type RowId =
  | 'M'
  | 'TT0'
  | 'pp0'
  | 'rhorho0'
  | 'AA'
  | 'mu'
  | 'nu'
  | 'M1'
  | 'M2'
  | 'p2p1'
  | 'rho2rho1'
  | 'T2T1'
  | 'p02p01'
  | 'p02p1'
  | 'beta'
  | 'theta'
  | 'M1n'
  | 'M2n'
  | 'thetaMax'
  | 'betaMax'
  | 'fLD'
  | 'TTs'
  | 'pps'
  | 'rhorhos'
  | 'p0p0s'
  | 'T0T0s';

/** LaTeX symbol of each row; the names are in the strings. */
export const SYMBOL: Readonly<Record<RowId, string>> = {
  M: 'M',
  TT0: 'T/T_0',
  pp0: 'p/p_0',
  rhorho0: '\\rho/\\rho_0',
  AA: 'A/A^*',
  mu: '\\mu',
  nu: '\\nu',
  M1: 'M_1',
  M2: 'M_2',
  p2p1: 'p_2/p_1',
  rho2rho1: '\\rho_2/\\rho_1',
  T2T1: 'T_2/T_1',
  p02p01: 'p_{02}/p_{01}',
  p02p1: 'p_{02}/p_1',
  beta: '\\beta',
  theta: '\\theta',
  M1n: 'M_{1n}',
  M2n: 'M_{2n}',
  thetaMax: '\\theta_{max}',
  betaMax: '\\beta_{\\theta max}',
  fLD: '4fL^*/D',
  TTs: 'T/T^*',
  pps: 'p/p^*',
  rhorhos: '\\rho/\\rho^*',
  p0p0s: 'p_0/p_0^*',
  T0T0s: 'T_0/T_0^*',
};

/** Rows that are angles, shown in degrees. */
export const ANGLES: ReadonlySet<RowId> = new Set<RowId>(['mu', 'nu', 'beta', 'theta', 'thetaMax', 'betaMax']);

/** The values each family can start from. Oblique shocks also need M1. */
export const KNOWNS: Readonly<Record<Family, readonly RowId[]>> = {
  isentropic: ['M', 'TT0', 'pp0', 'rhorho0', 'AA', 'mu'],
  normal: ['M1', 'M2', 'p2p1', 'rho2rho1', 'T2T1', 'p02p01'],
  oblique: ['theta', 'beta'],
  expansion: ['M', 'nu', 'mu'],
  fanno: ['M', 'fLD', 'TTs', 'pps', 'p0p0s'],
  rayleigh: ['M', 'T0T0s', 'pps', 'p0p0s'],
};

/** Knowns with two Mach numbers for one value, so the student picks the branch. */
export function needsBranch(family: Family, known: RowId): boolean {
  if (family === 'isentropic') return known === 'AA';
  if (family === 'fanno' || family === 'rayleigh') return known !== 'M';
  return false;
}

export interface CompressibleInput {
  readonly family: Family;
  readonly gamma: number;
  readonly known: RowId;
  /** The known value; angles in degrees. */
  readonly value: number;
  readonly branch?: Branch;
  /** Oblique shock: the upstream Mach number, and whether to take the strong solution. */
  readonly M1?: number;
  readonly strong?: boolean;
}

export interface Row {
  readonly id: RowId;
  /** Angles are in degrees. */
  readonly value: number;
}

export interface Series {
  readonly id: RowId;
  readonly points: readonly XY[];
}

export interface CompressiblePlot {
  /** x is the Mach number (or wave angle in degrees for oblique shocks). */
  readonly x: 'M' | 'M1' | 'beta';
  readonly series: readonly Series[];
  readonly marks: readonly XY[];
}

export interface CompressibleResult {
  readonly family: Family;
  readonly rows: readonly Row[];
  readonly steps: readonly AeroStep[];
  readonly plot: CompressiblePlot;
}

type Fn = (M: number) => number;

const deg = (rad: number) => rad / DEG;

/** Forward functions of M for each invertible known, and the Mach interval of each branch. */
function forward(family: Family, known: RowId, g: number): Fn | null {
  switch (family) {
    case 'isentropic':
      return (
        (
          {
            TT0: (M: number) => isentropicT(M, g),
            pp0: (M: number) => isentropicP(M, g),
            rhorho0: (M: number) => isentropicRho(M, g),
            AA: (M: number) => areaRatio(M, g),
            mu: (M: number) => deg(machAngle(M)),
          } as Partial<Record<RowId, Fn>>
        )[known] ?? null
      );
    case 'normal': {
      const pick: Partial<Record<RowId, (s: ReturnType<typeof normalShock>) => number>> = {
        M2: (s) => s.M2,
        p2p1: (s) => s.p2p1,
        rho2rho1: (s) => s.rho2rho1,
        T2T1: (s) => s.T2T1,
        p02p01: (s) => s.p02p01,
      };
      const f = pick[known];
      return f ? (M) => f(normalShock(M, g)) : null;
    }
    case 'expansion':
      return (
        (
          { nu: (M: number) => deg(prandtlMeyer(M, g)), mu: (M: number) => deg(machAngle(M)) } as Partial<
            Record<RowId, Fn>
          >
        )[known] ?? null
      );
    case 'fanno': {
      const pick: Partial<Record<RowId, (s: ReturnType<typeof fanno>) => number>> = {
        fLD: (s) => s.fLD,
        TTs: (s) => s.TT,
        pps: (s) => s.pp,
        p0p0s: (s) => s.p0p0,
      };
      const f = pick[known];
      return f ? (M) => f(fanno(M, g)) : null;
    }
    case 'rayleigh': {
      const pick: Partial<Record<RowId, (s: ReturnType<typeof rayleigh>) => number>> = {
        T0T0s: (s) => s.T0T0,
        pps: (s) => s.pp,
        p0p0s: (s) => s.p0p0,
      };
      const f = pick[known];
      return f ? (M) => f(rayleigh(M, g)) : null;
    }
    default:
      return null;
  }
}

function interval(family: Family, known: RowId, branch: Branch): [number, number] {
  if (family === 'normal' || family === 'expansion') return [1, M_MAX];
  if (family === 'isentropic' && known !== 'AA') return known === 'mu' ? [1, M_MAX] : [M_MIN, M_MAX];
  return branch === 'subsonic' ? [M_MIN, 1] : [1, M_MAX];
}

/** Mach number from the known value: the value itself, or Brent's method on the branch. */
function machFrom(input: CompressibleInput, g: number, steps: AeroStep[]): number {
  const { family, known, value } = input;
  if (known === 'M' || known === 'M1') {
    if (value <= 0) throw new AeroError('notPositive', { name: SYMBOL[known] });
    if (family === 'normal' && value < 1) throw new AeroError('shockSubsonic');
    if (family === 'expansion' && value < 1) throw new AeroError('expansionSubsonic');
    if (value > M_MAX) throw new AeroError('machTooLarge', { max: num(M_MAX) });
    return value;
  }
  const f = forward(family, known, g);
  if (!f) throw new AeroError('unknownInput');
  const branch = input.branch ?? 'subsonic';
  const [lo, hi] = interval(family, known, branch);
  const a = f(lo);
  const b = f(hi);
  const min = Math.min(a, b);
  const max = Math.max(a, b);
  if (Math.abs(value - a) <= 1e-12 * Math.max(1, Math.abs(a))) return lo;
  if (Math.abs(value - b) <= 1e-12 * Math.max(1, Math.abs(b))) return hi;
  if (!(value > min && value < max)) {
    throw new AeroError('valueRange', { name: SYMBOL[known], lo: num(min), hi: num(max), branch: `@branch.${branch}` });
  }
  const found = brentOn(f, value, lo, hi);
  steps.push(
    step('cfInverse', `${SYMBOL[known]}(M) = ${tex(value, 6)}`, {
      branch: `@branch.${branch}`,
      lo: num(lo),
      hi: num(hi),
      iterations: String(found.iterations),
      M: num(found.root, 6),
    }),
  );
  return found.root;
}

function brentOn(f: Fn, value: number, lo: number, hi: number) {
  // Search in log M on wide brackets, so the iteration count stays small near M = 0 and at high Mach numbers.
  const g = (x: number) => f(Math.exp(x)) - value;
  const r = brentLog(g, Math.log(lo), Math.log(hi));
  return { root: Math.exp(r.root), iterations: r.iterations };
}

const brentLog = (g: (x: number) => number, a: number, b: number) => brent(g, a, b, 1e-14);

export function compressible(input: CompressibleInput): CompressibleResult {
  const g = checkGamma(input.gamma);
  finite(input.value, SYMBOL[input.known] ?? 'value');
  if (!KNOWNS[input.family].includes(input.known) && !(input.family === 'isentropic' && input.known === 'M'))
    throw new AeroError('unknownInput');
  const steps: AeroStep[] = [];
  if (input.family === 'oblique') return oblique(input, g, steps);
  const M = machFrom(input, g, steps);
  switch (input.family) {
    case 'isentropic':
      return isentropic(M, g, steps);
    case 'normal':
      return normal(M, g, steps);
    case 'expansion':
      return expansion(M, g, steps);
    case 'fanno':
      return fannoFlow(M, g, steps);
    default:
      return rayleighFlow(M, g, steps);
  }
}

const G = (g: number) => tex(g, 4);

function isentropic(M: number, g: number, steps: AeroStep[]): CompressibleResult {
  const k = 1 + ((g - 1) / 2) * M * M;
  steps.push(
    step(
      'cfIsenT',
      eq(
        '\\frac{T}{T_0}',
        '\\left(1 + \\frac{\\gamma - 1}{2} M^2\\right)^{-1}',
        `\\left(1 + \\frac{${G(g)} - 1}{2} \\times ${tex(M, 6)}^2\\right)^{-1}`,
        `${tex(1 / k, 6)}`,
      ),
    ),
  );
  steps.push(
    step(
      'cfIsenP',
      eq(
        '\\frac{p}{p_0}',
        '\\left(\\frac{T}{T_0}\\right)^{\\gamma/(\\gamma - 1)}',
        `${tex(1 / k, 6)}^{${tex(g / (g - 1), 5)}}`,
        `${tex(isentropicP(M, g), 6)}`,
      ),
    ),
  );
  steps.push(
    step(
      'cfIsenRho',
      `\\frac{\\rho}{\\rho_0} = \\left(\\frac{T}{T_0}\\right)^{1/(\\gamma - 1)} = ${tex(isentropicRho(M, g), 6)}`,
    ),
  );
  steps.push(
    step(
      'cfIsenA',
      eq(
        '\\frac{A}{A^*}',
        '\\frac{1}{M}\\left[\\frac{2}{\\gamma + 1}\\left(1 + \\frac{\\gamma - 1}{2} M^2\\right)\\right]' +
          '^{\\frac{\\gamma + 1}{2(\\gamma - 1)}}',
        `${tex(areaRatio(M, g), 6)}`,
      ),
    ),
  );
  const rows: Row[] = [
    { id: 'M', value: M },
    { id: 'TT0', value: 1 / k },
    { id: 'pp0', value: isentropicP(M, g) },
    { id: 'rhorho0', value: isentropicRho(M, g) },
    { id: 'AA', value: areaRatio(M, g) },
  ];
  if (M >= 1) {
    rows.push({ id: 'mu', value: deg(machAngle(M)) }, { id: 'nu', value: deg(prandtlMeyer(M, g)) });
    steps.push(step('cfMachAngle', `\\mu = \\sin^{-1}(1/M) = ${tex(deg(machAngle(M)), 6)}^\\circ`));
  }
  const top = Math.max(3, Math.min(1.5 * M, 10));
  return {
    family: 'isentropic',
    rows,
    steps,
    plot: {
      x: 'M',
      series: [
        { id: 'TT0', points: sample((m) => isentropicT(m, g), 0, top) },
        { id: 'pp0', points: sample((m) => isentropicP(m, g), 0, top) },
        { id: 'rhorho0', points: sample((m) => isentropicRho(m, g), 0, top) },
        {
          id: 'AA',
          points: sample((m) => (m > 0.05 ? areaRatio(m, g) : NaN), 0, top).map((p) => ({
            x: p.x,
            y: p.y > 6 ? NaN : p.y,
          })),
        },
      ],
      marks: [{ x: M, y: isentropicP(M, g) }],
    },
  };
}

function normal(M1: number, g: number, steps: AeroStep[]): CompressibleResult {
  const s = normalShock(M1, g);
  const m = tex(M1, 6);
  steps.push(
    step(
      'cfNormalM2',
      eq(
        'M_2^2',
        '\\frac{1 + \\frac{\\gamma - 1}{2} M_1^2}{\\gamma M_1^2 - \\frac{\\gamma - 1}{2}}',
        `\\frac{1 + \\frac{${G(g)} - 1}{2} \\times ${m}^2}{${G(g)} \\times ${m}^2 - \\frac{${G(g)} - 1}{2}} \\Rightarrow M_2`,
        `${tex(s.M2, 6)}`,
      ),
    ),
  );
  steps.push(
    step('cfNormalP', eq('\\frac{p_2}{p_1}', '1 + \\frac{2\\gamma}{\\gamma + 1}(M_1^2 - 1)', `${tex(s.p2p1, 6)}`)),
  );
  steps.push(
    step(
      'cfNormalRho',
      eq(
        '\\frac{\\rho_2}{\\rho_1}',
        '\\frac{(\\gamma + 1) M_1^2}{(\\gamma - 1) M_1^2 + 2}',
        `${tex(s.rho2rho1, 6)}, \\quad \\frac{T_2}{T_1}`,
        '\\frac{p_2/p_1}{\\rho_2/\\rho_1}',
        `${tex(s.T2T1, 6)}`,
      ),
    ),
  );
  steps.push(
    step(
      'cfNormalP0',
      eq(
        '\\frac{p_{02}}{p_{01}}',
        '\\left(\\frac{\\rho_2}{\\rho_1}\\right)^{\\gamma/(\\gamma - 1)} \\left(\\frac{p_2}{p_1}\\right)^{-1/(\\gamma - 1)}',
        `${tex(s.p02p01, 6)}`,
      ),
    ),
  );
  const top = Math.max(3, Math.min(1.5 * M1, 10));
  return {
    family: 'normal',
    rows: [
      { id: 'M1', value: M1 },
      { id: 'M2', value: s.M2 },
      { id: 'p2p1', value: s.p2p1 },
      { id: 'rho2rho1', value: s.rho2rho1 },
      { id: 'T2T1', value: s.T2T1 },
      { id: 'p02p01', value: s.p02p01 },
      { id: 'p02p1', value: s.p02p1 },
    ],
    steps,
    plot: {
      x: 'M1',
      series: [
        { id: 'M2', points: sample((m) => normalShock(m, g).M2, 1, top) },
        { id: 'p02p01', points: sample((m) => normalShock(m, g).p02p01, 1, top) },
      ],
      marks: [{ x: M1, y: s.p02p01 }],
    },
  };
}

function oblique(input: CompressibleInput, g: number, steps: AeroStep[]): CompressibleResult {
  const M1 = finite(input.M1 ?? NaN, 'M₁');
  if (M1 <= 1) throw new AeroError('obliqueSubsonic');
  if (M1 > M_MAX) throw new AeroError('machTooLarge', { max: num(M_MAX) });
  const max = thetaMax(M1, g);
  const mu = machAngle(M1);
  let beta: number;
  let theta: number;
  if (input.known === 'beta') {
    beta = input.value * DEG;
    if (beta < mu - 1e-12 || beta > Math.PI / 2 + 1e-12)
      throw new AeroError('betaRange', { lo: num(deg(mu)), hi: '90' });
    theta = Math.max(0, thetaOf(beta, M1, g));
  } else {
    theta = input.value * DEG;
    if (theta < 0) throw new AeroError('notNegative', { name: 'θ' });
    const found = betaOf(theta, M1, g, input.strong === true);
    beta = found.root;
    steps.push(
      step(
        'cfObliqueSolve',
        `\\tan\\theta = 2\\cot\\beta\\,\\frac{M_1^2 \\sin^2\\beta - 1}{M_1^2(\\gamma + \\cos 2\\beta) + 2}`,
        {
          branch: input.strong ? '@branch.strong' : '@branch.weak',
          iterations: String(found.iterations),
        },
      ),
    );
  }
  steps.push(
    step(
      'cfThetaMax',
      `\\theta_{max} = ${tex(deg(max.theta), 5)}^\\circ \\text{ at } \\beta = ${tex(deg(max.beta), 5)}^\\circ`,
    ),
  );
  const M1n = M1 * Math.sin(beta);
  const s = normalShock(M1n, g);
  const M2 = s.M2 / Math.sin(beta - theta);
  steps.push(
    step(
      'cfObliqueNormal',
      `M_{1n} = M_1 \\sin\\beta = ${tex(M1, 6)} \\sin ${tex(deg(beta), 6)}^\\circ = ${tex(M1n, 6)}`,
    ),
  );
  steps.push(
    step(
      'cfObliqueM2',
      eq(
        'M_2',
        '\\frac{M_{2n}}{\\sin(\\beta - \\theta)}',
        `\\frac{${tex(s.M2, 6)}}{\\sin(${tex(deg(beta - theta), 6)}^\\circ)}`,
        `${tex(M2, 6)}`,
      ),
    ),
  );
  const curve = sample((b) => deg(Math.max(thetaOf(b * DEG, M1, g), 0)), deg(mu), 90, 180);
  return {
    family: 'oblique',
    rows: [
      { id: 'M1', value: M1 },
      { id: 'theta', value: deg(theta) },
      { id: 'beta', value: deg(beta) },
      { id: 'M1n', value: M1n },
      { id: 'M2n', value: s.M2 },
      { id: 'M2', value: M2 },
      { id: 'p2p1', value: s.p2p1 },
      { id: 'rho2rho1', value: s.rho2rho1 },
      { id: 'T2T1', value: s.T2T1 },
      { id: 'p02p01', value: s.p02p01 },
      { id: 'thetaMax', value: deg(max.theta) },
      { id: 'betaMax', value: deg(max.beta) },
    ],
    steps,
    plot: {
      x: 'beta',
      series: [{ id: 'theta', points: curve }],
      marks: [
        { x: deg(beta), y: deg(theta) },
        { x: deg(max.beta), y: deg(max.theta) },
      ],
    },
  };
}

function expansion(M: number, g: number, steps: AeroStep[]): CompressibleResult {
  const nu = deg(prandtlMeyer(M, g));
  steps.push(
    step(
      'cfPrandtlMeyer',
      eq(
        '\\nu(M)',
        '\\sqrt{\\frac{\\gamma + 1}{\\gamma - 1}} \\tan^{-1}\\sqrt{\\frac{\\gamma - 1}{\\gamma + 1}(M^2 - 1)} - \\tan^{-1}\\sqrt{M^2 - 1}',
        `${tex(nu, 6)}^\\circ`,
      ),
      { max: num(deg(nuMax(g)), 5) },
    ),
  );
  steps.push(step('cfMachAngle', `\\mu = \\sin^{-1}(1/M) = ${tex(deg(machAngle(M)), 6)}^\\circ`));
  const top = Math.max(4, Math.min(1.5 * M, 20));
  return {
    family: 'expansion',
    rows: [
      { id: 'M', value: M },
      { id: 'nu', value: nu },
      { id: 'mu', value: deg(machAngle(M)) },
      { id: 'TT0', value: isentropicT(M, g) },
      { id: 'pp0', value: isentropicP(M, g) },
    ],
    steps,
    plot: {
      x: 'M',
      series: [{ id: 'nu', points: sample((m) => deg(prandtlMeyer(m, g)), 1, top) }],
      marks: [{ x: M, y: nu }],
    },
  };
}

function fannoFlow(M: number, g: number, steps: AeroStep[]): CompressibleResult {
  const s = fanno(M, g);
  steps.push(
    step(
      'cfFanno',
      eq(
        '\\frac{4fL^*}{D}',
        '\\frac{1 - M^2}{\\gamma M^2} + \\frac{\\gamma + 1}{2\\gamma}\\ln\\frac{(\\gamma + 1)M^2}{2 + (\\gamma - 1)M^2}',
        `${tex(s.fLD, 6)}`,
      ),
    ),
  );
  steps.push(
    step(
      'cfFannoRatios',
      eq(
        '\\frac{T}{T^*}',
        '\\frac{\\gamma + 1}{2 + (\\gamma - 1)M^2}',
        `${tex(s.TT, 6)}, \\quad \\frac{p}{p^*}`,
        '\\frac{1}{M}\\sqrt{\\frac{T}{T^*}}',
        `${tex(s.pp, 6)}`,
      ),
    ),
  );
  steps.push(
    step(
      'cfFannoP0',
      eq(
        '\\frac{p_0}{p_0^*}',
        '\\frac{1}{M}\\left[\\frac{2 + (\\gamma - 1)M^2}{\\gamma + 1}\\right]^{\\frac{\\gamma + 1}{2(\\gamma - 1)}}',
        `${tex(s.p0p0, 6)}`,
      ),
    ),
  );
  return {
    family: 'fanno',
    rows: [
      { id: 'M', value: M },
      { id: 'fLD', value: s.fLD },
      { id: 'TTs', value: s.TT },
      { id: 'pps', value: s.pp },
      { id: 'rhorhos', value: s.rhorho },
      { id: 'p0p0s', value: s.p0p0 },
    ],
    steps,
    plot: {
      x: 'M',
      series: [
        {
          id: 'fLD',
          points: sample(
            (m) => (m > 0.15 ? Math.min(fanno(m, g).fLD, 10) : NaN),
            0,
            Math.max(3, Math.min(1.5 * M, 10)),
          ),
        },
      ],
      marks: [{ x: M, y: Math.min(s.fLD, 10) }],
    },
  };
}

function rayleighFlow(M: number, g: number, steps: AeroStep[]): CompressibleResult {
  const s = rayleigh(M, g);
  steps.push(
    step(
      'cfRayleighP',
      eq(
        '\\frac{p}{p^*}',
        '\\frac{1 + \\gamma}{1 + \\gamma M^2}',
        `${tex(s.pp, 6)}, \\quad \\frac{T}{T^*}`,
        'M^2\\left(\\frac{p}{p^*}\\right)^2',
        `${tex(s.TT, 6)}`,
      ),
    ),
  );
  steps.push(
    step(
      'cfRayleighT0',
      eq(
        '\\frac{T_0}{T_0^*}',
        '\\frac{2(\\gamma + 1)M^2\\left(1 + \\frac{\\gamma - 1}{2}M^2\\right)}{(1 + \\gamma M^2)^2}',
        `${tex(s.T0T0, 6)}`,
      ),
    ),
  );
  steps.push(
    step(
      'cfRayleighP0',
      eq(
        '\\frac{p_0}{p_0^*}',
        '\\frac{p}{p^*}\\left[\\frac{2 + (\\gamma - 1)M^2}{\\gamma + 1}\\right]^{\\gamma/(\\gamma - 1)}',
        `${tex(s.p0p0, 6)}`,
      ),
    ),
  );
  return {
    family: 'rayleigh',
    rows: [
      { id: 'M', value: M },
      { id: 'T0T0s', value: s.T0T0 },
      { id: 'TTs', value: s.TT },
      { id: 'pps', value: s.pp },
      { id: 'rhorhos', value: s.rhorho },
      { id: 'p0p0s', value: s.p0p0 },
    ],
    steps,
    plot: {
      x: 'M',
      series: [{ id: 'T0T0s', points: sample((m) => rayleigh(m, g).T0T0, 0, Math.max(3, Math.min(1.5 * M, 10))) }],
      marks: [{ x: M, y: s.T0T0 }],
    },
  };
}
