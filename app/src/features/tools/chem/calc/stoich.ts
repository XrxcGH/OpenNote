// Stoichiometry: grams to moles to grams through a balanced equation, the limiting reagent, and percent yield.
// Every answer carries its steps in plain words so a student can follow the method.
import { balance } from './balance';
import { molarMass } from './formula';

export const sig = (value: number, digits = 4): string => {
  if (!Number.isFinite(value)) return String(value);
  if (value === 0) return '0';
  const abs = Math.abs(value);
  if (abs >= 1e6 || abs < 1e-3) return value.toExponential(digits - 1).replace(/e\+?(-?)(\d+)/, ' × 10^$1$2');
  return String(Number(value.toPrecision(digits)));
};

export interface Amount {
  /** Grams of the species. */
  grams: number;
  moles: number;
}

export interface Line {
  text: string;
  coefficient: number;
  mass: number;
  /** The amount given, in moles, when the species is a reactant with a given mass. */
  given?: number;
  limiting?: boolean;
  /** Moles used or made. */
  moles?: number;
  grams?: number;
  leftover?: number;
}

export type StoichResult =
  | { ok: true; lines: Line[]; steps: string[]; limiting: string | null; equation: string }
  | { ok: false; reason: 'equation' | 'mass' | 'given' | 'target' };

/** Convert a given mass of one species to the mass of another through the balanced equation. */
export function convertThrough(
  equation: string,
  from: string,
  grams: number,
  to: string,
): { ok: true; grams: number; moles: number; steps: string[] } | { ok: false; reason: 'equation' | 'mass' | 'target' } {
  const result = balance(equation);
  if (!result.ok) return { ok: false, reason: 'equation' };
  const all = [...result.balanced.reactants, ...result.balanced.products];
  const a = all.find((s) => s.text === from.trim());
  const b = all.find((s) => s.text === to.trim());
  if (!a || !b) return { ok: false, reason: 'target' };
  const ma = molarMass(a.text);
  const mb = molarMass(b.text);
  if (!ma || !mb) return { ok: false, reason: 'mass' };
  const molesA = grams / ma;
  const molesB = (molesA * b.coefficient) / a.coefficient;
  const out = molesB * mb;
  return {
    ok: true,
    grams: out,
    moles: molesB,
    steps: [
      `Balanced: ${result.balanced.text}`,
      `Moles of ${a.text}: ${sig(grams)} g ÷ ${sig(ma)} g/mol = ${sig(molesA)} mol`,
      // checks-disable-next-line length: one step line of worked text, built from its parts
      `Mole ratio ${b.text}:${a.text} = ${b.coefficient}:${a.coefficient}, so ${sig(molesA)} × ${b.coefficient}/${a.coefficient} = ${sig(molesB)} mol ${b.text}`,
      `Mass of ${b.text}: ${sig(molesB)} mol × ${sig(mb)} g/mol = ${sig(out)} g`,
    ],
  };
}

/**
 * Limiting reagent: `given` maps each reactant to its mass in grams (omitted reactants are in excess). Returns the
 * theoretical yield of every product and what is left over of each reactant.
 */
export function limitingReagent(equation: string, given: Record<string, number>): StoichResult {
  const result = balance(equation);
  if (!result.ok) return { ok: false, reason: 'equation' };
  const { reactants, products } = result.balanced;
  const provided = reactants.filter((r) => (given[r.text] ?? 0) > 0);
  if (provided.length === 0) return { ok: false, reason: 'given' };
  const steps = [`Balanced: ${result.balanced.text}`];
  const lines: Line[] = [];
  let extent = Infinity;
  let limiting: string | null = null;
  for (const r of provided) {
    const mass = molarMass(r.text);
    if (!mass) return { ok: false, reason: 'mass' };
    const moles = given[r.text] / mass;
    const possible = moles / r.coefficient;
    steps.push(
      // checks-disable-next-line length: one step line of worked text, built from its parts
      `${r.text}: ${sig(given[r.text])} g ÷ ${sig(mass)} g/mol = ${sig(moles)} mol; ${sig(moles)} ÷ ${r.coefficient} = ${sig(possible)} reactions possible`,
    );
    if (possible < extent) {
      extent = possible;
      limiting = r.text;
    }
  }
  if (provided.length > 1) steps.push(`Fewest reactions possible: ${limiting}, so it is the limiting reagent.`);
  for (const r of reactants) {
    const mass = molarMass(r.text) ?? 0;
    const have = (given[r.text] ?? 0) / mass;
    const used = extent * r.coefficient;
    lines.push({
      text: r.text,
      coefficient: r.coefficient,
      mass,
      given: given[r.text] ? have : undefined,
      limiting: r.text === limiting,
      moles: used,
      grams: used * mass,
      leftover: given[r.text] ? (have - used) * mass : undefined,
    });
  }
  for (const p of products) {
    const mass = molarMass(p.text) ?? 0;
    const moles = extent * p.coefficient;
    lines.push({ text: p.text, coefficient: p.coefficient, mass, moles, grams: moles * mass });
    steps.push(
      `${p.text} made: ${sig(extent)} × ${p.coefficient} = ${sig(moles)} mol × ${sig(mass)} g/mol = ${sig(moles * mass)} g`,
    );
  }
  return { ok: true, lines, steps, limiting, equation: result.balanced.text };
}

export function percentYield(actual: number, theoretical: number): number {
  return (100 * actual) / theoretical;
}

/** Empirical formula from percent (or gram) composition: [{symbol, amount}] in any one unit of mass. */
export function empiricalFormula(
  parts: { symbol: string; amount: number }[],
): { formula: string; steps: string[] } | null {
  const moles: { symbol: string; mol: number }[] = [];
  for (const p of parts) {
    const mass = molarMass(p.symbol);
    if (!mass || p.amount <= 0) return null;
    moles.push({ symbol: p.symbol, mol: p.amount / mass });
  }
  if (moles.length === 0) return null;
  const smallest = Math.min(...moles.map((m) => m.mol));
  const ratios = moles.map((m) => m.mol / smallest);
  for (let k = 1; k <= 8; k += 1) {
    if (ratios.every((r) => Math.abs(r * k - Math.round(r * k)) < 0.06 * Math.max(1, k * 0.5))) {
      const counts = ratios.map((r) => Math.round(r * k));
      const formula = moles.map((m, i) => `${m.symbol}${counts[i] === 1 ? '' : counts[i]}`).join('');
      return {
        formula,
        steps: [
          ...moles.map((m) => `${m.symbol}: ${sig(m.mol)} mol`),
          `Divide by the smallest (${sig(smallest)} mol): ${ratios.map((r) => sig(r)).join(' : ')}`,
          ...(k > 1 ? [`Multiply by ${k} to reach whole numbers.`] : []),
          `Empirical formula: ${formula}`,
        ],
      };
    }
  }
  return null;
}
