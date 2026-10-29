// Population genetics: Hardy-Weinberg tests, X-linked frequencies, inbreeding, selection, mutation, migration,
// seeded drift, effective size, linkage disequilibrium, and the breeder's equation, each with worked steps.
import { parseSeed } from '../../subjects/num/rng';
import { fail, fmt, lines, need, numberList, ok, positive, whole, within } from '../shared';
import type { KitOk, KitStep, MolKey, Values } from '../shared';
import { choices } from '../spec';
import type { Field, ToolSpec } from '../spec';
import { linePlot } from '../plot';
import {
  equilibrium,
  hardyWeinberg,
  harmonicNe,
  heterozygosity,
  linkage,
  migration,
  mutationBalance,
  mutationPressure,
  pathF,
  readGenotypes,
  regression,
  selectOnce,
  sexRatioNe,
  trajectory,
  wrightFisher,
  xLinked,
} from './engine';
import type { Fitness } from './engine';

const MODES = [
  'hwe',
  'xlinked',
  'inbreeding',
  'selection',
  'balance',
  'mutation',
  'migration',
  'drift',
  'ne',
  'ld',
  'breeder',
  'heritability',
] as const;
type Mode = (typeof MODES)[number];
const is =
  (...modes: Mode[]) =>
  (v: Values) =>
    modes.includes((v.mode ?? 'hwe') as Mode);

const num = (id: string, initial: string, ...modes: Mode[]): Field => ({
  id,
  label: `popgen.f.${id}` as MolKey,
  kind: 'number',
  initial,
  when: is(...modes),
});

const fields: Field[] = [
  { id: 'mode', label: 'popgen.f.mode', kind: 'select', initial: 'hwe', options: choices('popgen.m.', MODES) },
  {
    id: 'genotypes',
    label: 'popgen.f.genotypes',
    kind: 'area',
    initial: 'A/A 298\nA/a 489\na/a 213',
    hint: 'popgen.f.genotypesHint',
    when: is('hwe'),
  },
  num('fAA', '30', 'xlinked'),
  num('fAa', '40', 'xlinked'),
  num('faa', '30', 'xlinked'),
  num('mA', '60', 'xlinked'),
  num('ma', '40', 'xlinked'),
  num('hObs', '0.3', 'inbreeding'),
  num('hExp', '0.4', 'inbreeding'),
  {
    id: 'paths',
    label: 'popgen.f.paths',
    kind: 'area',
    initial: '5 0\n5 0',
    hint: 'popgen.f.pathsHint',
    when: is('inbreeding'),
  },
  num('wAA', '1', 'selection'),
  num('wAa', '1', 'selection'),
  num('waa', '0.8', 'selection'),
  num('p0', '0.5', 'selection', 'mutation', 'migration', 'drift'),
  num('generations', '20', 'selection', 'mutation', 'migration', 'drift'),
  num('mu', '1e-5', 'balance', 'mutation'),
  num('s', '0.1', 'balance'),
  num('h', '0', 'balance'),
  num('nu', '1e-6', 'mutation'),
  num('m', '0.05', 'migration'),
  num('pm', '0.9', 'migration'),
  num('n', '50', 'drift'),
  num('replicates', '20', 'drift'),
  {
    id: 'seed',
    label: 'popgen.f.seed',
    kind: 'text',
    initial: '20251029',
    hint: 'popgen.f.seedHint',
    when: is('drift'),
  },
  { id: 'sizes', label: 'popgen.f.sizes', kind: 'text', initial: '100, 10, 100', when: is('ne') },
  num('males', '10', 'ne'),
  num('females', '90', 'ne'),
  num('AB', '0.4', 'ld'),
  num('Ab', '0.1', 'ld'),
  num('aB', '0.1', 'ld'),
  num('ab', '0.4', 'ld'),
  num('c', '0.1', 'ld'),
  num('ldGenerations', '10', 'ld'),
  num('h2', '0.4', 'breeder'),
  num('S', '10', 'breeder'),
  {
    id: 'pairs',
    label: 'popgen.f.pairs',
    kind: 'area',
    initial: '10 11\n12 12\n14 13\n16 15\n18 15',
    hint: 'popgen.f.pairsHint',
    when: is('heritability'),
  },
  {
    id: 'parent',
    label: 'popgen.f.parent',
    kind: 'select',
    initial: 'mid',
    options: choices('popgen.parent.', ['mid', 'one']),
    when: is('heritability'),
  },
];

const frequency = (values: Values, id: string): number => within(values, id, `popgen.f.${id}` as MolKey, [0, 1]);
const rate = frequency;

function hwe(values: Values): KitOk {
  const result = hardyWeinberg(readGenotypes(values.genotypes ?? ''));
  const { alleles, freqs, n, classes } = result;
  const small = classes.some((c) => c.expected < 5);
  const label = (a: string, b: string) => `${a}/${b}`;
  const first = alleles[0]!;
  const copies = Math.round(freqs[0]! * 2 * n);
  return ok({
    answer: {
      key: 'popgen.a.hwe',
      vars: { allele: first, p: fmt(freqs[0]!), chi2: fmt(result.chi2, 5), p_value: fmt(result.p, 4) },
    },
    rows: [
      ...alleles.map((a, i) => ({ key: 'popgen.r.allele' as MolKey, value: fmt(freqs[i]!), vars: { allele: a } })),
      { key: 'popgen.r.n', value: String(n) },
      { key: 'popgen.r.chi2', value: fmt(result.chi2, 5) },
      { key: 'popgen.r.df', value: String(result.df) },
      { key: 'popgen.r.p', value: fmt(result.p, 4) },
      ...(result.exactP === null ? [] : [{ key: 'popgen.r.exact' as MolKey, value: fmt(result.exactP, 4) }]),
      { key: 'popgen.r.hObs', value: fmt(result.observedHet, 5) },
      { key: 'popgen.r.hExp', value: fmt(result.expectedHet, 5) },
      { key: 'popgen.r.f', value: fmt(result.f, 4) },
    ],
    tables: [
      {
        title: 'popgen.h.expected',
        head: ['popgen.h.genotype', 'popgen.h.observed', 'popgen.h.expected', 'popgen.h.term'],
        rows: classes.map((c) => [
          label(c.a, c.b),
          String(c.observed),
          fmt(c.expected),
          c.expected > 0 ? fmt((c.observed - c.expected) ** 2 / c.expected, 5) : '—',
        ]),
      },
    ],
    latex: `\\chi^2 = \\sum \\frac{(O - E)^2}{E} = ${fmt(result.chi2, 5)},\\ df = ${result.df}`,
    steps: [
      {
        key: 'popgen.s.count',
        vars: { allele: first, copies: String(copies), total: String(2 * n), p: fmt(freqs[0]!) },
        math: `p_{${first}} = \\frac{${copies}}{2 \\times ${n}} = ${fmt(freqs[0]!)}`,
      },
      alleles.length === 2
        ? {
            key: 'popgen.s.expect',
            math: `E = Np^2,\\ 2Npq,\\ Nq^2 = ${classes.map((c) => fmt(c.expected)).join(',\\ ')}`,
          }
        : { key: 'popgen.s.expect' },
      {
        key: 'popgen.s.chi',
        vars: { df: String(result.df), alleles: String(alleles.length), classes: String(classes.length) },
        math: `\\chi^2 = ${fmt(result.chi2, 5)},\\ P = ${fmt(result.p, 4)}`,
      },
    ],
    notes: [
      ...(small ? ['popgen.n.small' as MolKey] : []),
      ...(result.exactP !== null ? ['popgen.n.exact' as MolKey] : []),
      'popgen.n.hwe',
    ],
    source: result.exactP !== null ? 'popgen.src.exact' : undefined,
  });
}

function xlinked(values: Values): KitOk {
  const counts = ['fAA', 'fAa', 'faa', 'mA', 'ma'].map((id) =>
    whole(values, id, `popgen.f.${id}` as MolKey, [0, 1e9]),
  ) as [number, number, number, number, number];
  const r = xLinked(...counts);
  const [fAA, fAa, , mA] = counts;
  return ok({
    answer: { key: 'popgen.a.xlinked', vars: { p: fmt(r.p), q: fmt(r.q) } },
    rows: [
      { key: 'popgen.r.pX', value: fmt(r.p) },
      { key: 'popgen.r.qX', value: fmt(r.q) },
      { key: 'popgen.r.femaleP', value: fmt(r.femaleP) },
      { key: 'popgen.r.maleP', value: fmt(r.maleP) },
      { key: 'popgen.r.affectedMales', value: fmt(r.q) },
      { key: 'popgen.r.affectedFemales', value: fmt(r.q * r.q) },
    ],
    steps: [
      {
        key: 'popgen.s.xCount',
        math: `p = \\frac{2(${fAA}) + ${fAa} + ${mA}}{${r.copies}} = ${fmt(r.p)}`,
      },
    ],
    notes: ['popgen.n.xlinked'],
  });
}

function inbreeding(values: Values): KitOk {
  const ho = frequency(values, 'hObs');
  const he = within(values, 'hExp', 'popgen.f.hExp', [0, 1]);
  if (he === 0) fail('popgen.e.noExpected');
  const f = 1 - ho / he;
  const paths = lines(values.paths ?? '').map((line) => {
    const [n, fa = 0, extra] = numberList(line, 'popgen.f.paths');
    if (n === undefined || extra !== undefined || !Number.isInteger(n) || n < 1 || fa < 0 || fa > 1) {
      return fail('popgen.e.pathLine', { line });
    }
    return { n, fa };
  });
  const fPath = pathF(paths);
  const steps: KitStep[] = [
    { key: 'popgen.s.fHet', math: `F = 1 - \\frac{H_o}{H_e} = 1 - \\frac{${fmt(ho)}}{${fmt(he)}} = ${fmt(f)}` },
  ];
  if (paths.length > 0) {
    steps.push({
      key: 'popgen.s.fPath',
      math: `F = \\sum \\left(\\tfrac{1}{2}\\right)^{n}(1 + F_A) = ${paths.map((p) => `(\\tfrac{1}{2})^{${p.n}}(1 + ${fmt(p.fa)})`).join(' + ')} = ${fmt(fPath)}`,
    });
  }
  return ok({
    answer: { key: 'popgen.a.inbreeding', vars: { f: fmt(f) } },
    rows: [
      { key: 'popgen.r.fHet', value: fmt(f) },
      ...(paths.length > 0 ? [{ key: 'popgen.r.fPath' as MolKey, value: fmt(fPath) }] : []),
    ],
    steps,
    notes: ['popgen.n.paths'],
  });
}

function selection(values: Values): KitOk {
  const w: Fitness = {
    AA: need(values, 'wAA', 'popgen.f.wAA'),
    Aa: need(values, 'wAa', 'popgen.f.wAa'),
    aa: need(values, 'waa', 'popgen.f.waa'),
  };
  if (w.AA < 0 || w.Aa < 0 || w.aa < 0) fail('popgen.e.fitnessNegative');
  const p0 = frequency(values, 'p0');
  const generations = whole(values, 'generations', 'popgen.f.generations', [1, 10000]);
  const once = selectOnce(p0, w);
  const path = trajectory(p0, w, generations);
  const eq = equilibrium(w);
  const q0 = 1 - p0;
  const steps: KitStep[] = [
    {
      key: 'popgen.s.mean',
      math: `\\bar w = p^2 w_{AA} + 2pq\\,w_{Aa} + q^2 w_{aa} = ${fmt(once.mean)}`,
    },
    {
      key: 'popgen.s.next',
      math: `p' = \\frac{p(p\\,w_{AA} + q\\,w_{Aa})}{\\bar w} = ${fmt(once.p)},\\quad q' = ${fmt(1 - once.p)}`,
    },
  ];
  for (let t = 1; t < Math.min(4, path.length - 1); t++) {
    steps.push({
      key: 'popgen.s.generation',
      vars: { t: String(t + 1), p: fmt(path[t + 1]!), q: fmt(1 - path[t + 1]!) },
    });
  }
  if (eq) {
    steps.push({
      key: eq.stable ? 'popgen.s.stable' : 'popgen.s.unstable',
      math: `\\hat p = \\frac{w_{Aa} - w_{aa}}{2w_{Aa} - w_{AA} - w_{aa}} = ${fmt(eq.p)}`,
    });
  }
  const xs = path.map((_, t) => t);
  return ok({
    answer: { key: 'popgen.a.selection', vars: { q: fmt(1 - once.p), q0: fmt(q0), p: fmt(once.p) } },
    rows: [
      { key: 'popgen.r.mean', value: fmt(once.mean) },
      { key: 'popgen.r.pNext', value: fmt(once.p) },
      { key: 'popgen.r.qNext', value: fmt(1 - once.p) },
      { key: 'popgen.r.delta', value: fmt(once.p - p0) },
      { key: 'popgen.r.pEnd', value: fmt(path.at(-1)!), vars: { t: String(generations) } },
      {
        key: 'popgen.r.equilibrium',
        value: eq ? fmt(eq.p) : '—',
        word: eq ? undefined : 'popgen.w.noEquilibrium',
      },
    ],
    figures: [
      {
        title: 'popgen.h.trajectory',
        figure: linePlot({
          xLabel: { word: 'popgen.h.generation' },
          yLabel: { word: 'popgen.h.freqA' },
          series: [
            { name: 'p (A)', x: xs, y: path },
            { name: 'q (a)', x: xs, y: path.map((p) => 1 - p) },
          ],
          yRange: [0, 1],
          marks: eq ? [eq.p] : [],
        }),
      },
    ],
    steps,
    notes: ['popgen.n.selection'],
  });
}

function balance(values: Values): KitOk {
  const mu = rate(values, 'mu');
  const s = within(values, 's', 'popgen.f.s', [0, 1]);
  const h = within(values, 'h', 'popgen.f.h', [0, 1]);
  const q = mutationBalance(mu, s, h);
  const math =
    h === 0
      ? `\\hat q = \\sqrt{\\mu / s} = \\sqrt{${fmt(mu)} / ${fmt(s)}} = ${fmt(q)}`
      : `\\hat q = \\frac{\\mu}{h s} = ${fmt(q)}`;
  return ok({
    answer: { key: 'popgen.a.balance', vars: { q: fmt(q) } },
    rows: [
      { key: 'popgen.r.qHat', value: fmt(q) },
      { key: 'popgen.r.affected', value: fmt(h === 0 ? q * q : 2 * q * (1 - q) + q * q) },
    ],
    latex: math,
    steps: [{ key: h === 0 ? 'popgen.s.recessiveBalance' : 'popgen.s.partialBalance', math }],
    notes: ['popgen.n.balance'],
  });
}

function mutation(values: Values): KitOk {
  const p0 = frequency(values, 'p0');
  const mu = rate(values, 'mu');
  const nu = rate(values, 'nu');
  const t = whole(values, 'generations', 'popgen.f.generations', [0, 1e7]);
  const r = mutationPressure(p0, mu, nu, t);
  return ok({
    answer: { key: 'popgen.a.mutation', vars: { p: fmt(r.p), t: String(t) } },
    rows: [
      { key: 'popgen.r.pEnd', value: fmt(r.p), vars: { t: String(t) } },
      { key: 'popgen.r.pHat', value: fmt(r.pHat) },
    ],
    steps: [
      { key: 'popgen.s.mutationHat', math: `\\hat p = \\frac{\\nu}{\\mu + \\nu} = ${fmt(r.pHat)}` },
      { key: 'popgen.s.mutationT', math: `p_t = \\hat p + (p_0 - \\hat p)(1 - \\mu - \\nu)^t = ${fmt(r.p)}` },
    ],
    notes: ['popgen.n.mutation'],
  });
}

function migrate(values: Values): KitOk {
  const p0 = frequency(values, 'p0');
  const pm = frequency(values, 'pm');
  const m = rate(values, 'm');
  const t = whole(values, 'generations', 'popgen.f.generations', [0, 1e7]);
  const points = Math.max(1, Math.min(t, 500));
  const xs = Array.from({ length: points + 1 }, (_, k) => Math.round((k * t) / points));
  return ok({
    answer: { key: 'popgen.a.migration', vars: { p: fmt(migration(p0, pm, m, t)), t: String(t) } },
    rows: [{ key: 'popgen.r.pEnd', value: fmt(migration(p0, pm, m, t)), vars: { t: String(t) } }],
    figures:
      t > 0
        ? [
            {
              title: 'popgen.h.trajectory',
              figure: linePlot({
                xLabel: { word: 'popgen.h.generation' },
                yLabel: { word: 'popgen.h.freqA' },
                series: [{ name: 'p', x: xs, y: xs.map((k) => migration(p0, pm, m, k)) }],
                yRange: [0, 1],
                marks: [pm],
              }),
            },
          ]
        : [],
    steps: [{ key: 'popgen.s.migration', math: `p_t = p_m + (p_0 - p_m)(1 - m)^t = ${fmt(migration(p0, pm, m, t))}` }],
    notes: ['popgen.n.migration'],
  });
}

function drift(values: Values): KitOk {
  const n = whole(values, 'n', 'popgen.f.n', [1, 100000]);
  const p0 = frequency(values, 'p0');
  const generations = whole(values, 'generations', 'popgen.f.generations', [1, 10000]);
  const replicates = whole(values, 'replicates', 'popgen.f.replicates', [1, 2000]);
  if (generations * replicates > 2_000_000) fail('popgen.e.tooLong');
  const seed = parseSeed(values.seed ?? '') ?? fail('popgen.e.seed');
  const run = wrightFisher(n, p0, generations, replicates, seed);
  const h0 = 2 * p0 * (1 - p0);
  const ht = heterozygosity(h0, n, generations);
  const xs = Array.from({ length: generations + 1 }, (_, t) => t);
  const shown = run.paths.slice(0, 30);
  return ok({
    answer: {
      key: 'popgen.a.drift',
      vars: { h: fmt(ht), t: String(generations), fixed: String(run.fixed), lost: String(run.lost) },
    },
    rows: [
      { key: 'popgen.r.hExpected', value: fmt(ht), vars: { t: String(generations) } },
      { key: 'popgen.r.hSimulated', value: fmt(run.meanHet.at(-1)!) },
      { key: 'popgen.r.fixation', value: fmt(p0) },
      { key: 'popgen.r.fixed', value: `${run.fixed} / ${replicates}` },
      { key: 'popgen.r.lost', value: `${run.lost} / ${replicates}` },
      { key: 'popgen.r.seed', value: String(seed) },
    ],
    figures: [
      {
        title: 'popgen.h.drift',
        vars: { shown: String(shown.length), replicates: String(replicates) },
        figure: linePlot({
          xLabel: { word: 'popgen.h.generation' },
          yLabel: { word: 'popgen.h.freqA' },
          series: shown.map((path, i) => ({ name: String(i + 1), x: xs, y: path })),
          yRange: [0, 1],
          legend: false,
        }),
      },
      {
        title: 'popgen.h.het',
        figure: linePlot({
          xLabel: { word: 'popgen.h.generation' },
          yLabel: { word: 'popgen.h.heterozygosity' },
          series: [
            { name: { word: 'popgen.h.expectedLine' }, x: xs, y: xs.map((t) => heterozygosity(h0, n, t)) },
            { name: { word: 'popgen.h.simulatedLine' }, x: xs, y: run.meanHet },
          ],
        }),
      },
    ],
    steps: [
      {
        key: 'popgen.s.het',
        math: `H_t = H_0\\left(1 - \\frac{1}{2N}\\right)^t = ${fmt(h0)}\\left(1 - \\frac{1}{${2 * n}}\\right)^{${generations}} = ${fmt(ht)}`,
      },
      { key: 'popgen.s.wf', vars: { copies: String(2 * n), seed: String(seed) } },
      { key: 'popgen.s.fix', vars: { p: fmt(p0) } },
    ],
    notes: ['popgen.n.drift'],
  });
}

function ne(values: Values): KitOk {
  const sizes = numberList(values.sizes ?? '', 'popgen.f.sizes');
  const harmonic = harmonicNe(sizes);
  const males = positive(values, 'males', 'popgen.f.males');
  const females = positive(values, 'females', 'popgen.f.females');
  const bySex = sexRatioNe(males, females);
  return ok({
    answer: { key: 'popgen.a.ne', vars: { harmonic: fmt(harmonic), sex: fmt(bySex) } },
    rows: [
      { key: 'popgen.r.harmonic', value: fmt(harmonic) },
      { key: 'popgen.r.arithmetic', value: fmt(sizes.reduce((a, b) => a + b, 0) / sizes.length) },
      { key: 'popgen.r.sexNe', value: fmt(bySex) },
    ],
    steps: [
      {
        key: 'popgen.s.harmonic',
        math: `N_e = \\frac{t}{\\sum 1/N_i} = \\frac{${sizes.length}}{${sizes.map((s) => `1/${fmt(s)}`).join(' + ')}} = ${fmt(harmonic)}`,
      },
      {
        key: 'popgen.s.sexNe',
        math: `N_e = \\frac{4 N_m N_f}{N_m + N_f} = \\frac{4 \\times ${fmt(males)} \\times ${fmt(females)}}{${fmt(males + females)}} = ${fmt(bySex)}`,
      },
    ],
    notes: ['popgen.n.ne'],
  });
}

function ld(values: Values): KitOk {
  const [AB, Ab, aB, ab] = ['AB', 'Ab', 'aB', 'ab'].map((id) => need(values, id, `popgen.f.${id}` as MolKey)) as [
    number,
    number,
    number,
    number,
  ];
  const r = linkage(AB, Ab, aB, ab);
  const c = within(values, 'c', 'popgen.f.c', [0, 0.5]);
  const t = whole(values, 'ldGenerations', 'popgen.f.ldGenerations', [0, 100000]);
  const dt = r.d * (1 - c) ** t;
  const total = AB + Ab + aB + ab;
  const xs = Array.from({ length: Math.min(t, 200) + 1 }, (_, k) => k);
  return ok({
    answer: { key: 'popgen.a.ld', vars: { d: fmt(r.d), dPrime: fmt(r.dPrime), r2: fmt(r.r2) } },
    rows: [
      { key: 'popgen.r.pA', value: fmt(r.pA) },
      { key: 'popgen.r.pB', value: fmt(r.pB) },
      { key: 'popgen.r.d', value: fmt(r.d) },
      { key: 'popgen.r.dMax', value: fmt(r.dMax) },
      { key: 'popgen.r.dPrime', value: fmt(r.dPrime) },
      { key: 'popgen.r.r2', value: fmt(r.r2) },
      { key: 'popgen.r.dT', value: fmt(dt), vars: { t: String(t) } },
    ],
    figures:
      t > 0
        ? [
            {
              title: 'popgen.h.decay',
              figure: linePlot({
                xLabel: { word: 'popgen.h.generation' },
                yLabel: 'D',
                series: [{ name: 'D', x: xs, y: xs.map((k) => r.d * (1 - c) ** k) }],
              }),
            },
          ]
        : [],
    steps: [
      {
        key: 'popgen.s.ldFreqs',
        vars: { total: fmt(total) },
        math: `p_A = ${fmt(r.pA)},\\ p_B = ${fmt(r.pB)}`,
      },
      {
        key: 'popgen.s.d',
        math: `D = p_{AB} - p_A p_B = ${fmt(AB / total)} - ${fmt(r.pA)} \\times ${fmt(r.pB)} = ${fmt(r.d)}`,
      },
      {
        key: r.d >= 0 ? 'popgen.s.dMaxPos' : 'popgen.s.dMaxNeg',
        math: `D' = D / D_{max} = ${fmt(r.d)} / ${fmt(r.dMax)} = ${fmt(r.dPrime)}`,
      },
      { key: 'popgen.s.r2', math: `r^2 = \\frac{D^2}{p_A p_a p_B p_b} = ${fmt(r.r2)}` },
      { key: 'popgen.s.decay', math: `D_t = D_0 (1 - c)^t = ${fmt(dt)}` },
    ],
    notes: ['popgen.n.ld'],
  });
}

function breeder(values: Values): KitOk {
  const h2 = within(values, 'h2', 'popgen.f.h2', [0, 1]);
  const s = need(values, 'S', 'popgen.f.S');
  const response = h2 * s;
  const math = `R = h^2 S = ${fmt(h2)} \\times ${fmt(s)} = ${fmt(response)}`;
  return ok({
    answer: { key: 'popgen.a.breeder', vars: { r: fmt(response) } },
    rows: [{ key: 'popgen.r.response', value: fmt(response) }],
    latex: math,
    steps: [{ key: 'popgen.s.breeder', math }],
    notes: ['popgen.n.breeder'],
  });
}

function heritability(values: Values): KitOk {
  const x: number[] = [];
  const y: number[] = [];
  for (const line of lines(values.pairs ?? '')) {
    const [a, b, extra] = numberList(line, 'popgen.f.pairs');
    if (a === undefined || b === undefined || extra !== undefined) fail('popgen.e.pairLine', { line });
    x.push(a!);
    y.push(b!);
  }
  const fit = regression(x, y);
  const mid = values.parent !== 'one';
  const h2 = mid ? fit.slope : 2 * fit.slope;
  return ok({
    answer: { key: 'popgen.a.heritability', vars: { h2: fmt(h2, 4) } },
    rows: [
      { key: 'popgen.r.slope', value: fmt(fit.slope) },
      { key: 'popgen.r.intercept', value: fmt(fit.intercept) },
      { key: 'popgen.r.h2', value: fmt(h2, 4) },
      { key: 'popgen.r.pairs', value: String(x.length) },
    ],
    figures: [
      {
        title: 'popgen.h.regression',
        figure: linePlot({
          xLabel: { word: mid ? 'popgen.h.midparent' : 'popgen.h.parent' },
          yLabel: { word: 'popgen.h.offspring' },
          series: [
            { name: { word: 'popgen.h.families' }, x, y, dots: true },
            {
              name: { word: 'popgen.h.fitLine' },
              x: [Math.min(...x), Math.max(...x)],
              y: [Math.min(...x), Math.max(...x)].map((v) => fit.intercept + fit.slope * v),
            },
          ],
        }),
      },
    ],
    steps: [
      {
        key: 'popgen.s.regression',
        math: `b = \\frac{\\operatorname{cov}(x, y)}{\\operatorname{var}(x)} = ${fmt(fit.slope)}`,
      },
      { key: mid ? 'popgen.s.h2Mid' : 'popgen.s.h2One', math: `h^2 = ${mid ? 'b' : '2b'} = ${fmt(h2, 4)}` },
    ],
    notes: ['popgen.n.heritability', ...(h2 > 1 || h2 < 0 ? ['popgen.n.h2Range' as MolKey] : [])],
  });
}

export const spec: ToolSpec = {
  id: 'popgen',
  fields,
  run(values) {
    switch (values.mode as Mode) {
      case 'xlinked':
        return xlinked(values);
      case 'inbreeding':
        return inbreeding(values);
      case 'selection':
        return selection(values);
      case 'balance':
        return balance(values);
      case 'mutation':
        return mutation(values);
      case 'migration':
        return migrate(values);
      case 'drift':
        return drift(values);
      case 'ne':
        return ne(values);
      case 'ld':
        return ld(values);
      case 'breeder':
        return breeder(values);
      case 'heritability':
        return heritability(values);
      default:
        return hwe(values);
    }
  },
};
