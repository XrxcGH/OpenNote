// Genetic crosses and linkage: Punnett squares with dominance, sex linkage, multiple alleles, epistasis and lethals;
// probabilities by the product rule; chi-square tests of ratios; two- and three-point mapping; LOD scores; and
// Bayesian carrier risk.
import { linePlot } from '../plot';
import { fail, fmt, numberList, ok, whole } from '../shared';
import type { Cell, KitOk, KitStep, KitTable, MolKey, Values } from '../shared';
import { choices } from '../spec';
import type { Field, ToolSpec } from '../spec';
import { chiSquareFit, fAdd, fNum, fText, frac, readProbability } from '../stats';
import type { Frac } from '../stats';
import { gametes, genotypeText, matches, offspring, order, parseGenotype, sexes } from './genotype';
import type { Child, Genotype } from './genotype';
import { haldane, kosambi, lod, maxLod, readClasses, readFamilies, threePoint } from './mapping';
import { DOMINANCE, phenotypeShares, ratio, readHierarchy, readRules, survivors } from './phenotype';
import type { Dominance, PhenoOptions } from './phenotype';

const MODES = ['punnett', 'chisq', 'twopoint', 'threepoint', 'lod', 'bayes'] as const;
type Mode = (typeof MODES)[number];
const is =
  (...modes: Mode[]) =>
  (values: Values) =>
    modes.includes(values.mode as Mode);

const THREE_POINT = '+ + + 400\na c b 390\n+ c b 55\na + + 50\na + b 50\n+ c + 45\n+ + b 5\na c + 5';

const fields: Field[] = [
  { id: 'mode', label: 'crosses.f.mode', kind: 'select', initial: 'punnett', options: choices('crosses.m.', MODES) },
  {
    id: 'p1',
    label: 'crosses.f.p1',
    kind: 'text',
    initial: 'AaBb',
    hint: 'crosses.f.genotypeHint',
    when: is('punnett'),
  },
  { id: 'p2', label: 'crosses.f.p2', kind: 'text', initial: 'AaBb', when: is('punnett') },
  {
    id: 'dominance',
    label: 'crosses.f.dominance',
    kind: 'select',
    initial: 'complete',
    options: choices('crosses.dom.', DOMINANCE),
    when: is('punnett'),
  },
  {
    id: 'hierarchy',
    label: 'crosses.f.hierarchy',
    kind: 'text',
    initial: '',
    hint: 'crosses.f.hierarchyHint',
    when: (v) => is('punnett')(v) && v.dominance === 'complete',
  },
  {
    id: 'rules',
    label: 'crosses.f.rules',
    kind: 'area',
    initial: 'A_B_ = purple\nelse = white',
    hint: 'crosses.f.rulesHint',
    when: (v) => is('punnett')(v) && v.dominance === 'custom',
  },
  {
    id: 'lethal',
    label: 'crosses.f.lethal',
    kind: 'text',
    initial: '',
    hint: 'crosses.f.lethalHint',
    when: is('punnett'),
  },
  {
    id: 'query',
    label: 'crosses.f.query',
    kind: 'text',
    initial: 'aabb',
    hint: 'crosses.f.queryHint',
    when: is('punnett'),
  },
  { id: 'observed', label: 'crosses.f.observed', kind: 'text', initial: '315, 108, 101, 32', when: is('chisq') },
  { id: 'ratio', label: 'crosses.f.ratio', kind: 'text', initial: '9:3:3:1', when: is('chisq') },
  { id: 'recombinants', label: 'crosses.f.recombinants', kind: 'number', initial: '20', when: is('twopoint') },
  { id: 'total', label: 'crosses.f.total', kind: 'number', initial: '100', when: is('twopoint') },
  {
    id: 'classes',
    label: 'crosses.f.classes',
    kind: 'area',
    initial: THREE_POINT,
    hint: 'crosses.f.classesHint',
    when: is('threepoint'),
  },
  {
    id: 'families',
    label: 'crosses.f.families',
    kind: 'area',
    initial: '2 10',
    hint: 'crosses.f.familiesHint',
    when: is('lod'),
  },
  {
    id: 'phase',
    label: 'crosses.f.phase',
    kind: 'select',
    initial: 'known',
    options: choices('crosses.phase.', ['known', 'unknown']),
    when: is('lod'),
  },
  {
    id: 'scenario',
    label: 'crosses.f.scenario',
    kind: 'select',
    initial: 'xlinked',
    options: choices('crosses.scenario.', ['xlinked', 'custom']),
    when: is('bayes'),
  },
  { id: 'prior', label: 'crosses.f.prior', kind: 'text', initial: '1/2', when: is('bayes') },
  {
    id: 'sons',
    label: 'crosses.f.sons',
    kind: 'number',
    initial: '2',
    when: (v) => is('bayes')(v) && v.scenario !== 'custom',
  },
  {
    id: 'likeCarrier',
    label: 'crosses.f.likeCarrier',
    kind: 'text',
    initial: '1/4',
    when: (v) => is('bayes')(v) && v.scenario === 'custom',
  },
  {
    id: 'likeNon',
    label: 'crosses.f.likeNon',
    kind: 'text',
    initial: '1',
    when: (v) => is('bayes')(v) && v.scenario === 'custom',
  },
];

const sexWord = (sex: Child['sex']): Cell => ({ word: `crosses.sex.${sex}` as MolKey });

function phenoOptions(values: Values, genes: number): PhenoOptions {
  const dominance = (DOMINANCE as readonly string[]).includes(values.dominance ?? '')
    ? (values.dominance as Dominance)
    : 'complete';
  const custom = dominance === 'custom' ? readRules(values.rules ?? '', genes) : { rules: [], elseName: null };
  return { dominance, hierarchy: dominance === 'complete' ? readHierarchy(values.hierarchy ?? '') : null, ...custom };
}

function grid(p1: Genotype, p2: Genotype): KitTable | null {
  const g1 = gametes(p1);
  const g2 = gametes(p2);
  if (g1.length > 16 || g2.length > 16) return null;
  const label = (alleles: string[], template: Genotype) =>
    template.every((g) => g.short) ? alleles.join('') : alleles.join(' ');
  return {
    title: 'crosses.h.grid',
    head: [],
    headText: ['', ...g2.map((g) => `${label(g.alleles, p2)} (${fText(g.p)})`)],
    rows: g1.map((a) => [
      `${label(a.alleles, p1)} (${fText(a.p)})`,
      ...g2.map((b) =>
        genotypeText(
          a.alleles.map((x, i) => order(x, b.alleles[i]!, p1[i]!.x)),
          p1,
        ),
      ),
    ]),
  };
}

interface Query {
  text: string;
  patterns: Genotype[];
  /** The probability of each pattern, then of any of them by the sum rule. */
  each: Frac[];
  p: Frac;
}

const chance = (children: Child[], pattern: Genotype): Frac =>
  children.filter((c) => matches(c.genes, pattern)).reduce((s, c) => fAdd(s, c.p), frac(0));

/** The offspring the student asks about; patterns separated by commas are different children, added by the sum rule. */
function query(children: Child[], values: Values, genes: number): Query | null {
  const text = (values.query ?? '').trim();
  if (text === '') return null;
  const patterns = text.split(',').map((part) => parseGenotype(part, 'crosses.f.query', true));
  for (const pattern of patterns) {
    if (pattern.length !== genes) fail('crosses.e.patternGenes', { genes: String(genes) });
  }
  const anyOf = (c: Child) => patterns.some((pattern) => matches(c.genes, pattern));
  const each = patterns.map((pattern) => chance(children, pattern));
  const p = children.filter(anyOf).reduce((s, c) => fAdd(s, c.p), frac(0));
  return { text, patterns, each, p };
}

const patternText = (gene: Genotype[number]) => (gene.short ? gene.alleles.join('') : gene.alleles.join('/'));

/** The product rule gene by gene for each pattern, then the sum rule across patterns that cannot overlap. */
function ruleSteps(p1: Genotype, p2: Genotype, q: Query | null, independent: boolean): KitStep[] {
  if (!q) return [];
  const steps: KitStep[] = [];
  if (independent) {
    q.patterns.forEach((pattern, k) => {
      const parts = pattern.map(
        (gene, i) => `P(${patternText(gene)}) = ${fText(chance(offspring([p1[i]!], [p2[i]!]), [gene]))}`,
      );
      steps.push({
        key: 'crosses.s.product',
        vars: { pattern: pattern.map(patternText).join(' '), parts: parts.join(' × '), p: fText(q.each[k]!) },
      });
    });
  }
  if (q.patterns.length > 1) {
    const total = q.each.reduce((s, f) => fAdd(s, f), frac(0));
    const disjoint = total.n * q.p.d === q.p.n * total.d;
    steps.push({
      key: disjoint ? 'crosses.s.sum' : 'crosses.s.sumOverlap',
      vars: { parts: q.each.map(fText).join(' + '), p: fText(q.p) },
    });
  }
  return steps;
}

function punnett(values: Values): KitOk {
  const p1 = parseGenotype(values.p1 ?? '', 'crosses.f.p1');
  const p2 = parseGenotype(values.p2 ?? '', 'crosses.f.p2');
  const all = offspring(p1, p2);
  const children = survivors(all, p1, values.lethal ?? '');
  const options = phenoOptions(values, p1.length);
  const shares = phenotypeShares(children, p1, options);
  const r = ratio(shares.map((s) => s.p));
  const genotypes = [...children].sort((a, b) => b.p.n * a.p.d - a.p.n * b.p.d);
  const q = query(children, values, p1.length);
  const table = grid(p1, p2);
  const bySex = shares.some((s) => s.sex !== 'either');
  return ok({
    answer: q
      ? { key: 'crosses.a.query', vars: { query: q.text, p: fText(q.p), ratio: r.join(':') } }
      : { key: 'crosses.a.ratio', vars: { ratio: r.join(':') } },
    rows: [
      { key: 'crosses.r.ratio', value: r.join(':') },
      { key: 'crosses.r.classes', value: String(shares.length) },
      { key: 'crosses.r.genotypes', value: String(children.length) },
      ...(q
        ? [{ key: 'crosses.r.query' as MolKey, vars: { query: q.text }, value: `${fText(q.p)} = ${fmt(fNum(q.p), 6)}` }]
        : []),
    ],
    tables: [
      ...(table ? [table] : []),
      {
        title: 'crosses.h.phenotypes',
        head: [
          ...(bySex ? ['crosses.h.sex' as MolKey] : []),
          'crosses.h.phenotype',
          'crosses.h.probability',
          'crosses.h.ratio',
        ],
        rows: shares.map((s, i) => [...(bySex ? [sexWord(s.sex)] : []), s.label, fText(s.p), String(r[i])]),
      },
      {
        title: 'crosses.h.genotypes',
        head: [...(bySex ? ['crosses.h.sex' as MolKey] : []), 'crosses.h.genotype', 'crosses.h.probability'],
        rows: genotypes.map((c) => [...(bySex ? [sexWord(c.sex)] : []), genotypeText(c.genes, p1), fText(c.p)]),
      },
    ],
    steps: [
      { key: 'crosses.s.gametes', vars: { a: String(gametes(p1).length), b: String(gametes(p2).length) } },
      { key: 'crosses.s.grid' },
      ...(children.length < all.length ? [{ key: 'crosses.s.lethal' as MolKey }] : []),
      { key: 'crosses.s.classes', vars: { ratio: r.join(':') } },
      ...ruleSteps(p1, p2, q, children.length === all.length && sexes(p1, p2) === null),
    ],
    notes: ['crosses.n.independent', ...(bySex ? ['crosses.n.sexLinked' as MolKey] : [])],
  });
}

function readRatio(text: string): number[] {
  return numberList(text.replace(/:/g, ' '), 'crosses.f.ratio');
}

function chisq(values: Values): KitOk {
  const observed = numberList(values.observed ?? '', 'crosses.f.observed');
  const r = readRatio(values.ratio ?? '');
  const test = chiSquareFit(observed, r);
  return ok({
    answer: { key: 'crosses.a.chisq', vars: { chi2: fmt(test.chi2, 5), df: String(test.df), p: fmt(test.p, 4) } },
    rows: [
      { key: 'crosses.r.chi2', value: fmt(test.chi2, 6) },
      { key: 'crosses.r.df', value: String(test.df) },
      { key: 'crosses.r.p', value: fmt(test.p, 4) },
      { key: 'crosses.r.verdict', value: '', word: test.p < 0.05 ? 'crosses.w.reject' : 'crosses.w.keep' },
    ],
    tables: [
      {
        title: 'crosses.h.chisq',
        head: ['crosses.h.class', 'crosses.h.observed', 'crosses.h.expected', 'crosses.h.term'],
        rows: observed.map((o, i) => [String(i + 1), fmt(o), fmt(test.expected[i]!, 6), fmt(test.terms[i]!, 5)]),
      },
    ],
    latex: `\\chi^2 = \\sum \\frac{(O - E)^2}{E} = ${fmt(test.chi2, 5)},\\ \\mathrm{df} = ${test.df},\\ p = ${fmt(test.p, 4)}`,
    steps: [
      { key: 'crosses.s.expected', vars: { total: fmt(observed.reduce((s, o) => s + o, 0)), ratio: r.join(':') } },
      {
        key: 'crosses.s.chi2',
        math: `\\chi^2 = \\sum \\frac{(O - E)^2}{E} = ${test.terms.map((t) => fmt(t, 4)).join(' + ')} = ${fmt(test.chi2, 5)}`,
      },
      { key: 'crosses.s.df', vars: { classes: String(observed.length), df: String(test.df), p: fmt(test.p, 4) } },
    ],
    notes: ['crosses.n.expectedFive'],
  });
}

function twopoint(values: Values): KitOk {
  const total = whole(values, 'total', 'crosses.f.total', [1, 1e9]);
  const rec = whole(values, 'recombinants', 'crosses.f.recombinants', [0, total]);
  const r = rec / total;
  if (r >= 0.5) return fail('crosses.e.unlinked');
  const h = haldane(r);
  const k = kosambi(r);
  return ok({
    answer: {
      key: 'crosses.a.twopoint',
      vars: { r: fmt(r, 5), cm: fmt(r * 100, 5), haldane: fmt(h, 5), kosambi: fmt(k, 5) },
    },
    rows: [
      { key: 'crosses.r.rf', value: fmt(r, 6) },
      { key: 'crosses.r.cm', value: `${fmt(r * 100, 6)} cM` },
      { key: 'crosses.r.haldane', value: `${fmt(h, 6)} cM` },
      { key: 'crosses.r.kosambi', value: `${fmt(k, 6)} cM` },
    ],
    steps: [
      { key: 'crosses.s.rf', math: `r = \\frac{${rec}}{${total}} = ${fmt(r, 6)}` },
      { key: 'crosses.s.haldane', math: `d = -50 \\ln(1 - 2r) = ${fmt(h, 6)}\\ \\mathrm{cM}` },
      { key: 'crosses.s.kosambi', math: `d = 25 \\ln\\frac{1 + 2r}{1 - 2r} = ${fmt(k, 6)}\\ \\mathrm{cM}` },
    ],
    notes: ['crosses.n.mapFunctions'],
  });
}

function threepointMode(values: Values): KitOk {
  const t = threePoint(readClasses(values.classes ?? ''));
  const [l, m, rt] = t.order.map((i) => t.genes[i]!);
  const line = (list: { alleles: string[]; count: number }[]) =>
    list.map((c) => `${c.alleles.join(' ')} (${c.count})`).join(', ');
  return ok({
    answer: {
      key: 'crosses.a.threepoint',
      vars: {
        order: `${l} – ${m} – ${rt}`,
        d1: fmt(t.rLeft * 100, 5),
        d2: fmt(t.rRight * 100, 5),
        i: fmt(t.interference, 4),
      },
    },
    rows: [
      { key: 'crosses.r.order', value: `${l} – ${m} – ${rt}` },
      { key: 'crosses.r.distance', vars: { a: l!, b: m! }, value: `${fmt(t.rLeft * 100, 6)} cM` },
      { key: 'crosses.r.distance', vars: { a: m!, b: rt! }, value: `${fmt(t.rRight * 100, 6)} cM` },
      { key: 'crosses.r.expectedDouble', value: fmt(t.expectedDouble, 6) },
      { key: 'crosses.r.coincidence', value: fmt(t.coincidence, 5) },
      { key: 'crosses.r.interference', value: fmt(t.interference, 5) },
    ],
    steps: [
      { key: 'crosses.s.parentals', vars: { classes: line(t.parental) } },
      { key: 'crosses.s.doubles', vars: { classes: line(t.double), middle: m! } },
      { key: 'crosses.s.singles', vars: { a: l!, b: m!, classes: line(t.singleLeft), r: fmt(t.rLeft, 5) } },
      { key: 'crosses.s.singles', vars: { a: m!, b: rt!, classes: line(t.singleRight), r: fmt(t.rRight, 5) } },
      {
        key: 'crosses.s.coincidence',
        math: `c = \\frac{${t.double.reduce((s, c) => s + c.count, 0)}}{${fmt(t.rLeft, 5)} \\times ${fmt(t.rRight, 5)} \\times ${t.total}} = ${fmt(t.coincidence, 4)},\\ I = 1 - c = ${fmt(t.interference, 4)}`,
      },
    ],
    notes: ['crosses.n.testCross'],
  });
}

function lodMode(values: Values): KitOk {
  const families = readFamilies(values.families ?? '');
  const known = values.phase !== 'unknown';
  const thetas = [0, 0.01, 0.05, 0.1, 0.2, 0.3, 0.4, 0.5];
  const best = maxLod(families, known);
  const xs = Array.from({ length: 101 }, (_, i) => i * 0.005);
  return ok({
    answer: { key: 'crosses.a.lod', vars: { theta: fmt(best.theta, 4), lod: fmt(best.lod, 5) } },
    rows: [
      { key: 'crosses.r.maxTheta', value: fmt(best.theta, 4) },
      { key: 'crosses.r.maxLod', value: fmt(best.lod, 5) },
      { key: 'crosses.r.verdict', value: '', word: best.lod >= 3 ? 'crosses.w.linked' : 'crosses.w.undecided' },
    ],
    tables: [
      {
        title: 'crosses.h.lod',
        head: ['crosses.h.theta', 'crosses.h.lodScore'],
        rows: thetas.map((theta) => [fmt(theta, 3), fmt(lod(families, theta, known), 5)]),
      },
    ],
    figures: [
      {
        title: 'crosses.h.lodCurve',
        figure: linePlot({
          xLabel: 'θ',
          yLabel: { word: 'crosses.h.lodScore' },
          series: [{ name: 'LOD', x: xs, y: xs.map((x) => lod(families, x, known)) }],
          marks: [3, 0, -2],
          xRange: [0, 0.5],
        }),
      },
    ],
    steps: [
      {
        key: known ? 'crosses.s.lodKnown' : 'crosses.s.lodUnknown',
        math: known
          ? '\\mathrm{LOD}(\\theta) = \\log_{10} \\frac{\\theta^R (1 - \\theta)^{N-R}}{0.5^N}'
          : '\\mathrm{LOD}(\\theta) = \\log_{10} \\frac{\\tfrac12[\\theta^R (1 - \\theta)^{N-R} + \\theta^{N-R} (1 - \\theta)^R]}{0.5^N}',
      },
      { key: 'crosses.s.lodSum', vars: { families: String(families.length) } },
    ],
    notes: ['crosses.n.lod'],
  });
}

function bayes(values: Values): KitOk {
  const prior = readProbability(values.prior ?? '', 'crosses.f.prior');
  const custom = values.scenario === 'custom';
  const sons = custom ? 0 : whole(values, 'sons', 'crosses.f.sons', [0, 100]);
  const likeCarrier = custom ? readProbability(values.likeCarrier ?? '', 'crosses.f.likeCarrier') : 0.5 ** sons;
  const likeNon = custom ? readProbability(values.likeNon ?? '', 'crosses.f.likeNon') : 1;
  const jointC = prior * likeCarrier;
  const jointN = (1 - prior) * likeNon;
  if (jointC + jointN === 0) return fail('crosses.e.impossible');
  const post = jointC / (jointC + jointN);
  return ok({
    answer: { key: 'crosses.a.bayes', vars: { p: fmt(post, 6) } },
    rows: [
      { key: 'crosses.r.posterior', value: fmt(post, 6) },
      ...(custom
        ? []
        : [
            { key: 'crosses.r.nextSon' as MolKey, value: fmt(post / 2, 6) },
            { key: 'crosses.r.nextChild' as MolKey, value: fmt(post / 4, 6) },
          ]),
    ],
    tables: [
      {
        title: 'crosses.h.bayes',
        head: [
          'crosses.h.hypothesis',
          'crosses.h.prior',
          'crosses.h.conditional',
          'crosses.h.joint',
          'crosses.h.posterior',
        ],
        rows: [
          [{ word: 'crosses.w.carrier' }, fmt(prior, 6), fmt(likeCarrier, 6), fmt(jointC, 6), fmt(post, 6)],
          [{ word: 'crosses.w.notCarrier' }, fmt(1 - prior, 6), fmt(likeNon, 6), fmt(jointN, 6), fmt(1 - post, 6)],
        ],
      },
    ],
    steps: [
      ...(custom ? [] : [{ key: 'crosses.s.sons' as MolKey, vars: { n: String(sons), like: fmt(likeCarrier, 6) } }]),
      {
        key: 'crosses.s.bayes',
        math: `P(\\text{carrier} \\mid \\text{data}) = \\frac{${fmt(prior, 4)} \\times ${fmt(likeCarrier, 4)}}{${fmt(jointC, 4)} + ${fmt(jointN, 4)}} = ${fmt(post, 6)}`,
      },
    ],
    notes: ['crosses.n.bayes'],
  });
}

const RUN: Record<Mode, (values: Values) => KitOk> = {
  punnett,
  chisq,
  twopoint,
  threepoint: threepointMode,
  lod: lodMode,
  bayes,
};

export const spec: ToolSpec = {
  id: 'crosses',
  fields,
  run(values) {
    const mode = MODES.includes(values.mode as Mode) ? (values.mode as Mode) : 'punnett';
    return RUN[mode](values);
  },
};
