// Dimensional analysis: the dimension matrix of a list of variables, its rank, the repeating variables, the pi groups
// as products of powers (exact fractions), and model-to-prototype scaling for matched Reynolds, Froude or Mach number.
import { fmt, need, positive, type Step } from '../numeric';

export interface Variable {
  /** The symbol, such as "rho" or "V". */
  name: string;
  /** Exponents of meter, kilogram, second, kelvin, ampere, mole, and candela. */
  dim: readonly number[];
}

/** The base dimensions in the order of a parsed unit's dimension vector (m, kg, s, K, A, mol, cd). */
export const DIM_NAMES = ['L', 'M', 'T', '\\Theta', 'I', 'N', 'J'] as const;

/** An exact fraction with a positive denominator. */
export interface Frac {
  n: number;
  d: number;
}

const gcd = (a: number, b: number): number => (b === 0 ? Math.abs(a) : gcd(b, a % b));
const frac = (n: number, d = 1): Frac => {
  const g = gcd(n, d) || 1;
  const s = d < 0 ? -1 : 1;
  return { n: (s * n) / g, d: (s * d) / g };
};
const sub = (a: Frac, b: Frac): Frac => frac(a.n * b.d - b.n * a.d, a.d * b.d);
const mul = (a: Frac, b: Frac): Frac => frac(a.n * b.n, a.d * b.d);
const div = (a: Frac, b: Frac): Frac => frac(a.n * b.d, a.d * b.n);
const isZero = (a: Frac) => a.n === 0;
export const fracText = (a: Frac): string => (a.d === 1 ? String(a.n) : `${a.n}/${a.d}`);
export const fracValue = (a: Frac): number => a.n / a.d;

/** A pi group: each variable's exponent, and a name when it is a well-known group. */
export interface PiGroup {
  exponents: Frac[];
  /** The key of a known group (see NAMED), when this group or its inverse is one. */
  named?: string;
  /** True when the printed group is the inverse of the one found by solving. */
  inverted: boolean;
  latex: string;
}

export interface DimensionalResult {
  matrix: number[][];
  rows: string[];
  rank: number;
  repeating: string[];
  groups: PiGroup[];
  steps: Step[];
}

/** Well-known groups by the roles their variables play. A role is matched by symbol. */
const ROLES: Record<string, readonly string[]> = {
  rho: ['rho', 'ρ'],
  V: ['V', 'U', 'v', 'u'],
  L: ['L', 'D', 'd', 'l', 'c', 'h'],
  mu: ['mu', 'μ', 'µ'],
  nu: ['nu', 'ν'],
  g: ['g'],
  a: ['a', 'cs'],
  sigma: ['sigma', 'σ'],
  p: ['dp', 'p', 'Δp', 'DeltaP', 'dP'],
  f: ['f', 'n', 'omega', 'ω'],
};
const roleOf = (name: string): string | undefined => Object.keys(ROLES).find((r) => ROLES[r].includes(name));

export const NAMED: Record<string, Record<string, number>> = {
  reynolds: { rho: 1, V: 1, L: 1, mu: -1 },
  reynoldsKin: { V: 1, L: 1, nu: -1 },
  froude: { V: 1, g: -0.5, L: -0.5 },
  mach: { V: 1, a: -1 },
  weber: { rho: 1, V: 2, L: 1, sigma: -1 },
  euler: { p: 1, rho: -1, V: -2 },
  strouhal: { f: 1, L: 1, V: -1 },
};

function nameOf(vars: Variable[], exps: Frac[]): { key?: string; inverse: boolean } {
  const byRole: Record<string, number> = {};
  for (let i = 0; i < vars.length; i++) {
    const e = fracValue(exps[i]);
    if (e === 0) continue;
    const role = roleOf(vars[i].name);
    if (!role) return { inverse: false };
    byRole[role] = (byRole[role] ?? 0) + e;
  }
  const same = (a: Record<string, number>, b: Record<string, number>, sign: number) => {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) if (Math.abs((a[k] ?? 0) - sign * (b[k] ?? 0)) > 1e-9) return false;
    return true;
  };
  for (const [key, pattern] of Object.entries(NAMED)) {
    if (same(byRole, pattern, 1)) return { key, inverse: false };
    if (same(byRole, pattern, -1)) return { key, inverse: true };
  }
  return { inverse: false };
}

const power = (name: string, e: Frac): string => {
  const sym = name.length > 1 ? `\\mathit{${name}}` : name;
  return e.n === e.d ? sym : `${sym}^{${fracText(e)}}`;
};

/** A product of powers in LaTeX, with negative exponents under a fraction bar. */
export function groupLatex(vars: Variable[], exps: Frac[]): string {
  const up: string[] = [];
  const down: string[] = [];
  vars.forEach((v, i) => {
    const e = exps[i];
    if (isZero(e)) return;
    if (e.n > 0) up.push(power(v.name, e));
    else down.push(power(v.name, frac(-e.n, e.d)));
  });
  if (up.length === 0 && down.length === 0) return '1';
  if (down.length === 0) return up.join(' ');
  return `\\frac{${up.length ? up.join(' ') : '1'}}{${down.join(' ')}}`;
}

/** Row-reduces a matrix of fractions in place for the first `cols` columns; returns the pivot column of each pivot row. */
function reduce(M: Frac[][], cols: number): number[] {
  const pivots: number[] = [];
  let row = 0;
  for (let c = 0; c < cols && row < M.length; c++) {
    let p = row;
    while (p < M.length && isZero(M[p][c])) p++;
    if (p === M.length) continue;
    [M[row], M[p]] = [M[p], M[row]];
    const piv = M[row][c];
    M[row] = M[row].map((x) => div(x, piv));
    for (let r = 0; r < M.length; r++) {
      if (r === row || isZero(M[r][c])) continue;
      const f = M[r][c];
      M[r] = M[r].map((x, k) => sub(x, mul(f, M[row][k])));
    }
    pivots.push(c);
    row++;
  }
  return pivots;
}

/**
 * Pi groups of the variables. The first variable is the dependent one. `repeating` names the repeating set, or is
 * left out to choose it.
 */
export function piGroups(vars: Variable[], repeating?: string[]): DimensionalResult {
  need(vars.length >= 2, 'fewVariables', 'List at least two variables.');
  const seen = new Set<string>();
  for (const v of vars) {
    need(v.name.trim() !== '', 'name', 'Every variable needs a symbol.');
    need(!seen.has(v.name), 'duplicate', `The symbol ${v.name} is used twice.`);
    seen.add(v.name);
  }
  const rowIdx = DIM_NAMES.map((_, k) => k).filter((k) => vars.some((v) => (v.dim[k] ?? 0) !== 0));
  need(rowIdx.length > 0, 'dimensionless', 'Every variable is dimensionless already.');
  const matrix = rowIdx.map((r) => vars.map((v) => v.dim[r] ?? 0));
  const A: Frac[][] = matrix.map((row) => row.map((x) => frac(Math.round(x * 12), 12)));
  const n = vars.length;
  const rank = reduce(
    A.map((r) => r.slice()),
    n,
  ).length;
  need(
    rank < n,
    'noGroups',
    'These variables are all independent in dimension, so no dimensionless group can be formed.',
  );
  const independent = (idx: number[]): boolean => {
    const M = rowIdx.map((_, r) => idx.map((c) => A[r][c]));
    return reduce(M, idx.length).length === idx.length;
  };
  let rep: number[] = [];
  if (repeating && repeating.length > 0) {
    rep = repeating.map((name) => {
      const i = vars.findIndex((v) => v.name === name);
      need(
        i > 0,
        'repeating',
        `${name} cannot be a repeating variable: it is missing or it is the dependent variable.`,
      );
      return i;
    });
    need(rep.length === rank, 'repeatingCount', `Choose exactly ${rank} repeating variables (the rank of the matrix).`);
    need(independent(rep), 'repeatingDependent', 'The repeating variables must not have dependent dimensions.');
  } else {
    for (let i = 1; i < n && rep.length < rank; i++) if (independent([...rep, i])) rep.push(i);
    need(rep.length === rank, 'repeatingFind', 'No set of repeating variables was found.');
  }
  const others = vars.map((_, i) => i).filter((i) => !rep.includes(i));
  const groups: PiGroup[] = [];
  for (const o of others) {
    // v * prod(rep_i ^ a_i) is dimensionless: Mrep a = -dim(v).
    const aug = rowIdx.map((_, r) => [...rep.map((c) => A[r][c]), sub(frac(0), A[r][o])]);
    const pivots = reduce(aug, rep.length);
    const exps: Frac[] = vars.map(() => frac(0));
    exps[o] = frac(1);
    pivots.forEach((c, r) => {
      exps[rep[c]] = aug[r][rep.length];
    });
    const nm = o === 0 ? { inverse: false } : nameOf(vars, exps);
    const inverted = nm.key !== undefined && nm.inverse;
    const finalExps = inverted ? exps.map((e) => frac(-e.n, e.d)) : exps;
    groups.push({
      exponents: finalExps,
      ...(nm.key ? { named: nm.key } : {}),
      inverted,
      latex: groupLatex(vars, finalExps),
    });
  }
  const unit = (v: Variable) => rowIdx.map((r) => `${DIM_NAMES[r]}^{${fmt(v.dim[r] ?? 0)}}`).join(' ');
  const steps: Step[] = [
    {
      key: 'fhDimMatrix',
      vars: { n: String(n), k: String(rowIdx.length) },
      math: vars.map((v) => `[${v.name.length > 1 ? `\\mathit{${v.name}}` : v.name}] = ${unit(v)}`).join(',\\quad '),
    },
    { key: 'fhDimRank', vars: { r: String(rank), n: String(n), p: String(n - rank) } },
    { key: 'fhDimRepeating', vars: { list: rep.map((i) => vars[i].name).join(', ') } },
    ...groups.map((g, i) => ({
      key: 'fhDimGroup',
      vars: { i: String(i + 1) },
      math: `\\Pi_{${i + 1}} = ${g.latex}`,
    })),
  ];
  return {
    matrix,
    rows: rowIdx.map((r) => DIM_NAMES[r]),
    rank,
    repeating: rep.map((i) => vars[i].name),
    groups,
    steps,
  };
}

export type SimilarityCriterion = 'reynolds' | 'froude' | 'mach';

export interface ScaleInput {
  criterion: SimilarityCriterion;
  /** Model length divided by prototype length. */
  lengthRatio: number;
  /** Prototype speed (m/s). */
  prototypeSpeed: number;
  /** Kinematic viscosities (m2/s), for Reynolds. */
  nuPrototype?: number;
  nuModel?: number;
  /** Densities (kg/m3) for the force ratio; left out when the fluid is the same. */
  rhoPrototype?: number;
  rhoModel?: number;
  /** Speeds of sound (m/s), for Mach. */
  aPrototype?: number;
  aModel?: number;
  /** A measured model force (N), to scale up to the prototype. */
  modelForce?: number;
}

export interface ScaleResult {
  modelSpeed: number;
  speedRatio: number;
  forceRatio: number;
  timeRatio: number;
  prototypeForce?: number;
  steps: Step[];
}

/** The model speed that matches one dimensionless group, and what follows for time and force. */
export function scaleModel(inp: ScaleInput): ScaleResult {
  positive(inp.lengthRatio, 'The length ratio');
  positive(inp.prototypeSpeed, 'The prototype speed');
  const lr = inp.lengthRatio;
  let speedRatio: number;
  const steps: Step[] = [];
  if (inp.criterion === 'reynolds') {
    positive(inp.nuPrototype ?? NaN, 'The prototype kinematic viscosity');
    positive(inp.nuModel ?? NaN, 'The model kinematic viscosity');
    speedRatio = inp.nuModel! / inp.nuPrototype! / lr;
    steps.push({
      key: 'fhDimScaleRe',
      vars: { v: fmt(speedRatio * inp.prototypeSpeed) },
      math:
        `\\frac{V_m L_m}{\\nu_m} = \\frac{V_p L_p}{\\nu_p} \\Rightarrow V_m = ` +
        `V_p\\frac{\\nu_m}{\\nu_p}\\frac{L_p}{L_m} ` +
        `= ${fmt(speedRatio * inp.prototypeSpeed)}\\ \\mathrm{m/s}`,
    });
  } else if (inp.criterion === 'froude') {
    speedRatio = Math.sqrt(lr);
    steps.push({
      key: 'fhDimScaleFr',
      vars: { v: fmt(speedRatio * inp.prototypeSpeed) },
      math:
        `\\frac{V_m}{\\sqrt{g L_m}} = \\frac{V_p}{\\sqrt{g L_p}} \\Rightarrow V_m = V_p\\sqrt{L_m/L_p} ` +
        `= ${fmt(speedRatio * inp.prototypeSpeed)}\\ \\mathrm{m/s}`,
    });
  } else {
    positive(inp.aPrototype ?? NaN, 'The prototype speed of sound');
    positive(inp.aModel ?? NaN, 'The model speed of sound');
    speedRatio = inp.aModel! / inp.aPrototype!;
    steps.push({
      key: 'fhDimScaleMa',
      vars: { v: fmt(speedRatio * inp.prototypeSpeed) },
      math:
        `\\frac{V_m}{a_m} = \\frac{V_p}{a_p} \\Rightarrow V_m = V_p\\frac{a_m}{a_p} ` +
        `= ${fmt(speedRatio * inp.prototypeSpeed)}\\ \\mathrm{m/s}`,
    });
  }
  let rhoRatio = 1;
  if (inp.rhoModel !== undefined && inp.rhoPrototype !== undefined) {
    positive(inp.rhoModel, 'The model density');
    positive(inp.rhoPrototype, 'The prototype density');
    rhoRatio = inp.rhoModel / inp.rhoPrototype;
  }
  const forceRatio = rhoRatio * speedRatio ** 2 * lr ** 2;
  const timeRatio = lr / speedRatio;
  steps.push({
    key: 'fhDimScaleForce',
    vars: { f: fmt(forceRatio), t: fmt(timeRatio) },
    math:
      `\\frac{F_m}{F_p} ` +
      `= \\frac{\\rho_m}{\\rho_p}\\left(\\frac{V_m}{V_p}\\right)^2\\left(\\frac{L_m}{L_p}\\right)^2 ` +
      `= ${fmt(forceRatio)}`,
  });
  const out: ScaleResult = { modelSpeed: speedRatio * inp.prototypeSpeed, speedRatio, forceRatio, timeRatio, steps };
  if (inp.modelForce !== undefined && Number.isFinite(inp.modelForce)) {
    out.prototypeForce = inp.modelForce / forceRatio;
    steps.push({
      key: 'fhDimScaleProto',
      vars: { f: fmt(out.prototypeForce) },
      math: `F_p = F_m / ${fmt(forceRatio)} = ${fmt(out.prototypeForce)}\\ \\mathrm{N}`,
    });
  }
  return out;
}
