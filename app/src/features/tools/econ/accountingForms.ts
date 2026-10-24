// The accounting forms. Each reads its fields and words the result; the methods are in accounting.ts.
import {
  activityCosting,
  attributeSample,
  benfordShare,
  benfordTest,
  bondSchedule,
  cvp,
  inputVariances,
  mixBreakEven,
  parseJournal,
  periodicInventory,
  perpetualInventory,
  processCosting,
  ratios,
  statements,
  unitEconomics,
} from './accounting';
import type { CostMethod, Event, Layer, Pool, Product } from './accounting';
import { bad, choice, failed, field, ok, optional, read, text, tx } from './forms';
import type { EconForm, EconToolDef } from './forms';
import { fmt, parseList, pct } from './num';

const T = 'accounting';
const f = (id: string, rest = {}) => field(T, id, rest);
const m = (x: number) => fmt(x, 2);
const form = (id: string, fields: EconForm['fields'], solve: EconForm['solve']): EconForm => ({
  id,
  name: `accounting-${id}`,
  intro: true,
  fields,
  solve,
});
const METHODS = ['fifo', 'lifo', 'average'];

const ledger = form(
  'ledger',
  [
    f('journal', {
      kind: 'text',
      initial:
        'Cash 10000 ; Capital 10000 | Equipment 4000 ; Cash 4000 | Cash 3000 ; Service revenue 3000 | Rent expense 1000 ; Cash 1000',
    }),
  ],
  (values) => {
    const parsed = parseJournal(values.text.journal ?? '');
    if (!parsed.ok) {
      if (parsed.reason === 'type')
        return bad('accounting.ledger.type', { line: parsed.line, name: parsed.name ?? '' });
      return bad(parsed.reason === 'unbalanced' ? 'accounting.ledger.unbalanced' : 'accounting.ledger.format', {
        line: parsed.line,
      });
    }
    const s = statements(parsed.value);
    const steps = [
      ...s.accounts.map((a) =>
        tx('accounting.ledger.row', {
          name: a.name,
          type: tx(`accounting.types.${a.type}`),
          side: tx(a.debit > 0 || a.credit === 0 ? 'accounting.ledger.debit' : 'accounting.ledger.credit'),
          amount: m(a.debit > 0 ? a.debit : a.credit),
        }),
      ),
      tx('accounting.ledger.income', { revenue: m(s.revenues), expenses: m(s.expenses), net: m(s.netIncome) }),
      tx('accounting.ledger.sheet', { assets: m(s.assets), liabilities: m(s.liabilities), equity: m(s.equity) }),
      tx(s.balanced ? 'accounting.ledger.balanced' : 'accounting.ledger.notBalanced'),
    ];
    return ok(
      tx('accounting.ledger.headline', { debit: m(s.trialDebit), credit: m(s.trialCredit), net: m(s.netIncome) }),
      steps,
    );
  },
);

function parseLayers(source: string): Layer[] | null {
  const parts = source
    .split(/[,;]+/)
    .map((p) => p.trim())
    .filter(Boolean);
  const layers = parts.map((p) => {
    const [units, cost] = p.split('@').map((x) => Number(x.trim()));
    return { units, cost };
  });
  return layers.length > 0 && layers.every((l) => Number.isFinite(l.units) && Number.isFinite(l.cost)) ? layers : null;
}

function parseEvents(source: string): Event[] | null {
  const out: Event[] = [];
  for (const part of source
    .split(/[;,]+/)
    .map((p) => p.trim())
    .filter(Boolean)) {
    const words = part.split(/\s+/);
    const kind = words[0].toLowerCase();
    const nums = words.slice(1).map(Number);
    if (nums.some((n) => !Number.isFinite(n))) return null;
    if (kind === 'b' && nums.length === 2) out.push({ kind: 'buy', units: nums[0], cost: nums[1] });
    else if (kind === 's' && nums.length === 1) out.push({ kind: 'sell', units: nums[0] });
    else return null;
  }
  return out.length > 0 ? out : null;
}

const inventory = form(
  'inventory',
  [
    choice(T, 'system', ['periodic', 'perpetual']),
    choice(T, 'method', METHODS),
    f('layers', { kind: 'text', initial: '10@5, 10@6' }),
    f('sold', { initial: '15' }),
    f('events', { kind: 'text', initial: 'B 10 5; S 8; B 10 6; S 7' }),
    f('nrv'),
  ],
  (values) => {
    const method = text(values, 'method') as CostMethod;
    const perpetual = text(values, 'system') === 'perpetual';
    let result: { cogs: number; ending: number; units: number } | null;
    if (perpetual) {
      const events = parseEvents(values.text.events ?? '');
      if (!events) return bad('accounting.inventory.events');
      result = perpetualInventory(events, method);
    } else {
      const layers = parseLayers(values.text.layers ?? '');
      const n = read(T, values, ['sold']);
      if (!layers || failed(n)) return failed(n) ? n : bad('accounting.inventory.layers');
      result = periodicInventory(layers, n[0], method);
    }
    if (!result) return bad('accounting.inventory.invalid');
    const steps = [
      tx(`accounting.inventory.${method}`),
      tx('accounting.inventory.ending', { ending: m(result.ending), units: fmt(result.units, 4) }),
    ];
    const nrv = optional(values, 'nrv');
    if (nrv !== null && !Number.isNaN(nrv) && result.units > 0) {
      const perUnit = result.ending / result.units;
      steps.push(
        tx('accounting.inventory.lcnrv', {
          cost: m(perUnit),
          nrv: m(nrv),
          value: m(Math.min(perUnit, nrv) * result.units),
        }),
      );
    }
    return ok(tx('accounting.inventory.headline', { cogs: m(result.cogs) }), steps);
  },
);

const FINANCIALS = [
  'cash',
  'receivables',
  'inventory',
  'currentAssets',
  'currentLiabilities',
  'totalAssets',
  'totalLiabilities',
  'equity',
  'revenue',
  'cogs',
  'netIncome',
  'interest',
  'tax',
];
const INITIAL: Record<string, string> = {
  cash: '10',
  receivables: '20',
  inventory: '30',
  currentAssets: '60',
  currentLiabilities: '30',
  totalAssets: '200',
  totalLiabilities: '80',
  equity: '120',
  revenue: '400',
  cogs: '240',
  netIncome: '40',
  interest: '10',
  tax: '10',
};
const ratioForm = form(
  'ratios',
  FINANCIALS.map((id) => f(id, { initial: INITIAL[id] })),
  (values) => {
    const n = read(T, values, FINANCIALS);
    if (failed(n)) return n;
    const r = ratios(
      Object.fromEntries(FINANCIALS.map((id, i) => [id, n[i]])) as unknown as Parameters<typeof ratios>[0],
    );
    const line = (key: string, value: number | null, percent = false) =>
      tx('accounting.ratios.line', {
        name: tx(`accounting.ratios.${key}`),
        value: value === null ? tx('accounting.ratios.undefined') : percent ? pct(value, 2) : fmt(value, 3),
      });
    return ok(tx('accounting.ratios.headline', { roe: r.roe === null ? '-' : pct(r.roe, 2) }), [
      line('current', r.current),
      line('quick', r.quick),
      line('debtToEquity', r.debtToEquity),
      line('debtRatio', r.debtRatio, true),
      line('grossMargin', r.grossMargin, true),
      line('netMargin', r.netMargin, true),
      line('assetTurnover', r.assetTurnover),
      line('roa', r.roa, true),
      line('roe', r.roe, true),
      line('interestCover', r.interestCover),
      line('inventoryTurnover', r.inventoryTurnover),
      line('receivablesDays', r.receivablesDays),
      tx('accounting.ratios.dupont', { value: r.dupont === null ? '-' : pct(r.dupont, 2) }),
    ]);
  },
);

const cvpForm = form(
  'cvp',
  [
    f('price', { initial: '50' }),
    f('variable', { initial: '30' }),
    f('fixed', { initial: '40000' }),
    f('target', { initial: '0' }),
    f('expected', { initial: '2500' }),
  ],
  (values) => {
    const n = read(T, values, ['price', 'variable', 'fixed', 'target', 'expected']);
    if (failed(n)) return n;
    const r = cvp(n[0], n[1], n[2], n[3], n[4]);
    if (!r) return bad('accounting.cvp.invalid');
    const steps = [
      tx('accounting.cvp.margin', { margin: m(r.unitMargin), ratio: pct(r.marginRatio, 2) }),
      tx('accounting.cvp.breakEven', {
        fixed: m(n[2]),
        margin: m(r.unitMargin),
        units: fmt(r.breakEvenUnits, 2),
        sales: m(r.breakEvenSales),
      }),
    ];
    if (n[3] > 0 && r.targetUnits !== null)
      steps.push(tx('accounting.cvp.target', { profit: m(n[3]), units: fmt(r.targetUnits, 2) }));
    if (r.marginOfSafety !== null) steps.push(tx('accounting.cvp.safety', { mos: pct(r.marginOfSafety, 2) }));
    if (r.operatingLeverage !== null) steps.push(tx('accounting.cvp.leverage', { dol: fmt(r.operatingLeverage, 3) }));
    return ok(tx('accounting.cvp.headline', { units: fmt(r.breakEvenUnits, 2) }), steps);
  },
);

const mix = form(
  'mix',
  [f('products', { kind: 'text', initial: '10/6/3, 20/10/1' }), f('fixed', { initial: '6500' })],
  (values) => {
    const parts = (values.text.products ?? '').split(',').map((p) => p.trim().split('/').map(Number));
    const n = read(T, values, ['fixed']);
    if (failed(n)) return n;
    if (parts.length === 0 || parts.some((p) => p.length !== 3 || p.some((x) => !Number.isFinite(x))))
      return bad('accounting.mix.parse');
    const products: Product[] = parts.map(([price, variable, share]) => ({ price, variable, share }));
    const r = mixBreakEven(products, n[0]);
    if (!r) return bad('accounting.mix.invalid');
    return ok(tx('accounting.mix.headline', { units: fmt(r.units, 2) }), [
      tx('accounting.mix.margin', { margin: fmt(r.unitMargin, 4) }),
      ...r.byProduct.map((u, i) => tx('accounting.mix.product', { n: i + 1, units: fmt(u, 2) })),
    ]);
  },
);

const variance = form(
  'variance',
  [
    f('actualQty', { initial: '1000' }),
    f('actualPrice', { initial: '2.10' }),
    f('standardQty', { initial: '950' }),
    f('standardPrice', { initial: '2.00' }),
  ],
  (values) => {
    const n = read(T, values, ['actualQty', 'actualPrice', 'standardQty', 'standardPrice']);
    if (failed(n)) return n;
    const v = inputVariances(n[0], n[1], n[2], n[3]);
    const label = (x: number) =>
      tx(
        x > 1e-9
          ? 'accounting.variance.unfavorable'
          : x < -1e-9
            ? 'accounting.variance.favorable'
            : 'accounting.variance.none',
      );
    const sized = (x: number) => `${m(Math.abs(x))} ${label(x)}`;
    return ok(tx('accounting.variance.headline', { price: sized(v.price), quantity: sized(v.quantity) }), [
      tx('accounting.variance.price', { ap: m(n[1]), sp: m(n[3]), aq: fmt(n[0], 4), value: sized(v.price) }),
      tx('accounting.variance.quantity', { aq: fmt(n[0], 4), sq: fmt(n[2], 4), sp: m(n[3]), value: sized(v.quantity) }),
      tx('accounting.variance.total', { value: sized(v.total) }),
    ]);
  },
);

const processForm = form(
  'process',
  [
    f('completed', { initial: '800' }),
    f('ending', { initial: '200' }),
    f('endMaterial', { initial: '100' }),
    f('endConversion', { initial: '50' }),
    f('materialCost', { initial: '9000' }),
    f('conversionCost', { initial: '8800' }),
  ],
  (values) => {
    const n = read(T, values, [
      'completed',
      'ending',
      'endMaterial',
      'endConversion',
      'materialCost',
      'conversionCost',
    ]);
    if (failed(n)) return n;
    const r = processCosting(n[0], n[1], n[2] / 100, n[3] / 100, n[4], n[5]);
    if (!r) return bad('accounting.process.invalid');
    return ok(tx('accounting.process.headline', { cost: fmt(r.materialPerUnit + r.conversionPerUnit, 4) }), [
      tx('accounting.process.units', { material: fmt(r.materialUnits, 2), conversion: fmt(r.conversionUnits, 2) }),
      tx('accounting.process.rates', { material: fmt(r.materialPerUnit, 4), conversion: fmt(r.conversionPerUnit, 4) }),
      tx('accounting.process.split', {
        done: m(r.completedCost),
        ending: m(r.endingCost),
        total: m(r.completedCost + r.endingCost),
      }),
    ]);
  },
);

const activity = form(
  'activity',
  [f('pools', { kind: 'text', initial: 'Setups/10000/100/5, Inspections/6000/300/20' })],
  (values) => {
    const pools: Pool[] = [];
    for (const part of (values.text.pools ?? '')
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean)) {
      const [name, cost, driverTotal, used] = part.split('/');
      pools.push({
        name: name?.trim() ?? '',
        cost: Number(cost),
        driverTotal: Number(driverTotal),
        used: Number(used),
      });
    }
    if (
      pools.length === 0 ||
      pools.some((p) => !p.name || [p.cost, p.driverTotal, p.used].some((x) => !Number.isFinite(x)))
    )
      return bad('accounting.activity.parse');
    const r = activityCosting(pools);
    if (!r) return bad('accounting.activity.invalid');
    return ok(
      tx('accounting.activity.headline', { total: m(r.total) }),
      pools.map((p, i) =>
        tx('accounting.activity.pool', {
          name: p.name,
          rate: m(r.rates[i]),
          used: fmt(p.used, 4),
          amount: m(r.assigned[i]),
        }),
      ),
    );
  },
);

const bonds = form(
  'bonds',
  [
    f('face', { initial: '1000' }),
    f('coupon', { initial: '4' }),
    f('market', { initial: '5' }),
    f('periods', { initial: '5' }),
  ],
  (values) => {
    const n = read(T, values, ['face', 'coupon', 'market', 'periods']);
    if (failed(n)) return n;
    const r = bondSchedule(n[0], n[1] / 100, n[2] / 100, n[3]);
    if (!r) return bad('accounting.bonds.invalid');
    const steps = [
      tx(
        r.issue < n[0]
          ? 'accounting.bonds.discount'
          : r.issue > n[0]
            ? 'accounting.bonds.premium'
            : 'accounting.bonds.par',
        { amount: m(Math.abs(n[0] - r.issue)) },
      ),
      ...r.rows.slice(0, 12).map((row) =>
        tx('accounting.bonds.row', {
          n: row.period,
          expense: m(row.expense),
          cash: m(row.cash),
          amort: m(row.amortization),
          carrying: m(row.carrying),
        }),
      ),
    ];
    return ok(tx('accounting.bonds.headline', { issue: m(r.issue) }), steps);
  },
);

const audit = form(
  'audit',
  [
    choice(T, 'test', ['sample', 'benford']),
    f('confidence', { initial: '95' }),
    f('tolerable', { initial: '5' }),
    f('deviations', { initial: '0' }),
    f('amounts', { kind: 'text', initial: '' }),
  ],
  (values) => {
    if (text(values, 'test') === 'benford') {
      const amounts = parseList(values.text.amounts ?? '');
      if (!amounts) return bad('accounting.audit.amounts');
      const r = benfordTest(amounts);
      if (!r) return bad('accounting.audit.amounts');
      const steps = r.counts.map((c, i) =>
        tx('accounting.audit.digit', { d: i + 1, observed: pct(c / r.used, 1), expected: pct(benfordShare(i + 1), 1) }),
      );
      steps.push(
        tx('accounting.audit.chi', { chi: fmt(r.chiSquare, 3), p: fmt(r.pValue, 4) }),
        tx('accounting.audit.mad', { mad: fmt(r.mad, 5) }),
      );
      return ok(tx('accounting.audit.benfordHeadline', { p: fmt(r.pValue, 4), n: r.used }), steps);
    }
    const n = read(T, values, ['confidence', 'tolerable', 'deviations']);
    if (failed(n)) return n;
    const size = attributeSample(n[0] / 100, n[1] / 100, n[2]);
    if (size === null) return bad('accounting.audit.invalid');
    return ok(tx('accounting.audit.headline', { n: size }), [
      tx('accounting.audit.sampleStep', {
        confidence: fmt(n[0], 4),
        tolerable: fmt(n[1], 4),
        k: fmt(n[2], 4),
        n: size,
      }),
    ]);
  },
);

const unit = form(
  'unit',
  [
    f('margin', { initial: '100' }),
    f('retention', { initial: '0.8' }),
    f('discount', { initial: '0.1' }),
    f('acquisition', { initial: '150' }),
    f('funnel', { kind: 'text', initial: '1000, 400, 120, 30' }),
  ],
  (values) => {
    const n = read(T, values, ['margin', 'retention', 'discount', 'acquisition']);
    if (failed(n)) return n;
    const r = unitEconomics(n[0], n[1], n[2], n[3]);
    if (!r) return bad('accounting.unit.invalid');
    const steps = [
      tx('accounting.unit.clv', { m: m(n[0]), r: fmt(n[1], 4), d: fmt(n[2], 4), value: m(r.lifetimeValue) }),
    ];
    if (r.lifetimeValueToCost !== null)
      steps.push(tx('accounting.unit.ratio', { ratio: fmt(r.lifetimeValueToCost, 3) }));
    if (r.paybackPeriods !== null) steps.push(tx('accounting.unit.payback', { n: fmt(r.paybackPeriods, 2) }));
    if (r.lifetimePeriods !== null) steps.push(tx('accounting.unit.lifetime', { n: fmt(r.lifetimePeriods, 2) }));
    const funnel = parseList(values.text.funnel ?? '');
    if (
      funnel &&
      funnel.length > 1 &&
      funnel.every((x, i) => x >= 0 && (i === 0 || x <= funnel[i - 1]) && funnel[0] > 0)
    ) {
      funnel.slice(1).forEach((x, i) =>
        steps.push(
          tx('accounting.unit.step', {
            n: i + 1,
            step: pct(funnel[i] > 0 ? x / funnel[i] : 0, 1),
            cumulative: pct(x / funnel[0], 2),
          }),
        ),
      );
    }
    for (const t of [1, 2, 3, 6, 12]) steps.push(tx('accounting.unit.cohort', { t, share: pct(n[1] ** t, 1) }));
    return ok(tx('accounting.unit.headline', { value: m(r.lifetimeValue) }), steps);
  },
);

export const ACCOUNTING: EconToolDef = {
  id: 'accounting',
  forms: [ledger, inventory, ratioForm, cvpForm, mix, variance, processForm, activity, bonds, audit, unit],
};
