// A reaction enthalpy estimated from average bond enthalpies: the bonds broken minus the bonds formed.
import { latexNumber } from '../chemText';
import { fail } from '../types';
import type { KitStep, Outcome } from '../types';

/**
 * Average bond enthalpies in kJ/mol, as listed in general chemistry texts (for example Zumdahl, Chemistry). Sources
 * differ by a few percent, and the value in one molecule can differ from the average (C=O in CO2 is 799).
 */
const TABLE: Record<string, number> = {
  'H-H': 432,
  'H-F': 565,
  'H-Cl': 427,
  'H-Br': 363,
  'H-I': 295,
  'C-H': 413,
  'C-C': 347,
  'C=C': 614,
  'C≡C': 839,
  'C-N': 305,
  'C=N': 615,
  'C≡N': 891,
  'C-O': 358,
  'C=O': 745,
  'C-F': 485,
  'C-Cl': 339,
  'C-Br': 276,
  'C-I': 240,
  'C-S': 259,
  'N-H': 391,
  'N-N': 160,
  'N=N': 418,
  'N≡N': 941,
  'N-O': 201,
  'N=O': 607,
  'O-H': 467,
  'O-O': 146,
  'O=O': 495,
  'S-H': 339,
  'S-S': 266,
  'F-F': 154,
  'Cl-Cl': 239,
  'Br-Br': 193,
  'I-I': 149,
};

export const BOND_NAMES = Object.keys(TABLE);

/** The table key for a bond written either way round, such as O-H or H-O, with any dash or equals sign. */
export function bondKey(text: string): string | null {
  const cleaned = text
    .trim()
    .replace(/[–−‐‑]/g, '-')
    .replace(/#/g, '≡')
    .replace(/\s+/g, '');
  const m = /^([A-Z][a-z]?)([-=≡])([A-Z][a-z]?)$/.exec(cleaned);
  if (!m) return null;
  const forward = `${m[1]}${m[2]}${m[3]}`;
  const backward = `${m[3]}${m[2]}${m[1]}`;
  return forward in TABLE ? forward : backward in TABLE ? backward : null;
}

export interface BondCount {
  bond: string;
  count: number;
}

/** Reads "4 C-H, 2 O=O" or "C-H x4" (separated by commas, semicolons, plus signs or lines); null names a bad term. */
export function parseBonds(text: string): { ok: true; list: BondCount[] } | { ok: false; term: string } {
  const terms = text
    .split(/[,;\n+]/)
    .map((t) => t.trim())
    .filter(Boolean);
  const list: BondCount[] = [];
  for (const term of terms) {
    const lead = /^(\d+)\s*[x×*]?\s*(\S+)$/i.exec(term);
    const trail = /^(\S+?)\s*[x×*]\s*(\d+)$/i.exec(term);
    const [bondText, count] = lead ? [lead[2], Number(lead[1])] : trail ? [trail[1], Number(trail[2])] : [term, 1];
    const bond = bondKey(bondText);
    if (bond === null || !(count >= 1)) return { ok: false, term };
    list.push({ bond, count });
  }
  return { ok: true, list };
}

const sum = (list: readonly BondCount[]) => list.reduce((s, b) => s + b.count * TABLE[b.bond], 0);
const latexBond = (b: string) => b.replace('≡', '\\equiv ').replace('-', '\\text{-}');
const side = (list: readonly BondCount[]) =>
  list.map((b) => `${b.count}\\,(\\mathrm{${latexBond(b.bond)}})`).join('+') || '0';

export function bondEnthalpy(broken: string, formed: string): Outcome {
  const b = parseBonds(broken);
  if (!b.ok) return fail('kitChemMat.thermo.err.bond', { term: b.term });
  const f = parseBonds(formed);
  if (!f.ok) return fail('kitChemMat.thermo.err.bond', { term: f.term });
  if (b.list.length === 0 || f.list.length === 0) return fail('kitChemMat.thermo.err.bondsEmpty');
  const eb = sum(b.list);
  const ef = sum(f.list);
  const dH = eb - ef;
  const steps: KitStep[] = [
    {
      key: 'kitChemMat.thermo.step.bondsBroken',
      math: `\\sum D_{\\text{broken}}=${side(b.list)}=${latexNumber(eb)}\\ \\mathrm{kJ/mol}`,
    },
    {
      key: 'kitChemMat.thermo.step.bondsFormed',
      math: `\\sum D_{\\text{formed}}=${side(f.list)}=${latexNumber(ef)}\\ \\mathrm{kJ/mol}`,
    },
    {
      key: 'kitChemMat.thermo.step.bondsSum',
      math: `\\Delta H\\approx${latexNumber(eb)}-${latexNumber(ef)}=${latexNumber(dH)}\\ \\mathrm{kJ/mol}`,
    },
  ];
  return {
    ok: true,
    rows: [
      { key: 'kitChemMat.thermo.row.broken', value: eb * 1e3, dim: 'energyMol', digits: 5 },
      { key: 'kitChemMat.thermo.row.formed', value: ef * 1e3, dim: 'energyMol', digits: 5 },
      { key: 'kitChemMat.thermo.row.dHBonds', value: dH * 1e3, dim: 'energyMol', digits: 5 },
      {
        key: 'kitChemMat.thermo.row.kind',
        value: '',
        word: dH < 0 ? 'kitChemMat.thermo.word.exo' : 'kitChemMat.thermo.word.endo',
      },
    ],
    steps,
    notes: [{ key: 'kitChemMat.thermo.note.bonds' }],
    equation: '\\Delta H\\approx\\sum D_{\\text{broken}}-\\sum D_{\\text{formed}}',
    sources: ['Average bond enthalpies from general chemistry texts'],
  };
}
