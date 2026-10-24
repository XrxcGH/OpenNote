// The measurement forms. Each reads its fields and words the result; the methods are in measures.ts.
import { CPI_UPDATED, cpiFor } from './cpi';
import { Plot } from './Plot';
import { bad, choice, failed, field, ok, optional, read, text, tx } from './forms';
import type { EconForm, EconToolDef, Values } from './forms';
import {
  FEDERAL,
  FEDERAL_YEAR,
  adjust,
  cagr,
  chain,
  dimensionIndex,
  doubling,
  gini,
  hdi,
  inequality,
  leontief,
  locationQuotients,
  lorenz,
  poverty,
  priceIndexes,
  segregation,
  shiftShare,
  taxOn,
} from './measures';
import type { Bracket } from './measures';
import { fmt, pct, parseList } from './num';

const T = 'measures';
const f = (id: string, rest = {}) => field(T, id, rest);
const m = (x: number) => fmt(x, 4);
const list = (id: string, initial: string) => f(id, { kind: 'text', initial });
const form = (id: string, fields: EconForm['fields'], solve: EconForm['solve']): EconForm => ({
  id,
  name: `measures-${id}`,
  intro: true,
  fields,
  solve,
});
const listOf = (values: Values, id: string) => parseList(values.text[id] ?? '');
const join = (xs: readonly number[]) => xs.map((x) => fmt(x, 4)).join(', ');

const index = form(
  'index',
  [list('p0', '2, 5'), list('q0', '10, 4'), list('p1', '3, 6'), list('q1', '8, 5')],
  (values) => {
    const [p0, q0, p1, q1] = ['p0', 'q0', 'p1', 'q1'].map((id) => listOf(values, id));
    if (!p0 || !q0 || !p1 || !q1) return bad('measures.listsNeeded');
    if (new Set([p0.length, q0.length, p1.length, q1.length]).size !== 1) return bad('measures.index.sameLength');
    const r = priceIndexes(p0, q0, p1, q1);
    if (!r) return bad('measures.index.invalid');
    return ok(tx('measures.index.headline', { l: m(r.laspeyres), p: m(r.paasche), f: m(r.fisher) }), [
      tx('measures.index.laspeyres', { l: m(r.laspeyres) }),
      tx('measures.index.paasche', { p: m(r.paasche) }),
      tx('measures.index.fisher', { f: m(r.fisher) }),
      tx(r.laspeyres >= r.paasche ? 'measures.index.upward' : 'measures.index.downward'),
    ]);
  },
);

const rebase = form('rebase', [list('series', '100, 104, 109, 113'), f('base', { initial: '2' })], (values) => {
  const series = listOf(values, 'series');
  const n = read(T, values, ['base']);
  if (!series || failed(n)) return failed(n) ? n : bad('measures.listsNeeded');
  const base = series[n[0] - 1];
  if (!Number.isInteger(n[0]) || base === undefined || !(base > 0)) return bad('measures.rebase.invalid');
  const out = series.map((x) => (x / base) * 100);
  const links = series.slice(1).map((x, i) => x / series[i]);
  return ok(tx('measures.rebase.headline', { list: join(out.map((x) => Math.round(x * 1e6) / 1e6)) }), [
    tx('measures.rebase.step', { n: n[0], base: m(base) }),
    tx('measures.rebase.chain', { list: join(chain(links)) }),
  ]);
});

const deflator = form('deflator', [f('nominal', { initial: '1200' }), f('real', { initial: '1000' })], (values) => {
  const n = read(T, values, ['nominal', 'real']);
  if (failed(n)) return n;
  if (!(n[1] > 0)) return bad('measures.deflator.invalid');
  const d = (n[0] / n[1]) * 100;
  return ok(tx('measures.deflator.headline', { d: m(d) }), [
    tx('measures.deflator.step', { nominal: m(n[0]), real: m(n[1]), d: m(d) }),
    tx('measures.deflator.inflation', { value: pct(d / 100 - 1, 3) }),
  ]);
});

const real = form(
  'real',
  [
    f('amount', { initial: '100' }),
    f('from', { initial: '1990' }),
    f('to', { initial: '2020' }),
    f('fromIndex'),
    f('toIndex'),
  ],
  (values) => {
    const n = read(T, values, ['amount', 'from', 'to']);
    if (failed(n)) return n;
    const typedFrom = optional(values, 'fromIndex');
    const typedTo = optional(values, 'toIndex');
    const typed = typedFrom !== null && typedTo !== null;
    const a = typed ? typedFrom : cpiFor(n[1]);
    const b = typed ? typedTo : cpiFor(n[2]);
    if (a === null || b === null || Number.isNaN(a) || Number.isNaN(b))
      return bad('measures.real.range', { last: CPI_UPDATED });
    const value = adjust(n[0], a, b);
    if (value === null) return bad('measures.real.invalid');
    const years = n[2] - n[1];
    const rate = years !== 0 ? cagr(1, b / a, Math.abs(years)) : null;
    const steps = [
      tx('measures.real.step', { amount: m(n[0]), a: m(a), b: m(b), value: m(value) }),
      tx('measures.real.cumulative', { value: pct(b / a - 1, 2) }),
    ];
    if (rate !== null) steps.push(tx('measures.real.annual', { value: pct(years > 0 ? rate : -rate, 3) }));
    steps.push(tx('measures.real.source', { last: CPI_UPDATED }));
    return ok(tx('measures.real.headline', { amount: m(n[0]), from: n[1], value: fmt(value, 2), to: n[2] }), steps);
  },
);

const growth = form(
  'growth',
  [f('start', { initial: '100' }), f('end', { initial: '200' }), f('years', { initial: '10' })],
  (values) => {
    const n = read(T, values, ['start', 'end', 'years']);
    if (failed(n)) return n;
    const g = cagr(n[0], n[1], n[2]);
    if (g === null) return bad('measures.growth.invalid');
    const d = doubling(g * 100);
    const steps = [
      tx('measures.growth.cagr', { start: m(n[0]), end: m(n[1]), years: m(n[2]), g: pct(g, 4) }),
      tx('measures.growth.log', { value: pct(Math.log(n[1] / n[0]) / n[2], 4) }),
    ];
    if (d) steps.push(tx('measures.growth.doubling', { rule: fmt(d.rule, 2), exact: fmt(d.exact, 2) }));
    return ok(tx('measures.growth.headline', { g: pct(g, 3) }), steps);
  },
);

const inequalityForm = form(
  'inequality',
  [list('values', '10, 20, 30, 40'), list('weights', ''), f('epsilon', { initial: '1' })],
  (values) => {
    const xs = listOf(values, 'values');
    if (!xs || xs.length < 2) return bad('measures.inequality.needValues');
    const wText = (values.text.weights ?? '').trim();
    const ws = wText === '' ? undefined : listOf(values, 'weights');
    if (ws === null) return bad('measures.inequality.weights');
    const eps = read(T, values, ['epsilon']);
    if (failed(eps)) return eps;
    const g = gini(xs, ws);
    if (g === null) return bad('measures.inequality.invalid');
    const steps = [tx('measures.inequality.gini', { g: m(g) })];
    const other = !ws ? inequality(xs, eps[0]) : null;
    if (other) {
      steps.push(
        tx('measures.inequality.theil', { t: m(other.theilT), l: m(other.theilL) }),
        tx('measures.inequality.atkinson', { e: m(eps[0]), a: m(other.atkinson) }),
        tx('measures.inequality.ratio', { r: other.p90p10 === null ? '-' : m(other.p90p10) }),
      );
      if (other.palma !== null) steps.push(tx('measures.inequality.palma', { p: m(other.palma) }));
    } else if (ws) steps.push(tx('measures.inequality.weighted'));
    const pts = !ws ? lorenz(xs) : null;
    const figure = pts ? (
      <Plot
        summary={tx('measures.inequality.plot', { g: m(g) })}
        xLabel={tx('measures.inequality.population')}
        yLabel={tx('measures.inequality.income')}
        curves={[
          { label: tx('measures.inequality.lorenz'), points: pts },
          {
            label: tx('measures.inequality.equality'),
            points: [
              [0, 0],
              [1, 1],
            ],
            dashed: true,
          },
        ]}
      />
    ) : undefined;
    return ok(tx('measures.inequality.headline', { g: m(g) }), steps, figure);
  },
);

const povertyForm = form('poverty', [list('incomes', '10, 20, 30, 40'), f('line', { initial: '25' })], (values) => {
  const xs = listOf(values, 'incomes');
  const n = read(T, values, ['line']);
  if (!xs || failed(n)) return failed(n) ? n : bad('measures.listsNeeded');
  const r = poverty(xs, n[0]);
  if (!r) return bad('measures.poverty.invalid');
  return ok(tx('measures.poverty.headline', { h: m(r.headcount), g: m(r.gap), s: m(r.squaredGap) }), [
    tx('measures.poverty.headcount', { h: pct(r.headcount, 2) }),
    tx('measures.poverty.gap', { g: m(r.gap) }),
    tx('measures.poverty.squared', { s: m(r.squaredGap) }),
  ]);
});

const segregationForm = form('segregation', [list('a', '10, 20, 70'), list('b', '50, 30, 20')], (values) => {
  const a = listOf(values, 'a');
  const b = listOf(values, 'b');
  if (!a || !b) return bad('measures.listsNeeded');
  const r = segregation(a, b);
  if (!r) return bad('measures.segregation.invalid');
  return ok(tx('measures.segregation.headline', { d: m(r.dissimilarity) }), [
    tx('measures.segregation.dissimilarity', { d: m(r.dissimilarity), pct: fmt(r.dissimilarity * 100, 2) }),
    tx('measures.segregation.isolation', { i: m(r.isolationA) }),
    tx('measures.segregation.exposure', { e: m(r.exposureAToB) }),
    tx('measures.segregation.entropy', { h: m(r.entropy) }),
  ]);
});

const quotients = form('quotients', [list('region', '30, 70'), list('nation', '100, 400')], (values) => {
  const region = listOf(values, 'region');
  const nation = listOf(values, 'nation');
  if (!region || !nation) return bad('measures.listsNeeded');
  const lq = locationQuotients(region, nation);
  if (!lq) return bad('measures.quotients.invalid');
  return ok(
    tx('measures.quotients.headline', { list: join(lq) }),
    lq.map((q, i) => tx(q > 1 ? 'measures.quotients.concentrated' : 'measures.quotients.under', { n: i + 1, q: m(q) })),
  );
});

const shifts = form(
  'shift',
  [
    list('region0', '100, 200'),
    list('region1', '130, 210'),
    list('nation0', '1000, 2000'),
    list('nation1', '1200, 2100'),
  ],
  (values) => {
    const [r0, r1, n0, n1] = ['region0', 'region1', 'nation0', 'nation1'].map((id) => listOf(values, id));
    if (!r0 || !r1 || !n0 || !n1) return bad('measures.listsNeeded');
    const r = shiftShare(r0, r1, n0, n1);
    if (!r) return bad('measures.shift.invalid');
    return ok(tx('measures.shift.headline', { change: m(r.totals.change) }), [
      tx('measures.shift.national', { v: m(r.totals.national) }),
      tx('measures.shift.mix', { v: m(r.totals.mix) }),
      tx('measures.shift.competitive', { v: m(r.totals.competitive) }),
      ...r0.map((_x, i) =>
        tx('measures.shift.industry', { n: i + 1, a: m(r.national[i]), b: m(r.mix[i]), c: m(r.competitive[i]) }),
      ),
    ]);
  },
);

const matrixText = '0.2, 0.3\n0.4, 0.1';
const leontiefForm = form('leontief', [f('matrix', { kind: 'text', initial: matrixText })], (values) => {
  const rows = (values.text.matrix ?? '')
    .split(/\n|;/)
    .map((row) => parseList(row))
    .filter((row) => row === null || row.length > 0);
  if (rows.length === 0 || rows.some((row) => row === null)) return bad('measures.leontief.parse');
  const A = rows as number[][];
  const r = leontief(A);
  if (!r) return bad('measures.leontief.invalid');
  return ok(tx('measures.leontief.headline', { list: join(r.multipliers) }), [
    ...r.inverse.map((row, i) => tx('measures.leontief.row', { n: i + 1, row: join(row) })),
    ...r.multipliers.map((x, j) => tx('measures.leontief.multiplier', { n: j + 1, m: m(x) })),
  ]);
});

const hdiForm = form(
  'hdi',
  [f('health', { initial: '0.9' }), f('education', { initial: '0.8' }), f('incomeIndex', { initial: '0.85' })],
  (values) => {
    const n = read(T, values, ['health', 'education', 'incomeIndex']);
    if (failed(n)) return n;
    const h = hdi(n[0], n[1], n[2]);
    if (h === null) return bad('measures.hdi.range');
    return ok(tx('measures.hdi.headline', { h: fmt(h, 3) }), [
      tx('measures.hdi.step', { a: m(n[0]), b: m(n[1]), c: m(n[2]), h: fmt(h, 5) }),
    ]);
  },
);

const hdiRaw = form(
  'hdiRaw',
  [
    f('life', { initial: '75' }),
    f('mys', { initial: '10' }),
    f('eys', { initial: '14' }),
    f('gni', { initial: '20000' }),
    f('lifeMin', { initial: '20' }),
    f('lifeMax', { initial: '85' }),
    f('mysMax', { initial: '15' }),
    f('eysMax', { initial: '18' }),
    f('gniMin', { initial: '100' }),
    f('gniMax', { initial: '75000' }),
  ],
  (values) => {
    const n = read(T, values, [
      'life',
      'mys',
      'eys',
      'gni',
      'lifeMin',
      'lifeMax',
      'mysMax',
      'eysMax',
      'gniMin',
      'gniMax',
    ]);
    if (failed(n)) return n;
    const health = dimensionIndex(n[0], n[4], n[5]);
    const mys = dimensionIndex(n[1], 0, n[6]);
    const eys = dimensionIndex(n[2], 0, n[7]);
    const income = dimensionIndex(n[3], n[8], n[9], true);
    if (health === null || mys === null || eys === null || income === null) return bad('measures.hdi.goalposts');
    const education = (mys + eys) / 2;
    const h = hdi(health, education, income);
    if (h === null) return bad('measures.hdi.range');
    return ok(tx('measures.hdi.headline', { h: fmt(h, 3) }), [
      tx('measures.hdi.health', { v: m(health) }),
      tx('measures.hdi.education', { mys: m(mys), eys: m(eys), v: m(education) }),
      tx('measures.hdi.income', { v: m(income) }),
      tx('measures.hdi.step', { a: m(health), b: m(education), c: m(income), h: fmt(h, 5) }),
      tx('measures.hdi.goalNote'),
    ]);
  },
);

/** "0:10, 10000:20, 40000:30" as brackets: threshold, a colon, and the rate in percent. */
function parseBrackets(source: string): Bracket[] | null {
  const parts = source
    .split(/[,;\n]+/)
    .map((p) => p.trim())
    .filter(Boolean);
  const out = parts.map((part) => {
    const [from, rate] = part.split(':').map((x) => Number(x.trim().replace('%', '')));
    return { from, rate: rate / 100 };
  });
  return out.length > 0 && out.every((b) => Number.isFinite(b.from) && Number.isFinite(b.rate)) ? out : null;
}

const taxForm = form(
  'tax',
  [
    f('income', { initial: '50000' }),
    choice(T, 'schedule', ['custom', 'single', 'joint']),
    f('brackets', { kind: 'text', initial: '0:10, 10000:20, 40000:30' }),
  ],
  (values) => {
    const n = read(T, values, ['income']);
    if (failed(n)) return n;
    const kind = text(values, 'schedule');
    const brackets =
      kind === 'custom' ? parseBrackets(values.text.brackets ?? '') : FEDERAL[kind as 'single' | 'joint'];
    if (!brackets) return bad('measures.tax.parse');
    const r = taxOn(n[0], brackets);
    if (!r) return bad('measures.tax.invalid');
    const steps = r.pieces
      .filter((p) => p.amount > 0)
      .map((p) =>
        tx('measures.tax.piece', {
          from: m(p.from),
          to: p.to === null ? tx('measures.tax.above') : m(p.to),
          rate: fmt(p.rate * 100, 2),
          amount: m(p.amount),
        }),
      );
    steps.push(tx('measures.tax.rates', { avg: pct(r.average, 3), marginal: pct(r.marginal, 2) }));
    if (kind !== 'custom') steps.push(tx('measures.tax.federalNote', { year: FEDERAL_YEAR }));
    return ok(tx('measures.tax.headline', { tax: m(r.tax) }), steps);
  },
);

export const MEASURES: EconToolDef = {
  id: 'measures',
  forms: [
    index,
    rebase,
    deflator,
    real,
    growth,
    inequalityForm,
    povertyForm,
    segregationForm,
    quotients,
    shifts,
    leontiefForm,
    hdiForm,
    hdiRaw,
    taxForm,
  ],
};
