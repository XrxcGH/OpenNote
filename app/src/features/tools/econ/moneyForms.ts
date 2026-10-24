// The time-value, loan, project, depreciation, property, and cost-effectiveness forms. The methods are in money.ts;
// this file reads the fields and words the result with its steps.
import {
  annuityFv,
  annuityPv,
  depreciation,
  effectiveRate,
  fv,
  icer,
  irrs,
  loanPayment,
  macrs,
  mirr,
  netMonetaryBenefit,
  npv,
  payback,
  periodsFor,
  perpetuity,
  profitabilityIndex,
  property,
  rateFor,
  schedule,
  sinkingDeposit,
} from './money';
import type { Convention, Method } from './money';
import { bad, choice, failed, field, ok, optional, read, text, tx } from './forms';
import type { EconForm, EconToolDef } from './forms';
import { fmt, parseList, pct } from './num';

const T = 'money';
const f = (id: string, rest = {}) => field(T, id, rest);
const m = (x: number) => fmt(x, 2);

const single: EconForm = {
  id: 'single',
  name: 'money-single',
  intro: true,
  fields: [f('rate', { initial: '5' }), f('n', { initial: '10' }), f('pv', { initial: '1000' }), f('fv')],
  solve(values) {
    const empty = ['rate', 'n', 'pv', 'fv'].filter((id) => optional(values, id) === null);
    if (empty.length > 1) return bad('money.single.fillThree');
    if (empty.length === 0) return bad('money.single.leaveOne');
    const r = optional(values, 'rate');
    const n = optional(values, 'n');
    const p = optional(values, 'pv');
    const fut = optional(values, 'fv');
    const given = [r, n, p, fut].filter((x) => x !== null);
    if (given.some((x) => Number.isNaN(x))) return bad('common.notNumber', { name: tx('money.single.anyField') });
    const rate = r === null ? 0 : r / 100;
    if (rate <= -1) return bad('money.single.rateLow');
    if (empty[0] === 'fv') {
      const out = fv(p!, rate, n!);
      return ok(tx('money.single.fvIs', { value: m(out) }), [
        tx('money.single.fvStep', { pv: m(p!), r: fmt(r!, 4), n: fmt(n!), fv: m(out) }),
      ]);
    }
    if (empty[0] === 'pv') {
      const out = fut! / (1 + rate) ** n!;
      return ok(tx('money.single.pvIs', { value: m(out) }), [
        tx('money.single.pvStep', { fv: m(fut!), r: fmt(r!, 4), n: fmt(n!), pv: m(out) }),
      ]);
    }
    if (empty[0] === 'rate') {
      const out = rateFor(p!, fut!, n!);
      if (out === null) return bad('money.single.positive');
      return ok(tx('money.single.rateIs', { value: pct(out) }), [
        tx('money.single.rateStep', { fv: m(fut!), pv: m(p!), n: fmt(n!), r: pct(out) }),
      ]);
    }
    const out = periodsFor(p!, fut!, rate);
    if (out === null) return bad('money.single.periodsNone');
    return ok(tx('money.single.nIs', { value: fmt(out, 3) }), [
      tx('money.single.nStep', { fv: m(fut!), pv: m(p!), r: fmt(r!, 4), n: fmt(out, 3) }),
    ]);
  },
};

const annuity: EconForm = {
  id: 'annuity',
  name: 'money-annuity',
  intro: true,
  fields: [
    f('payment', { initial: '1000' }),
    f('rate', { initial: '5' }),
    f('n', { initial: '10' }),
    choice(T, 'timing', ['ordinary', 'due']),
    f('growth', { initial: '0' }),
  ],
  solve(values) {
    const nums = read(T, values, ['payment', 'rate', 'n', 'growth']);
    if (failed(nums)) return nums;
    const [payment, r, n, g] = nums;
    const rate = r / 100;
    const growth = g / 100;
    const due = text(values, 'timing') === 'due';
    if (rate <= -1) return bad('money.single.rateLow');
    if (n < 0 || !Number.isInteger(n)) return bad('money.annuity.whole');
    const pvValue = annuityPv(payment, rate, n, due, growth);
    const fvValue = annuityFv(payment, rate, n, due, growth);
    const steps = [
      tx(due ? 'money.annuity.pvDue' : 'money.annuity.pvOrdinary', { a: m(payment), r: fmt(r, 4), n, pv: m(pvValue) }),
      tx('money.annuity.fv', { fv: m(fvValue) }),
    ];
    const forever = perpetuity(payment, rate, growth);
    if (forever !== null) steps.push(tx('money.annuity.perpetuity', { value: m(forever) }));
    return ok(tx('money.annuity.headline', { pv: m(pvValue), fv: m(fvValue) }), steps);
  },
};

const COMPOUNDING = ['1', '2', '4', '12', '52', '365', 'continuous'];
const rates: EconForm = {
  id: 'rates',
  name: 'money-rates',
  intro: true,
  fields: [f('nominal', { initial: '12' }), choice(T, 'compounding', COMPOUNDING, '12')],
  solve(values) {
    const nums = read(T, values, ['nominal']);
    if (failed(nums)) return nums;
    const nominal = nums[0] / 100;
    const kind = text(values, 'compounding');
    const times = kind === 'continuous' ? Infinity : Number(kind);
    const ear = effectiveRate(nominal, times);
    const steps =
      kind === 'continuous'
        ? [tx('money.rates.continuous', { r: fmt(nums[0], 4), ear: pct(ear) })]
        : [
            tx('money.rates.periodic', { m: times, per: pct(nominal / times, 5) }),
            tx('money.rates.ear', { r: fmt(nums[0], 4), m: times, ear: pct(ear) }),
          ];
    return ok(tx('money.rates.headline', { ear: pct(ear) }), steps);
  },
};

const loan: EconForm = {
  id: 'loan',
  name: 'money-loan',
  intro: true,
  fields: [
    f('amount', { initial: '300000' }),
    f('apr', { initial: '6' }),
    f('years', { initial: '30' }),
    f('perYear', { initial: '12' }),
    f('extra', { initial: '0' }),
    f('after'),
  ],
  solve(values) {
    const nums = read(T, values, ['amount', 'apr', 'years', 'perYear', 'extra']);
    if (failed(nums)) return nums;
    const [amount, apr, years, perYear, extra] = nums;
    const count = Math.round(years * perYear);
    if (!(amount > 0) || !(perYear >= 1) || count < 1) return bad('money.loan.invalid');
    const rate = apr / 100 / perYear;
    const pay = loanPayment(amount, rate, count);
    const plan = schedule(amount, rate, count, Math.max(0, extra));
    const steps = [
      tx('money.loan.formula', { rate: pct(rate, 5), n: count, pay: m(pay) }),
      tx('money.loan.interest', { interest: m(plan.interest), total: m(plan.interest + amount) }),
    ];
    if (extra > 0)
      steps.push(tx('money.loan.extra', { n: plan.rows.length, saved: m(pay * count - amount - plan.interest) }));
    const after = optional(values, 'after');
    if (after !== null) {
      if (Number.isNaN(after) || after < 0) return bad('common.notNumber', { name: tx('money.f.after') });
      const row = plan.rows[Math.min(Math.floor(after), plan.rows.length) - 1];
      steps.push(
        tx('money.loan.balance', { k: Math.floor(after), balance: m(after < 1 ? amount : (row?.balance ?? 0)) }),
      );
    }
    const first = plan.rows[0];
    steps.push(tx('money.loan.first', { interest: m(first.interest), principal: m(first.principal) }));
    return ok(tx('money.loan.headline', { pay: m(pay) }), steps);
  },
};

function cashFlowText(values: { text: Record<string, string> }): number[] | null {
  return parseList(values.text.flows ?? '');
}

const flows: EconForm = {
  id: 'flows',
  name: 'money-flows',
  intro: true,
  fields: [
    f('flows', { kind: 'text', initial: '-1000, 300, 400, 500' }),
    f('rate', { initial: '10' }),
    f('reinvest', { initial: '10' }),
  ],
  solve(values) {
    const list = cashFlowText(values);
    if (!list || list.length < 2) return bad('money.flows.list');
    const nums = read(T, values, ['rate', 'reinvest']);
    if (failed(nums)) return nums;
    const [r, reinvest] = nums.map((x) => x / 100);
    if (r <= -1) return bad('money.single.rateLow');
    const value = npv(r, list);
    const found = irrs(list);
    const steps = [tx('money.flows.npv', { r: fmt(nums[0], 4), npv: m(value) })];
    if (found.length === 0) steps.push(tx('money.flows.noIrr'));
    else if (found.length === 1) steps.push(tx('money.flows.irr', { irr: pct(found[0], 3) }));
    else steps.push(tx('money.flows.irrMany', { count: found.length, list: found.map((x) => pct(x, 3)).join(', ') }));
    const mod = mirr(list, r, reinvest);
    if (mod !== null) steps.push(tx('money.flows.mirr', { mirr: pct(mod, 3) }));
    const back = payback(list);
    steps.push(back === null ? tx('money.flows.noPayback') : tx('money.flows.payback', { n: fmt(back, 2) }));
    const dback = payback(list, r);
    steps.push(dback === null ? tx('money.flows.noDiscounted') : tx('money.flows.discounted', { n: fmt(dback, 2) }));
    const index = profitabilityIndex(r, list);
    if (index !== null) steps.push(tx('money.flows.index', { pi: fmt(index, 3) }));
    steps.push(tx(value >= 0 ? 'money.flows.accept' : 'money.flows.reject'));
    return ok(tx('money.flows.headline', { npv: m(value) }), steps);
  },
};

const DEPR = ['straight', 'declining', 'double', 'syd', 'macrs'];
const CONVENTIONS = ['half', 'q1', 'q2', 'q3', 'q4'];
const depr: EconForm = {
  id: 'depr',
  name: 'money-depr',
  intro: true,
  fields: [
    choice(T, 'method', DEPR),
    f('cost', { initial: '10000' }),
    f('salvage', { initial: '1000' }),
    f('life', { initial: '5' }),
    choice(T, 'convention', CONVENTIONS),
  ],
  solve(values) {
    const nums = read(T, values, ['cost', 'salvage', 'life']);
    if (failed(nums)) return nums;
    const [cost, salvage, life] = nums;
    const method = text(values, 'method');
    if (!(cost > 0) || salvage < 0 || salvage > cost) return bad('money.depr.salvage');
    if (!Number.isInteger(life) || life < 1 || life > 60) return bad('money.depr.life');
    if (method === 'macrs') {
      if (![3, 5, 7, 10, 15, 20].includes(life)) return bad('money.depr.macrsClass');
      const shares = macrs(life, text(values, 'convention') as Convention);
      const steps = shares.map((share, i) =>
        tx('money.depr.row', { year: i + 1, amount: m(share * cost), share: fmt(share * 100, 2) }),
      );
      return ok(tx('money.depr.macrsHeadline', { first: m(shares[0] * cost), cls: life }), steps);
    }
    const all = depreciation(method as Method, cost, salvage, life);
    let book = cost;
    const steps = all.map((d, i) => {
      book -= d;
      return tx('money.depr.book', { year: i + 1, amount: m(d), book: m(book) });
    });
    return ok(tx('money.depr.headline', { first: m(all[0]), total: m(all.reduce((a, b) => a + b, 0)) }), steps);
  },
};

const realEstate: EconForm = {
  id: 'property',
  name: 'money-property',
  intro: true,
  fields: [
    f('noi', { initial: '120000' }),
    f('price', { initial: '1500000' }),
    f('debtService', { initial: '100000' }),
    f('equity', { initial: '300000' }),
    f('grossRent', { initial: '' }),
  ],
  solve(values) {
    const nums = read(T, values, ['noi', 'price', 'debtService', 'equity']);
    if (failed(nums)) return nums;
    const [noi, price, debt, equity] = nums;
    if (!(price > 0)) return bad('money.property.price');
    const p = property(noi, price, debt, equity);
    const steps = [tx('money.property.cap', { noi: m(noi), price: m(price), cap: pct(p.capRate, 3) })];
    if (p.dscr !== null) steps.push(tx('money.property.dscr', { dscr: fmt(p.dscr, 3) }));
    if (p.cashOnCash !== null) steps.push(tx('money.property.coc', { coc: pct(p.cashOnCash, 3) }));
    const rent = optional(values, 'grossRent');
    if (rent !== null && rent > 0) steps.push(tx('money.property.grm', { grm: fmt(price / rent, 2) }));
    return ok(tx('money.property.headline', { cap: pct(p.capRate, 3) }), steps);
  },
};

const cea: EconForm = {
  id: 'cea',
  name: 'money-cea',
  intro: true,
  fields: [
    f('costNew', { initial: '50000' }),
    f('costOld', { initial: '20000' }),
    f('effectNew', { initial: '5' }),
    f('effectOld', { initial: '3.5' }),
    f('willingness', { initial: '' }),
  ],
  solve(values) {
    const nums = read(T, values, ['costNew', 'costOld', 'effectNew', 'effectOld']);
    if (failed(nums)) return nums;
    const [cn, co, en, eo] = nums;
    const ratio = icer(cn, co, en, eo);
    if (ratio === null) return bad('money.cea.noEffect');
    const steps = [tx('money.cea.step', { dc: m(cn - co), de: fmt(en - eo, 3), icer: m(ratio) })];
    const will = optional(values, 'willingness');
    if (will !== null && !Number.isNaN(will)) {
      const nmb = netMonetaryBenefit(cn, co, en, eo, will);
      steps.push(tx('money.cea.nmb', { w: m(will), nmb: m(nmb) }));
      steps.push(tx(nmb >= 0 ? 'money.cea.worth' : 'money.cea.notWorth'));
    }
    return ok(tx('money.cea.headline', { icer: m(ratio) }), steps);
  },
};

const sinking: EconForm = {
  id: 'sinking',
  name: 'money-sinking',
  intro: true,
  fields: [f('target', { initial: '100000' }), f('rate', { initial: '5' }), f('n', { initial: '20' })],
  solve(values) {
    const nums = read(T, values, ['target', 'rate', 'n']);
    if (failed(nums)) return nums;
    const [target, r, n] = nums;
    if (!(n >= 1) || r / 100 <= -1) return bad('money.sinking.invalid');
    const deposit = sinkingDeposit(target, r / 100, n);
    return ok(tx('money.sinking.headline', { deposit: m(deposit) }), [
      tx('money.sinking.step', { target: m(target), r: fmt(r, 4), n: fmt(n), deposit: m(deposit) }),
    ]);
  },
};

export const MONEY: EconToolDef = {
  id: 'money',
  forms: [single, annuity, rates, loan, sinking, flows, depr, realEstate, cea],
};
