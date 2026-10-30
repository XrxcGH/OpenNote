// Chemical equilibrium of ideal-gas products at a given T and p, found by minimizing the Gibbs energy with element
// potentials. The method is the Newton iteration on log moles of Gordon and McBride, NASA RP-1311 (1994), section 2.
// The products are the ten species of species.ts; there is no solid carbon.
import { ThermoError } from '../common/types';
import { SPECIES } from '../data/nasa';
import { ELEMENTS, PRODUCTS, PRODUCT_ATOMS, g0RT, type Amounts, type Element, type ProductId } from './species';

/** Solves M x = r in place by Gaussian elimination with partial pivoting. */
export function solveLinear(M: number[][], r: number[]): number[] {
  const n = r.length;
  for (let col = 0; col < n; col++) {
    let best = col;
    for (let row = col + 1; row < n; row++) if (Math.abs(M[row][col]) > Math.abs(M[best][col])) best = row;
    if (!(Math.abs(M[best][col]) > 1e-300)) throw new ThermoError('equilibriumFailed');
    [M[col], M[best]] = [M[best], M[col]];
    [r[col], r[best]] = [r[best], r[col]];
    for (let row = col + 1; row < n; row++) {
      const f = M[row][col] / M[col][col];
      for (let k = col; k < n; k++) M[row][k] -= f * M[col][k];
      r[row] -= f * r[col];
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let row = n - 1; row >= 0; row--) {
    let sum = r[row];
    for (let k = row + 1; k < n; k++) sum -= M[row][k] * x[k];
    x[row] = sum / M[row][row];
  }
  return x;
}

export interface Equilibrium {
  n: Amounts;
  moles: number;
  iterations: number;
}

interface System {
  elements: Element[];
  species: ProductId[];
  /** a[j][i]: atoms of element i in species j. */
  a: number[][];
  b0: number[];
  g: number[];
  lnP: number;
}

function systemOf(b0: Readonly<Record<Element, number>>, T: number, pKpa: number): System {
  const elements = ELEMENTS.filter((e) => b0[e] > 1e-12);
  const species = PRODUCTS.filter((id) => ELEMENTS.every((e) => !PRODUCT_ATOMS[id][e] || elements.includes(e)));
  return {
    elements,
    species,
    a: species.map((id) => elements.map((e) => PRODUCT_ATOMS[id][e] ?? 0)),
    b0: elements.map((e) => b0[e]),
    g: species.map((id) => g0RT(SPECIES[id], T)),
    lnP: Math.log(pKpa / 100),
  };
}

/** One Newton step: the change in each ln nⱼ and in ln n, from RP-1311's reduced equations (2.24) and (2.26). */
function newtonStep(sys: System, n: number[], lnN: number): { dln: number[]; dlnN: number } {
  const m = sys.elements.length;
  const mu = n.map((nj, j) => sys.g[j] + Math.log(nj) - lnN + sys.lnP);
  const M = Array.from({ length: m + 1 }, () => new Array<number>(m + 1).fill(0));
  const r = new Array<number>(m + 1).fill(0);
  const total = n.reduce((s, x) => s + x, 0);
  for (let i = 0; i < m; i++) {
    let bi = 0;
    let rhs = 0;
    n.forEach((nj, j) => {
      const aij = sys.a[j][i];
      bi += aij * nj;
      rhs += aij * nj * mu[j];
      for (let k = 0; k < m; k++) M[i][k] += aij * sys.a[j][k] * nj;
    });
    M[i][m] = bi;
    M[m][i] = bi;
    r[i] = sys.b0[i] - bi + rhs;
  }
  M[m][m] = total - Math.exp(lnN);
  r[m] = Math.exp(lnN) - total + n.reduce((s, nj, j) => s + nj * mu[j], 0);
  const x = solveLinear(M, r);
  const dlnN = x[m];
  const dln = n.map((_, j) => -mu[j] + sys.a[j].reduce((s, aij, i) => s + aij * x[i], 0) + dlnN);
  return { dln, dlnN };
}

/** RP-1311's control factor (3.1)-(3.2): no ln n moves by more than 2, and trace species stay trace. */
function damping(n: number[], lnN: number, dln: number[], dlnN: number): number {
  let big = 5 * Math.abs(dlnN);
  let trace = Infinity;
  dln.forEach((d, j) => {
    const rel = Math.log(n[j]) - lnN;
    if (rel > -18.420681) big = Math.max(big, Math.abs(d));
    else if (d - dlnN > 0) trace = Math.min(trace, Math.abs((-rel - 9.2103404) / (d - dlnN)));
  });
  return Math.min(1, big > 0 ? 2 / big : 1, trace);
}

/** The equilibrium products of these atoms (moles of each element) at T (K) and p (kPa), from a starting guess. */
export function equilibrium(
  atoms: Readonly<Record<Element, number>>,
  T: number,
  pKpa: number,
  start?: Amounts,
): Equilibrium {
  const sys = systemOf(atoms, T, pKpa);
  const totalAtoms = sys.b0.reduce((s, x) => s + x, 0);
  const seed = sys.species.map((id) => start?.[id] ?? 0);
  const seedSum = seed.reduce((s, x) => s + x, 0) || totalAtoms / 2;
  let n = seed.map((x) => x + (0.01 * seedSum) / sys.species.length);
  let lnN = Math.log(n.reduce((s, x) => s + x, 0));
  for (let iteration = 1; iteration <= 300; iteration++) {
    const { dln, dlnN } = newtonStep(sys, n, lnN);
    const lambda = damping(n, lnN, dln, dlnN);
    n = n.map((nj, j) => Math.exp(Math.log(nj) + lambda * dln[j]));
    lnN += lambda * dlnN;
    const total = n.reduce((s, x) => s + x, 0);
    const change = n.reduce((s, nj, j) => s + nj * Math.abs(dln[j]), 0) / total;
    if (lambda === 1 && change < 1e-9 && Math.abs(dlnN) < 1e-9) {
      const out: Amounts = {};
      sys.species.forEach((id, j) => (out[id] = n[j]));
      return { n: out, moles: total, iterations: iteration };
    }
  }
  throw new ThermoError('equilibriumFailed');
}
