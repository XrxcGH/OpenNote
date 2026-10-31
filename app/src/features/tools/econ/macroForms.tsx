// The macroeconomics forms. Each reads its fields and words the result; the methods are in macro.ts.
import { Plot } from './Plot';
import { bad, failed, field, ok, optional, read, tx } from './forms';
import type { EconForm, EconToolDef } from './forms';
import {
  difference,
  forwardRate,
  isLm,
  keynesianCross,
  moneyMultiplier,
  nominalRate,
  phillips,
  pppRate,
  quantityTheory,
  solowPath,
  solowResidual,
  solowSteadyState,
  taylorRate,
} from './macro';
import { fmt, pct } from './num';

const T = 'macro';
const f = (id: string, rest = {}) => field(T, id, rest);
const m = (x: number) => fmt(x, 4);
const form = (id: string, fields: EconForm['fields'], solve: EconForm['solve']): EconForm => ({
  id,
  name: `macro-${id}`,
  intro: true,
  fields,
  solve,
});

const cross = form(
  'cross',
  [
    f('c0', { initial: '100' }),
    f('c1', { initial: '0.8' }),
    f('t0', { initial: '0' }),
    f('t1', { initial: '0' }),
    f('invest', { initial: '200' }),
    f('gov', { initial: '100' }),
  ],
  (values) => {
    const n = read(T, values, ['c0', 'c1', 't0', 't1', 'invest', 'gov']);
    if (failed(n)) return n;
    const r = keynesianCross(n[0], n[1], n[2], n[3], n[4], n[5]);
    if (!r) return bad('macro.cross.invalid');
    const figure = (
      <Plot
        summary={tx('macro.cross.plot', { y: m(r.income) })}
        xLabel={tx('macro.income')}
        yLabel={tx('macro.spending')}
        curves={[
          {
            label: tx('macro.cross.planned'),
            points: [0, 1.6 * r.income].map((y) => [y, n[0] + n[1] * (y - n[2] - n[3] * y) + n[4] + n[5]] as const),
          },
          {
            label: tx('macro.cross.line'),
            points: [
              [0, 0],
              [1.6 * r.income, 1.6 * r.income],
            ],
            dashed: true,
          },
        ]}
        marks={[{ label: tx('macro.cross.point'), x: r.income, y: r.income }]}
      />
    );
    return ok(
      tx('macro.cross.headline', { y: m(r.income) }),
      [
        tx('macro.cross.solve', { y: m(r.income), c: m(r.consumption), t: m(r.taxes) }),
        tx('macro.cross.multiplier', { k: m(r.spendingMultiplier) }),
        tx('macro.cross.taxMultiplier', { k: m(r.taxMultiplier) }),
        tx('macro.cross.balanced', { k: m(r.balancedBudgetMultiplier) }),
      ],
      figure,
    );
  },
);

const islm = form(
  'islm',
  [
    f('c0', { initial: '100' }),
    f('c1', { initial: '0.8' }),
    f('tax', { initial: '100' }),
    f('i0', { initial: '300' }),
    f('i1', { initial: '20' }),
    f('gov', { initial: '200' }),
    f('money', { initial: '1000' }),
    f('k', { initial: '0.5' }),
    f('h', { initial: '50' }),
    f('dGov', { initial: '0' }),
    f('dMoney', { initial: '0' }),
  ],
  (values) => {
    const n = read(T, values, ['c0', 'c1', 'tax', 'i0', 'i1', 'gov', 'money', 'k', 'h', 'dGov', 'dMoney']);
    if (failed(n)) return n;
    const [c0, c1, tax, i0, i1, gov, money, k, h, dGov, dMoney] = n;
    const base = { c0, c1, tax, i0, i1, gov, money, k, h };
    const r = isLm(base);
    if (!r) return bad('macro.islm.invalid');
    const steps = [
      tx('macro.islm.is', { a: m((c0 - c1 * tax + i0 + gov) / (1 - c1)), b: m(i1 / (1 - c1)) }),
      tx('macro.islm.lm', { a: m(money / k), b: m(h / k) }),
      tx('macro.islm.solve', { y: m(r.income), r: m(r.rate) }),
    ];
    let after = r;
    if (dGov !== 0 || dMoney !== 0) {
      const next = isLm({ ...base, gov: gov + dGov, money: money + dMoney });
      if (!next) return bad('macro.islm.invalid');
      after = next;
      steps.push(
        tx('macro.islm.shift', {
          y: m(next.income),
          r: m(next.rate),
          dy: m(next.income - r.income),
          dr: m(next.rate - r.rate),
        }),
      );
    }
    const isAt = (g: number, y: number) => (c0 - c1 * tax + i0 + g - (1 - c1) * y) / i1;
    const lmAt = (mm: number, y: number) => (k * y - mm) / h;
    const hi = Math.max(r.income, after.income) * 1.4;
    const lo = 0;
    const curves = [
      { label: tx('macro.islm.isLabel'), points: [lo, hi].map((y) => [y, isAt(gov, y)] as const) },
      { label: tx('macro.islm.lmLabel'), points: [lo, hi].map((y) => [y, lmAt(money, y)] as const), dashed: true },
    ];
    if (after !== r) {
      curves.push(
        { label: tx('macro.islm.isNew'), points: [lo, hi].map((y) => [y, isAt(gov + dGov, y)] as const) },
        {
          label: tx('macro.islm.lmNew'),
          points: [lo, hi].map((y) => [y, lmAt(money + dMoney, y)] as const),
          dashed: true,
        },
      );
    }
    const figure = (
      <Plot
        summary={tx('macro.islm.plot', { y: m(after.income), r: m(after.rate) })}
        xLabel={tx('macro.income')}
        yLabel={tx('macro.rate')}
        curves={curves.map((c) => ({ ...c, points: c.points.map((p) => [p[0] - lo, Math.max(0, p[1])] as const) }))}
        marks={[{ label: tx('macro.islm.point'), x: after.income - lo, y: Math.max(0, after.rate) }]}
      />
    );
    return ok(tx('macro.islm.headline', { y: m(after.income), r: m(after.rate) }), steps, figure);
  },
);

const solow = form(
  'solow',
  [
    f('s', { initial: '0.2' }),
    f('n', { initial: '0.01' }),
    f('delta', { initial: '0.05' }),
    f('alpha', { initial: '0.3333333333' }),
    f('g', { initial: '0' }),
    f('k0', { initial: '1' }),
    f('periods', { initial: '50' }),
  ],
  (values) => {
    const n = read(T, values, ['s', 'n', 'delta', 'alpha', 'g', 'k0', 'periods']);
    if (failed(n)) return n;
    const [s, pop, delta, alpha, g, k0, periods] = n;
    const r = solowSteadyState(s, pop, delta, alpha, g);
    if (!r) return bad('macro.solow.invalid');
    if (!(k0 > 0) || !Number.isInteger(periods) || periods < 1 || periods > 1000) return bad('macro.solow.path');
    const path = solowPath(s, pop, delta, alpha, k0, periods, g);
    const steps = [
      tx('macro.solow.capital', { s: m(s), loss: m(pop + g + delta), alpha: m(alpha), k: m(r.capital) }),
      tx('macro.solow.output', { y: m(r.output), c: m(r.consumption), i: m(r.investment) }),
      tx('macro.solow.golden', { s: m(r.goldenSaving), k: m(r.goldenCapital) }),
      tx(s > r.goldenSaving ? 'macro.solow.dynamicallyInefficient' : 'macro.solow.efficient'),
    ];
    const marks = [0, 1, 5, 10, 25, 50, 100, 250, 500, 1000].filter((t) => t <= periods);
    for (const t of marks) steps.push(tx('macro.solow.row', { t, k: m(path[t]), y: m(path[t] ** alpha) }));
    const kTop = Math.max(r.capital, k0) * 1.4;
    const grid = Array.from({ length: 21 }, (_, i) => (kTop * i) / 20);
    const figure = (
      <Plot
        summary={tx('macro.solow.plot', { k: m(r.capital) })}
        xLabel={tx('macro.solow.k')}
        yLabel={tx('macro.solow.flows')}
        curves={[
          { label: tx('macro.solow.saving'), points: grid.map((k) => [k, s * k ** alpha] as const) },
          {
            label: tx('macro.solow.breakEven'),
            points: grid.map((k) => [k, (pop + g + delta) * k] as const),
            dashed: true,
          },
        ]}
        marks={[{ label: tx('macro.solow.steady'), x: r.capital, y: s * r.capital ** alpha }]}
      />
    );
    return ok(tx('macro.solow.headline', { k: m(r.capital), y: m(r.output) }), steps, figure);
  },
);

const accounting = form(
  'accounting',
  [f('gY', { initial: '3' }), f('gK', { initial: '2' }), f('gL', { initial: '1' }), f('alpha', { initial: '0.3' })],
  (values) => {
    const n = read(T, values, ['gY', 'gK', 'gL', 'alpha']);
    if (failed(n)) return n;
    if (!(n[3] > 0 && n[3] < 1)) return bad('macro.accounting.share');
    const residual = solowResidual(n[0], n[1], n[2], n[3]);
    return ok(tx('macro.accounting.headline', { a: m(residual) }), [
      tx('macro.accounting.step', { gy: m(n[0]), a: m(n[3]), gk: m(n[1]), gl: m(n[2]), r: m(residual) }),
      tx('macro.accounting.parts', { capital: m(n[3] * n[1]), labor: m((1 - n[3]) * n[2]), tfp: m(residual) }),
    ]);
  },
);

const taylor = form(
  'taylor',
  [
    f('neutral', { initial: '2' }),
    f('inflation', { initial: '3' }),
    f('target', { initial: '2' }),
    f('gap', { initial: '1' }),
    f('a', { initial: '0.5' }),
    f('b', { initial: '0.5' }),
  ],
  (values) => {
    const n = read(T, values, ['neutral', 'inflation', 'target', 'gap', 'a', 'b']);
    if (failed(n)) return n;
    const i = taylorRate(n[0], n[1], n[2], n[3], n[4], n[5]);
    return ok(tx('macro.taylor.headline', { i: m(i) }), [
      tx('macro.taylor.step', {
        r: m(n[0]),
        pi: m(n[1]),
        a: m(n[4]),
        target: m(n[2]),
        b: m(n[5]),
        gap: m(n[3]),
        i: m(i),
      }),
      tx(i - n[1] > n[0] ? 'macro.taylor.tight' : 'macro.taylor.easy', { real: m(i - n[1]) }),
    ]);
  },
);

const phillipsForm = form(
  'phillips',
  [
    f('expected', { initial: '2' }),
    f('slope', { initial: '0.5' }),
    f('u', { initial: '6' }),
    f('natural', { initial: '5' }),
    f('shock', { initial: '0' }),
  ],
  (values) => {
    const n = read(T, values, ['expected', 'slope', 'u', 'natural', 'shock']);
    if (failed(n)) return n;
    const pi = phillips(n[0], n[1], n[2], n[3], n[4]);
    return ok(tx('macro.phillips.headline', { pi: m(pi) }), [
      tx('macro.phillips.step', { e: m(n[0]), b: m(n[1]), u: m(n[2]), un: m(n[3]), s: m(n[4]), pi: m(pi) }),
    ]);
  },
);

const quantity = form(
  'quantity',
  [f('m'), f('v', { initial: '5' }), f('p', { initial: '2' }), f('y', { initial: '100' })],
  (values) => {
    const get = (id: string) => optional(values, id);
    const parts = ['m', 'v', 'p', 'y'].map(get);
    if (parts.some((x) => x !== null && Number.isNaN(x)))
      return bad('common.notNumber', { name: tx('macro.f.quantityAny') });
    if (parts.filter((x) => x === null).length !== 1) return bad('macro.quantity.one');
    const r = quantityTheory(parts[0], parts[1], parts[2], parts[3]);
    if (!r || !Number.isFinite(r.m + r.v + r.p + r.y)) return bad('macro.quantity.zero');
    return ok(tx('macro.quantity.headline', { m: m(r.m), v: m(r.v), p: m(r.p), y: m(r.y) }), [
      tx('macro.quantity.step', { m: m(r.m), v: m(r.v), p: m(r.p), y: m(r.y) }),
    ]);
  },
);

const multiplier = form(
  'multiplier',
  [f('currency', { initial: '0.2' }), f('reserve', { initial: '0.1' })],
  (values) => {
    const n = read(T, values, ['currency', 'reserve']);
    if (failed(n)) return n;
    const k = n[0] >= 0 && n[1] > 0 ? moneyMultiplier(n[0], n[1]) : null;
    if (k === null) return bad('macro.multiplier.invalid');
    return ok(tx('macro.multiplier.headline', { k: m(k) }), [
      tx('macro.multiplier.step', { c: m(n[0]), r: m(n[1]), k: m(k) }),
    ]);
  },
);

const fisher = form('fisher', [f('real', { initial: '2' }), f('inflation', { initial: '3' })], (values) => {
  const n = read(T, values, ['real', 'inflation']);
  if (failed(n)) return n;
  const exact = nominalRate(n[0] / 100, n[1] / 100);
  return ok(tx('macro.fisher.headline', { i: pct(exact, 4) }), [
    tx('macro.fisher.approx', { i: m(n[0] + n[1]) }),
    tx('macro.fisher.exact', { r: m(n[0]), pi: m(n[1]), i: pct(exact, 4) }),
  ]);
});

const forward = form(
  'forward',
  [f('spot', { initial: '1.1' }), f('domestic', { initial: '5' }), f('foreign', { initial: '2' })],
  (values) => {
    const n = read(T, values, ['spot', 'domestic', 'foreign']);
    if (failed(n)) return n;
    if (!(n[0] > 0) || n[1] <= -100 || n[2] <= -100) return bad('macro.forward.invalid');
    const fw = forwardRate(n[0], n[1] / 100, n[2] / 100);
    return ok(tx('macro.forward.headline', { f: fmt(fw, 5) }), [
      tx('macro.forward.step', { s: m(n[0]), id: m(n[1]), if: m(n[2]), f: fmt(fw, 5) }),
      tx('macro.forward.premium', { value: pct(fw / n[0] - 1, 3) }),
      tx('macro.forward.uncovered'),
    ]);
  },
);

const ppp = form(
  'ppp',
  [f('spot', { initial: '100' }), f('domestic', { initial: '3' }), f('foreign', { initial: '1' })],
  (values) => {
    const n = read(T, values, ['spot', 'domestic', 'foreign']);
    if (failed(n)) return n;
    if (!(n[0] > 0) || n[1] <= -100 || n[2] <= -100) return bad('macro.forward.invalid');
    const next = pppRate(n[0], n[1] / 100, n[2] / 100);
    return ok(tx('macro.ppp.headline', { s: fmt(next, 4) }), [
      tx('macro.ppp.step', { s: m(n[0]), pi: m(n[1]), pf: m(n[2]), next: fmt(next, 4) }),
      tx('macro.ppp.change', { value: pct(next / n[0] - 1, 3) }),
    ]);
  },
);

const differenceForm = form(
  'difference',
  [f('a', { initial: '0.5' }), f('b', { initial: '10' }), f('x0', { initial: '0' }), f('periods', { initial: '10' })],
  (values) => {
    const n = read(T, values, ['a', 'b', 'x0', 'periods']);
    if (failed(n)) return n;
    if (!Number.isInteger(n[3]) || n[3] < 1 || n[3] > 200) return bad('macro.difference.periods');
    const d = difference(n[0], n[1], n[2], n[3]);
    const steps = [
      d.fixedPoint === null ? tx('macro.difference.none') : tx('macro.difference.fixed', { x: m(d.fixedPoint) }),
      tx(
        d.stable
          ? 'macro.difference.stable'
          : n[0] === 1 || n[0] === -1
            ? 'macro.difference.neutral'
            : 'macro.difference.unstable',
        { a: m(n[0]) },
      ),
      ...(n[0] < 0 && n[0] > -1 ? [tx('macro.difference.oscillates')] : []),
    ];
    d.path.slice(0, 11).forEach((x, t) => steps.push(tx('macro.difference.row', { t, x: m(x) })));
    return ok(tx('macro.difference.headline', { x: m(d.path[d.path.length - 1]), t: n[3] }), steps);
  },
);

export const MACRO: EconToolDef = {
  id: 'macro',
  forms: [
    cross,
    islm,
    solow,
    accounting,
    taylor,
    phillipsForm,
    quantity,
    multiplier,
    fisher,
    forward,
    ppp,
    differenceForm,
  ],
};
