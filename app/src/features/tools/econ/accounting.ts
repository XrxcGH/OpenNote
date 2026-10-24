// Accounting and managerial analysis as pure functions over journal entries and lists of numbers.

export type AccountType = 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';

const TYPE_WORDS: [AccountType, RegExp][] = [
  ['revenue', /revenue|sales|income|fees earned|interest earned|gain/i],
  [
    'expense',
    /expense|cost of|wages|salar|rent|utilit|supplies used|depreciation|insurance|interest paid|loss|advertising/i,
  ],
  ['liability', /payable|loan|debt|unearned|deferred revenue|notes? due|mortgage|accrued|bonds/i],
  ['equity', /capital|equity|retained|drawing|dividend|stock|owner/i],
  ['asset', /cash|receivable|inventory|equipment|prepaid|supplies|land|building|vehicle|investment|furniture|asset/i],
];

/** The type named in parentheses after an account, such as "Fees (revenue)", or guessed from its name. */
export function accountType(name: string): AccountType | null {
  const tagged = name.match(/\((asset|liability|equity|revenue|expense)\)\s*$/i);
  if (tagged) return tagged[1].toLowerCase() as AccountType;
  return TYPE_WORDS.find(([, pattern]) => pattern.test(name))?.[0] ?? null;
}

export interface Line {
  account: string;
  amount: number;
}
export interface Entry {
  debits: Line[];
  credits: Line[];
}

export type ParseResult<T> =
  { ok: true; value: T } | { ok: false; line: number; reason: 'format' | 'unbalanced' | 'type'; name?: string };

function parseSide(side: string): Line[] | null {
  const items = side
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
  const lines = items.map((item) => {
    const m = item.match(/^(.*?)\s+(-?[\d,]*\.?\d+)$/);
    return m ? { account: m[1].trim().replace(/\s+/g, ' '), amount: Number(m[2].replace(/,/g, '')) } : null;
  });
  return items.length > 0 && lines.every((l) => l !== null && l.amount > 0 && l.account !== '')
    ? (lines as Line[])
    : null;
}

/** Journal entries, one per line, or separated by a bar, as "debits ; credits" where each side lists "Account amount" items. */
export function parseJournal(source: string): ParseResult<Entry[]> {
  const entries: Entry[] = [];
  const lines = source.split(/\n|\|/).map((l) => l.trim());
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i] === '') continue;
    const [left, right, ...extra] = lines[i].split(';');
    const debits = right === undefined || extra.length > 0 ? null : parseSide(left);
    const credits = right === undefined || extra.length > 0 ? null : parseSide(right);
    if (!debits || !credits) return { ok: false, line: i + 1, reason: 'format' };
    const total = (ls: Line[]) => Math.round(ls.reduce((s, l) => s + l.amount, 0) * 1e6) / 1e6;
    if (total(debits) !== total(credits)) return { ok: false, line: i + 1, reason: 'unbalanced' };
    for (const l of [...debits, ...credits])
      if (accountType(l.account) === null) return { ok: false, line: i + 1, reason: 'type', name: l.account };
    entries.push({ debits, credits });
  }
  return entries.length > 0 ? { ok: true, value: entries } : { ok: false, line: 1, reason: 'format' };
}

export interface AccountRow {
  name: string;
  type: AccountType;
  debit: number;
  credit: number;
}

export interface Statements {
  accounts: AccountRow[];
  trialDebit: number;
  trialCredit: number;
  revenues: number;
  expenses: number;
  netIncome: number;
  assets: number;
  liabilities: number;
  equity: number;
  balanced: boolean;
}

/** Post entries to accounts and build the trial balance, income statement, and balance sheet. */
export function statements(entries: readonly Entry[]): Statements {
  const books = new Map<string, { type: AccountType; dr: number; cr: number }>();
  const touch = (name: string) => {
    if (!books.has(name)) books.set(name, { type: accountType(name)!, dr: 0, cr: 0 });
    return books.get(name)!;
  };
  for (const e of entries) {
    for (const l of e.debits) touch(l.account).dr += l.amount;
    for (const l of e.credits) touch(l.account).cr += l.amount;
  }
  const accounts: AccountRow[] = [...books.entries()].map(([name, b]) => {
    const net = b.dr - b.cr;
    return { name, type: b.type, debit: net > 0 ? net : 0, credit: net < 0 ? -net : 0 };
  });
  const sum = (types: AccountType[], side: 'debit' | 'credit') =>
    accounts.filter((a) => types.includes(a.type)).reduce((s, a) => s + a[side], 0);
  const revenues = sum(['revenue'], 'credit') - sum(['revenue'], 'debit');
  const expenses = sum(['expense'], 'debit') - sum(['expense'], 'credit');
  const netIncome = revenues - expenses;
  const assets = sum(['asset'], 'debit') - sum(['asset'], 'credit');
  const liabilities = sum(['liability'], 'credit') - sum(['liability'], 'debit');
  const equity = sum(['equity'], 'credit') - sum(['equity'], 'debit') + netIncome;
  const round = (x: number) => Math.round(x * 1e6) / 1e6;
  return {
    accounts,
    trialDebit: round(accounts.reduce((s, a) => s + a.debit, 0)),
    trialCredit: round(accounts.reduce((s, a) => s + a.credit, 0)),
    revenues,
    expenses,
    netIncome,
    assets,
    liabilities,
    equity,
    balanced: round(assets - liabilities - equity) === 0,
  };
}

export type CostMethod = 'fifo' | 'lifo' | 'average';

export interface Layer {
  units: number;
  cost: number;
}

/** Periodic costing: cost of goods sold and ending inventory from the layers in order and the units sold. */
export function periodicInventory(
  layers: readonly Layer[],
  sold: number,
  method: CostMethod,
): { cogs: number; ending: number; units: number } | null {
  const units = layers.reduce((s, l) => s + l.units, 0);
  if (layers.some((l) => !(l.units > 0) || l.cost < 0) || sold < 0 || sold > units) return null;
  const total = layers.reduce((s, l) => s + l.units * l.cost, 0);
  if (method === 'average') {
    const cogs = (total / units) * sold;
    return { cogs, ending: total - cogs, units: units - sold };
  }
  const order = method === 'fifo' ? layers : [...layers].reverse();
  let left = sold;
  let cogs = 0;
  for (const l of order) {
    const take = Math.min(left, l.units);
    cogs += take * l.cost;
    left -= take;
  }
  return { cogs, ending: total - cogs, units: units - sold };
}

export type Event = { kind: 'buy'; units: number; cost: number } | { kind: 'sell'; units: number };

/** Perpetual costing: events in order; FIFO and LIFO use layers, average uses a moving average. */
export function perpetualInventory(
  events: readonly Event[],
  method: CostMethod,
): { cogs: number; ending: number; units: number } | null {
  let layers: Layer[] = [];
  let cogs = 0;
  for (const e of events) {
    if (e.kind === 'buy') {
      if (!(e.units > 0) || e.cost < 0) return null;
      layers.push({ units: e.units, cost: e.cost });
      continue;
    }
    const have = layers.reduce((s, l) => s + l.units, 0);
    if (!(e.units > 0) || e.units > have) return null;
    const result = periodicInventory(layers, e.units, method);
    if (!result) return null;
    cogs += result.cogs;
    if (method === 'average') {
      const avg = result.units > 0 ? result.ending / result.units : 0;
      layers = result.units > 0 ? [{ units: result.units, cost: avg }] : [];
    } else {
      let left = e.units;
      const queue = method === 'fifo' ? layers : [...layers].reverse();
      for (const l of queue) {
        const take = Math.min(left, l.units);
        l.units -= take;
        left -= take;
      }
      layers = layers.filter((l) => l.units > 1e-12);
    }
  }
  const units = layers.reduce((s, l) => s + l.units, 0);
  return { cogs, ending: layers.reduce((s, l) => s + l.units * l.cost, 0), units };
}

export const lowerOfCostOrNrv = (cost: number, nrv: number): number => Math.min(cost, nrv);

export interface Ratios {
  current: number | null;
  quick: number | null;
  debtToEquity: number | null;
  debtRatio: number | null;
  grossMargin: number | null;
  netMargin: number | null;
  assetTurnover: number | null;
  roa: number | null;
  roe: number | null;
  interestCover: number | null;
  inventoryTurnover: number | null;
  receivablesDays: number | null;
  dupont: number | null;
}

export interface Financials {
  cash: number;
  receivables: number;
  inventory: number;
  currentAssets: number;
  currentLiabilities: number;
  totalAssets: number;
  totalLiabilities: number;
  equity: number;
  revenue: number;
  cogs: number;
  netIncome: number;
  interest: number;
  tax: number;
}

const div = (a: number, b: number): number | null => (b !== 0 ? a / b : null);

export function ratios(f: Financials): Ratios {
  const margin = div(f.netIncome, f.revenue);
  const turnover = div(f.revenue, f.totalAssets);
  const leverage = div(f.totalAssets, f.equity);
  return {
    current: div(f.currentAssets, f.currentLiabilities),
    quick: div(f.cash + f.receivables, f.currentLiabilities),
    debtToEquity: div(f.totalLiabilities, f.equity),
    debtRatio: div(f.totalLiabilities, f.totalAssets),
    grossMargin: div(f.revenue - f.cogs, f.revenue),
    netMargin: margin,
    assetTurnover: turnover,
    roa: div(f.netIncome, f.totalAssets),
    roe: div(f.netIncome, f.equity),
    interestCover: div(f.netIncome + f.interest + f.tax, f.interest),
    inventoryTurnover: div(f.cogs, f.inventory),
    receivablesDays: f.revenue !== 0 ? (f.receivables / f.revenue) * 365 : null,
    dupont: margin !== null && turnover !== null && leverage !== null ? margin * turnover * leverage : null,
  };
}

export interface Cvp {
  unitMargin: number;
  marginRatio: number;
  breakEvenUnits: number;
  breakEvenSales: number;
  targetUnits: number | null;
  marginOfSafety: number | null;
  operatingLeverage: number | null;
}

/** Cost-volume-profit for a price, variable cost per unit, and fixed costs; optional target profit and expected units. */
export function cvp(
  price: number,
  variable: number,
  fixed: number,
  target = 0,
  expected: number | null = null,
): Cvp | null {
  const unitMargin = price - variable;
  if (!(price > 0) || !(unitMargin > 0) || fixed < 0) return null;
  const breakEvenUnits = fixed / unitMargin;
  const profit = expected === null ? null : expected * unitMargin - fixed;
  return {
    unitMargin,
    marginRatio: unitMargin / price,
    breakEvenUnits,
    breakEvenSales: breakEvenUnits * price,
    targetUnits: (fixed + target) / unitMargin,
    marginOfSafety: expected === null || expected <= 0 ? null : (expected - breakEvenUnits) / expected,
    operatingLeverage: profit === null || profit === 0 ? null : (expected! * unitMargin) / profit,
  };
}

export interface Product {
  price: number;
  variable: number;
  share: number;
}

/** Break-even for a mix of products sold in fixed proportions (shares need not add to one). */
export function mixBreakEven(
  products: readonly Product[],
  fixed: number,
): { units: number; byProduct: number[]; unitMargin: number } | null {
  const total = products.reduce((s, p) => s + p.share, 0);
  if (products.length === 0 || !(total > 0) || products.some((p) => p.share < 0 || p.price <= p.variable)) return null;
  const unitMargin = products.reduce((s, p) => s + ((p.price - p.variable) * p.share) / total, 0);
  const units = fixed / unitMargin;
  return { units, byProduct: products.map((p) => (units * p.share) / total), unitMargin };
}

export interface Variance {
  price: number;
  quantity: number;
  total: number;
}

/** Price and quantity (or rate and efficiency) variances; positive means unfavorable. */
export function inputVariances(
  actualQty: number,
  actualPrice: number,
  standardQty: number,
  standardPrice: number,
): Variance {
  const price = (actualPrice - standardPrice) * actualQty;
  const quantity = (actualQty - standardQty) * standardPrice;
  return { price, quantity, total: price + quantity };
}

export interface ProcessCost {
  materialUnits: number;
  conversionUnits: number;
  materialPerUnit: number;
  conversionPerUnit: number;
  completedCost: number;
  endingCost: number;
}

/** Weighted-average process costing from units in process at the start, units started, and the ending work. */
export function processCosting(
  completed: number,
  endingUnits: number,
  endingMaterial: number,
  endingConversion: number,
  materialCost: number,
  conversionCost: number,
): ProcessCost | null {
  if (!(completed >= 0) || !(endingUnits >= 0) || [endingMaterial, endingConversion].some((x) => x < 0 || x > 1))
    return null;
  const materialUnits = completed + endingUnits * endingMaterial;
  const conversionUnits = completed + endingUnits * endingConversion;
  if (!(materialUnits > 0) || !(conversionUnits > 0)) return null;
  const materialPerUnit = materialCost / materialUnits;
  const conversionPerUnit = conversionCost / conversionUnits;
  return {
    materialUnits,
    conversionUnits,
    materialPerUnit,
    conversionPerUnit,
    completedCost: completed * (materialPerUnit + conversionPerUnit),
    endingCost: endingUnits * endingMaterial * materialPerUnit + endingUnits * endingConversion * conversionPerUnit,
  };
}

export interface Pool {
  name: string;
  cost: number;
  driverTotal: number;
  used: number;
}

/** Activity-based costing: overhead assigned to one product from each pool's rate and the product's use of it. */
export function activityCosting(pools: readonly Pool[]): { rates: number[]; assigned: number[]; total: number } | null {
  if (
    pools.length === 0 ||
    pools.some((p) => !(p.driverTotal > 0) || p.cost < 0 || p.used < 0 || p.used > p.driverTotal)
  )
    return null;
  const rates = pools.map((p) => p.cost / p.driverTotal);
  const assigned = pools.map((p, i) => rates[i] * p.used);
  return { rates, assigned, total: assigned.reduce((s, x) => s + x, 0) };
}

export interface BondRow {
  period: number;
  cash: number;
  expense: number;
  amortization: number;
  carrying: number;
}

/** Bonds payable by the effective-interest method; rates are per period. */
export function bondSchedule(
  face: number,
  couponRate: number,
  marketRate: number,
  periods: number,
): { issue: number; rows: BondRow[] } | null {
  if (!(face > 0) || !(periods >= 1) || !Number.isInteger(periods) || marketRate <= -1 || couponRate < 0) return null;
  const cash = face * couponRate;
  const factor = marketRate === 0 ? periods : (1 - (1 + marketRate) ** -periods) / marketRate;
  const issue = cash * factor + face / (1 + marketRate) ** periods;
  const rows: BondRow[] = [];
  let carrying = issue;
  for (let period = 1; period <= periods; period += 1) {
    const expense = carrying * marketRate;
    const amortization = expense - cash;
    carrying += amortization;
    rows.push({ period, cash, expense, amortization, carrying });
  }
  return { issue, rows };
}

export const benfordShare = (digit: number): number => Math.log10(1 + 1 / digit);

/** First significant digit of a nonzero number. */
export function firstDigit(x: number): number | null {
  const a = Math.abs(x);
  if (!(a > 0) || !Number.isFinite(a)) return null;
  return Number(a.toExponential().charAt(0));
}

/** Regularized upper incomplete gamma Q(a, x), by series and continued fraction. */
function gammaQ(a: number, x: number): number {
  if (x <= 0) return 1;
  const lg = lnGamma(a);
  if (x < a + 1) {
    let sum = 1 / a;
    let term = sum;
    for (let n = 1; n < 500; n += 1) {
      term *= x / (a + n);
      sum += term;
      if (Math.abs(term) < Math.abs(sum) * 1e-15) break;
    }
    return 1 - sum * Math.exp(-x + a * Math.log(x) - lg);
  }
  let b = x + 1 - a;
  let c = 1e300;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i < 500; i += 1) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < 1e-300) d = 1e-300;
    c = b + an / c;
    if (Math.abs(c) < 1e-300) c = 1e-300;
    d = 1 / d;
    const delta = d * c;
    h *= delta;
    if (Math.abs(delta - 1) < 1e-15) break;
  }
  return Math.exp(-x + a * Math.log(x) - lg) * h;
}

function lnGamma(z: number): number {
  const c = [
    76.1800917294715, -86.5053203294168, 24.0140982408309, -1.23173957245015, 0.0012086509738662, -0.000005395239385,
  ];
  let y = z;
  let tmp = z + 5.5;
  tmp -= (z + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (const coefficient of c) ser += coefficient / (y += 1);
  return -tmp + Math.log((Math.sqrt(2 * Math.PI) * ser) / z);
}

/** The upper-tail probability of a chi-square statistic with the given degrees of freedom. */
export const chiSquareP = (statistic: number, df: number): number => gammaQ(df / 2, statistic / 2);

export interface Benford {
  counts: number[];
  used: number;
  chiSquare: number;
  pValue: number;
  mad: number;
}

/** A first-digit test of amounts against Benford's law (chi-square on 8 degrees of freedom, and the MAD). */
export function benfordTest(amounts: readonly number[]): Benford | null {
  const digits = amounts.map(firstDigit).filter((d): d is number => d !== null);
  if (digits.length < 1) return null;
  const counts = Array.from({ length: 9 }, (_, i) => digits.filter((d) => d === i + 1).length);
  const n = digits.length;
  const chiSquare = counts.reduce((s, c, i) => s + (c - n * benfordShare(i + 1)) ** 2 / (n * benfordShare(i + 1)), 0);
  const mad = counts.reduce((s, c, i) => s + Math.abs(c / n - benfordShare(i + 1)), 0) / 9;
  return { counts, used: n, chiSquare, pValue: chiSquareP(chiSquare, 8), mad };
}

/** The smallest sample whose chance of finding at least one deviation (if the rate is the tolerable one) reaches the
 * confidence, allowing `expected` deviations in the sample (Poisson approximation). */
export function attributeSample(confidence: number, tolerable: number, expected = 0): number | null {
  if (
    !(confidence > 0 && confidence < 1) ||
    !(tolerable > 0 && tolerable < 1) ||
    expected < 0 ||
    !Number.isInteger(expected)
  )
    return null;
  const cdf = (lambda: number) => {
    let term = Math.exp(-lambda);
    let sum = term;
    for (let k = 1; k <= expected; k += 1) {
      term *= lambda / k;
      sum += term;
    }
    return sum;
  };
  for (let n = 1; n < 100000; n += 1) if (cdf(n * tolerable) <= 1 - confidence + 1e-12) return n;
  return null;
}

export interface UnitEconomics {
  lifetimeValue: number;
  lifetimeValueToCost: number | null;
  paybackPeriods: number | null;
  lifetimePeriods: number | null;
}

/** Customer lifetime value m r / (1 + d - r) for margin m per period, retention r, and discount rate d. */
export function unitEconomics(
  margin: number,
  retention: number,
  discount: number,
  acquisition: number,
): UnitEconomics | null {
  if (!(retention >= 0 && retention < 1) || discount <= -1 || 1 + discount - retention <= 0) return null;
  const lifetimeValue = (margin * retention) / (1 + discount - retention);
  return {
    lifetimeValue,
    lifetimeValueToCost: acquisition > 0 ? lifetimeValue / acquisition : null,
    paybackPeriods: margin > 0 && acquisition > 0 ? acquisition / margin : null,
    lifetimePeriods: retention < 1 ? 1 / (1 - retention) : null,
  };
}
