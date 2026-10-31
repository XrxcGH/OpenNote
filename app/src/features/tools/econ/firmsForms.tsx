// The market-power forms: monopoly, price discrimination, Cournot, Bertrand, Stackelberg, collusion, and
// concentration. The methods are in firms.ts; this file reads the fields and words the result with its steps.
import { Plot } from './Plot';
import { bad, choice, failed, field, ok, optional, read, text, tx } from './forms';
import type { EconForm, EconToolDef } from './forms';
import {
  bertrandDifferentiated,
  bertrandHomogeneous,
  bestResponse,
  collusion,
  concentration,
  cournot,
  mergerChange,
  monopoly,
  perfectDiscrimination,
  stackelberg,
  thirdDegree,
} from './firms';
import { fmt, parseList } from './num';

const T = 'firms';
const f = (id: string, rest = {}) => field(T, id, rest);
const m = (x: number) => fmt(x, 3);

const monopolyForm: EconForm = {
  id: 'monopoly',
  name: 'firms-monopoly',
  intro: true,
  fields: [
    f('a', { initial: '100' }),
    f('b', { initial: '1' }),
    f('c', { initial: '10' }),
    f('fixed', { initial: '0' }),
  ],
  solve(values) {
    const nums = read(T, values, ['a', 'b', 'c', 'fixed']);
    if (failed(nums)) return nums;
    const [a, b, c, fixed] = nums;
    const r = monopoly(a, b, c, fixed);
    if (!r) return bad('firms.noMarket');
    const qc = (a - c) / b;
    const steps = [
      tx('firms.monopoly.mr', { a: m(a), twoB: m(2 * b), c: m(c), q: m(r.quantity) }),
      tx('firms.monopoly.price', { a: m(a), b: m(b), q: m(r.quantity), p: m(r.price) }),
      tx('firms.monopoly.profit', { p: m(r.price), c: m(c), q: m(r.quantity), fixed: m(fixed), profit: m(r.profit) }),
      tx('firms.monopoly.dwl', { qc: m(qc), q: m(r.quantity), dwl: m(r.deadweightLoss) }),
      tx('firms.monopoly.lerner', { lerner: fmt(r.lerner, 5), e: fmt(r.elasticity, 4), inv: fmt(1 / r.elasticity, 5) }),
    ];
    const figure = (
      <Plot
        summary={tx('firms.monopoly.plot', { q: m(r.quantity), p: m(r.price) })}
        xLabel={tx('firms.quantity')}
        yLabel={tx('firms.priceAxis')}
        curves={[
          {
            label: tx('firms.demand'),
            points: [
              [0, a],
              [a / b, 0],
            ],
          },
          {
            label: tx('firms.mr'),
            points: [
              [0, a],
              [a / (2 * b), 0],
            ],
            dashed: true,
          },
          {
            label: tx('firms.mc'),
            points: [
              [0, c],
              [a / b, c],
            ],
          },
        ]}
        areas={[
          {
            label: tx('firms.monopoly.dwlArea', { dwl: m(r.deadweightLoss) }),
            points: [
              [r.quantity, r.price],
              [r.quantity, c],
              [qc, c],
            ],
          },
        ]}
        marks={[{ label: tx('firms.monopoly.point'), x: r.quantity, y: r.price }]}
      />
    );
    return ok(tx('firms.monopoly.headline', { q: m(r.quantity), p: m(r.price), profit: m(r.profit) }), steps, figure);
  },
};

const discrimination: EconForm = {
  id: 'discrimination',
  name: 'firms-discrimination',
  intro: true,
  fields: [
    choice(T, 'kind', ['third', 'first']),
    f('a', { initial: '100' }),
    f('b', { initial: '1' }),
    f('a2', { initial: '60' }),
    f('b2', { initial: '1' }),
    f('c', { initial: '10' }),
  ],
  solve(values) {
    const first = text(values, 'kind') === 'first';
    const nums = read(T, values, first ? ['a', 'b', 'c'] : ['a', 'b', 'a2', 'b2', 'c']);
    if (failed(nums)) return nums;
    if (first) {
      const [a, b, c] = nums;
      const r = perfectDiscrimination(a, b, c);
      const single = monopoly(a, b, c);
      if (!r || !single) return bad('firms.noMarket');
      return ok(tx('firms.disc.firstHeadline', { q: m(r.quantity), profit: m(r.profit) }), [
        tx('firms.disc.firstStep', { a: m(a), c: m(c), b: m(b), q: m(r.quantity), profit: m(r.profit) }),
        tx('firms.disc.twoPart', { fee: m(r.profit), price: m(c) }),
        tx('firms.disc.versusUniform', { uniform: m(single.profit), gain: m(r.profit - single.profit) }),
      ]);
    }
    const [a, b, a2, b2, c] = nums;
    const r = thirdDegree(
      [
        { a, b },
        { a: a2, b: b2 },
      ],
      c,
    );
    if (!r) return bad('firms.noMarket');
    const steps = r.prices.map((p, i) =>
      tx('firms.disc.market', { n: i + 1, p: m(p), q: m(r.quantities[i]), profit: m((p - c) * r.quantities[i]) }),
    );
    steps.push(tx('firms.disc.uniform', { p: m(r.uniformPrice), profit: m(r.uniformProfit) }));
    steps.push(tx('firms.disc.gain', { gain: m(r.profit - r.uniformProfit) }));
    return ok(tx('firms.disc.thirdHeadline', { profit: m(r.profit) }), steps);
  },
};

const cournotForm: EconForm = {
  id: 'cournot',
  name: 'firms-cournot',
  intro: true,
  fields: [f('a', { initial: '100' }), f('b', { initial: '1' }), f('costs', { kind: 'text', initial: '10, 10' })],
  solve(values) {
    const nums = read(T, values, ['a', 'b']);
    if (failed(nums)) return nums;
    const costs = parseList(values.text.costs ?? '');
    if (!costs || costs.length < 1 || costs.length > 20) return bad('firms.costsList');
    const [a, b] = nums;
    const r = cournot(a, b, costs);
    if (!r) return bad('firms.noMarket');
    const steps = [tx('firms.cournot.foc', { n: costs.length })];
    r.quantities.forEach((q, i) =>
      steps.push(tx('firms.cournot.firm', { n: i + 1, q: m(q), profit: m(r.profits[i]) })),
    );
    steps.push(tx('firms.cournot.price', { total: m(r.total), p: m(r.price) }));
    let figure;
    if (costs.length === 2) {
      const [c1, c2] = costs;
      const top = Math.max((a - c1) / b, (a - c2) / b);
      figure = (
        <Plot
          summary={tx('firms.cournot.plot', { q1: m(r.quantities[0]), q2: m(r.quantities[1]) })}
          xLabel={tx('firms.cournot.q1')}
          yLabel={tx('firms.cournot.q2')}
          curves={[
            { label: tx('firms.cournot.r1'), points: [0, top].map((q2) => [bestResponse(a, b, c1, q2), q2] as const) },
            {
              label: tx('firms.cournot.r2'),
              points: [0, top].map((q1) => [q1, bestResponse(a, b, c2, q1)] as const),
              dashed: true,
            },
          ]}
          marks={[{ label: tx('firms.cournot.nash'), x: r.quantities[0], y: r.quantities[1] }]}
        />
      );
    }
    return ok(tx('firms.cournot.headline', { n: costs.length, total: m(r.total), p: m(r.price) }), steps, figure);
  },
};

const bertrandSame: EconForm = {
  id: 'bertrand',
  name: 'firms-bertrand',
  intro: true,
  fields: [f('a', { initial: '100' }), f('b', { initial: '1' }), f('costs', { kind: 'text', initial: '10, 10' })],
  solve(values) {
    const nums = read(T, values, ['a', 'b']);
    if (failed(nums)) return nums;
    const costs = parseList(values.text.costs ?? '');
    if (!costs || costs.length < 2) return bad('firms.costsTwo');
    const r = bertrandHomogeneous(nums[0], nums[1], costs);
    if (!r) return bad('firms.noMarket');
    const steps = [tx('firms.bertrand.rule')];
    r.prices.forEach((p, i) =>
      steps.push(tx('firms.bertrand.firm', { n: i + 1, c: m(costs[i]), p: m(p), profit: m(r.profits[i]) })),
    );
    return ok(tx('firms.bertrand.headline', { p: m(Math.min(...r.prices)) }), steps);
  },
};

const bertrandDiff: EconForm = {
  id: 'differentiated',
  name: 'firms-differentiated',
  intro: true,
  fields: [
    f('alpha1', { initial: '100' }),
    f('alpha2', { initial: '100' }),
    f('beta', { initial: '2' }),
    f('gamma', { initial: '1' }),
    f('c1', { initial: '10' }),
    f('c2', { initial: '10' }),
  ],
  solve(values) {
    const nums = read(T, values, ['alpha1', 'alpha2', 'beta', 'gamma', 'c1', 'c2']);
    if (failed(nums)) return nums;
    const [a1, a2, beta, gamma, c1, c2] = nums;
    const r = bertrandDifferentiated([a1, a2], beta, gamma, [c1, c2]);
    if (!r) return bad('firms.diff.invalid');
    return ok(tx('firms.diff.headline', { p1: m(r.prices[0]), p2: m(r.prices[1]) }), [
      tx('firms.diff.response', { beta: m(beta), gamma: m(gamma) }),
      ...[0, 1].map((i) =>
        tx('firms.diff.firm', { n: i + 1, p: m(r.prices[i]), q: m(r.quantities[i]), profit: m(r.profits[i]) }),
      ),
    ]);
  },
};

const stackelbergForm: EconForm = {
  id: 'stackelberg',
  name: 'firms-stackelberg',
  intro: true,
  fields: [
    f('a', { initial: '100' }),
    f('b', { initial: '1' }),
    f('c1', { initial: '10' }),
    f('c2', { initial: '10' }),
  ],
  solve(values) {
    const nums = read(T, values, ['a', 'b', 'c1', 'c2']);
    if (failed(nums)) return nums;
    const [a, b, c1, c2] = nums;
    const r = stackelberg(a, b, c1, c2);
    if (!r) return bad('firms.noMarket');
    const cn = cournot(a, b, [c1, c2]);
    const steps = [
      tx('firms.stack.follower', { a: m(a), c2: m(c2), b: m(b) }),
      tx('firms.stack.leader', { q1: m(r.leader), profit: m(r.leaderProfit) }),
      tx('firms.stack.followerQ', { q2: m(r.follower), profit: m(r.followerProfit), p: m(r.price) }),
    ];
    if (cn) steps.push(tx('firms.stack.versus', { profit: m(cn.profits[0]), q: m(cn.quantities[0]) }));
    return ok(tx('firms.stack.headline', { q1: m(r.leader), q2: m(r.follower), p: m(r.price) }), steps);
  },
};

const collusionForm: EconForm = {
  id: 'collusion',
  name: 'firms-collusion',
  intro: true,
  fields: [f('a', { initial: '100' }), f('b', { initial: '1' }), f('c', { initial: '10' }), f('n', { initial: '2' })],
  solve(values) {
    const nums = read(T, values, ['a', 'b', 'c', 'n']);
    if (failed(nums)) return nums;
    const [a, b, c, n] = nums;
    const r = collusion(a, b, c, n);
    if (!r) return bad('firms.collusion.invalid');
    return ok(tx('firms.collusion.headline', { delta: fmt(r.criticalDiscount, 5) }), [
      tx('firms.collusion.cartel', { profit: m(r.collusiveProfit) }),
      tx('firms.collusion.deviate', { profit: m(r.deviationProfit) }),
      tx('firms.collusion.nash', { profit: m(r.nashProfit) }),
      tx('firms.collusion.formula', { delta: fmt(r.criticalDiscount, 5) }),
    ]);
  },
};

const concentrationForm: EconForm = {
  id: 'concentration',
  name: 'firms-concentration',
  intro: true,
  fields: [
    f('shares', { kind: 'text', initial: '40, 30, 20, 10' }),
    f('mergeA', { initial: '3' }),
    f('mergeB', { initial: '4' }),
  ],
  solve(values) {
    const shares = parseList(values.text.shares ?? '');
    if (!shares) return bad('firms.sharesList');
    const r = concentration(shares);
    if (!r) return bad('firms.sharesList');
    const steps = [
      tx('firms.conc.hhi', { hhi: fmt(r.hhi, 2) }),
      tx('firms.conc.cr4', { cr4: fmt(r.cr4, 2) }),
      tx(r.hhi > 1800 ? 'firms.conc.high' : r.hhi >= 1000 ? 'firms.conc.moderate' : 'firms.conc.low'),
    ];
    const a = optional(values, 'mergeA');
    const b = optional(values, 'mergeB');
    if (a !== null && b !== null) {
      const delta = mergerChange(shares, a - 1, b - 1);
      if (delta === null) return bad('firms.conc.badMerge');
      steps.push(tx('firms.conc.merger', { a, b, delta: fmt(delta, 2), after: fmt(r.hhi + delta, 2) }));
    }
    return ok(tx('firms.conc.headline', { hhi: fmt(r.hhi, 2) }), steps);
  },
};

export const FIRMS: EconToolDef = {
  id: 'firms',
  forms: [
    monopolyForm,
    discrimination,
    cournotForm,
    bertrandSame,
    bertrandDiff,
    stackelbergForm,
    collusionForm,
    concentrationForm,
  ],
};
