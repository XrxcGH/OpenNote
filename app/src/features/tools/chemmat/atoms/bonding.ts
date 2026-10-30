// Atoms and bonding: an element's configuration and trends (from the reference tables), formal charge, VSEPR shapes with
// hybridization, and molecular-orbital filling for the homonuclear diatomics of the first two periods.
import { ELEMENTS } from '../../reference/data';
import type { Element } from '../../reference/data';
import { latexNumber } from '../chemText';
import { fail } from '../types';
import type { KitStep, Outcome, Row } from '../types';
import type { MessageKey } from '../../../../strings/t';

// ---------- Elements ----------

/** Finds an element by symbol (any case), by name, or by atomic number. */
export function findElement(text: string): Element | null {
  const t = text.trim();
  if (t === '') return null;
  if (/^\d+$/.test(t)) return ELEMENTS.find((e) => e.number === Number(t)) ?? null;
  const lower = t.toLowerCase();
  return ELEMENTS.find((e) => e.symbol.toLowerCase() === lower || e.name.toLowerCase() === lower) ?? null;
}

/** Valence electrons from the group: s and p electrons for the main groups, and ns plus (n-1)d for the d block. Null for f. */
export function valenceElectrons(e: Element): number | null {
  const g = e.groupNumber;
  if (g === null) return null;
  if (e.number === 2) return 2;
  return g >= 13 ? g - 10 : g;
}

/** What the electronegativity difference suggests about a bond (the usual rule of thumb). */
export function bondType(difference: number): MessageKey {
  if (difference < 0.4) return 'kitChemMat.at.bond.nonpolar';
  if (difference < 1.7) return 'kitChemMat.at.bond.polar';
  return 'kitChemMat.at.bond.ionic';
}

export function element(first: string, second: string): Outcome {
  const a = findElement(first);
  if (!a) return fail('kitChemMat.at.err.element', { text: first.trim() });
  const rows: Row[] = [
    { key: 'kitChemMat.at.row.symbol', value: `${a.symbol} (${a.name}), Z = ${a.number}` },
    { key: 'kitChemMat.at.row.configuration', value: a.configuration },
    { key: 'kitChemMat.at.row.period', value: String(a.period) },
    { key: 'kitChemMat.at.row.group', value: a.groupNumber === null ? '–' : String(a.groupNumber) },
  ];
  const v = valenceElectrons(a);
  if (v !== null) rows.push({ key: 'kitChemMat.at.row.valence', value: String(v) });
  if (a.electronegativity !== null)
    rows.push({ key: 'kitChemMat.at.row.electronegativity', value: a.electronegativity, digits: 3 });
  if (a.oxidation !== '') rows.push({ key: 'kitChemMat.at.row.oxidation', value: a.oxidation });
  const steps: KitStep[] = [{ key: 'kitChemMat.at.step.aufbau' }];
  const notes: { key: MessageKey }[] = [{ key: 'kitChemMat.at.note.config' }];
  if (second.trim() !== '') {
    const b = findElement(second);
    if (!b) return fail('kitChemMat.at.err.element', { text: second.trim() });
    if (a.electronegativity === null || b.electronegativity === null) return fail('kitChemMat.at.err.noEn');
    const d = Math.abs(a.electronegativity - b.electronegativity);
    rows.push({ key: 'kitChemMat.at.row.second', value: `${b.symbol} (${b.name}), χ = ${b.electronegativity}` });
    rows.push({ key: 'kitChemMat.at.row.deltaEn', value: d, digits: 3 });
    rows.push({ key: 'kitChemMat.at.row.bondType', value: '', word: bondType(d) });
    steps.push({
      key: 'kitChemMat.at.step.deltaEn',
      math:
        `\\Delta\\chi=|${latexNumber(a.electronegativity, 3)}-${latexNumber(b.electronegativity, 3)}|=` +
        `${latexNumber(d, 3)}`,
    });
    notes.push({ key: 'kitChemMat.at.note.bond' });
  }
  return { ok: true, rows, steps, notes, equation: '\\Delta\\chi=|\\chi_A-\\chi_B|' };
}

// ---------- Formal charge ----------

export function formalCharge(valence: number, lonePairElectrons: number, bondingElectrons: number): Outcome {
  if (!Number.isInteger(valence) || valence < 0 || valence > 8) return fail('kitChemMat.at.err.valence');
  if (!Number.isInteger(lonePairElectrons) || lonePairElectrons < 0 || lonePairElectrons > 8)
    return fail('kitChemMat.at.err.nonbonding');
  if (!Number.isInteger(bondingElectrons) || bondingElectrons < 0 || bondingElectrons % 2 !== 0)
    return fail('kitChemMat.at.err.bonding');
  if (lonePairElectrons % 2 !== 0) return fail('kitChemMat.at.err.nonbondingOdd');
  const fc = valence - lonePairElectrons - bondingElectrons / 2;
  return {
    ok: true,
    rows: [{ key: 'kitChemMat.at.row.formal', value: fc > 0 ? `+${fc}` : String(fc) }],
    steps: [
      {
        key: 'kitChemMat.at.step.formal',
        math: `\\mathrm{FC}=V-N-\\frac B2=${valence}-${lonePairElectrons}-\\frac{${bondingElectrons}}{2}=${fc}`,
      },
    ],
    notes: [{ key: 'kitChemMat.at.note.formal' }],
    equation: '\\mathrm{FC}=V-N-\\tfrac12 B',
  };
}

// ---------- VSEPR ----------

interface Shape {
  geometry: MessageKey;
  shape: MessageKey;
  angle: MessageKey;
}

const geomKey = (name: string) => `kitChemMat.at.geom.${name}` as MessageKey;
const shapeKey = (name: string) => `kitChemMat.at.shape.${name}` as MessageKey;
const angleKey = (name: string) => `kitChemMat.at.angle.${name}` as MessageKey;

/** The shapes by number of bonded atoms and lone pairs on the central atom, keyed "X,E". */
const SHAPES: Readonly<Record<string, Shape>> = {
  '1,0': { geometry: geomKey('linear'), shape: shapeKey('diatomic'), angle: angleKey('none') },
  '1,2': { geometry: geomKey('linear'), shape: shapeKey('diatomic'), angle: angleKey('none') },
  '1,3': { geometry: geomKey('linear'), shape: shapeKey('diatomic'), angle: angleKey('none') },
  '1,1': { geometry: geomKey('linear'), shape: shapeKey('diatomic'), angle: angleKey('none') },
  '2,0': { geometry: geomKey('linear'), shape: shapeKey('linear'), angle: angleKey('a180') },
  '3,0': { geometry: geomKey('trigonalPlanar'), shape: shapeKey('trigonalPlanar'), angle: angleKey('a120') },
  '2,1': { geometry: geomKey('trigonalPlanar'), shape: shapeKey('bent'), angle: angleKey('lt120') },
  '4,0': { geometry: geomKey('tetrahedral'), shape: shapeKey('tetrahedral'), angle: angleKey('a1095') },
  '3,1': { geometry: geomKey('tetrahedral'), shape: shapeKey('trigonalPyramidal'), angle: angleKey('lt1095') },
  '2,2': { geometry: geomKey('tetrahedral'), shape: shapeKey('bent'), angle: angleKey('lt1095') },
  '5,0': {
    geometry: geomKey('trigonalBipyramidal'),
    shape: shapeKey('trigonalBipyramidal'),
    angle: angleKey('a90120'),
  },
  '4,1': { geometry: geomKey('trigonalBipyramidal'), shape: shapeKey('seesaw'), angle: angleKey('lt90120') },
  '3,2': { geometry: geomKey('trigonalBipyramidal'), shape: shapeKey('tShaped'), angle: angleKey('lt90') },
  '2,3': { geometry: geomKey('trigonalBipyramidal'), shape: shapeKey('linear'), angle: angleKey('a180') },
  '6,0': { geometry: geomKey('octahedral'), shape: shapeKey('octahedral'), angle: angleKey('a90') },
  '5,1': { geometry: geomKey('octahedral'), shape: shapeKey('squarePyramidal'), angle: angleKey('lt90') },
  '4,2': { geometry: geomKey('octahedral'), shape: shapeKey('squarePlanar'), angle: angleKey('a90') },
};

const HYBRID: Record<number, string> = { 2: 'sp', 3: 'sp²', 4: 'sp³', 5: 'sp³d', 6: 'sp³d²' };

export function vsepr(bonded: number, lonePairs: number, terminalsAlike: boolean): Outcome {
  if (!Number.isInteger(bonded) || bonded < 1 || bonded > 6) return fail('kitChemMat.at.err.bonded');
  if (!Number.isInteger(lonePairs) || lonePairs < 0 || lonePairs > 3) return fail('kitChemMat.at.err.lone');
  const domains = bonded + lonePairs;
  if (domains > 6) return fail('kitChemMat.at.err.domains');
  const entry = SHAPES[`${bonded},${lonePairs}`];
  if (!entry) return fail('kitChemMat.at.err.unknownShape', { x: String(bonded), e: String(lonePairs) });
  const label = `AX${bonded === 1 ? '' : bonded}${lonePairs === 0 ? '' : lonePairs === 1 ? 'E' : `E${lonePairs}`}`;
  const rows: Row[] = [
    { key: 'kitChemMat.at.row.axe', value: label },
    { key: 'kitChemMat.at.row.domains', value: String(domains) },
    { key: 'kitChemMat.at.row.geometry', value: '', word: entry.geometry },
    { key: 'kitChemMat.at.row.shape', value: '', word: entry.shape },
    { key: 'kitChemMat.at.row.angles', value: '', word: entry.angle },
  ];
  if (domains >= 2) rows.push({ key: 'kitChemMat.at.row.hybrid', value: HYBRID[domains] });
  // A molecule is nonpolar when its identical bonds cancel: the symmetric shapes without lone pairs, and the two
  // lone-pair shapes whose pairs sit opposite each other (square planar, and the linear AX2E3).
  const symmetric = ['5,0', '3,0', '4,0', '2,0', '6,0', '4,2', '2,3'].includes(`${bonded},${lonePairs}`);
  if (bonded >= 2) {
    const polar: MessageKey =
      symmetric && terminalsAlike ? 'kitChemMat.at.word.cancel' : 'kitChemMat.at.word.polarShape';
    rows.push({ key: 'kitChemMat.at.row.polarity', value: '', word: polar });
  }
  return {
    ok: true,
    rows,
    steps: [{ key: 'kitChemMat.at.step.vsepr', math: `${bonded}+${lonePairs}=${domains}\\ \\text{electron domains}` }],
    notes: [{ key: 'kitChemMat.at.note.vsepr' }],
    equation: 'AX_nE_m,\\quad n+m=\\text{domains}',
  };
}

// ---------- Molecular orbitals of homonuclear diatomics ----------

interface Orbital {
  name: string;
  capacity: number;
  /** Degenerate orbitals in the set (2 for a pi set). */
  degeneracy: number;
  bonding: boolean;
}

const orbital = (name: string, capacity: number, degeneracy: number, bonding: boolean): Orbital => ({
  name,
  capacity,
  degeneracy,
  bonding,
});

/** Valence MOs of period 2, lowest energy first. Through N2 the sigma 2p lies above the pi 2p set (s-p mixing). */
const PERIOD2_MIXED: readonly Orbital[] = [
  orbital('σ2s', 2, 1, true),
  orbital('σ*2s', 2, 1, false),
  orbital('π2p', 4, 2, true),
  orbital('σ2p', 2, 1, true),
  orbital('π*2p', 4, 2, false),
  orbital('σ*2p', 2, 1, false),
];
const PERIOD2_PLAIN: readonly Orbital[] = [
  PERIOD2_MIXED[0],
  PERIOD2_MIXED[1],
  PERIOD2_MIXED[3],
  PERIOD2_MIXED[2],
  PERIOD2_MIXED[4],
  PERIOD2_MIXED[5],
];
const PERIOD1: readonly Orbital[] = [orbital('σ1s', 2, 1, true), orbital('σ*1s', 2, 1, false)];

/** The molecule's valence electrons and the symbol list, or a reason it is not supported. */
export interface MoInput {
  atom: string;
  charge: number;
}

/** Fills a set of orbitals with electrons: lowest first, and electrons spread over a degenerate set before pairing. */
export function fillOrbitals(order: readonly Orbital[], electrons: number) {
  let left = electrons;
  const filled = order.map((o) => {
    const take = Math.min(left, o.capacity);
    left -= take;
    // Spread over the degenerate orbitals first (one up spin in each), then pair up.
    const spin = new Array<number>(o.degeneracy).fill(0);
    for (let k = 0; k < take; k++) spin[k % o.degeneracy] += 1;
    return { orbital: o, electrons: take, spin };
  });
  return { filled, left };
}

const arrows = (count: number) => (count === 0 ? '' : count === 1 ? '↑' : '↑↓');

export function molecularOrbitals(input: MoInput): Outcome {
  const el = findElement(input.atom);
  if (!el || el.number > 10) return fail('kitChemMat.at.err.moAtom');
  if (!Number.isInteger(input.charge) || Math.abs(input.charge) > 4) return fail('kitChemMat.at.err.moCharge');
  const valencePerAtom = el.number <= 2 ? el.number : el.number - 2;
  const electrons = 2 * valencePerAtom - input.charge;
  if (electrons < 0) return fail('kitChemMat.at.err.moElectrons');
  const period1 = el.number <= 2;
  const mixed = el.number <= 7;
  const order = period1 ? PERIOD1 : mixed ? PERIOD2_MIXED : PERIOD2_PLAIN;
  const capacity = order.reduce((sum, o) => sum + o.capacity, 0);
  if (electrons > capacity) return fail('kitChemMat.at.err.moElectrons');
  const { filled } = fillOrbitals(order, electrons);
  let bonding = 0;
  let anti = 0;
  let unpaired = 0;
  for (const f of filled) {
    if (f.orbital.bonding) bonding += f.electrons;
    else anti += f.electrons;
    for (const n of f.spin) if (n === 1) unpaired += 1;
  }
  const bondOrder = (bonding - anti) / 2;
  const sign = input.charge > 0 ? '⁺' : '⁻';
  const count = Math.abs(input.charge) === 1 ? '' : '²³⁴'[Math.abs(input.charge) - 2];
  const label = `${el.symbol}₂${input.charge === 0 ? '' : count + sign}`;
  const table = filled
    .slice()
    .reverse()
    .map((f) => [f.orbital.name, f.orbital.bonding ? '+' : '−', f.spin.map(arrows).join('  ') || '–']);
  const rows: Row[] = [
    { key: 'kitChemMat.at.row.molecule', value: label },
    { key: 'kitChemMat.at.row.valenceElectrons', value: String(electrons) },
    { key: 'kitChemMat.at.row.bondOrder', value: bondOrder, digits: 3 },
    { key: 'kitChemMat.at.row.unpaired', value: String(unpaired) },
    {
      key: 'kitChemMat.at.row.magnetism',
      value: '',
      word: unpaired > 0 ? 'kitChemMat.at.word.paramagnetic' : 'kitChemMat.at.word.diamagnetic',
    },
  ];
  if (bondOrder <= 0) rows.push({ key: 'kitChemMat.at.row.stable', value: '', word: 'kitChemMat.at.word.unbound' });
  const notes: { key: MessageKey }[] = [{ key: 'kitChemMat.at.note.mo' }];
  if (!period1) notes.push({ key: mixed ? 'kitChemMat.at.note.mixing' : 'kitChemMat.at.note.noMixing' });
  return {
    ok: true,
    rows,
    steps: [
      {
        key: 'kitChemMat.at.step.moFill',
        math: `\\text{bond order}=\\frac{n_b-n_a}{2}=\\frac{${bonding}-${anti}}{2}=${latexNumber(bondOrder, 3)}`,
      },
    ],
    notes,
    tables: [
      {
        title: 'kitChemMat.at.table.mo',
        header: ['kitChemMat.at.col.orbital', 'kitChemMat.at.col.character', 'kitChemMat.at.col.filling'],
        rows: table,
      },
    ],
    equation: '\\text{bond order}=\\frac{n_b-n_a}{2}',
  };
}
