// Proteins and peptides: masses, extinction coefficient, charge, and isoelectric point, hydropathy, a helical wheel,
// fragment ions, and an amino acid reference card, each from a one-letter sequence.
import { linePlot } from '../plot';
import { fail, fmt, need, ok, pct, whole, within } from '../shared';
import type { KitOk, KitStep, KitTable, MolKey, Values } from '../shared';
import { choices } from '../spec';
import type { Field, ToolSpec } from '../spec';
import { THREE } from '../sequence/codes';
import { AA_CLASS, AMINO_ACIDS, AVERAGE, KYTE_DOOLITTLE, MONO, PKA_SETS, RESIDUES } from './data';
import type { PkaSet } from './data';
import { helicalWheel } from './draw';
import {
  cleanProtein,
  composition,
  count,
  extinction,
  fragmentIons,
  gravy,
  groups,
  hill,
  hydropathy,
  isoelectric,
  massOf,
  masses,
  netCharge,
  wheel,
} from './engine';
import type { Group, Mods } from './engine';

const MODES = ['properties', 'charge', 'hydropathy', 'wheel', 'ions', 'reference'] as const;
type Mode = (typeof MODES)[number];
const is =
  (...modes: Mode[]) =>
  (values: Values) =>
    modes.includes(values.mode as Mode);
const userPka = (values: Values) => is('properties', 'charge')(values) && values.pka === 'user';
const PKA_FIELDS = ['nTerm', 'cTerm', 'K', 'R', 'H', 'D', 'E', 'C', 'Y'] as const;
const USER_DEFAULTS: Record<(typeof PKA_FIELDS)[number], string> = {
  nTerm: '9.0',
  cTerm: '2.0',
  K: '10.5',
  R: '12.5',
  H: '6.0',
  D: '3.9',
  E: '4.1',
  C: '8.3',
  Y: '10.1',
};

const fields: Field[] = [
  { id: 'mode', label: 'protein.f.mode', kind: 'select', initial: 'properties', options: choices('protein.m.', MODES) },
  {
    id: 'seq',
    label: 'protein.f.seq',
    kind: 'area',
    initial: 'MKWVTFISLLFLFSSAYS',
    hint: 'protein.f.seqHint',
    when: (v) => v.mode !== 'reference',
  },
  { id: 'disulfides', label: 'protein.f.disulfides', kind: 'number', initial: '0', when: is('properties') },
  { id: 'phospho', label: 'protein.f.phospho', kind: 'number', initial: '0', when: is('properties') },
  {
    id: 'acetyl',
    label: 'protein.f.acetyl',
    kind: 'select',
    initial: 'no',
    options: choices('w.', ['no', 'yes']),
    when: is('properties', 'charge', 'ions'),
  },
  {
    id: 'amide',
    label: 'protein.f.amide',
    kind: 'select',
    initial: 'no',
    options: choices('w.', ['no', 'yes']),
    when: is('properties', 'charge', 'ions'),
  },
  {
    id: 'pka',
    label: 'protein.f.pka',
    kind: 'select',
    initial: 'emboss',
    options: choices('protein.pka.', ['solution', 'emboss', 'bjellqvist', 'user']),
    when: is('properties', 'charge'),
  },
  ...PKA_FIELDS.map((id): Field => ({
    id: `pk${id}`,
    label: `protein.f.pk.${id}`,
    kind: 'number',
    initial: USER_DEFAULTS[id],
    when: userPka,
  })),
  { id: 'pH', label: 'protein.f.pH', kind: 'number', initial: '7', when: is('properties', 'charge') },
  {
    id: 'a280',
    label: 'protein.f.a280',
    kind: 'number',
    initial: '',
    hint: 'protein.f.a280Hint',
    when: is('properties'),
  },
  { id: 'path', label: 'protein.f.path', kind: 'number', initial: '1', when: is('properties') },
  { id: 'window', label: 'protein.f.window', kind: 'number', initial: '9', when: is('hydropathy') },
  { id: 'start', label: 'protein.f.start', kind: 'number', initial: '1', when: is('wheel') },
];

const da = (value: number, digits = 9) => `${fmt(value, digits)} Da`;

function readMods(values: Values): Mods {
  return {
    disulfides: values.mode === 'properties' ? whole(values, 'disulfides', 'protein.f.disulfides', [0, 1000]) : 0,
    acetyl: values.acetyl === 'yes',
    amide: values.amide === 'yes',
    phospho: values.mode === 'properties' ? whole(values, 'phospho', 'protein.f.phospho', [0, 1000]) : 0,
  };
}

function readPka(values: Values): PkaSet {
  if (values.pka !== 'user') return PKA_SETS[values.pka as keyof typeof PKA_SETS] ?? PKA_SETS.emboss;
  const read = (id: (typeof PKA_FIELDS)[number]) => within(values, `pk${id}`, `protein.f.pk.${id}`, [-2, 16]);
  return {
    nTerm: read('nTerm'),
    cTerm: read('cTerm'),
    K: read('K'),
    R: read('R'),
    H: read('H'),
    D: read('D'),
    E: read('E'),
    C: read('C'),
    Y: read('Y'),
  };
}

function piSteps(list: Group[], pI: number, trail: ReturnType<typeof isoelectric>['trail']): KitStep[] {
  return [
    {
      key: 'protein.s.charge',
      math:
        'z(\\mathrm{pH}) = \\sum_{\\text{bases}} \\frac{n}{1 + 10^{\\mathrm{pH} - \\mathrm{p}K_a}}' +
        ' - \\sum_{\\text{acids}} \\frac{n}{1 + 10^{\\mathrm{p}K_a - \\mathrm{pH}}}',
    },
    {
      key: 'protein.s.groups',
      vars: { groups: list.map((g) => `${g.count} ${g.name} (${fmt(g.pKa, 4)})`).join(', ') },
    },
    ...trail.map((step) => ({
      key: 'protein.s.bisect' as MolKey,
      vars: { lo: fmt(step.lo, 5), hi: fmt(step.hi, 5), mid: fmt(step.mid, 5), z: fmt(step.charge, 4) },
    })),
    { key: 'protein.s.pI', vars: { pI: fmt(pI, 4) } },
  ];
}

function compositionTable(seq: string): KitTable {
  return {
    title: 'protein.h.composition',
    head: ['protein.h.residue', 'protein.h.count', 'protein.h.share'],
    rows: composition(seq).map(([aa, n]) => [`${aa} (${THREE[aa]})`, String(n), pct(n / seq.length, 4)]),
  };
}

function concentrationRows(values: Values, epsilon: number, average: number) {
  if ((values.a280 ?? '').trim() === '') return [];
  const a = need(values, 'a280', 'protein.f.a280');
  const l = within(values, 'path', 'protein.f.path', [1e-6, 1000]);
  if (epsilon === 0) return fail('protein.e.noChromophore');
  const molar = a / (epsilon * l);
  return [
    { key: 'protein.r.concM' as MolKey, value: `${fmt(molar * 1e6, 5)} µM` },
    { key: 'protein.r.concMg' as MolKey, value: `${fmt(molar * average, 5)} mg/mL` },
  ];
}

function properties(seq: string, values: Values): KitOk {
  const mods = readMods(values);
  const m = masses(seq, mods);
  const epsReduced = extinction(seq, 0);
  const epsOxidized = extinction(seq, mods.disulfides);
  const list = groups(seq, readPka(values), mods);
  const { pI, trail } = isoelectric(list);
  const pH = within(values, 'pH', 'protein.f.pH', [0, 14]);
  const g = gravy(seq);
  return ok({
    answer: {
      key: 'protein.a.properties',
      vars: { mass: fmt(m.average, 7), pI: fmt(pI, 4), epsilon: fmt(epsOxidized, 6) },
    },
    rows: [
      { key: 'protein.r.length', value: String(seq.length) },
      { key: 'protein.r.formula', value: hill(m.formula) },
      { key: 'protein.r.mono', value: da(m.mono) },
      { key: 'protein.r.average', value: da(m.average, 7) },
      { key: 'protein.r.epsReduced', value: `${fmt(epsReduced, 6)} M⁻¹ cm⁻¹` },
      { key: 'protein.r.epsCystine', vars: { n: String(mods.disulfides) }, value: `${fmt(epsOxidized, 6)} M⁻¹ cm⁻¹` },
      { key: 'protein.r.abs1', value: m.average > 0 ? fmt(epsOxidized / m.average, 4) : '—' },
      { key: 'protein.r.pI', value: fmt(pI, 4) },
      { key: 'protein.r.chargeAt', vars: { pH: fmt(pH, 3) }, value: fmt(netCharge(list, pH), 4) },
      { key: 'protein.r.gravy', value: fmt(g, 6) },
      ...concentrationRows(values, epsOxidized, m.average),
    ],
    tables: [compositionTable(seq)],
    steps: [
      {
        key: 'protein.s.mass',
        math: 'M = \\sum_i m(\\text{residue}_i) + m(\\mathrm{H_2O}) + \\Delta m_{\\text{mods}}',
      },
      {
        key: 'protein.s.massValue',
        vars: { formula: hill(m.formula), mono: fmt(m.mono, 9), average: fmt(m.average, 7) },
      },
      {
        key: 'protein.s.epsilon',
        math:
          `\\varepsilon_{280} = 5500 \\times ${count(seq, 'W')} + 1490 \\times ${count(seq, 'Y')}` +
          ` + 125 \\times ${mods.disulfides} = ${fmt(epsOxidized, 6)}`,
      },
      ...piSteps(list, pI, trail),
      { key: 'protein.s.gravy', vars: { gravy: fmt(g, 6) } },
    ],
    notes: [
      'protein.n.average',
      'protein.n.pka',
      ...(count(seq, 'W') + count(seq, 'Y') === 0 ? ['protein.n.noAromatic' as MolKey] : []),
    ],
    source: 'protein.src.properties',
  });
}

function charge(seq: string, values: Values): KitOk {
  const mods = readMods(values);
  const list = groups(seq, readPka(values), mods);
  const { pI, trail } = isoelectric(list);
  const pH = within(values, 'pH', 'protein.f.pH', [0, 14]);
  const xs = Array.from({ length: 141 }, (_, i) => i / 10);
  return ok({
    answer: { key: 'protein.a.charge', vars: { pI: fmt(pI, 4), pH: fmt(pH, 3), z: fmt(netCharge(list, pH), 4) } },
    rows: [
      { key: 'protein.r.pI', value: fmt(pI, 4) },
      { key: 'protein.r.chargeAt', vars: { pH: fmt(pH, 3) }, value: fmt(netCharge(list, pH), 4) },
    ],
    figures: [
      {
        title: 'protein.h.chargeCurve',
        figure: linePlot({
          xLabel: 'pH',
          yLabel: { word: 'protein.h.netCharge' },
          series: [{ name: 'z', x: xs, y: xs.map((x) => netCharge(list, x)) }],
          marks: [0],
          xRange: [0, 14],
        }),
      },
    ],
    tables: [
      {
        title: 'protein.h.groups',
        head: ['protein.h.group', 'protein.h.pKa', 'protein.h.count', 'protein.h.chargeAt'],
        rows: list.map((g) => [
          g.name === 'N'
            ? { word: 'protein.w.nTerm' }
            : g.name === 'C-term'
              ? { word: 'protein.w.cTerm' }
              : `${g.name} (${THREE[g.name]})`,
          fmt(g.pKa, 4),
          String(g.count),
          fmt(netCharge([g], pH), 4),
        ]),
      },
    ],
    steps: piSteps(list, pI, trail),
    notes: ['protein.n.pka'],
    source: 'protein.src.pka',
  });
}

function hydro(seq: string, values: Values): KitOk {
  const window = whole(values, 'window', 'protein.f.window', [1, 101]);
  const h = hydropathy(seq, window);
  const g = gravy(seq);
  const peak = Math.max(...h.values);
  return ok({
    answer: { key: 'protein.a.gravy', vars: { gravy: fmt(g, 6) } },
    rows: [
      { key: 'protein.r.gravy', value: fmt(g, 6) },
      { key: 'protein.r.peak', vars: { at: String(h.mids[h.values.indexOf(peak)] ?? '') }, value: fmt(peak, 4) },
    ],
    figures: [
      {
        title: 'protein.h.hydropathy',
        figure: linePlot({
          xLabel: { word: 'protein.h.position' },
          yLabel: { word: 'protein.h.kd' },
          series: [{ name: 'KD', x: h.mids, y: h.values }],
          marks: [0, 1.6],
        }),
      },
    ],
    steps: [
      { key: 'protein.s.gravyRule', math: '\\mathrm{GRAVY} = \\frac{1}{n} \\sum_i h_i' },
      { key: 'protein.s.window', vars: { window: String(window) } },
    ],
    notes: ['protein.n.membrane'],
    source: 'protein.src.kd',
  });
}

function wheelMode(seq: string, values: Values): KitOk {
  const start = whole(values, 'start', 'protein.f.start', [1, seq.length]);
  const part = seq.slice(start - 1, start - 1 + 18);
  const w = wheel(part);
  return ok({
    answer: {
      key: 'protein.a.wheel',
      vars: { from: String(start), to: String(start + part.length - 1), moment: fmt(w.moment, 4) },
    },
    rows: [
      { key: 'protein.r.shown', value: `${start}–${start + part.length - 1}` },
      { key: 'protein.r.moment', value: fmt(w.moment, 4) },
    ],
    figures: [{ title: 'protein.h.wheel', figure: helicalWheel(part, w.angles) }],
    steps: [
      { key: 'protein.s.wheel' },
      { key: 'protein.s.moment', math: '\\mu_H = \\frac{1}{n}\\left|\\sum_k h_k e^{i k \\cdot 100^\\circ}\\right|' },
    ],
    source: 'protein.src.kd',
  });
}

function ions(seq: string, values: Values): KitOk {
  const list = fragmentIons(seq, readMods(values));
  const n = seq.length;
  return ok({
    answer: { key: 'protein.a.ions', vars: { b1: fmt(list[0]!.b, 9), y1: fmt(list[0]!.y, 9) } },
    rows: [
      { key: 'protein.r.mh', value: da(list[n - 1]!.y) },
      { key: 'protein.r.b1', value: fmt(list[0]!.b, 9) },
      { key: 'protein.r.y1', value: fmt(list[0]!.y, 9) },
    ],
    tables: [
      {
        title: 'protein.h.ions',
        head: ['protein.h.bIndex', 'protein.h.residue', 'protein.h.b', 'protein.h.y', 'protein.h.yIndex'],
        rows: [...seq].map((aa, i) => [
          String(i + 1),
          aa,
          i < n - 1 ? fmt(list[i]!.b, 9) : '—',
          i > 0 ? fmt(list[n - 1 - i]!.y, 9) : '—',
          String(n - i),
        ]),
      },
    ],
    steps: [
      { key: 'protein.s.bIon', math: 'b_i = \\sum_{k=1}^{i} m_k + m_{\\mathrm{H^+}}' },
      { key: 'protein.s.yIon', math: 'y_j = \\sum_{k=n-j+1}^{n} m_k + m(\\mathrm{H_2O}) + m_{\\mathrm{H^+}}' },
    ],
    notes: ['protein.n.ions'],
    source: 'protein.src.masses',
  });
}

function reference(): KitOk {
  const set = PKA_SETS.solution;
  const side: Record<string, number> = { K: set.K, R: set.R, H: set.H, D: set.D, E: set.E, C: set.C, Y: set.Y };
  return ok({
    answer: { key: 'protein.a.reference' },
    rows: [],
    tables: [
      {
        title: 'protein.h.card',
        head: [
          'protein.h.one',
          'protein.h.three',
          'protein.h.name',
          'protein.h.class',
          'protein.h.sidePka',
          'protein.h.kdShort',
          'protein.h.monoRes',
          'protein.h.avgRes',
        ],
        rows: [...AMINO_ACIDS].map((aa) => [
          aa,
          THREE[aa] ?? '',
          { word: `protein.aa.${aa}` as MolKey },
          { word: `protein.w.${AA_CLASS[aa]}` as MolKey },
          side[aa] === undefined ? '—' : fmt(side[aa], 4),
          fmt(KYTE_DOOLITTLE[aa]!, 3),
          fmt(massOf(RESIDUES[aa]!, MONO), 9),
          fmt(massOf(RESIDUES[aa]!, AVERAGE), 6),
        ]),
      },
    ],
    notes: ['protein.n.card'],
    source: 'protein.src.properties',
  });
}

const RUN: Record<Exclude<Mode, 'reference'>, (seq: string, values: Values) => KitOk> = {
  properties,
  charge,
  hydropathy: hydro,
  wheel: wheelMode,
  ions,
};

export const spec: ToolSpec = {
  id: 'protein',
  fields,
  run(values) {
    const mode = MODES.includes(values.mode as Mode) ? (values.mode as Mode) : 'properties';
    if (mode === 'reference') return reference();
    return RUN[mode](cleanProtein(values.seq ?? ''), values);
  },
};
