// The supply and demand forms. Each reads its fields, words the result with its steps, and draws the graph.
// The methods are in markets.ts.
import { Plot } from './Plot';
import type { Area, Curve, Mark } from './Plot';
import { bad, choice, failed, field, ok, read, text, tx } from './forms';
import type { EconForm, EconToolDef, Values } from './forms';
import {
  arcElasticity,
  buyerPrice,
  equilibrium,
  externality,
  importPolicy,
  labor,
  openEconomy,
  priceControl,
  quota,
  sellerPrice,
  unitTax,
  valueTax,
  validCurves,
} from './markets';
import type { Curves, Equilibrium } from './markets';
import { fmt, pct } from './num';

const T = 'markets';
const f = (id: string, rest = {}) => field(T, id, rest);
const m = (x: number) => fmt(x, 3);
const CURVES = ['a', 'b', 'c', 'd'];
const curveFields = () => [
  f('a', { initial: '100' }),
  f('b', { initial: '2' }),
  f('c', { initial: '-20' }),
  f('d', { initial: '2' }),
];

function curves(values: Values): Curves | ReturnType<typeof bad> {
  const nums = read(T, values, CURVES);
  if (failed(nums)) return nums;
  const k = { a: nums[0], b: nums[1], c: nums[2], d: nums[3] };
  return validCurves(k) && equilibrium(k) ? k : bad('markets.invalidCurves');
}
const isCurves = (x: Curves | ReturnType<typeof bad>): x is Curves => 'a' in x;

/** Demand and supply as price against quantity, out to qmax, plus any extra curves. */
function drawing(k: Curves, qmax: number, extra: Curve[] = []): Curve[] {
  const demand: Curve = {
    label: tx('markets.demand'),
    points: [
      [0, buyerPrice(k, 0)],
      [qmax, Math.max(0, buyerPrice(k, qmax))],
    ],
  };
  const start = Math.max(0, k.c);
  const supply: Curve = {
    label: tx('markets.supply'),
    points: [
      [start, sellerPrice(k, start)],
      [qmax, sellerPrice(k, qmax)],
    ],
    dashed: true,
  };
  return [demand, supply, ...extra];
}

function graph(summary: string, k: Curves, qmax: number, extra: Curve[], areas: Area[], marks: Mark[]) {
  return (
    <Plot
      summary={summary}
      xLabel={tx('markets.quantity')}
      yLabel={tx('markets.price')}
      curves={drawing(k, qmax, extra)}
      areas={areas}
      marks={marks}
    />
  );
}

const marketForm: EconForm = {
  id: 'market',
  name: 'markets-market',
  intro: true,
  fields: curveFields(),
  solve(values) {
    const k = curves(values);
    if (!isCurves(k)) return k;
    const e = equilibrium(k)!;
    const top = buyerPrice(k, 0);
    const bottom = Math.max(0, sellerPrice(k, 0));
    const areas: Area[] = [
      {
        label: tx('markets.cs', { value: m(e.consumerSurplus) }),
        points: [
          [0, top],
          [e.quantity, e.price],
          [0, e.price],
        ],
      },
      {
        label: tx('markets.ps', { value: m(e.producerSurplus) }),
        points: [
          [0, e.price],
          [e.quantity, e.price],
          [Math.max(0, k.c), bottom],
        ],
      },
    ];
    const steps = [
      tx('markets.algebra', { a: m(k.a), b: m(k.b), c: m(k.c), d: m(k.d), p: m(e.price) }),
      tx('markets.quantityStep', { a: m(k.a), b: m(k.b), p: m(e.price), q: m(e.quantity) }),
      tx('markets.csStep', { top: m(top), p: m(e.price), q: m(e.quantity), cs: m(e.consumerSurplus) }),
      tx('markets.psStep', { bottom: m(bottom), p: m(e.price), q: m(e.quantity), ps: m(e.producerSurplus) }),
      tx('markets.totalStep', { total: m(e.consumerSurplus + e.producerSurplus) }),
      tx('markets.elasticStep', {
        ed: m(e.demandElasticity),
        es: m(e.supplyElasticity),
        range: tx(
          Math.abs(e.demandElasticity) > 1
            ? 'markets.elastic'
            : Math.abs(e.demandElasticity) < 1
              ? 'markets.inelastic'
              : 'markets.unit',
        ),
      }),
    ];
    const figure = graph(
      tx('markets.plotEq', { p: m(e.price), q: m(e.quantity) }),
      k,
      Math.min(k.a, e.quantity * 1.8),
      [],
      areas,
      [{ label: tx('markets.eq'), x: e.quantity, y: e.price }],
    );
    return ok(tx('markets.headline', { p: m(e.price), q: m(e.quantity) }), steps, figure);
  },
};

const elasticity: EconForm = {
  id: 'elasticity',
  name: 'markets-elasticity',
  intro: true,
  fields: [
    f('p1', { initial: '10' }),
    f('q1', { initial: '100' }),
    f('p2', { initial: '12' }),
    f('q2', { initial: '90' }),
  ],
  solve(values) {
    const nums = read(T, values, ['p1', 'q1', 'p2', 'q2']);
    if (failed(nums)) return nums;
    const [p1, q1, p2, q2] = nums;
    const r = arcElasticity(p1, q1, p2, q2);
    if (!r) return bad('markets.elasticity.invalid');
    return ok(tx('markets.elasticity.headline', { e: fmt(r.elasticity, 4) }), [
      tx('markets.elasticity.step', {
        dq: m(q2 - q1),
        q: m((q1 + q2) / 2),
        dp: m(p2 - p1),
        p: m((p1 + p2) / 2),
        e: fmt(r.elasticity, 4),
      }),
      tx(`markets.elasticity.${r.range}`),
      tx('markets.elasticity.revenue', { r1: m(p1 * q1), r2: m(p2 * q2), change: m(r.revenueChange) }),
    ]);
  },
};

const POLICIES = ['tax', 'subsidy', 'valueTax', 'ceiling', 'floor', 'quota'];

interface PolicyContext {
  k: Curves;
  e: Equilibrium;
  x: number;
  policy: string;
  qmax: number;
  total: number;
}

function taxCase({ k, e, x, policy, qmax, total }: PolicyContext) {
  const r = policy === 'valueTax' ? valueTax(k, x / 100) : unitTax(k, policy === 'tax' ? x : -x);
  if (!r) return bad('markets.noTrade');
  const wedge = r.buyersPay - r.sellersGet;
  const subsidy = wedge < 0;
  const steps = [
    tx(policy === 'valueTax' ? 'markets.tax.valueStep' : 'markets.tax.step', {
      t: m(Math.abs(wedge)),
      rate: fmt(x, 3),
      buyers: m(r.buyersPay),
      sellers: m(r.sellersGet),
      q: m(r.quantity),
    }),
    tx(subsidy ? 'markets.tax.cost' : 'markets.tax.revenue', { value: m(Math.abs(r.revenue)) }),
    tx('markets.tax.dwl', {
      wedge: m(Math.abs(wedge)),
      lost: m(e.quantity - r.quantity),
      dwl: m(r.deadweightLoss),
    }),
    tx('markets.tax.incidence', { buyers: pct(r.buyerShare, 2), sellers: pct(r.sellerShare, 2) }),
    tx('markets.tax.surplus', { cs: m(r.consumerSurplus), ps: m(r.producerSurplus), total: m(total) }),
  ];
  const lo = Math.min(r.buyersPay, r.sellersGet);
  const hi = Math.max(r.buyersPay, r.sellersGet);
  const areas: Area[] = [
    {
      label: tx(subsidy ? 'markets.tax.costArea' : 'markets.tax.revenueArea', { value: m(Math.abs(r.revenue)) }),
      points: [
        [0, hi],
        [r.quantity, hi],
        [r.quantity, lo],
        [0, lo],
      ],
    },
    {
      label: tx('markets.tax.dwlArea', { value: m(r.deadweightLoss) }),
      points: [
        [r.quantity, hi],
        [e.quantity, e.price],
        [r.quantity, lo],
      ],
    },
  ];
  const figure = graph(
    tx('markets.plotTax', { pb: m(r.buyersPay), ps: m(r.sellersGet), q: m(r.quantity) }),
    k,
    qmax,
    [],
    areas,
    [
      { label: tx('markets.tax.buyers'), x: r.quantity, y: r.buyersPay },
      { label: tx('markets.tax.sellers'), x: r.quantity, y: r.sellersGet },
    ],
  );
  return ok(
    tx('markets.tax.headline', { buyers: m(r.buyersPay), sellers: m(r.sellersGet), q: m(r.quantity) }),
    steps,
    figure,
  );
}

function controlCase({ k, e, x, policy, qmax }: PolicyContext) {
  const r = priceControl(k, policy as 'ceiling' | 'floor', x);
  if (!r) return bad('markets.control.invalid');
  if (!r.binding)
    return ok(tx('markets.control.notBinding', { p: m(e.price) }), [
      tx('markets.control.notBindingStep', { level: m(x), p: m(e.price) }),
    ]);
  const ceiling = policy === 'ceiling';
  const steps = [
    tx('markets.control.quantities', { p: m(r.price), qd: m(r.quantityDemanded), qs: m(r.quantitySupplied) }),
    tx(ceiling ? 'markets.control.shortage' : 'markets.control.surplus', { gap: m(r.gap), traded: m(r.traded) }),
    tx('markets.control.surplusStep', {
      cs: m(r.consumerSurplus),
      ps: m(r.producerSurplus),
      dwl: m(r.deadweightLoss),
    }),
  ];
  const qHi = Math.max(r.quantityDemanded, r.quantitySupplied);
  const figure = graph(
    tx('markets.plotControl', { p: m(r.price), traded: m(r.traded) }),
    k,
    Math.min(k.a, Math.max(qmax, qHi * 1.1)),
    [
      {
        label: tx(ceiling ? 'markets.ceiling' : 'markets.floor'),
        points: [
          [0, r.price],
          [Math.min(k.a, Math.max(qmax, qHi * 1.1)), r.price],
        ],
      },
    ],
    [
      {
        label: tx('markets.tax.dwlArea', { value: m(r.deadweightLoss) }),
        points: [
          [r.traded, buyerPrice(k, r.traded)],
          [e.quantity, e.price],
          [r.traded, sellerPrice(k, r.traded)],
        ],
      },
    ],
    [{ label: tx('markets.eq'), x: e.quantity, y: e.price }],
  );
  return ok(
    tx(ceiling ? 'markets.control.shortageHeadline' : 'markets.control.surplusHeadline', { gap: m(r.gap) }),
    steps,
    figure,
  );
}

function quotaCase({ k, e, x, qmax }: PolicyContext) {
  const r = quota(k, x);
  if (!r) return bad('markets.control.invalid');
  if (!r.binding)
    return ok(tx('markets.control.notBinding', { p: m(e.price) }), [
      tx('markets.quota.notBinding', { q: m(e.quantity) }),
    ]);
  const figure = graph(
    tx('markets.plotQuota', { pb: m(r.buyersPay), ps: m(r.sellersGet), q: m(x) }),
    k,
    qmax,
    [
      {
        label: tx('markets.quota.limit'),
        points: [
          [x, 0],
          [x, r.buyersPay],
        ],
        dashed: true,
      },
    ],
    [
      {
        label: tx('markets.quota.rentArea', { value: m(r.rent) }),
        points: [
          [0, r.buyersPay],
          [x, r.buyersPay],
          [x, r.sellersGet],
          [0, r.sellersGet],
        ],
      },
      {
        label: tx('markets.tax.dwlArea', { value: m(r.deadweightLoss) }),
        points: [
          [x, r.buyersPay],
          [e.quantity, e.price],
          [x, r.sellersGet],
        ],
      },
    ],
    [{ label: tx('markets.eq'), x: e.quantity, y: e.price }],
  );
  return ok(
    tx('markets.quota.headline', { pb: m(r.buyersPay), ps: m(r.sellersGet), q: m(x) }),
    [
      tx('markets.quota.step', { pb: m(r.buyersPay), ps: m(r.sellersGet), gap: m(r.rentPerUnit) }),
      tx('markets.quota.rent', { rent: m(r.rent) }),
      tx('markets.tax.dwl', { wedge: m(r.rentPerUnit), lost: m(e.quantity - x), dwl: m(r.deadweightLoss) }),
    ],
    figure,
  );
}

const policyForm: EconForm = {
  id: 'policy',
  name: 'markets-policy',
  intro: true,
  fields: [...curveFields(), choice(T, 'policy', POLICIES), f('level', { initial: '10' })],
  solve(values) {
    const k = curves(values);
    if (!isCurves(k)) return k;
    const level = read(T, values, ['level']);
    if (failed(level)) return level;
    const x = level[0];
    const policy = text(values, 'policy');
    const e = equilibrium(k)!;
    const total = e.consumerSurplus + e.producerSurplus;
    const qmax = Math.min(k.a, e.quantity * 1.8);
    const context = { k, e, x, policy, qmax, total };
    if (policy === 'tax' || policy === 'subsidy' || policy === 'valueTax') return taxCase(context);
    if (policy === 'ceiling' || policy === 'floor') return controlCase(context);
    return quotaCase(context);
  },
};

const tradeForm: EconForm = {
  id: 'trade',
  name: 'markets-trade',
  intro: true,
  fields: [
    ...curveFields(),
    f('world', { initial: '20' }),
    choice(T, 'tradePolicy', ['none', 'tariff', 'importQuota']),
    f('level', { initial: '5' }),
  ],
  solve(values) {
    const k = curves(values);
    if (!isCurves(k)) return k;
    const nums = read(T, values, ['world', 'level']);
    if (failed(nums)) return nums;
    const [world, level] = nums;
    const free = openEconomy(k, world);
    if (!free) return bad('markets.trade.invalid');
    const e = equilibrium(k)!;
    const steps = [
      tx('markets.trade.autarky', { p: m(e.price), q: m(e.quantity) }),
      tx(
        free.direction === 'exports'
          ? 'markets.trade.exports'
          : free.direction === 'imports'
            ? 'markets.trade.imports'
            : 'markets.trade.none',
        { pw: m(world), qd: m(free.consumption), qs: m(free.production), flow: m(free.flow) },
      ),
      tx('markets.trade.surplus', {
        cs: m(free.consumerSurplus),
        ps: m(free.producerSurplus),
        gain: m(free.gainFromTrade),
      }),
    ];
    const policy = text(values, 'tradePolicy');
    if (policy === 'none')
      return ok(
        tx('markets.trade.headline', { flow: m(free.flow), what: tx(`markets.trade.${free.direction}Word`) }),
        steps,
      );
    if (free.direction !== 'imports') return bad('markets.trade.onlyImports');
    const r = importPolicy(k, world, policy === 'tariff' ? 'tariff' : 'quota', level);
    if (!r) return bad('markets.trade.invalid');
    steps.push(
      tx(policy === 'tariff' ? 'markets.trade.tariffStep' : 'markets.trade.quotaStep', {
        p: m(r.domesticPrice),
        imports: m(r.trade.flow),
        qd: m(r.trade.consumption),
        qs: m(r.trade.production),
      }),
      tx(policy === 'tariff' ? 'markets.trade.tariffRevenue' : 'markets.trade.quotaRent', { value: m(r.revenue) }),
      tx('markets.trade.dwl', { dwl: m(r.deadweightLoss) }),
    );
    return ok(tx('markets.trade.policyHeadline', { p: m(r.domesticPrice), dwl: m(r.deadweightLoss) }), steps);
  },
};

const externalityForm: EconForm = {
  id: 'externality',
  name: 'markets-externality',
  intro: true,
  fields: [...curveFields(), f('external', { initial: '10' })],
  solve(values) {
    const k = curves(values);
    if (!isCurves(k)) return k;
    const ext = read(T, values, ['external']);
    if (failed(ext)) return ext;
    const r = externality(k, ext[0]);
    if (!r) return bad('markets.externality.invalid');
    const e = equilibrium(k)!;
    const cost = ext[0] >= 0;
    const steps = [
      tx('markets.externality.market', { q: m(e.quantity), p: m(e.price) }),
      tx(cost ? 'markets.externality.efficientCost' : 'markets.externality.efficientBenefit', {
        x: m(Math.abs(ext[0])),
        q: m(r.efficientQuantity),
      }),
      tx(cost ? 'markets.externality.tax' : 'markets.externality.subsidy', {
        x: m(Math.abs(ext[0])),
        pb: m(r.priceBuyersPay),
      }),
      tx('markets.externality.dwl', {
        x: m(Math.abs(ext[0])),
        dq: m(Math.abs(e.quantity - r.efficientQuantity)),
        dwl: m(r.deadweightLoss),
      }),
    ];
    const qmax = Math.min(k.a, Math.max(e.quantity, r.efficientQuantity) * 1.6);
    const figure = graph(
      tx('markets.externality.plot', { q: m(r.efficientQuantity) }),
      k,
      qmax,
      [
        {
          label: tx('markets.externality.social'),
          points: [
            [Math.max(0, k.c), sellerPrice(k, Math.max(0, k.c)) + ext[0]],
            [qmax, sellerPrice(k, qmax) + ext[0]],
          ],
          dashed: true,
        },
      ],
      [
        {
          label: tx('markets.tax.dwlArea', { value: m(r.deadweightLoss) }),
          points: [
            [Math.min(e.quantity, r.efficientQuantity), buyerPrice(k, Math.min(e.quantity, r.efficientQuantity))],
            [Math.max(e.quantity, r.efficientQuantity), buyerPrice(k, Math.max(e.quantity, r.efficientQuantity))],
            [
              Math.min(e.quantity, r.efficientQuantity),
              sellerPrice(k, Math.min(e.quantity, r.efficientQuantity)) + ext[0],
            ],
          ].slice(0, 3) as [number, number][],
        },
      ],
      [{ label: tx('markets.externality.efficient'), x: r.efficientQuantity, y: r.priceBuyersPay }],
    );
    return ok(tx('markets.externality.headline', { q: m(r.efficientQuantity), x: m(r.correctiveTax) }), steps, figure);
  },
};

const laborForm: EconForm = {
  id: 'labor',
  name: 'markets-labor',
  intro: true,
  fields: [
    f('m0', { initial: '50' }),
    f('m1', { initial: '1' }),
    f('s0', { initial: '10' }),
    f('s1', { initial: '1' }),
  ],
  solve(values) {
    const nums = read(T, values, ['m0', 'm1', 's0', 's1']);
    if (failed(nums)) return nums;
    const r = labor(nums[0], nums[1], nums[2], nums[3]);
    if (!r) return bad('markets.labor.invalid');
    return ok(tx('markets.labor.headline', { w: m(r.monopsonyWage), l: m(r.monopsonyEmployment) }), [
      tx('markets.labor.competitive', { w: m(r.competitiveWage), l: m(r.competitiveEmployment) }),
      tx('markets.labor.mfc', { l: m(r.monopsonyEmployment), w: m(r.monopsonyWage) }),
      tx('markets.labor.compare', {
        dw: m(r.competitiveWage - r.monopsonyWage),
        dl: m(r.competitiveEmployment - r.monopsonyEmployment),
      }),
      tx('markets.labor.minimum', { w: m(r.competitiveWage) }),
    ]);
  },
};

export const MARKETS: EconToolDef = {
  id: 'markets',
  forms: [marketForm, elasticity, policyForm, tradeForm, externalityForm, laborForm],
};
