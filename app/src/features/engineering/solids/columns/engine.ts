// Columns and buckling. It gives the Euler critical load for an effective length, the slenderness with the
// Johnson parabola for intermediate columns, and the secant formula for an eccentric load. Brent's method finds the
// load that first yields the column. Everything is in base SI.
import { brent } from '../kit/numeric';
import { fail, positive, q, step, type KitStep } from '../kit/types';

/** End conditions and their theoretical effective-length factors. */
export const END_K = { pinned: 1, fixedFree: 2, fixedPinned: 0.7, fixedFixed: 0.5 } as const;

export interface ColumnInput {
  readonly E: number;
  readonly I: number;
  readonly L: number;
  readonly K: number;
  /** Cross-section area; with it come slenderness and stresses. */
  readonly A?: number;
  /** Yield strength; with it come the Johnson parabola and the regime. */
  readonly Sy?: number;
  /** Eccentricity and distance to the extreme fiber, with the applied load, for the secant formula. */
  readonly e?: number;
  readonly c?: number;
  readonly P?: number;
}

export interface ColumnResult {
  readonly Pcr: number;
  readonly Le: number;
  readonly r?: number;
  readonly slenderness?: number;
  readonly sigmaEuler?: number;
  readonly Cc?: number;
  readonly regime?: 'euler' | 'johnson';
  readonly sigmaCr?: number;
  readonly Pallow?: number;
  readonly sigmaMax?: number;
  readonly Pyield?: number;
  readonly steps: KitStep[];
}

const has = (value: number | undefined): value is number => value !== undefined && Number.isFinite(value);

/** The largest stress of an eccentrically loaded pinned-equivalent column (secant formula). */
export function secantStress(P: number, A: number, e: number, c: number, r: number, Le: number, E: number): number {
  const angle = (Le / (2 * r)) * Math.sqrt(P / (E * A));
  if (angle >= Math.PI / 2) return Infinity;
  return (P / A) * (1 + (e * c) / (r * r) / Math.cos(angle));
}

export function solveColumn(input: ColumnInput): ColumnResult {
  const E = positive(input.E, 'E');
  const I = positive(input.I, 'I');
  const L = positive(input.L, 'L');
  const K = positive(input.K, 'K');
  const Le = K * L;
  const Pcr = (Math.PI ** 2 * E * I) / Le ** 2;
  const steps: KitStep[] = [
    step('columns.effective', 'L_e = K L = [[K]] \\times [[L]] = [[Le]]', {
      K: input.K,
      L: q(L, 'length'),
      Le: q(Le, 'length'),
    }),
    step('columns.euler', 'P_{cr} = \\frac{\\pi^2 E I}{L_e^2} = \\frac{\\pi^2 ([[E]])([[I]])}{([[Le]])^2} = [[Pcr]]', {
      E: q(E, 'stress'),
      I: q(I, 'inertia'),
      Le: q(Le, 'length'),
      Pcr: q(Pcr, 'force'),
    }),
  ];
  if (!has(input.A)) return { Pcr, Le, steps };
  const A = positive(input.A, 'A');
  const r = Math.sqrt(I / A);
  const slenderness = Le / r;
  const sigmaEuler = Pcr / A;
  steps.push(
    step('columns.gyration', 'r = \\sqrt{I/A} = \\sqrt{[[I]] / [[A]]} = [[r]]', {
      I: q(I, 'inertia'),
      A: q(A, 'area'),
      r: q(r, 'length'),
    }),
    step('columns.slenderness', '\\frac{L_e}{r} = \\frac{[[Le]]}{[[r]]} = [[s]]', {
      Le: q(Le, 'length'),
      r: q(r, 'length'),
      s: slenderness,
    }),
    step('columns.eulerStress', '\\sigma_{cr} = \\frac{P_{cr}}{A} = [[sigma]]', { sigma: q(sigmaEuler, 'stress') }),
  );
  const result: { -readonly [K in keyof ColumnResult]: ColumnResult[K] } = {
    Pcr,
    Le,
    r,
    slenderness,
    sigmaEuler,
    steps,
  };
  if (has(input.Sy)) Object.assign(result, johnson(E, positive(input.Sy, 'S_y'), A, slenderness, steps));
  if (has(input.P)) Object.assign(result, secant(input, { A, r, Le, E, Pcr }, steps));
  return result;
}

function johnson(E: number, Sy: number, A: number, slenderness: number, steps: KitStep[]) {
  const Cc = Math.sqrt((2 * Math.PI ** 2 * E) / Sy);
  steps.push(
    step(
      'columns.transition',
      'C_c = \\sqrt{\\frac{2\\pi^2 E}{S_y}} = \\sqrt{\\frac{2\\pi^2 ([[E]])}{[[Sy]]}} = [[Cc]]',
      {
        E: q(E, 'stress'),
        Sy: q(Sy, 'stress'),
        Cc,
      },
    ),
  );
  if (slenderness >= Cc) {
    const sigmaCr = (Math.PI ** 2 * E) / slenderness ** 2;
    steps.push(step('columns.longColumn', '\\frac{L_e}{r} = [[s]] \\ge C_c', { s: slenderness }));
    return { Cc, regime: 'euler' as const, sigmaCr, Pallow: sigmaCr * A };
  }
  const sigmaCr = Sy - (Sy ** 2 / (4 * Math.PI ** 2 * E)) * slenderness ** 2;
  steps.push(
    step('columns.intermediate', '\\frac{L_e}{r} = [[s]] < C_c', { s: slenderness }),
    step(
      'columns.johnson',
      '\\sigma_{cr} = S_y - \\frac{S_y^2}{4\\pi^2 E}\\left(\\frac{L_e}{r}\\right)^2 = ' +
        '[[Sy]] - \\frac{([[Sy]])^2}{4\\pi^2 ([[E]])}([[s]])^2 = [[sigma]]',
      { Sy: q(Sy, 'stress'), E: q(E, 'stress'), s: slenderness, sigma: q(sigmaCr, 'stress') },
    ),
    step('columns.johnsonLoad', 'P_{cr} = \\sigma_{cr} A = [[P]]', { P: q(sigmaCr * A, 'force') }),
  );
  return { Cc, regime: 'johnson' as const, sigmaCr, Pallow: sigmaCr * A };
}

interface Column {
  A: number;
  r: number;
  Le: number;
  E: number;
  Pcr: number;
}

function secant(input: ColumnInput, col: Column, steps: KitStep[]) {
  const P = positive(input.P ?? NaN, 'P');
  const e = input.e ?? 0;
  const c = input.c ?? 0;
  if (!Number.isFinite(e) || e < 0) fail('notNegative', 'e');
  if (!Number.isFinite(c) || c < 0) fail('notNegative', 'c');
  if (P >= col.Pcr) fail('aboveCritical');
  const { A, r, Le, E } = col;
  const angle = (Le / (2 * r)) * Math.sqrt(P / (E * A));
  const sigmaMax = secantStress(P, A, e, c, r, Le, E);
  steps.push(
    step('columns.secantAngle', '\\frac{L_e}{2r}\\sqrt{\\frac{P}{EA}} = [[angle]]\\ \\text{rad}', { angle }),
    step(
      'columns.secant',
      '\\sigma_{max} = \\frac{P}{A}\\left[1 + \\frac{ec}{r^2}\\sec\\left(\\frac{L_e}{2r}\\sqrt{\\frac{P}{EA}}\\right)\\right] = [[s]]',
      { s: q(sigmaMax, 'stress'), ratio: (e * c) / (r * r) },
    ),
  );
  if (!has(input.Sy)) return { sigmaMax };
  const Sy = input.Sy;
  const Pyield =
    brent((load) => secantStress(load, A, e, c, r, Le, E) - Sy, 0, col.Pcr * (1 - 1e-12), 1e-9) ?? undefined;
  if (Pyield !== undefined) steps.push(step('columns.secantYield', 'P_{y} = [[P]]', { P: q(Pyield, 'force') }));
  return { sigmaMax, ...(Pyield === undefined ? {} : { Pyield }) };
}

/** Critical stress against slenderness: the Euler curve and, with a yield strength, the Johnson parabola. */
export function stressCurves(E: number, Sy: number | undefined, upTo: number) {
  const euler: [number, number][] = [];
  const johnsonCurve: [number, number][] = [];
  const Cc = Sy ? Math.sqrt((2 * Math.PI ** 2 * E) / Sy) : 0;
  for (let i = 1; i <= 120; i += 1) {
    const s = (upTo * i) / 120;
    const value = (Math.PI ** 2 * E) / s ** 2;
    euler.push([s, Sy && value > 1.6 * Sy ? NaN : value]);
    if (Sy && s <= Cc) johnsonCurve.push([s, Sy - (Sy ** 2 / (4 * Math.PI ** 2 * E)) * s ** 2]);
  }
  return { euler, johnson: johnsonCurve };
}

/**
 * Buckling coefficients k of a long flat plate in uniform compression, by the support of its two unloaded edges
 * (Timoshenko and Gere, Theory of Elastic Stability, 1961; Bulson, The Stability of Flat Plates, 1970).
 */
export const PLATE_K = { ss: 4, clamped: 6.97, ssClamped: 5.42, clampedFree: 1.277, ssFree: 0.425 } as const;

export interface PlateInput {
  readonly edges: keyof typeof PLATE_K;
  readonly E: number;
  readonly nu: number;
  /** The loaded width, between the unloaded edges. */
  readonly b: number;
  readonly t: number;
  /** The length along the load; NaN for a long plate. Used only when all four edges are simply supported. */
  readonly a: number;
  readonly Sy: number;
}

export interface PlateResult {
  readonly k: number;
  /** The number of half waves along the length, when the length is given. */
  readonly m?: number;
  readonly sigmaCr: number;
  /** The load per unit width at buckling, σcr t. */
  readonly Ncr: number;
  readonly yields: boolean;
  readonly steps: KitStep[];
}

/** σcr = k π² E / (12 (1 − ν²)) (t/b)², the elastic buckling stress of a flat plate. */
export function plateBuckling(input: PlateInput): PlateResult {
  const E = positive(input.E, 'E');
  const b = positive(input.b, 'b');
  const t = positive(input.t, 't');
  if (!Number.isFinite(input.nu) || input.nu <= -1 || input.nu >= 0.5) fail('poisson');
  const steps: KitStep[] = [];
  let k: number = PLATE_K[input.edges];
  let m: number | undefined;
  if (input.edges === 'ss' && Number.isFinite(input.a)) {
    const ratio = positive(input.a, 'a') / b;
    // k = (m b/a + a/(m b))², least over the number of half waves m.
    const kOf = (n: number) => (n / ratio + ratio / n) ** 2;
    m = 1;
    while (kOf(m + 1) < kOf(m)) m += 1;
    k = kOf(m);
    steps.push(
      step('columns.plateWaves', 'k = \\left(\\frac{m b}{a} + \\frac{a}{m b}\\right)^2 = [[k]], \\quad m = [[m]]', {
        k,
        m,
      }),
    );
  } else steps.push(step('columns.plateK', 'k = [[k]]', { k }));
  const D = E / (12 * (1 - input.nu ** 2));
  const sigmaCr = k * Math.PI ** 2 * D * (t / b) ** 2;
  steps.push(
    step('columns.plate', '\\sigma_{cr} = \\frac{k \\pi^2 E}{12(1-\\nu^2)} \\left(\\frac{t}{b}\\right)^2 = [[s]]', {
      s: q(sigmaCr, 'stress'),
    }),
  );
  const yields = Number.isFinite(input.Sy) && sigmaCr > input.Sy;
  if (yields) steps.push(step('columns.plateYield', '\\sigma_{cr} > S_y', {}));
  return { k, ...(m === undefined ? {} : { m }), sigmaCr, Ncr: sigmaCr * t, yields, steps };
}
