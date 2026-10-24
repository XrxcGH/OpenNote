// The example kit tool's engine (README.md walks through it): the ideal gas law p V = n R T solved for whichever of
// the four quantities is unknown, in SI, with worked steps. Pure: no DOM, no React, no t().
import { KitProblem } from '../../problem';
import { formatValue, latexUnit, latexValue } from '../../units';
import type { KitStep } from '../../types';

/** The molar gas constant, exact since the 2019 SI (CODATA 2022). */
export const R = 8.314462618;

export type GasUnknown = 'p' | 'V' | 'n' | 'T';

export interface GasKnowns {
  p: number;
  V: number;
  n: number;
  T: number;
}

export interface GasResult {
  unknown: GasUnknown;
  /** All four quantities in SI: Pa, m³, mol, K. */
  values: GasKnowns;
  steps: KitStep[];
}

/** Each quantity's SI unit label, as the kit units write it. */
export const SI_UNIT: Record<GasUnknown, string> = { p: 'Pa', V: 'm³', n: 'mol', T: 'K' };
const LATEX_UNIT: Record<GasUnknown, string> = { p: 'Pa', V: 'm^3', n: 'mol', T: 'K' };
const REARRANGED: Record<GasUnknown, string> = {
  p: 'p = \\frac{nRT}{V}',
  V: 'V = \\frac{nRT}{p}',
  n: 'n = \\frac{pV}{RT}',
  T: 'T = \\frac{pV}{nR}',
};

function solveFor(unknown: GasUnknown, k: GasKnowns): number {
  switch (unknown) {
    case 'p':
      return (k.n * R * k.T) / k.V;
    case 'V':
      return (k.n * R * k.T) / k.p;
    case 'n':
      return (k.p * k.V) / (R * k.T);
    case 'T':
      return (k.p * k.V) / (k.n * R);
  }
}

function substitution(unknown: GasUnknown, k: GasKnowns): string {
  const v = (x: number) => latexValue(x, 6);
  const r = `(${v(R)})`;
  switch (unknown) {
    case 'p':
      return `p = \\frac{(${v(k.n)})${r}(${v(k.T)})}{${v(k.V)}}`;
    case 'V':
      return `V = \\frac{(${v(k.n)})${r}(${v(k.T)})}{${v(k.p)}}`;
    case 'n':
      return `n = \\frac{(${v(k.p)})(${v(k.V)})}{${r}(${v(k.T)})}`;
    case 'T':
      return `T = \\frac{(${v(k.p)})(${v(k.V)})}{(${v(k.n)})${r}}`;
  }
}

/** Solves p V = n R T for `unknown` from the other three (SI). The unknown's own entry in `knowns` is ignored. */
export function idealGas(unknown: GasUnknown, knowns: GasKnowns): GasResult {
  for (const key of ['p', 'V', 'n', 'T'] as const) {
    if (key === unknown) continue;
    const value = knowns[key];
    if (!Number.isFinite(value)) throw new KitProblem('kits.field.notNumber');
    if (key === 'T' && value <= 0) throw new KitProblem('kits.example.error.temperature');
    if (value <= 0) throw new KitProblem('kits.field.positive');
  }
  const answer = solveFor(unknown, knowns);
  if (!Number.isFinite(answer)) throw new KitProblem('kits.error.tooLarge');
  const values = { ...knowns, [unknown]: answer };
  const steps: KitStep[] = [
    { key: 'kits.example.step.law', math: 'pV = nRT' },
    { key: 'kits.example.step.rearrange', math: REARRANGED[unknown] },
    { key: 'kits.example.step.substitute', math: substitution(unknown, knowns) },
    {
      key: 'kits.example.step.result',
      vars: { value: `${unknown} = ${formatValue(answer, 6)} ${SI_UNIT[unknown]}` },
      math: `${unknown} = ${latexValue(answer, 6)}${latexUnit(LATEX_UNIT[unknown])}`,
    },
  ];
  return { unknown, values, steps };
}
