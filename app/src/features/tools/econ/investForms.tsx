// The investment forms. Each reads its fields, words the result with its steps, and draws the graph.
// The methods are in invest.ts.
import {
  accruedInterest,
  binomialTree,
  blackScholes,
  bondPrice,
  bondRisk,
  bondYield,
  bootstrap,
  capm,
  covarianceFrom,
  dcf,
  dilution,
  gbmPaths,
  gordon,
  impliedVolatility,
  mean,
  minimumVariance,
  poolShuffle,
  portfolioStats,
  postMoney,
  priceChange,
  returnsFrom,
  safeConversion,
  strategy,
  tangency,
  variance,
  ventureMethod,
  wacc,
} from './invest';
import type { DayCount, Leg } from './invest';
import { Plot } from './Plot';
import { bad, choice, failed, field, ok, optional, read, text, tx } from './forms';
import type { EconForm, EconToolDef } from './forms';
import { fmt, parseList, pct } from './num';

const T = 'invest';
const f = (id: string, rest = {}) => field(T, id, rest);
const m = (x: number) => fmt(x, 4);
const form = (id: string, fields: EconForm['fields'], solve: EconForm['solve']): EconForm => ({
  id,
  name: `invest-${id}`,
  intro: true,
  fields,
  solve,
});
const list = (id: string, initial: string) => f(id, { kind: 'text', initial });
const listOf = (values: { text: Record<string, string> }, id: string) => parseList(values.text[id] ?? '');

const bondForm = form(
  'bond',
  [
    f('face', { initial: '1000' }),
    f('coupon', { initial: '5' }),
    f('years', { initial: '10' }),
    f('frequency', { initial: '1' }),
    f('yield', { initial: '6' }),
    f('price'),
    f('shock', { initial: '1' }),
  ],
  (values) => {
    const n = read(T, values, ['face', 'coupon', 'years', 'frequency', 'shock']);
    if (failed(n)) return n;
    const terms = { face: n[0], coupon: n[1] / 100, years: n[2], frequency: n[3] };
    const y = optional(values, 'yield');
    const p = optional(values, 'price');
    if ((y === null) === (p === null)) return bad('invest.bond.one');
    if ((y !== null && Number.isNaN(y)) || (p !== null && Number.isNaN(p)))
      return bad('common.notNumber', { name: tx('invest.f.yield') });
    const rate = y !== null ? y / 100 : bondYield(terms, p!);
    if (rate === null) return bad('invest.bond.noYield');
    const risk = bondRisk(terms, rate);
    if (!risk) return bad('invest.bond.invalid');
    const dy = n[4] / 100;
    const exact = bondPrice(terms, rate + dy);
    const steps = [
      tx(y !== null ? 'invest.bond.price' : 'invest.bond.yield', { price: fmt(risk.price, 2), yield: pct(rate, 4) }),
      tx('invest.bond.macaulay', { d: fmt(risk.macaulay, 4) }),
      tx('invest.bond.modified', { d: fmt(risk.modified, 4) }),
      tx('invest.bond.convexity', { c: fmt(risk.convexity, 3) }),
      tx('invest.bond.change', {
        dy: fmt(n[4], 3),
        approx: pct(priceChange(risk, dy), 3),
        exact: exact === null ? '-' : pct(exact / risk.price - 1, 3),
      }),
      tx(
        rate > terms.coupon ? 'invest.bond.discount' : rate < terms.coupon ? 'invest.bond.premium' : 'invest.bond.par',
      ),
    ];
    return ok(
      y !== null
        ? tx('invest.bond.headline', { price: fmt(risk.price, 2) })
        : tx('invest.bond.yieldHeadline', { yield: pct(rate, 4) }),
      steps,
    );
  },
);

const accrued = form(
  'accrued',
  [
    f('annualCoupon', { initial: '6' }),
    f('frequency', { initial: '2' }),
    f('last', { kind: 'text', initial: '2024-01-15' }),
    f('settlement', { kind: 'text', initial: '2024-03-15' }),
    f('next', { kind: 'text', initial: '2024-07-15' }),
    choice(T, 'convention', ['30/360', 'act/act', 'act/360']),
    f('clean'),
  ],
  (values) => {
    const n = read(T, values, ['annualCoupon', 'frequency']);
    if (failed(n)) return n;
    const r = accruedInterest(
      n[0],
      n[1],
      text(values, 'last'),
      text(values, 'settlement'),
      text(values, 'next'),
      text(values, 'convention') as DayCount,
    );
    if (!r) return bad('invest.accrued.invalid');
    const steps = [tx('invest.accrued.step', { days: r.days, basis: r.basis, accrued: fmt(r.accrued, 4) })];
    const clean = optional(values, 'clean');
    if (clean !== null && !Number.isNaN(clean))
      steps.push(tx('invest.accrued.dirty', { clean: m(clean), dirty: m(clean + r.accrued) }));
    return ok(tx('invest.accrued.headline', { accrued: fmt(r.accrued, 4) }), steps);
  },
);

const curve = form('curve', [list('bonds', '1/0/95.2381, 2/5/99, 3/5/97')], (values) => {
  const bonds = (values.text.bonds ?? '')
    .split(',')
    .map((b) => b.trim())
    .filter(Boolean)
    .map((b) => b.split('/').map(Number));
  if (bonds.length === 0 || bonds.some((b) => b.length !== 3 || b.some((x) => !Number.isFinite(x))))
    return bad('invest.curve.parse');
  const r = bootstrap(bonds.map(([years, coupon, price]) => ({ years, coupon, price })));
  if (!r) return bad('invest.curve.invalid');
  const figure = (
    <Plot
      summary={tx('invest.curve.plot')}
      xLabel={tx('invest.curve.years')}
      yLabel={tx('invest.curve.rate')}
      curves={[
        { label: tx('invest.curve.spot'), points: r.spot.map((s, i) => [i + 1, s * 100] as const) },
        {
          label: tx('invest.curve.forward'),
          points: r.forward.flatMap((x, i) => (x === null ? [] : [[i + 1, x * 100] as const])),
          dashed: true,
        },
      ].filter((c) => c.points.length > 0)}
    />
  );
  return ok(
    tx('invest.curve.headline', { list: r.spot.map((s) => pct(s, 3)).join(', ') }),
    r.discount.map((d, i) =>
      tx('invest.curve.row', {
        n: i + 1,
        df: fmt(d, 5),
        spot: pct(r.spot[i], 3),
        fwd: r.forward[i] === null ? tx('invest.curve.none') : pct(r.forward[i]!, 3),
      }),
    ),
    figure,
  );
});

const returns = form(
  'returns',
  [list('prices', '100, 105, 102, 110, 108'), f('perYear', { initial: '12' })],
  (values) => {
    const prices = listOf(values, 'prices');
    const n = read(T, values, ['perYear']);
    if (!prices || prices.length < 3 || prices.some((x) => !(x > 0)) || failed(n))
      return failed(n) ? n : bad('invest.returns.invalid');
    const r = returnsFrom(prices);
    const mu = mean(r);
    const sd = Math.sqrt(variance(r));
    return ok(tx('invest.returns.headline', { mean: pct(mu, 3), sd: pct(sd, 3) }), [
      tx('invest.returns.list', { list: r.map((x) => pct(x, 2)).join(', ') }),
      tx('invest.returns.annual', { mean: pct(mu * n[0], 3), sd: pct(sd * Math.sqrt(n[0]), 3) }),
    ]);
  },
);

const capmForm = form(
  'capm',
  [
    list('asset', '0.03, -0.02, 0.05, 0.02, -0.04'),
    list('market', '0.02, -0.01, 0.03, 0.01, -0.02'),
    f('rf', { initial: '0.1' }),
  ],
  (values) => {
    const asset = listOf(values, 'asset');
    const market = listOf(values, 'market');
    const n = read(T, values, ['rf']);
    if (!asset || !market || failed(n)) return failed(n) ? n : bad('invest.capm.lists');
    const r = capm(asset, market, n[0] / 100);
    if (!r) return bad('invest.capm.invalid');
    return ok(tx('invest.capm.headline', { beta: m(r.beta) }), [
      tx('invest.capm.beta', { beta: m(r.beta), r2: fmt(r.rSquared, 4) }),
      tx('invest.capm.alpha', { alpha: pct(r.alpha, 3) }),
      tx('invest.capm.sml', { rf: fmt(n[0], 4), beta: m(r.beta), expected: pct(r.expected, 3) }),
    ]);
  },
);

const portfolio = form(
  'portfolio',
  [
    list('means', '10, 15'),
    list('sds', '20, 30'),
    f('corr', { kind: 'text', initial: '1, 0.3; 0.3, 1' }),
    f('rf', { initial: '3' }),
  ],
  (values) => {
    const means = listOf(values, 'means')?.map((x) => x / 100);
    const sds = listOf(values, 'sds')?.map((x) => x / 100);
    const rows = (values.text.corr ?? '').split(';').map((row) => parseList(row));
    const n = read(T, values, ['rf']);
    if (!means || !sds || failed(n)) return failed(n) ? n : bad('invest.portfolio.lists');
    if (means.length !== sds.length) return bad('invest.portfolio.sameLength');
    if (rows.some((row) => row === null)) return bad('invest.portfolio.corr');
    const cov = covarianceFrom(sds, rows as number[][]);
    if (!cov) return bad('invest.portfolio.corr');
    const mv = minimumVariance(means, cov, n[0] / 100);
    if (!mv) return bad('invest.portfolio.singular');
    const tg = tangency(means, cov, n[0] / 100);
    const weights = (w: number[]) => w.map((x) => pct(x, 2)).join(', ');
    const steps = [
      tx('invest.portfolio.mv', { w: weights(mv.weights), mean: pct(mv.mean, 3), sd: pct(mv.sd, 3) }),
      tg
        ? tx('invest.portfolio.tg', {
            w: weights(tg.weights),
            mean: pct(tg.mean, 3),
            sd: pct(tg.sd, 3),
            sharpe: fmt(tg.sharpe ?? 0, 4),
          })
        : tx('invest.portfolio.noTg'),
      tx('invest.portfolio.shorts'),
    ];
    let figure;
    if (means.length === 2) {
      const grid = Array.from({ length: 41 }, (_, i) => -0.5 + i * 0.05);
      const points = grid
        .map((w) => portfolioStats([w, 1 - w], means, cov, 0))
        .map((p) => [p.sd * 100, p.mean * 100] as const);
      figure = (
        <Plot
          summary={tx('invest.portfolio.plot')}
          xLabel={tx('invest.portfolio.risk')}
          yLabel={tx('invest.portfolio.return')}
          curves={[{ label: tx('invest.portfolio.frontier'), points }]}
          marks={[
            { label: tx('invest.portfolio.mvLabel'), x: mv.sd * 100, y: mv.mean * 100 },
            ...(tg ? [{ label: tx('invest.portfolio.tgLabel'), x: tg.sd * 100, y: tg.mean * 100 }] : []),
          ]}
        />
      );
    }
    return ok(tx('invest.portfolio.headline', { w: weights(mv.weights) }), steps, figure);
  },
);

const bsForm = form(
  'blackScholes',
  [
    choice(T, 'kind', ['call', 'put']),
    f('spot', { initial: '100' }),
    f('strike', { initial: '100' }),
    f('rate', { initial: '5' }),
    f('vol', { initial: '20' }),
    f('time', { initial: '1' }),
    f('dividend', { initial: '0' }),
    f('marketPrice'),
  ],
  (values) => {
    const n = read(T, values, ['spot', 'strike', 'rate', 'vol', 'time', 'dividend']);
    if (failed(n)) return n;
    const kind = text(values, 'kind') as 'call' | 'put';
    const o = { spot: n[0], strike: n[1], rate: n[2] / 100, vol: n[3] / 100, time: n[4], dividend: n[5] / 100 };
    const g = blackScholes(o, kind);
    if (!g) return bad('invest.bs.invalid');
    const other = blackScholes(o, kind === 'call' ? 'put' : 'call')!;
    const call = kind === 'call' ? g.price : other.price;
    const put = kind === 'call' ? other.price : g.price;
    const steps = [
      tx('invest.bs.greeks', {
        delta: fmt(g.delta, 5),
        gamma: fmt(g.gamma, 5),
        vega: fmt(g.vega, 4),
        theta: fmt(g.theta, 4),
        rho: fmt(g.rho, 4),
      }),
      tx('invest.bs.parity', {
        lhs: fmt(call - put, 4),
        rhs: fmt(o.spot * Math.exp(-o.dividend * o.time) - o.strike * Math.exp(-o.rate * o.time), 4),
      }),
      tx('invest.bs.other', { kind: tx(`invest.o.${kind === 'call' ? 'put' : 'call'}`), price: fmt(other.price, 4) }),
    ];
    const market = optional(values, 'marketPrice');
    if (market !== null && !Number.isNaN(market)) {
      const iv = impliedVolatility(
        { spot: o.spot, strike: o.strike, rate: o.rate, time: o.time, dividend: o.dividend },
        kind,
        market,
      );
      steps.push(iv === null ? tx('invest.bs.noImplied') : tx('invest.bs.implied', { vol: pct(iv, 3) }));
    }
    return ok(tx('invest.bs.headline', { kind: tx(`invest.o.${kind}`), price: fmt(g.price, 4) }), steps);
  },
);

const binomial = form(
  'binomial',
  [
    choice(T, 'kind', ['call', 'put']),
    choice(T, 'style', ['european', 'american']),
    f('spot', { initial: '100' }),
    f('strike', { initial: '100' }),
    f('rate', { initial: '5' }),
    f('vol', { initial: '20' }),
    f('time', { initial: '1' }),
    f('dividend', { initial: '0' }),
    f('steps', { initial: '3' }),
  ],
  (values) => {
    const n = read(T, values, ['spot', 'strike', 'rate', 'vol', 'time', 'dividend', 'steps']);
    if (failed(n)) return n;
    const american = text(values, 'style') === 'american';
    const t = binomialTree(
      { spot: n[0], strike: n[1], rate: n[2] / 100, vol: n[3] / 100, time: n[4], dividend: n[5] / 100 },
      text(values, 'kind') as 'call' | 'put',
      n[6],
      american,
    );
    if (!t) return bad('invest.binomial.invalid');
    const steps = [tx('invest.binomial.params', { u: fmt(t.up, 5), d: fmt(t.down, 5), p: fmt(t.probability, 5) })];
    if (n[6] <= 5)
      t.tree.forEach((row, i) =>
        steps.push(tx('invest.binomial.row', { t: i, values: row.map((v) => fmt(v, 4)).join(', ') })),
      );
    return ok(tx('invest.binomial.headline', { price: fmt(t.price, 4) }), steps);
  },
);

function parseLegs(source: string): Leg[] | null {
  const legs: Leg[] = [];
  for (const part of source
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)) {
    const words = part.split(/\s+/);
    const kind = words[0].toLowerCase();
    if (kind === 'stock' && words.length === 3)
      legs.push({ kind: 'stock', strike: 0, quantity: Number(words[1]), premium: Number(words[2]) });
    else if ((kind === 'call' || kind === 'put') && words.length === 4)
      legs.push({ kind, strike: Number(words[1]), quantity: Number(words[2]), premium: Number(words[3]) });
    else return null;
  }
  return legs.length > 0 &&
    legs.every((l) => [l.strike, l.quantity, l.premium].every(Number.isFinite) && l.quantity !== 0)
    ? legs
    : null;
}

const strategyForm = form(
  'strategy',
  [
    f('legs', { kind: 'text', initial: 'call 100 1 5, put 100 1 5' }),
    f('low', { initial: '60' }),
    f('high', { initial: '140' }),
  ],
  (values) => {
    const legs = parseLegs(values.text.legs ?? '');
    const n = read(T, values, ['low', 'high']);
    if (!legs || failed(n)) return failed(n) ? n : bad('invest.strategy.parse');
    if (!(n[1] > n[0]) || n[0] < 0) return bad('invest.strategy.range');
    const s = strategy(legs, n[0], n[1]);
    const grid = Array.from({ length: 81 }, (_, i) => n[0] + ((n[1] - n[0]) * i) / 80);
    const steps = [
      s.breakEvens.length > 0
        ? tx('invest.strategy.breakEvens', { list: s.breakEvens.map((x) => fmt(x, 4)).join(', ') })
        : tx('invest.strategy.noBreakEven'),
      tx('invest.strategy.extremes', {
        gain: fmt(s.maxProfit, 4),
        loss: fmt(s.maxLoss, 4),
        low: fmt(n[0], 4),
        high: fmt(n[1], 4),
      }),
    ];
    const figure = (
      <Plot
        summary={tx('invest.strategy.plot', { gain: fmt(s.maxProfit, 3), loss: fmt(s.maxLoss, 3) })}
        xLabel={tx('invest.strategy.price')}
        yLabel={tx('invest.strategy.profit')}
        curves={[{ label: tx('invest.strategy.curve'), points: grid.map((x) => [x, s.profitAt(x)] as const) }]}
        marks={s.breakEvens.map((x) => ({ label: fmt(x, 3), x, y: 0 }))}
      />
    );
    return ok(tx('invest.strategy.headline', { gain: fmt(s.maxProfit, 4), loss: fmt(s.maxLoss, 4) }), steps, figure);
  },
);

const paths = form(
  'paths',
  [
    f('spot', { initial: '100' }),
    f('drift', { initial: '8' }),
    f('vol', { initial: '20' }),
    f('time', { initial: '1' }),
    f('steps', { initial: '52' }),
    f('count', { initial: '200' }),
    f('seed', { initial: '1' }),
  ],
  (values) => {
    const n = read(T, values, ['spot', 'drift', 'vol', 'time', 'steps', 'count', 'seed']);
    if (failed(n)) return n;
    if (
      !(n[0] > 0) ||
      !(n[2] >= 0) ||
      !(n[3] > 0) ||
      !Number.isInteger(n[4]) ||
      n[4] < 1 ||
      n[4] > 1000 ||
      !Number.isInteger(n[5]) ||
      n[5] < 1 ||
      n[5] > 5000
    )
      return bad('invest.paths.invalid');
    const all = gbmPaths(n[0], n[1] / 100, n[2] / 100, n[3], n[4], n[5], n[6]);
    const ends = all.map((p) => p[p.length - 1]).sort((a, b) => a - b);
    const q = (x: number) => ends[Math.min(ends.length - 1, Math.floor(x * ends.length))];
    const figure = (
      <Plot
        summary={tx('invest.paths.plot', { count: Math.min(5, all.length) })}
        xLabel={tx('invest.paths.time')}
        yLabel={tx('invest.paths.price')}
        curves={all
          .slice(0, 5)
          .map((p, i) => ({ label: `${i + 1}`, points: p.map((v, k) => [(k * n[3]) / n[4], v] as const) }))}
      />
    );
    return ok(
      tx('invest.paths.headline', { mean: fmt(mean(ends), 2) }),
      [
        tx('invest.paths.expected', { value: fmt(n[0] * Math.exp((n[1] / 100) * n[3]), 2) }),
        tx('invest.paths.range', { p5: fmt(q(0.05), 2), p50: fmt(q(0.5), 2), p95: fmt(q(0.95), 2) }),
        tx('invest.paths.seeded', { seed: n[6] }),
      ],
      figure,
    );
  },
);

const waccForm = form(
  'wacc',
  [
    f('equity', { initial: '600' }),
    f('debt', { initial: '400' }),
    f('costEquity', { initial: '12' }),
    f('costDebt', { initial: '6' }),
    f('tax', { initial: '25' }),
  ],
  (values) => {
    const n = read(T, values, ['equity', 'debt', 'costEquity', 'costDebt', 'tax']);
    if (failed(n)) return n;
    const w = wacc(n[0], n[1], n[2] / 100, n[3] / 100, n[4] / 100);
    if (w === null || n[0] < 0 || n[1] < 0 || n[4] < 0 || n[4] > 100) return bad('invest.wacc.invalid');
    const v = n[0] + n[1];
    return ok(tx('invest.wacc.headline', { w: pct(w, 4) }), [
      tx('invest.wacc.step', {
        e: pct(n[0] / v, 2),
        re: fmt(n[2], 4),
        d: pct(n[1] / v, 2),
        rd: fmt(n[3], 4),
        t: fmt(n[4], 4),
        w: pct(w, 4),
      }),
    ]);
  },
);

const dcfForm = form(
  'dcf',
  [
    list('flows', '100, 110, 120'),
    f('dcfRate', { initial: '10' }),
    choice(T, 'terminal', ['growth', 'multiple']),
    f('growth', { initial: '3' }),
    f('multiple', { initial: '8' }),
    f('metric', { initial: '150' }),
    f('netDebt', { initial: '0' }),
    f('shares', { initial: '' }),
  ],
  (values) => {
    const flows = listOf(values, 'flows');
    const n = read(T, values, ['dcfRate', 'growth', 'multiple', 'metric', 'netDebt']);
    if (!flows || failed(n)) return failed(n) ? n : bad('invest.dcf.flows');
    const growth = text(values, 'terminal') === 'growth';
    const term = growth
      ? ({ kind: 'growth', growth: n[1] / 100 } as const)
      : ({ kind: 'multiple', multiple: n[2], metric: n[3] } as const);
    const r = dcf(flows, n[0] / 100, term);
    if (!r) return bad('invest.dcf.invalid');
    const equity = r.value - n[4];
    const steps = [
      tx('invest.dcf.flows', { pv: fmt(r.pvFlows, 2) }),
      tx('invest.dcf.terminal', { tv: fmt(r.terminal, 2), pv: fmt(r.pvTerminal, 2) }),
      tx('invest.dcf.equity', { ev: fmt(r.value, 2), debt: fmt(n[4], 2), equity: fmt(equity, 2) }),
    ];
    const shares = optional(values, 'shares');
    if (shares !== null && shares > 0) steps.push(tx('invest.dcf.perShare', { value: fmt(equity / shares, 4) }));
    if (growth) {
      for (const dr of [-1, 0, 1]) {
        const cells = [-0.5, 0, 0.5].map((dg) =>
          dcf(flows, (n[0] + dr) / 100, { kind: 'growth', growth: (n[1] + dg) / 100 }),
        );
        steps.push(
          tx('invest.dcf.sensitivity', {
            rate: fmt(n[0] + dr, 3),
            values: cells.map((c) => (c ? fmt(c.value, 1) : '-')).join(' | '),
          }),
        );
      }
    }
    return ok(tx('invest.dcf.headline', { ev: fmt(r.value, 2) }), steps);
  },
);

const gordonForm = form(
  'gordon',
  [f('payment', { initial: '2' }), f('required', { initial: '9' }), f('growth', { initial: '4' })],
  (values) => {
    const n = read(T, values, ['payment', 'required', 'growth']);
    if (failed(n)) return n;
    const v = gordon(n[0], n[1] / 100, n[2] / 100);
    if (v === null) return bad('invest.gordon.invalid');
    return ok(tx('invest.gordon.headline', { v: fmt(v, 4) }), [
      tx('invest.gordon.step', { d: fmt(n[0], 4), r: fmt(n[1], 4), g: fmt(n[2], 4), v: fmt(v, 4) }),
    ]);
  },
);

const round = form(
  'round',
  [f('investment', { initial: '1000000' }), f('preMoney', { initial: '4000000' }), list('later', '2000000/8000000')],
  (values) => {
    const n = read(T, values, ['investment', 'preMoney']);
    if (failed(n)) return n;
    if (!(n[0] > 0) || !(n[1] > 0)) return bad('invest.round.invalid');
    const first = { investment: n[0], preMoney: n[1] };
    const later = (values.text.later ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => s.split('/').map(Number));
    if (later.some((r) => r.length !== 2 || r.some((x) => !(x > 0)))) return bad('invest.round.later');
    const rounds = [first, ...later.map(([investment, preMoney]) => ({ investment, preMoney }))];
    const p = postMoney(first);
    const held = dilution(rounds);
    return ok(tx('invest.round.headline', { post: fmt(p.post, 2), own: pct(p.ownership, 3) }), [
      tx('invest.round.step', { pre: fmt(n[1], 2), inv: fmt(n[0], 2), post: fmt(p.post, 2), own: pct(p.ownership, 3) }),
      ...held.map((h, i) => tx('invest.round.held', { n: i + 1, share: pct(h, 3) })),
    ]);
  },
);

const pool = form(
  'pool',
  [
    f('existing', { initial: '8000000' }),
    f('investment', { initial: '2000000' }),
    f('post', { initial: '10000000' }),
    f('poolPct', { initial: '10' }),
  ],
  (values) => {
    const n = read(T, values, ['existing', 'investment', 'post', 'poolPct']);
    if (failed(n)) return n;
    const r = poolShuffle(n[0], n[1], n[2], n[3] / 100);
    if (!r) return bad('invest.pool.invalid');
    return ok(tx('invest.pool.headline', { price: fmt(r.price, 4) }), [
      tx('invest.pool.shares', {
        total: fmt(r.shares, 0),
        investor: fmt(r.investorShares, 0),
        pool: fmt(r.poolShares, 0),
      }),
      tx('invest.pool.effective', { pre: fmt(r.preMoneyEffective, 0), stated: fmt(n[2] - n[1], 0) }),
    ]);
  },
);

const safe = form(
  'safe',
  [
    f('amount', { initial: '1000000' }),
    f('preShares', { initial: '10000000' }),
    f('roundPrice', { initial: '1' }),
    f('cap', { initial: '5000000' }),
    f('discount', { initial: '20' }),
  ],
  (values) => {
    const n = read(T, values, ['amount', 'preShares', 'roundPrice', 'discount']);
    if (failed(n)) return n;
    const cap = optional(values, 'cap');
    const r = safeConversion(n[0], n[1], n[2], cap !== null && !Number.isNaN(cap) ? cap : null, n[3] / 100);
    if (!r) return bad('invest.safe.invalid');
    return ok(tx('invest.safe.headline', { price: fmt(r.price, 4), shares: fmt(r.shares, 0) }), [
      tx('invest.safe.cap', { price: Number.isFinite(r.capPrice) ? fmt(r.capPrice, 4) : tx('invest.safe.none') }),
      tx('invest.safe.discount', { price: fmt(r.discountPrice, 4) }),
      tx(`invest.safe.basis.${r.basis}`),
    ]);
  },
);

const venture = form(
  'venture',
  [
    f('exit', { initial: '50000000' }),
    f('horizon', { initial: '5' }),
    f('target', { initial: '40' }),
    f('investment', { initial: '2000000' }),
  ],
  (values) => {
    const n = read(T, values, ['exit', 'horizon', 'target', 'investment']);
    if (failed(n)) return n;
    const r = ventureMethod(n[0], n[1], n[2] / 100, n[3]);
    if (!r) return bad('invest.venture.invalid');
    return ok(tx('invest.venture.headline', { own: pct(r.ownership, 3) }), [
      tx('invest.venture.post', {
        exit: fmt(n[0], 0),
        target: fmt(n[2], 3),
        years: fmt(n[1], 3),
        post: fmt(r.post, 0),
      }),
      tx('invest.venture.pre', { pre: fmt(r.pre, 0) }),
    ]);
  },
);

export const INVEST: EconToolDef = {
  id: 'invest',
  forms: [
    bondForm,
    accrued,
    curve,
    returns,
    capmForm,
    portfolio,
    bsForm,
    binomial,
    strategyForm,
    paths,
    waccForm,
    dcfForm,
    gordonForm,
    round,
    pool,
    safe,
    venture,
  ],
};
