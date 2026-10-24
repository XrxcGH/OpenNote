// The choice forms: utility maximization, price-change decomposition, cost minimization, short-run costs, and
// two-period consumption. The methods are in choice.ts; this file reads the fields, words the result with its
// steps, and draws the indifference curves and budget lines.
import {
  costMinimization,
  firmSupply,
  indifferenceY,
  marshallian,
  shortRunCosts,
  slutsky,
  twoPeriod,
  utility,
} from './choice';
import type { Bundle, Production, ProductionKind, Utility, UtilityKind } from './choice';
import { Plot } from './Plot';
import type { Curve, Mark } from './Plot';
import { bad, choice, failed, field, ok, read, text, tx } from './forms';
import type { EconForm, EconToolDef, FieldSpec, Values } from './forms';
import { fmt } from './num';

const T = 'choice';
const f = (id: string, rest = {}) => field(T, id, rest);
const m = (x: number) => fmt(x, 4);
const KINDS = ['cd', 'subs', 'compl', 'quasi', 'ces'];

function utilityFields(values: Values): FieldSpec[] {
  const kind = text(values, 'kind');
  const out = [choice(T, 'kind', KINDS), f('a', { initial: '0.3' }), f('b', { initial: '0.7' })];
  if (!kind || kind === 'ces') out.push(f('rho', { initial: '0.5' }));
  return out;
}

function readUtility(values: Values): Utility | ReturnType<typeof bad> {
  const kind = (text(values, 'kind') || 'cd') as UtilityKind;
  const ids = kind === 'ces' ? ['a', 'b', 'rho'] : ['a', 'b'];
  const n = read(T, values, ids);
  if (failed(n)) return n;
  const u: Utility = { kind, a: n[0], b: n[1], rho: n[2] };
  if (!(u.a > 0 && u.b > 0)) return bad('choice.weights');
  if (kind === 'ces' && !(u.rho! < 1 && u.rho !== 0)) return bad('choice.rho');
  return u;
}
const isUtility = (x: Utility | ReturnType<typeof bad>): x is Utility => 'kind' in x;

function stepsFor(u: Utility, px: number, py: number, income: number, b: Bundle): string[] {
  const p = { a: m(u.a), b: m(u.b), px: m(px), py: m(py), i: m(income), x: m(b.x), y: m(b.y) };
  const out = [tx(`choice.demand.${u.kind}`, p)];
  if (b.x === 0 || b.y === 0) out.push(tx('choice.demand.corner'));
  out.push(tx('choice.demand.budget', { spent: m(px * b.x + py * b.y) }));
  out.push(tx('choice.demand.utility', { u: m(utility(u, Math.max(b.x, 1e-300), Math.max(b.y, 1e-300))) }));
  return out;
}

function curveOf(u: Utility, level: number, xMax: number, label: string): Curve {
  const points: [number, number][] = [];
  for (let i = 1; i <= 60; i += 1) {
    const y = indifferenceY(u, level, (xMax * i) / 60);
    if (y !== null) points.push([(xMax * i) / 60, y]);
  }
  return {
    label,
    points:
      points.length > 1
        ? points
        : [
            [0, 0],
            [xMax, 0],
          ],
  };
}

const priceFields = [f('px', { initial: '2' }), f('py', { initial: '5' }), f('income', { initial: '100' })];

const demand: EconForm = {
  id: 'demand',
  name: 'choice-demand',
  intro: true,
  fields: (values) => [...utilityFields(values), ...priceFields],
  solve(values) {
    const u = readUtility(values);
    if (!isUtility(u)) return u;
    const n = read(T, values, ['px', 'py', 'income']);
    if (failed(n)) return n;
    const b = marshallian(u, n[0], n[1], n[2]);
    if (!b) return bad('choice.prices');
    const level = utility(u, Math.max(b.x, 1e-300), Math.max(b.y, 1e-300));
    const xMax = n[2] / n[0];
    const figure = (
      <Plot
        summary={tx('choice.demand.plot', { x: m(b.x), y: m(b.y) })}
        xLabel={tx('choice.goodX')}
        yLabel={tx('choice.goodY')}
        curves={[
          {
            label: tx('choice.budget'),
            points: [
              [0, n[2] / n[1]],
              [xMax, 0],
            ],
          },
          curveOf(u, level, xMax * 1.2, tx('choice.indifference')),
        ]}
        marks={[{ label: tx('choice.optimum'), x: b.x, y: b.y }]}
      />
    );
    return ok(tx('choice.demand.headline', { x: m(b.x), y: m(b.y) }), stepsFor(u, n[0], n[1], n[2], b), figure);
  },
};

const slutskyForm: EconForm = {
  id: 'slutsky',
  name: 'choice-slutsky',
  intro: true,
  fields: (values) => [
    ...utilityFields(values),
    ...priceFields,
    f('px1', { initial: '4' }),
    f('py1', { initial: '5' }),
  ],
  solve(values) {
    const u = readUtility(values);
    if (!isUtility(u)) return u;
    const n = read(T, values, ['px', 'py', 'income', 'px1', 'py1']);
    if (failed(n)) return n;
    const s = slutsky(u, n[0], n[1], n[3], n[4], n[2]);
    if (!s) return bad('choice.prices');
    const bundle = (b: Bundle) => `(${m(b.x)}, ${m(b.y)})`;
    const steps = [
      tx('choice.slutsky.bundles', { a: bundle(s.before), b: bundle(s.compensated), c: bundle(s.after) }),
      tx('choice.slutsky.x', { sub: m(s.substitutionX), inc: m(s.incomeX), total: m(s.totalX) }),
      tx('choice.slutsky.y', { sub: m(s.substitutionY), inc: m(s.incomeY) }),
      tx('choice.slutsky.cv', { cv: m(s.compensatingVariation) }),
      tx('choice.slutsky.ev', { ev: m(s.equivalentVariation) }),
    ];
    const compensatedIncome = n[3] * s.compensated.x + n[4] * s.compensated.y;
    const xMax = Math.max(n[2] / n[0], n[2] / n[3]) * 1.1;
    const marks: Mark[] = [
      { label: 'A', x: s.before.x, y: s.before.y },
      { label: 'B', x: s.compensated.x, y: s.compensated.y },
      { label: 'C', x: s.after.x, y: s.after.y },
    ];
    const figure = (
      <Plot
        summary={tx('choice.slutsky.plot')}
        xLabel={tx('choice.goodX')}
        yLabel={tx('choice.goodY')}
        curves={[
          {
            label: tx('choice.slutsky.old'),
            points: [
              [0, n[2] / n[1]],
              [n[2] / n[0], 0],
            ],
          },
          {
            label: tx('choice.slutsky.new'),
            points: [
              [0, n[2] / n[4]],
              [n[2] / n[3], 0],
            ],
            dashed: true,
          },
          {
            label: tx('choice.slutsky.comp'),
            points: [
              [0, compensatedIncome / n[4]],
              [compensatedIncome / n[3], 0],
            ],
            dashed: true,
          },
          curveOf(u, s.utilityBefore, xMax, tx('choice.indifference')),
        ]}
        marks={marks}
      />
    );
    return ok(
      tx('choice.slutsky.headline', { total: m(s.totalX), sub: m(s.substitutionX), inc: m(s.incomeX) }),
      steps,
      figure,
    );
  },
};

const PRODUCTION: ProductionKind[] = ['cd', 'leontief', 'linear'];

const cost: EconForm = {
  id: 'cost',
  name: 'choice-cost',
  intro: true,
  fields: (values) => {
    const kind = text(values, 'kind') || 'cd';
    return [
      { ...choice(T, 'kind', PRODUCTION, 'cd'), label: tx('choice.f.production') },
      { id: 'a', label: tx(`choice.p.${kind}.a`), initial: '1' },
      { id: 'b', label: tx(`choice.p.${kind}.b`), initial: '0.5' },
      ...(kind === 'cd' ? [{ id: 'c', label: tx('choice.p.cd.c'), initial: '0.5' }] : []),
      f('w', { initial: '4' }),
      f('r', { initial: '1' }),
      f('q', { initial: '10' }),
    ];
  },
  solve(values) {
    const kind = (text(values, 'kind') || 'cd') as ProductionKind;
    const n = read(T, values, kind === 'cd' ? ['a', 'b', 'c', 'w', 'r', 'q'] : ['a', 'b', 'w', 'r', 'q']);
    if (failed(n)) return n;
    const p: Production = kind === 'cd' ? { kind, a: n[0], b: n[1], c: n[2] } : { kind, a: n[0], b: n[1] };
    const [w, r, q] = kind === 'cd' ? n.slice(3) : n.slice(2);
    const result = costMinimization(p, w, r, q);
    if (!result) return bad('choice.cost.invalid');
    const steps = [tx(`choice.cost.${kind}`, { w: m(w), r: m(r), l: m(result.labour), k: m(result.capital) })];
    if (result.mrts !== null) steps.push(tx('choice.cost.mrts', { v: m(result.mrts) }));
    if (result.returns) steps.push(tx(`choice.cost.${result.returns}`));
    steps.push(
      tx('choice.cost.total', { w: m(w), l: m(result.labour), r: m(r), k: m(result.capital), c: m(result.cost) }),
    );
    return ok(tx('choice.cost.headline', { l: m(result.labour), k: m(result.capital), c: m(result.cost) }), steps);
  },
};

const shortRun: EconForm = {
  id: 'shortRun',
  name: 'choice-shortRun',
  intro: true,
  fields: [
    f('A', { initial: '1' }),
    f('alpha', { initial: '0.5' }),
    f('beta', { initial: '0.5' }),
    f('k', { initial: '4' }),
    f('w', { initial: '1' }),
    f('r', { initial: '1' }),
    f('q', { initial: '8' }),
    f('price'),
  ],
  solve(values) {
    const n = read(T, values, ['A', 'alpha', 'beta', 'k', 'w', 'r', 'q']);
    if (failed(n)) return n;
    const s = shortRunCosts(n[0], n[1], n[2], n[3], n[4], n[5], n[6]);
    if (!s) return bad('choice.short.invalid');
    const steps = [
      tx('choice.short.labour', { l: m(s.labour) }),
      tx('choice.short.costs', { vc: m(s.variableCost), fc: m(n[5] * n[3]), tc: m(s.totalCost) }),
      tx('choice.short.averages', { mc: m(s.marginalCost), avc: m(s.averageVariable), atc: m(s.averageTotal) }),
    ];
    const price = Number(values.text.price ?? '');
    if ((values.text.price ?? '').trim() !== '' && Number.isFinite(price)) {
      const q = firmSupply(n[0], n[1], n[2], n[3], n[4], price);
      const at = q === null ? null : shortRunCosts(n[0], n[1], n[2], n[3], n[4], n[5], q);
      steps.push(
        at && q !== null
          ? tx('choice.short.supply', { p: m(price), q: m(q), profit: m(price * q - at.totalCost) })
          : tx('choice.short.noSupply'),
      );
    }
    const top = n[6] * 1.5;
    const grid = Array.from({ length: 40 }, (_, i) => (top * (i + 1)) / 40);
    const curve = (
      label: string,
      pick: (s: NonNullable<ReturnType<typeof shortRunCosts>>) => number,
      dashed = false,
    ): Curve => ({
      label,
      points: grid.map((g) => [g, pick(shortRunCosts(n[0], n[1], n[2], n[3], n[4], n[5], g)!)] as const),
      dashed,
    });
    const figure = (
      <Plot
        summary={tx('choice.short.plot')}
        xLabel={tx('choice.short.output')}
        yLabel={tx('choice.short.perUnit')}
        curves={[
          curve('MC', (c) => c.marginalCost),
          curve('AVC', (c) => c.averageVariable, true),
          curve('ATC', (c) => c.averageTotal),
        ]}
      />
    );
    return ok(tx('choice.short.headline', { tc: m(s.totalCost), mc: m(s.marginalCost) }), steps, figure);
  },
};

const twoPeriodForm: EconForm = {
  id: 'twoPeriod',
  name: 'choice-twoPeriod',
  intro: true,
  fields: [
    f('y1', { initial: '100' }),
    f('y2', { initial: '110' }),
    f('rate', { initial: '10' }),
    f('patience', { initial: '0.9' }),
    f('theta', { initial: '1' }),
  ],
  solve(values) {
    const n = read(T, values, ['y1', 'y2', 'rate', 'patience', 'theta']);
    if (failed(n)) return n;
    const r = twoPeriod(n[0], n[1], n[2] / 100, n[3], n[4]);
    if (!r) return bad('choice.two.invalid');
    return ok(tx('choice.two.headline', { c1: fmt(r.first, 2), c2: fmt(r.second, 2) }), [
      tx('choice.two.wealth', { y1: m(n[0]), y2: m(n[1]), r: m(n[2]), w: m(r.wealth) }),
      tx('choice.two.euler', { g: m((n[3] * (1 + n[2] / 100)) ** (1 / n[4])) }),
      tx(r.saving >= 0 ? 'choice.two.saves' : 'choice.two.borrows', { s: m(Math.abs(r.saving)) }),
    ]);
  },
};

export const CHOICE: EconToolDef = {
  id: 'choice',
  forms: [demand, slutskyForm, cost, shortRun, twoPeriodForm],
};
