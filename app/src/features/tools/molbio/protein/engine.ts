// The protein tool's calculations: masses with modifications, extinction coefficient, net charge, and isoelectric
// point, hydropathy, the helical wheel's angles, and b and y fragment ions. Pure; sequences are one-letter codes.
import { fail } from '../shared';
import { AA_CLASS, AMINO_ACIDS, AVERAGE, EPSILON_280, KYTE_DOOLITTLE, MODS, MONO, PROTON, RESIDUES } from './data';
import type { Element, Formula, PkaSet } from './data';

/** Reads a one-letter protein sequence, ignoring FASTA headers, numbers, spaces, and a final stop. */
export function cleanProtein(text: string): string {
  let seq = '';
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith('>') || line.startsWith(';')) continue;
    for (const ch of line) {
      if (/[\s\d]/.test(ch)) continue;
      const up = ch.toUpperCase();
      if (up === '*' && seq.length > 0) continue;
      if (!AMINO_ACIDS.includes(up))
        return fail('protein.e.badResidue', { char: ch, position: String(seq.length + 1) });
      seq += up;
    }
  }
  return seq === '' ? fail('protein.e.noProtein') : seq;
}

export interface Mods {
  disulfides: number;
  acetyl: boolean;
  amide: boolean;
  phospho: number;
}

export const NO_MODS: Mods = { disulfides: 0, acetyl: false, amide: false, phospho: 0 };

function addFormula(total: Formula, part: Formula, times = 1): void {
  for (const [el, n] of Object.entries(part) as [Element, number][]) total[el] = (total[el] ?? 0) + n * times;
}

/** The element counts of the whole chain: residues, one water for the termini, and the modifications. */
export function chainFormula(seq: string, mods: Mods = NO_MODS): Formula {
  const total: Formula = {};
  for (const aa of seq) addFormula(total, RESIDUES[aa]!);
  addFormula(total, { H: 2, O: 1 });
  addFormula(total, MODS.disulfide, mods.disulfides);
  if (mods.acetyl) addFormula(total, MODS.acetyl);
  if (mods.amide) addFormula(total, MODS.amide);
  addFormula(total, MODS.phospho, mods.phospho);
  return total;
}

export const massOf = (formula: Formula, table: Record<Element, number>): number =>
  (Object.entries(formula) as [Element, number][]).reduce((sum, [el, n]) => sum + n * table[el], 0);

/** The formula in Hill order: C, then H, then the others in alphabetical order. */
export function hill(formula: Formula): string {
  return (['C', 'H', 'N', 'O', 'P', 'S'] as Element[])
    .filter((el) => (formula[el] ?? 0) !== 0)
    .map((el) => `${el}${formula[el] === 1 ? '' : formula[el]}`)
    .join('');
}

export function masses(seq: string, mods: Mods = NO_MODS): { mono: number; average: number; formula: Formula } {
  if (mods.disulfides * 2 > count(seq, 'C')) return fail('protein.e.tooManyDisulfides');
  if (mods.phospho > count(seq, 'S') + count(seq, 'T') + count(seq, 'Y')) return fail('protein.e.tooManyPhospho');
  const formula = chainFormula(seq, mods);
  return { mono: massOf(formula, MONO), average: massOf(formula, AVERAGE), formula };
}

export const count = (seq: string, aa: string): number => [...seq].filter((x) => x === aa).length;

export function composition(seq: string): [string, number][] {
  return [...AMINO_ACIDS].map((aa): [string, number] => [aa, count(seq, aa)]).filter(([, n]) => n > 0);
}

/** Molar extinction coefficient at 280 nm: 5500 W + 1490 Y + 125 per cystine. */
export const extinction = (seq: string, cystines: number): number =>
  EPSILON_280.W * count(seq, 'W') + EPSILON_280.Y * count(seq, 'Y') + EPSILON_280.cystine * cystines;

export interface Group {
  kind: 'base' | 'acid';
  pKa: number;
  count: number;
  name: string;
}

/** The ionizable groups of a chain under a pKa set; acetyl and amide caps remove the terminal groups. */
export function groups(seq: string, set: PkaSet, mods: Mods = NO_MODS): Group[] {
  const first = seq[0]!;
  const last = seq.at(-1)!;
  const list: Group[] = [];
  if (!mods.acetyl) list.push({ kind: 'base', pKa: set.nTermBy?.[first] ?? set.nTerm, count: 1, name: 'N' });
  if (!mods.amide) list.push({ kind: 'acid', pKa: set.cTermBy?.[last] ?? set.cTerm, count: 1, name: 'C-term' });
  for (const aa of ['K', 'R', 'H'] as const) list.push({ kind: 'base', pKa: set[aa], count: count(seq, aa), name: aa });
  for (const aa of ['D', 'E', 'C', 'Y'] as const)
    list.push({ kind: 'acid', pKa: set[aa], count: count(seq, aa), name: aa });
  return list.filter((g) => g.count > 0);
}

/** Net charge by the Henderson-Hasselbalch sum over the groups. */
export function netCharge(list: Group[], pH: number): number {
  let charge = 0;
  for (const g of list) {
    charge += g.kind === 'base' ? g.count / (1 + 10 ** (pH - g.pKa)) : -g.count / (1 + 10 ** (g.pKa - pH));
  }
  return charge;
}

export interface Isoelectric {
  pI: number;
  /** The brackets of the first bisection steps, for the worked steps. */
  trail: { lo: number; hi: number; mid: number; charge: number }[];
}

/** The pH of zero net charge by bisection on [0, 14] to 1e-7 pH; throws when the charge never changes sign. */
export function isoelectric(list: Group[]): Isoelectric {
  let lo = 0;
  let hi = 14;
  if (list.length === 0 || netCharge(list, lo) <= 0 || netCharge(list, hi) >= 0) return fail('protein.e.noPi');
  const trail: Isoelectric['trail'] = [];
  while (hi - lo > 1e-7) {
    const mid = (lo + hi) / 2;
    const charge = netCharge(list, mid);
    if (trail.length < 4) trail.push({ lo, hi, mid, charge });
    if (charge > 0) lo = mid;
    else hi = mid;
  }
  return { pI: (lo + hi) / 2, trail };
}

export const gravy = (seq: string): number => [...seq].reduce((sum, aa) => sum + KYTE_DOOLITTLE[aa]!, 0) / seq.length;

/** Kyte-Doolittle window means, each at its window's middle residue (1-based). */
export function hydropathy(seq: string, window: number): { mids: number[]; values: number[] } {
  if (window > seq.length) return fail('protein.e.windowLong', { window: String(window), length: String(seq.length) });
  const mids: number[] = [];
  const values: number[] = [];
  let sum = 0;
  for (let i = 0; i < seq.length; i++) {
    sum += KYTE_DOOLITTLE[seq[i]!]!;
    if (i >= window) sum -= KYTE_DOOLITTLE[seq[i - window]!]!;
    if (i >= window - 1) {
      mids.push(i - window + 1 + (window + 1) / 2);
      values.push(sum / window);
    }
  }
  return { mids, values };
}

/** Residues on a helical wheel at 100 degrees each, and the hydrophobic moment with Kyte-Doolittle values. */
export function wheel(seq: string, turn = 100): { angles: number[]; moment: number } {
  let x = 0;
  let y = 0;
  const angles = [...seq].map((aa, i) => {
    const angle = (i * turn) % 360;
    const h = KYTE_DOOLITTLE[aa]!;
    x += h * Math.cos((angle * Math.PI) / 180);
    y += h * Math.sin((angle * Math.PI) / 180);
    return angle;
  });
  return { angles, moment: Math.hypot(x, y) / seq.length };
}

export interface Ion {
  index: number;
  b: number;
  y: number;
}

/** Singly charged monoisotopic b and y ions; b_i holds residues 1..i, y_i the last i residues. */
export function fragmentIons(seq: string, mods: Mods = NO_MODS): Ion[] {
  const residue = [...seq].map((aa) => massOf(RESIDUES[aa]!, MONO));
  const water = massOf({ H: 2, O: 1 }, MONO);
  const nCap = mods.acetyl ? massOf(MODS.acetyl, MONO) : 0;
  const cCap = mods.amide ? massOf(MODS.amide, MONO) : 0;
  const ions: Ion[] = [];
  let b = nCap + PROTON;
  let y = water + cCap + PROTON;
  const ys: number[] = [];
  for (let i = seq.length - 1; i >= 0; i--) {
    y += residue[i]!;
    ys.unshift(y);
  }
  for (let i = 0; i < seq.length; i++) {
    b += residue[i]!;
    ions.push({ index: i + 1, b, y: ys[seq.length - 1 - i]! });
  }
  return ions;
}

export const aaClass = (aa: string) => AA_CLASS[aa]!;
