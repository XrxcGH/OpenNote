// Family, pedigree, and kinship charts: genetic pedigrees with an inheritance-pattern check and Mendelian
// probabilities, relationship and inbreeding coefficients by path counting, kin types from Ego with a terminology
// table, genealogy lists with an order of succession, and genograms with relationship lines and households.
import { fail, fmt, lines, ok, within } from '../shared';
import type { Cell, KitOk, KitStep, KitTable, MolKey, Values } from '../shared';
import { choices } from '../spec';
import type { Field, ToolSpec } from '../spec';
import { chartFigure } from './chart';
import type { ChartOptions } from './chart';
import {
  ancestors,
  cousinKind,
  descendants,
  kinType,
  kinship,
  paths,
  readKinType,
  relationship,
  succession,
} from './kin';
import { peel, statesOf } from './peel';
import type { Mode as PeelMode } from './peel';
import { readFamily } from './people';
import type { Family } from './people';
import { checkPatterns } from './rules';

const MODES = ['pedigree', 'probability', 'relationship', 'kinship', 'genealogy', 'genogram'] as const;
type Mode = (typeof MODES)[number];
const is =
  (...modes: Mode[]) =>
  (v: Values) =>
    modes.includes((v.mode ?? 'pedigree') as Mode);

const PEOPLE = [
  'Bob, M, , , deceased, b. 1938',
  'Ann, F, , , , b. 1940',
  'Carl, M, Bob, Ann',
  'Eve, F',
  'Dina, F, Bob, Ann',
  'Fred, M',
  'Kim, F, Bob, Ann',
  'Gus, M, Carl, Eve',
  'Hana, F, Carl, Eve, affected proband',
  'Ivy, F, Fred, Dina',
  'Joe, M, Fred, Dina',
].join('\n');

const fields: Field[] = [
  { id: 'mode', label: 'family.f.mode', kind: 'select', initial: 'pedigree', options: choices('family.m.', MODES) },
  { id: 'people', label: 'family.f.people', kind: 'area', initial: PEOPLE, hint: 'family.f.peopleHint' },
  {
    id: 'penetrance',
    label: 'family.f.penetrance',
    kind: 'select',
    initial: 'complete',
    options: choices('family.penetrance.', ['complete', 'incomplete']),
    when: is('pedigree'),
  },
  {
    id: 'rare',
    label: 'family.f.rare',
    kind: 'select',
    initial: 'yes',
    options: choices('family.yesNo.', ['yes', 'no']),
    when: is('pedigree'),
  },
  {
    id: 'pattern',
    label: 'family.f.pattern',
    kind: 'select',
    initial: 'ar',
    options: choices('family.pattern.', ['ar', 'ad', 'xr', 'xd']),
    when: is('probability'),
  },
  { id: 'q', label: 'family.f.q', kind: 'number', initial: '0.001', hint: 'family.f.qHint', when: is('probability') },
  { id: 'target', label: 'family.f.target', kind: 'text', initial: 'Gus', when: is('probability') },
  { id: 'a', label: 'family.f.a', kind: 'text', initial: 'Gus', when: is('relationship') },
  { id: 'b', label: 'family.f.b', kind: 'text', initial: 'Ivy', when: is('relationship') },
  { id: 'ego', label: 'family.f.ego', kind: 'text', initial: 'Hana', when: is('kinship') },
  {
    id: 'kintype',
    label: 'family.f.kintype',
    kind: 'text',
    initial: 'FBD',
    hint: 'family.f.kintypeHint',
    when: is('kinship'),
  },
  {
    id: 'terms',
    label: 'family.f.terms',
    kind: 'area',
    initial: 'FZD = cousin\nFB = uncle\nF = father',
    hint: 'family.f.termsHint',
    when: is('kinship'),
  },
  { id: 'holder', label: 'family.f.holder', kind: 'text', initial: 'Bob', when: is('genealogy') },
  {
    id: 'rule',
    label: 'family.f.rule',
    kind: 'select',
    initial: 'absolute',
    options: choices('family.succession.', ['absolute', 'male']),
    when: is('genealogy'),
  },
  {
    id: 'relations',
    label: 'family.f.relations',
    kind: 'area',
    initial: 'Carl Eve close\nDina Fred conflict\nCarl Dina distant',
    hint: 'family.f.relationsHint',
    when: is('genogram'),
  },
  {
    id: 'households',
    label: 'family.f.households',
    kind: 'area',
    initial: 'Carl Eve Gus Hana',
    hint: 'family.f.householdsHint',
    when: is('genogram'),
  },
];

/** A dyadic or small fraction for a probability or coefficient, else the decimal. */
export function fraction(x: number): string {
  for (let d = 1; d <= 1 << 20; d *= 2) {
    const n = Math.round(x * d);
    if (Math.abs(n / d - x) < 1e-12) return d === 1 ? String(n) : `${n}/${d}`;
  }
  for (let d = 3; d <= 64; d++) {
    const n = Math.round(x * d);
    if (Math.abs(n / d - x) < 1e-9) return `${n}/${d}`;
  }
  return fmt(x);
}

const person = (family: Family, values: Values, id: string, label: MolKey): string => {
  const name = (values[id] ?? '').trim();
  if (name === '') return fail('family.e.choose', { field: label });
  if (!family.byId.has(name)) return fail('family.e.unknownPerson', { id: name });
  return name;
};

const chart = (family: Family, options?: ChartOptions) => {
  const { figure } = chartFigure(family, options);
  return { title: 'family.h.chart' as MolKey, figure };
};

function pedigree(values: Values): KitOk {
  const family = readFamily(values.people ?? '');
  const incomplete = values.penetrance === 'incomplete';
  const verdicts = checkPatterns(family, { incomplete, rare: values.rare !== 'no' });
  const fits = verdicts.filter((v) => v.consistent).map((v) => v.pattern);
  const steps: KitStep[] = verdicts.map((v) =>
    v.consistent
      ? { key: 'family.s.fits', vars: { pattern: v.pattern } }
      : { key: `family.rule.${v.rule}` as MolKey, vars: { ...v.vars, pattern: v.pattern } },
  );
  return ok({
    answer: {
      key: fits.length > 0 ? 'family.a.patterns' : 'family.a.noPattern',
      vars: Object.fromEntries(verdicts.map((v) => [v.pattern, v.consistent ? 'yes' : 'no'])),
    },
    rows: verdicts.map((v) => ({
      key: `family.pattern.${v.pattern}` as MolKey,
      value: '',
      word: v.consistent ? 'family.w.consistent' : 'family.w.excluded',
    })),
    tables: [
      {
        title: 'family.h.patterns',
        head: ['family.h.pattern', 'family.h.verdict', 'family.h.reason'],
        rows: verdicts.map((v): Cell[] => [
          { word: `family.pattern.${v.pattern}` as MolKey },
          { word: v.consistent ? 'family.w.consistent' : 'family.w.excluded' },
          v.consistent ? '—' : { word: `family.rule.${v.rule}` as MolKey, vars: { ...v.vars, pattern: v.pattern } },
        ]),
      },
    ],
    figures: [chart(family)],
    steps,
    notes: ['family.n.rules', ...(incomplete ? ['family.n.incomplete' as MolKey] : []), 'family.n.symbols'],
    source: 'family.src.nsgc',
  });
}

const STATE_KEYS: Record<string, MolKey[]> = {
  auto: ['family.state.zero', 'family.state.one', 'family.state.two'],
  male: ['family.state.maleZero', 'family.state.maleOne'],
};

function probability(values: Values): KitOk {
  const family = readFamily(values.people ?? '');
  const mode = (['ar', 'ad', 'xr', 'xd'].includes(values.pattern ?? '') ? values.pattern : 'ar') as PeelMode;
  const q = within(values, 'q', 'family.f.q', [1e-12, 0.5]);
  const target = person(family, values, 'target', 'family.f.target');
  const result = peel(family, mode, q, target);
  const p = family.byId.get(target)!;
  const male = statesOf(mode, p) === 2;
  const keys = male ? STATE_KEYS.male! : STATE_KEYS.auto!;
  const heterozygote = result.posterior[1]!;
  const extra = new Map([[target, `P = ${fmt(heterozygote, 4)}`]]);
  return ok({
    answer: {
      key: male ? 'family.a.probabilityMale' : 'family.a.probability',
      vars: { id: target, p: fmt(heterozygote, 5), fraction: fraction(heterozygote) },
    },
    rows: result.posterior.map((v, g) => ({ key: keys[g]!, value: `${fmt(v, 6)} (${fraction(v)})` })),
    tables: [
      {
        title: 'family.h.peeling',
        head: ['family.h.step', 'family.h.person', 'family.h.size'],
        rows: result.order.map((o, k) => [String(k + 1), o.id, String(o.size)]),
      },
    ],
    figures: [chart(family, { extra, highlight: new Set([target]) })],
    steps: [
      { key: 'family.s.priors', vars: { q: fmt(q) }, math: `P(0) = (1-q)^2,\\ P(1) = 2q(1-q),\\ P(2) = q^2` },
      { key: 'family.s.transmission' },
      { key: 'family.s.evidence' },
      { key: 'family.s.peel', vars: { count: String(result.order.length), likelihood: fmt(result.likelihood, 4) } },
      { key: 'family.s.posterior', vars: { id: target, p: fmt(heterozygote, 6) } },
    ],
    notes: ['family.n.peel', 'family.n.coursework'],
  });
}

function related(values: Values): KitOk {
  const family = readFamily(values.people ?? '');
  const a = person(family, values, 'a', 'family.f.a');
  const b = person(family, values, 'b', 'family.f.b');
  if (a === b) fail('family.e.samePerson');
  const list = paths(family, a, b);
  const r = relationship(list);
  const phi = kinship(family)(a, b);
  const math =
    list.length > 0
      ? `r = \\sum \\left(\\tfrac{1}{2}\\right)^{n}(1 + F_A) = ${list.map((p) => `(\\tfrac{1}{2})^{${p.steps}}`).join(' + ')} = ${fraction(r)}`
      : 'r = 0';
  return ok({
    answer: { key: 'family.a.relationship', vars: { a, b, r: fraction(r), f: fraction(phi) } },
    rows: [
      { key: 'family.r.r', value: `${fraction(r)} (${fmt(r)})` },
      { key: 'family.r.kinship', value: `${fraction(phi)} (${fmt(phi)})` },
      { key: 'family.r.childF', value: `${fraction(phi)} (${fmt(phi)})` },
      { key: 'family.r.paths', value: String(list.length) },
    ],
    tables: [
      {
        title: 'family.h.paths',
        head: ['family.h.ancestor', 'family.h.path', 'family.h.steps', 'family.h.adds'],
        rows: list.map((p) => [
          p.ancestor,
          p.people.join(' – '),
          String(p.steps),
          fraction(0.5 ** p.steps * (1 + p.ancestorF)),
        ]),
      },
    ],
    latex: math,
    figures: [chart(family, { highlight: new Set([a, b]) })],
    steps: [
      { key: 'family.s.paths', vars: { count: String(list.length) } },
      { key: 'family.s.sum', math },
      { key: 'family.s.kinship', math: `F_{\\text{child}} = \\varphi_{${a}${b}} = ${fraction(phi)}` },
    ],
    notes: ['family.n.paths'],
  });
}

function readTerms(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of lines(text)) {
    const at = line.indexOf('=');
    if (at === -1) fail('family.e.termLine', { line });
    out.set(readKinType(line.slice(0, at)), line.slice(at + 1).trim());
  }
  return out;
}

function kin(values: Values): KitOk {
  const family = readFamily(values.people ?? '');
  const ego = person(family, values, 'ego', 'family.f.ego');
  const terms = readTerms(values.terms ?? '');
  const types = new Map<string, string>();
  for (const p of family.people) {
    try {
      types.set(p.id, kinType(family, ego, p.id));
    } catch {
      types.set(p.id, '—');
    }
  }
  const typed = (values.kintype ?? '').trim();
  const reading = typed === '' ? null : readKinType(typed);
  const kind = reading ? cousinKind(reading) : null;
  const tables: KitTable[] = [
    {
      title: 'family.h.kinTypes',
      head: ['family.h.person', 'family.h.kinType', 'family.h.term'],
      rows: family.people.map((p) => [p.id, types.get(p.id)!, terms.get(types.get(p.id)!) ?? '—']),
    },
  ];
  if (reading) {
    tables.unshift({
      title: 'family.h.reading',
      vars: { type: reading },
      head: ['family.h.letter', 'family.h.relative'],
      rows: [...reading].map((ch) => [ch, { word: `family.kin.${ch}` as MolKey }]),
    });
  }
  const extra = new Map([...types].map(([id, t]) => [id, terms.get(t) ? `${t} · ${terms.get(t)}` : t]));
  return ok({
    answer: reading
      ? {
          key: kind ? `family.a.cousin.${kind}` : terms.has(reading) ? 'family.a.kinTerm' : 'family.a.kinType',
          vars: { type: reading, term: terms.get(reading) ?? '' },
        }
      : { key: 'family.a.kinChart', vars: { ego } },
    rows: [
      ...(reading
        ? [
            { key: 'family.r.kinType' as MolKey, value: reading },
            {
              key: 'family.r.cousin' as MolKey,
              value: '',
              word: kind ? (`family.w.${kind}` as MolKey) : ('family.w.notCousin' as MolKey),
            },
            { key: 'family.r.term' as MolKey, value: terms.get(reading) ?? '—' },
          ]
        : []),
      { key: 'family.r.ego', value: ego },
    ],
    tables,
    figures: [chart(family, { extra, highlight: new Set([ego]) })],
    steps: [
      { key: 'family.s.kinLetters' },
      { key: 'family.s.kinPath', vars: { ego } },
      ...(reading && kind ? [{ key: 'family.s.cousin' as MolKey, vars: { type: reading } }] : []),
    ],
    notes: ['family.n.kin'],
  });
}

function genealogy(values: Values): KitOk {
  const family = readFamily(values.people ?? '');
  const holder = person(family, values, 'holder', 'family.f.holder');
  const up = ancestors(family, holder);
  const down = descendants(family, holder);
  const male = values.rule === 'male';
  const line = succession(family, holder, male);
  const label = (id: string) => family.byId.get(id)!.label;
  return ok({
    answer: { key: line.length > 0 ? 'family.a.heir' : 'family.a.noHeir', vars: { holder, heir: line[0] ?? '' } },
    rows: [
      { key: 'family.r.ancestors', value: String(up.length) },
      { key: 'family.r.descendants', value: String(down.length) },
      { key: 'family.r.heir', value: line[0] ?? '—' },
    ],
    tables: [
      {
        title: 'family.h.succession',
        head: ['family.h.place', 'family.h.person', 'family.h.label'],
        rows: line.map((id, k) => [String(k + 1), id, label(id) || '—']),
      },
      {
        title: 'family.h.descendants',
        head: ['family.h.generation', 'family.h.person', 'family.h.label'],
        rows: down.map((d) => [String(d.generation), d.id, label(d.id) || '—']),
      },
      {
        title: 'family.h.ancestors',
        head: ['family.h.generation', 'family.h.person', 'family.h.label'],
        rows: up.map((d) => [String(d.generation), d.id, label(d.id) || '—']),
      },
    ],
    figures: [chart(family, { highlight: new Set([holder]) })],
    steps: [{ key: male ? 'family.s.male' : 'family.s.absolute' }, { key: 'family.s.deceased' }],
    notes: ['family.n.succession'],
  });
}

const KINDS = ['close', 'distant', 'conflict', 'cutoff'] as const;

function genogram(values: Values): KitOk {
  const family = readFamily(values.people ?? '');
  const relations = lines(values.relations ?? '').map((line) => {
    const [a = '', b = '', kind = '', extra] = line.split(/\s+/);
    if (extra !== undefined || !KINDS.includes(kind as (typeof KINDS)[number])) fail('family.e.relationLine', { line });
    for (const id of [a, b]) if (!family.byId.has(id)) fail('family.e.unknownPerson', { id });
    return { a, b, kind: kind as (typeof KINDS)[number] };
  });
  const households = lines(values.households ?? '').map((line) => {
    const ids = line.split(/[\s,]+/).filter(Boolean);
    for (const id of ids) if (!family.byId.has(id)) fail('family.e.unknownPerson', { id });
    return ids;
  });
  return ok({
    answer: {
      key: 'family.a.genogram',
      vars: { people: String(family.people.length), relations: String(relations.length) },
    },
    rows: [
      { key: 'family.r.people', value: String(family.people.length) },
      { key: 'family.r.relations', value: String(relations.length) },
      { key: 'family.r.households', value: String(households.length) },
    ],
    tables: [
      {
        title: 'family.h.relations',
        head: ['family.h.person', 'family.h.person', 'family.h.kind'],
        rows: relations.map((r) => [r.a, r.b, { word: `family.kind.${r.kind}` as MolKey }]),
      },
    ],
    figures: [chart(family, { relations, households })],
    steps: [{ key: 'family.s.genogram' }],
    notes: ['family.n.genogram'],
  });
}

export const spec: ToolSpec = {
  id: 'family',
  fields,
  run(values) {
    switch (values.mode as Mode) {
      case 'probability':
        return probability(values);
      case 'relationship':
        return related(values);
      case 'kinship':
        return kin(values);
      case 'genealogy':
        return genealogy(values);
      case 'genogram':
        return genogram(values);
      default:
        return pedigree(values);
    }
  },
};
