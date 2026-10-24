import { describe, expect, it } from 'vitest';
import {
  accountType,
  activityCosting,
  attributeSample,
  benfordShare,
  benfordTest,
  bondSchedule,
  chiSquareP,
  cvp,
  firstDigit,
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
import { ACCOUNTING } from './accountingForms';
import type { EconForm, Values } from './forms';

const JOURNAL =
  'Cash 10000 ; Capital 10000\nEquipment 4000 ; Cash 4000\nCash 3000 ; Service revenue 3000\nRent expense 1000 ; Cash 1000';

describe('ledger', () => {
  it('guesses account types and reads an explicit type', () => {
    expect(accountType('Cash')).toBe('asset');
    expect(accountType('Accounts payable')).toBe('liability');
    expect(accountType('Service revenue')).toBe('revenue');
    expect(accountType('Rent expense')).toBe('expense');
    expect(accountType('Owner capital')).toBe('equity');
    expect(accountType('Gizmo')).toBeNull();
    expect(accountType('Gizmo (asset)')).toBe('asset');
  });
  it('builds the trial balance and statements', () => {
    const parsed = parseJournal(JOURNAL);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const s = statements(parsed.value);
    expect(s.trialDebit).toBe(13000);
    expect(s.trialCredit).toBe(13000);
    expect(s.accounts.find((a) => a.name === 'Cash')!.debit).toBe(8000);
    expect(s.netIncome).toBe(2000);
    expect(s.assets).toBe(12000);
    expect(s.equity).toBe(12000);
    expect(s.balanced).toBe(true);
  });
  it('rejects an unbalanced or malformed entry and an unknown account', () => {
    expect(parseJournal('Cash 100 ; Capital 90')).toEqual({ ok: false, line: 1, reason: 'unbalanced' });
    expect(parseJournal('Cash 100')).toEqual({ ok: false, line: 1, reason: 'format' });
    expect(parseJournal('Cash 100 ; Gizmo 100')).toEqual({ ok: false, line: 1, reason: 'type', name: 'Gizmo' });
    expect(parseJournal('')).toMatchObject({ ok: false });
  });
  it('accepts compound entries', () => {
    const parsed = parseJournal('Cash 5000, Accounts receivable 3000 ; Service revenue 8000');
    expect(parsed.ok && statements(parsed.value).revenues).toBe(8000);
  });
});

describe('inventory', () => {
  const layers = [
    { units: 10, cost: 5 },
    { units: 10, cost: 6 },
  ];
  it('costs 15 units sold three ways', () => {
    expect(periodicInventory(layers, 15, 'fifo')!.cogs).toBe(80);
    expect(periodicInventory(layers, 15, 'lifo')!.cogs).toBe(85);
    expect(periodicInventory(layers, 15, 'average')!.cogs).toBe(82.5);
    expect(periodicInventory(layers, 15, 'fifo')!.ending).toBe(30);
  });
  it('rejects selling more than was bought', () => {
    expect(periodicInventory(layers, 25, 'fifo')).toBeNull();
  });
  it('differs in the perpetual system', () => {
    const events = [
      { kind: 'buy', units: 10, cost: 5 },
      { kind: 'sell', units: 8 },
      { kind: 'buy', units: 10, cost: 6 },
      { kind: 'sell', units: 7 },
    ] as const;
    expect(perpetualInventory(events, 'fifo')!.cogs).toBe(8 * 5 + 2 * 5 + 5 * 6);
    expect(perpetualInventory(events, 'lifo')!.cogs).toBe(8 * 5 + 7 * 6);
    // moving average: after 8 sold, 2 left at 5; then 12 units at (10 + 60) / 12
    expect(perpetualInventory(events, 'average')!.cogs).toBeCloseTo(40 + 7 * (70 / 12), 9);
    expect(perpetualInventory([{ kind: 'sell', units: 1 }], 'fifo')).toBeNull();
  });
});

describe('ratios', () => {
  const f = {
    cash: 10,
    receivables: 20,
    inventory: 30,
    currentAssets: 60,
    currentLiabilities: 30,
    totalAssets: 200,
    totalLiabilities: 80,
    equity: 120,
    revenue: 400,
    cogs: 240,
    netIncome: 40,
    interest: 10,
    tax: 10,
  };
  it('computes the standard ratios', () => {
    const r = ratios(f);
    expect(r.current).toBe(2);
    expect(r.quick).toBe(1);
    expect(r.debtToEquity).toBeCloseTo(2 / 3, 12);
    expect(r.grossMargin).toBeCloseTo(0.4, 12);
    expect(r.netMargin).toBeCloseTo(0.1, 12);
    expect(r.roe).toBeCloseTo(1 / 3, 12);
    expect(r.dupont).toBeCloseTo(r.roe!, 12);
    expect(r.interestCover).toBe(6);
    expect(r.inventoryTurnover).toBe(8);
    expect(r.receivablesDays).toBeCloseTo(18.25, 9);
  });
  it('leaves a ratio empty when its denominator is zero', () => {
    expect(ratios({ ...f, currentLiabilities: 0 }).current).toBeNull();
  });
});

describe('managerial accounting', () => {
  it('finds break-even, margin of safety and operating leverage', () => {
    const r = cvp(50, 30, 40000, 10000, 2500)!;
    expect(r.breakEvenUnits).toBe(2000);
    expect(r.breakEvenSales).toBe(100000);
    expect(r.marginRatio).toBeCloseTo(0.4, 12);
    expect(r.marginOfSafety).toBeCloseTo(0.2, 12);
    expect(r.operatingLeverage).toBeCloseTo(5, 12);
    expect(r.targetUnits).toBe(2500);
    expect(cvp(30, 30, 100)).toBeNull();
  });
  it('finds a break-even mix', () => {
    const r = mixBreakEven(
      [
        { price: 10, variable: 6, share: 3 },
        { price: 20, variable: 10, share: 1 },
      ],
      6500,
    )!;
    // unit margin = (4 * 3 + 10 * 1) / 4 = 5.5
    expect(r.unitMargin).toBeCloseTo(5.5, 12);
    expect(r.units).toBeCloseTo(6500 / 5.5, 9);
    expect(r.byProduct[0] / r.byProduct[1]).toBeCloseTo(3, 12);
    expect(mixBreakEven([], 1)).toBeNull();
  });
  it('splits materials variance', () => {
    const v = inputVariances(1000, 2.1, 950, 2);
    expect(v.price).toBeCloseTo(100, 9);
    expect(v.quantity).toBeCloseTo(100, 9);
    expect(v.total).toBeCloseTo(200, 9);
    expect(inputVariances(900, 1.9, 950, 2).price).toBeLessThan(0);
  });
  it('does weighted-average process costing', () => {
    const p = processCosting(800, 200, 1, 0.5, 9000, 8800)!;
    expect(p.materialUnits).toBe(1000);
    expect(p.conversionUnits).toBe(900);
    expect(p.materialPerUnit).toBe(9);
    expect(p.conversionPerUnit).toBeCloseTo(8800 / 900, 12);
    expect(p.completedCost + p.endingCost).toBeCloseTo(17800, 9);
    expect(processCosting(0, 0, 1, 1, 1, 1)).toBeNull();
  });
  it('assigns activity-based overhead', () => {
    const r = activityCosting([
      { name: 'Setups', cost: 10000, driverTotal: 100, used: 5 },
      { name: 'Inspections', cost: 6000, driverTotal: 300, used: 20 },
    ])!;
    expect(r.rates).toEqual([100, 20]);
    expect(r.total).toBe(900);
    expect(activityCosting([{ name: 'x', cost: 1, driverTotal: 0, used: 0 }])).toBeNull();
  });
  it('amortizes a discount bond', () => {
    const b = bondSchedule(1000, 0.04, 0.05, 5)!;
    expect(b.issue).toBeCloseTo(956.7052, 3);
    expect(b.rows[0].expense).toBeCloseTo(47.8353, 3);
    expect(b.rows[4].carrying).toBeCloseTo(1000, 6);
    expect(bondSchedule(1000, 0.05, 0.05, 3)!.issue).toBeCloseTo(1000, 9);
  });
});

describe('audit analytics and unit economics', () => {
  it('knows the Benford shares', () => {
    expect(benfordShare(1)).toBeCloseTo(0.30103, 5);
    expect(benfordShare(9)).toBeCloseTo(0.045757, 6);
    expect(firstDigit(0.00456)).toBe(4);
    expect(firstDigit(-987)).toBe(9);
    expect(firstDigit(0)).toBeNull();
  });
  it('tests data that follows Benford against data that does not', () => {
    const powers = Array.from({ length: 200 }, (_, i) => 2 ** i);
    const good = benfordTest(powers)!;
    expect(good.pValue).toBeGreaterThan(0.1);
    expect(good.mad).toBeLessThan(0.015);
    const bad = benfordTest(Array.from({ length: 90 }, (_, i) => 10 + i))!;
    expect(bad.pValue).toBeLessThan(0.001);
    expect(benfordTest([0])).toBeNull();
  });
  it('computes chi-square tail probabilities', () => {
    expect(chiSquareP(15.507, 8)).toBeCloseTo(0.05, 3);
    expect(chiSquareP(3.841, 1)).toBeCloseTo(0.05, 3);
    expect(chiSquareP(0, 4)).toBe(1);
  });
  it('sizes an attribute sample', () => {
    expect(attributeSample(0.95, 0.05)).toBe(60);
    expect(attributeSample(0.95, 0.05, 1)).toBe(95);
    expect(attributeSample(1, 0.05)).toBeNull();
  });
  it('computes lifetime value', () => {
    const u = unitEconomics(100, 0.8, 0.1, 150)!;
    expect(u.lifetimeValue).toBeCloseTo(266.67, 2);
    expect(u.lifetimeValueToCost).toBeCloseTo(266.67 / 150, 2);
    expect(u.paybackPeriods).toBe(1.5);
    expect(u.lifetimePeriods).toBeCloseTo(5, 12);
    expect(unitEconomics(100, 1, 0.1, 150)).toBeNull();
  });
});

function run(id: string, text: Record<string, string> = {}) {
  const form = ACCOUNTING.forms.find((f) => f.id === id) as EconForm;
  const initial: Values = { text: {}, unit: {} };
  const fields = typeof form.fields === 'function' ? form.fields(initial) : form.fields;
  const base = Object.fromEntries(
    fields.map((f) => [f.id, f.initial ?? (f.kind === 'select' ? f.options?.[0]?.value : '') ?? '']),
  );
  return form.solve({ text: { ...base, ...text }, unit: {} });
}
const headline = (o: ReturnType<typeof run>) => (o.ok ? o.headline : o.message);

describe('accounting forms', () => {
  it('words the answers', () => {
    expect(headline(run('ledger'))).toMatch(/13,000 = 13,000/);
    expect(headline(run('inventory'))).toMatch(/80/);
    expect(headline(run('cvp'))).toMatch(/2,000 units/);
    expect(headline(run('variance'))).toMatch(/100 unfavorable/);
    expect(headline(run('audit'))).toMatch(/60/);
    expect(headline(run('unit'))).toMatch(/266\.67/);
  });
  it('explains impossible input', () => {
    expect(headline(run('ledger', { journal: 'Cash 100 ; Capital 90' }))).toMatch(/line 1/i);
    expect(headline(run('ledger', { journal: 'Cash 100 ; Gizmo 100' }))).toMatch(/Gizmo/);
    expect(headline(run('cvp', { variable: '60' }))).toMatch(/above the variable cost/i);
  });
});
