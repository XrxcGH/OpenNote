// Solutions: dilution (C1V1 = C2V2), molarity, serial dilution, and pH of strong and weak acids and bases, and buffers.
import { sig } from './stoich';

export const KW = 1e-14;

export type DilutionKey = 'c1' | 'v1' | 'c2' | 'v2';

/** C1·V1 = C2·V2 with exactly one value empty. Volumes in any one unit; concentrations in any one unit. */
export function dilution(
  input: Record<DilutionKey, number | null>,
): { ok: true; key: DilutionKey; value: number; steps: string[] } | { ok: false } {
  const keys = ['c1', 'v1', 'c2', 'v2'] as const;
  const empty = keys.filter((k) => input[k] === null);
  if (empty.length !== 1) return { ok: false };
  const key = empty[0];
  const v = input as Record<DilutionKey, number>;
  if (keys.some((k) => k !== key && !(v[k] > 0))) return { ok: false };
  const value =
    key === 'c1'
      ? (v.c2 * v.v2) / v.v1
      : key === 'v1'
        ? (v.c2 * v.v2) / v.c1
        : key === 'c2'
          ? (v.c1 * v.v1) / v.v2
          : (v.c1 * v.v1) / v.c2;
  return { ok: true, key, value, steps: ['C₁V₁ = C₂V₂', `${key.toUpperCase()} = ${sig(value)}`] };
}

/** Molarity from the mass of solute (g), its molar mass (g/mol), and the volume of solution (L). */
export const molarity = (grams: number, molar: number, liters: number) => grams / molar / liters;

/** The volume of stock needed and the water to add for a target concentration and volume. */
export function dilutionPlan(
  stock: number,
  target: number,
  finalVolume: number,
): { stockVolume: number; water: number } | null {
  if (!(stock > 0 && target > 0 && finalVolume > 0 && target <= stock)) return null;
  const stockVolume = (target * finalVolume) / stock;
  return { stockVolume, water: finalVolume - stockVolume };
}

/** Concentrations after a series of equal dilutions: each step takes `aliquot` of the last into `total` volume. */
export function serialDilution(start: number, aliquot: number, total: number, steps: number): number[] {
  const out: number[] = [];
  let c = start;
  for (let i = 0; i < steps; i += 1) {
    c = (c * aliquot) / total;
    out.push(c);
  }
  return out;
}

export const pH = (h: number) => -Math.log10(h);

/** [H+] of a monoprotic weak acid of concentration c: the exact root of x² + Ka·x − Ka·c = 0 (water ignored). */
export function weakAcidH(c: number, ka: number): number {
  return (-ka + Math.sqrt(ka * ka + 4 * ka * c)) / 2;
}

export interface PhResult {
  ph: number;
  poh: number;
  h: number;
  oh: number;
  steps: string[];
}

export type Species = 'strongAcid' | 'strongBase' | 'weakAcid' | 'weakBase';

// checks-disable-next-line length: one doc line that states the formula whole
/** pH of a solution of one acid or base. `k` is Ka for a weak acid and Kb for a weak base; `n` is the number of H+ or OH- each unit gives (strong only). */
export function phOf(kind: Species, c: number, k = 0, n = 1): PhResult | null {
  if (!(c > 0) || ((kind === 'weakAcid' || kind === 'weakBase') && !(k > 0))) return null;
  let h: number;
  const steps: string[] = [];
  if (kind === 'strongAcid') {
    h = c * n;
    steps.push(`Strong acid: [H⁺] = ${n > 1 ? `${n} × ` : ''}${sig(c)} = ${sig(h)} M`);
  } else if (kind === 'strongBase') {
    const oh = c * n;
    h = KW / oh;
    steps.push(`Strong base: [OH⁻] = ${sig(oh)} M, so [H⁺] = 1.0 × 10⁻¹⁴ ÷ ${sig(oh)} = ${sig(h)} M`);
  } else if (kind === 'weakAcid') {
    h = weakAcidH(c, k);
    steps.push(`Weak acid: Ka = x²/(${sig(c)} − x), so x = [H⁺] = ${sig(h)} M`);
  } else {
    const oh = weakAcidH(c, k);
    h = KW / oh;
    steps.push(
      `Weak base: Kb = x²/(${sig(c)} − x), so x = [OH⁻] = ${sig(oh)} M`,
      `[H⁺] = 1.0 × 10⁻¹⁴ ÷ ${sig(oh)} = ${sig(h)} M`,
    );
  }
  const ph = pH(h);
  steps.push(`pH = −log[H⁺] = ${ph.toFixed(2)}`);
  return { ph, poh: 14 - ph, h, oh: KW / h, steps };
}

/** Henderson–Hasselbalch: pH = pKa + log([A⁻]/[HA]). */
export function buffer(pKa: number, base: number, acid: number): { ph: number; steps: string[] } | null {
  if (!(base > 0 && acid > 0)) return null;
  const ph = pKa + Math.log10(base / acid);
  return { ph, steps: [`pH = pKa + log([A⁻]/[HA]) = ${sig(pKa)} + log(${sig(base)}/${sig(acid)}) = ${ph.toFixed(2)}`] };
}
