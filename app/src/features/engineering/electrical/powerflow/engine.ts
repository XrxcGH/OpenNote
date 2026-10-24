// Small-network load flow (Newton-Raphson, Gauss-Seidel, DC) and economic dispatch of generators. Pure functions on
// per-unit quantities; the network is read from a short text description by parse().
import {
  cAbs,
  cAdd,
  cArg,
  cConj,
  cDiv,
  cMul,
  cPolar,
  cSub,
  cx,
  fail,
  readNumber,
  solveReal,
  toRadians,
} from '../shared';
import type { Cx } from '../shared';

export type BusType = 'slack' | 'pv' | 'pq';

export interface Bus {
  id: number;
  type: BusType;
  /** Voltage magnitude (slack, PV) or the starting guess (PQ), per unit. */
  v: number;
  /** Angle in radians (slack) or the starting guess. */
  theta: number;
  /** Scheduled generation and load, per unit. */
  pg: number;
  qg: number;
  pl: number;
  ql: number;
}

export interface Line {
  from: number;
  to: number;
  r: number;
  x: number;
  /** Total line-charging susceptance, split between the 2 ends. */
  b: number;
}

export interface Network {
  buses: Bus[];
  lines: Line[];
}

const MAX_BUSES = 30;

/**
 * Reads the network description. One statement per line; '#' starts a comment.
 *   slack <bus> <V> [<angle in degrees>]
 *   gen <bus> <P> <V>        a generator that holds its voltage (a PV bus)
 *   load <bus> <P> <Q>       a load (added to any other at the bus)
 *   line <from> <to> <R> <X> [<B>]
 */
export function parseNetwork(text: string): Network {
  const slack = new Map<number, { v: number; theta: number }>();
  const gens = new Map<number, { p: number; v: number }>();
  const loads = new Map<number, { p: number; q: number }>();
  const lines: Line[] = [];
  const seen = new Set<number>();
  const rows = text.split('\n');
  rows.forEach((raw, index) => {
    const lineNo = String(index + 1);
    const stripped = raw.replace(/#.*/, '').trim();
    if (stripped === '') return;
    const words = stripped.split(/\s+/);
    const word = words[0]!.toLowerCase();
    const nums = words.slice(1).map((w) => readNumber(w));
    const need = (min: number, max: number): number[] => {
      if (nums.length < min || nums.length > max) fail('pfCount', { line: lineNo, word, min: String(min) });
      if (nums.some((n) => n === null || !Number.isFinite(n))) fail('pfNumber', { line: lineNo, text: stripped });
      return nums as number[];
    };
    const bus = (n: number): number => {
      if (!Number.isInteger(n) || n < 1 || n > 9999) fail('pfBusNumber', { line: lineNo });
      seen.add(n);
      return n;
    };
    if (word === 'slack') {
      const a = need(2, 3);
      slack.set(bus(a[0]!), { v: a[1]!, theta: toRadians(a[2] ?? 0) });
    } else if (word === 'gen') {
      const a = need(3, 3);
      gens.set(bus(a[0]!), { p: a[1]!, v: a[2]! });
    } else if (word === 'load') {
      const a = need(3, 3);
      const b = bus(a[0]!);
      const old = loads.get(b) ?? { p: 0, q: 0 };
      loads.set(b, { p: old.p + a[1]!, q: old.q + a[2]! });
    } else if (word === 'line') {
      const a = need(4, 5);
      const from = bus(a[0]!);
      const to = bus(a[1]!);
      if (from === to) fail('pfSelfLine', { line: lineNo });
      if (a[2]! < 0 || (a[2]! === 0 && a[3]! === 0)) fail('pfImpedance', { line: lineNo });
      lines.push({ from, to, r: a[2]!, x: a[3]!, b: a[4] ?? 0 });
    } else {
      fail('pfWord', { line: lineNo, word });
    }
  });
  if (slack.size === 0) fail('pfNoSlack');
  if (slack.size > 1) fail('pfManySlack');
  if (seen.size > MAX_BUSES) fail('pfTooMany', { max: String(MAX_BUSES) });
  const ids = [...seen].sort((a, b) => a - b);
  const buses: Bus[] = ids.map((id) => {
    const s = slack.get(id);
    const g = gens.get(id);
    const l = loads.get(id) ?? { p: 0, q: 0 };
    if (s && g) fail('pfBothKinds', { bus: String(id) });
    const type: BusType = s ? 'slack' : g ? 'pv' : 'pq';
    return {
      id,
      type,
      v: s?.v ?? g?.v ?? 1,
      theta: s?.theta ?? 0,
      pg: g?.p ?? 0,
      qg: 0,
      pl: l.p,
      ql: l.q,
    };
  });
  for (const b of buses) if (b.v <= 0) fail('pfVoltage', { bus: String(b.id) });
  return { buses, lines };
}

/** The bus admittance matrix, indexed in the order of net.buses. */
export function admittanceMatrix(net: Network): Cx[][] {
  const index = new Map(net.buses.map((b, i) => [b.id, i]));
  const n = net.buses.length;
  const y: Cx[][] = Array.from({ length: n }, () => Array.from({ length: n }, () => cx(0)));
  for (const l of net.lines) {
    const i = index.get(l.from)!;
    const j = index.get(l.to)!;
    const series = cDiv(cx(1), cx(l.r, l.x));
    const half = cx(0, l.b / 2);
    y[i]![i] = cAdd(y[i]![i]!, cAdd(series, half));
    y[j]![j] = cAdd(y[j]![j]!, cAdd(series, half));
    y[i]![j] = cSub(y[i]![j]!, series);
    y[j]![i] = cSub(y[j]![i]!, series);
  }
  return y;
}

/** A check that every bus can be reached from the slack bus along lines, so the equations have an answer. */
function checkConnected(net: Network): void {
  const reach = new Set<number>([net.buses.find((b) => b.type === 'slack')!.id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const l of net.lines) {
      if (reach.has(l.from) !== reach.has(l.to)) {
        reach.add(l.from);
        reach.add(l.to);
        grew = true;
      }
    }
  }
  const lost = net.buses.find((b) => !reach.has(b.id));
  if (lost) fail('pfIsland', { bus: String(lost.id) });
}

export interface FlowResult {
  /** Bus voltages, in the order of net.buses. */
  v: number[];
  theta: number[];
  /** Net injected power at each bus, per unit. */
  p: number[];
  q: number[];
  iterations: number;
  /** The largest power mismatch at the start and after each iteration. */
  history: number[];
  y: Cx[][];
  method: 'newton' | 'gauss';
}

const injection = (y: Cx[][], v: number[], th: number[], i: number): { p: number; q: number } => {
  let p = 0;
  let q = 0;
  for (let k = 0; k < v.length; k++) {
    const g = y[i]![k]!.re;
    const b = y[i]![k]!.im;
    const d = th[i]! - th[k]!;
    p += v[i]! * v[k]! * (g * Math.cos(d) + b * Math.sin(d));
    q += v[i]! * v[k]! * (g * Math.sin(d) - b * Math.cos(d));
  }
  return { p, q };
};

export interface FlowOptions {
  tolerance?: number;
  maxIterations?: number;
}

/** Newton-Raphson load flow in polar form with the full analytic Jacobian. */
export function newtonRaphson(net: Network, options: FlowOptions = {}): FlowResult {
  checkConnected(net);
  const tol = options.tolerance ?? 1e-10;
  const max = options.maxIterations ?? 40;
  const y = admittanceMatrix(net);
  const n = net.buses.length;
  const v = net.buses.map((b) => b.v);
  const th = net.buses.map((b) => b.theta);
  const sched = net.buses.map((b) => ({ p: b.pg - b.pl, q: b.qg - b.ql }));
  const angleIdx = net.buses.map((b, i) => (b.type !== 'slack' ? i : -1)).filter((i) => i >= 0);
  const magIdx = net.buses.map((b, i) => (b.type === 'pq' ? i : -1)).filter((i) => i >= 0);
  const history: number[] = [];
  let iterations = 0;
  for (; iterations <= max; iterations++) {
    const calc = Array.from({ length: n }, (_, i) => injection(y, v, th, i));
    const mismatch = [...angleIdx.map((i) => sched[i]!.p - calc[i]!.p), ...magIdx.map((i) => sched[i]!.q - calc[i]!.q)];
    const worst = Math.max(0, ...mismatch.map(Math.abs));
    history.push(worst);
    if (worst < tol) break;
    if (iterations === max) fail('pfNoConverge', { count: String(max) });
    const size = mismatch.length;
    const jac: number[][] = Array.from({ length: size }, () => Array.from({ length: size }, () => 0));
    const rows = [...angleIdx.map((i) => ['p', i] as const), ...magIdx.map((i) => ['q', i] as const)];
    const cols = [...angleIdx.map((i) => ['t', i] as const), ...magIdx.map((i) => ['v', i] as const)];
    rows.forEach(([kind, i], r) => {
      cols.forEach(([what, k], c) => {
        const g = y[i]![k]!.re;
        const b = y[i]![k]!.im;
        const d = th[i]! - th[k]!;
        let value: number;
        if (kind === 'p' && what === 't') {
          value = i === k ? -calc[i]!.q - b * v[i]! ** 2 : v[i]! * v[k]! * (g * Math.sin(d) - b * Math.cos(d));
        } else if (kind === 'p' && what === 'v') {
          value = i === k ? calc[i]!.p / v[i]! + g * v[i]! : v[i]! * (g * Math.cos(d) + b * Math.sin(d));
        } else if (kind === 'q' && what === 't') {
          value = i === k ? calc[i]!.p - g * v[i]! ** 2 : -v[i]! * v[k]! * (g * Math.cos(d) + b * Math.sin(d));
        } else {
          value = i === k ? calc[i]!.q / v[i]! - b * v[i]! : v[i]! * (g * Math.sin(d) - b * Math.cos(d));
        }
        jac[r]![c] = value;
      });
    });
    const dx = solveReal(jac, mismatch);
    if (!dx) fail('pfSingular');
    angleIdx.forEach((i, k) => {
      th[i]! += dx![k]!;
    });
    magIdx.forEach((i, k) => {
      v[i]! += dx![angleIdx.length + k]!;
    });
    if (magIdx.some((i) => v[i]! <= 0)) fail('pfCollapse');
  }
  const final = Array.from({ length: n }, (_, i) => injection(y, v, th, i));
  return { v, theta: th, p: final.map((s) => s.p), q: final.map((s) => s.q), iterations, history, y, method: 'newton' };
}

/** Gauss-Seidel load flow: slow, but each step is just an update of one voltage. */
export function gaussSeidel(net: Network, options: FlowOptions = {}): FlowResult {
  checkConnected(net);
  const tol = options.tolerance ?? 1e-9;
  const max = options.maxIterations ?? 2000;
  const y = admittanceMatrix(net);
  const n = net.buses.length;
  const volt: Cx[] = net.buses.map((b) => cPolar(b.v, b.theta));
  const history: number[] = [];
  const qCalc = (i: number): number => {
    let sum = cx(0);
    for (let k = 0; k < n; k++) sum = cAdd(sum, cMul(y[i]![k]!, volt[k]!));
    return -cMul(cConj(volt[i]!), sum).im;
  };
  let iterations = 0;
  for (; iterations <= max; iterations++) {
    let worst = 0;
    for (let i = 0; i < n; i++) {
      const b = net.buses[i]!;
      if (b.type === 'slack') continue;
      let q = b.qg - b.ql;
      if (b.type === 'pv') q = qCalc(i);
      const p = b.pg - b.pl;
      let others = cx(0);
      for (let k = 0; k < n; k++) if (k !== i) others = cAdd(others, cMul(y[i]![k]!, volt[k]!));
      const rhs = cDiv(cx(p, -q), cConj(volt[i]!));
      let next = cDiv(cSub(rhs, others), y[i]![i]!);
      if (b.type === 'pv') next = cPolar(b.v, cArg(next));
      worst = Math.max(worst, cAbs(cSub(next, volt[i]!)));
      volt[i] = next;
    }
    history.push(worst);
    if (worst < tol) break;
    if (iterations === max) fail('pfNoConverge', { count: String(max) });
  }
  const v = volt.map(cAbs);
  const th = volt.map(cArg);
  const final = Array.from({ length: n }, (_, i) => injection(y, v, th, i));
  return { v, theta: th, p: final.map((s) => s.p), q: final.map((s) => s.q), iterations, history, y, method: 'gauss' };
}

export interface LineFlow {
  from: number;
  to: number;
  /** Complex power leaving each end into the line, per unit. */
  sFrom: Cx;
  sTo: Cx;
  loss: Cx;
}

/** The power sent into each line at both ends and its loss (the sum of the 2). */
export function lineFlows(net: Network, result: FlowResult): LineFlow[] {
  const index = new Map(net.buses.map((b, i) => [b.id, i]));
  const volt = result.v.map((m, i) => cPolar(m, result.theta[i]!));
  return net.lines.map((l) => {
    const i = index.get(l.from)!;
    const j = index.get(l.to)!;
    const series = cDiv(cx(1), cx(l.r, l.x));
    const half = cx(0, l.b / 2);
    const iFrom = cAdd(cMul(series, cSub(volt[i]!, volt[j]!)), cMul(half, volt[i]!));
    const iTo = cAdd(cMul(series, cSub(volt[j]!, volt[i]!)), cMul(half, volt[j]!));
    const sFrom = cMul(volt[i]!, cConj(iFrom));
    const sTo = cMul(volt[j]!, cConj(iTo));
    return { from: l.from, to: l.to, sFrom, sTo, loss: cAdd(sFrom, sTo) };
  });
}

export interface DcResult {
  theta: number[];
  /** The power in each line from its first bus to its second, per unit. */
  flows: number[];
  /** The power the slack bus supplies, per unit. */
  slackPower: number;
}

/** DC power flow: B' theta = P with the slack angle fixed, flows (theta_i - theta_j) / x. */
export function dcFlow(net: Network): DcResult {
  checkConnected(net);
  const index = new Map(net.buses.map((b, i) => [b.id, i]));
  const n = net.buses.length;
  const b: number[][] = Array.from({ length: n }, () => Array.from({ length: n }, () => 0));
  for (const l of net.lines) {
    if (l.x === 0) fail('pfDcReactance');
    const i = index.get(l.from)!;
    const j = index.get(l.to)!;
    const s = 1 / l.x;
    b[i]![i]! += s;
    b[j]![j]! += s;
    b[i]![j]! -= s;
    b[j]![i]! -= s;
  }
  const free = net.buses.map((x, i) => (x.type !== 'slack' ? i : -1)).filter((i) => i >= 0);
  const reduced = free.map((i) => free.map((k) => b[i]![k]!));
  const power = free.map((i) => net.buses[i]!.pg - net.buses[i]!.pl);
  const sol = solveReal(reduced, power);
  if (!sol) fail('pfSingular');
  const theta = Array.from({ length: n }, () => 0);
  const slackAt = net.buses.findIndex((x) => x.type === 'slack');
  theta[slackAt] = net.buses[slackAt]!.theta;
  free.forEach((i, k) => {
    theta[i] = sol![k]! + theta[slackAt]!;
  });
  const flows = net.lines.map((l) => (theta[index.get(l.from)!]! - theta[index.get(l.to)!]!) / l.x);
  const slackPower = b[slackAt]!.reduce((sum, bk, k) => sum + bk * theta[k]!, 0);
  return { theta, flows, slackPower };
}

// ---- Economic dispatch ----

export interface Unit {
  /** Cost = a P^2 + b P + c in currency per hour with P in MW. */
  a: number;
  b: number;
  c: number;
  min: number;
  max: number;
}

export interface Dispatch {
  p: number[];
  /** The system incremental cost (lambda), currency per MWh. */
  lambda: number;
  cost: number;
  /** Which limit each unit sits at, if any. */
  limit: ('min' | 'max' | null)[];
}

export const unitCost = (u: Unit, p: number): number => u.a * p * p + u.b * p + u.c;

/** Economic dispatch by equal incremental cost: bisect on lambda so the units' output meets the demand, with limits. */
export function economicDispatch(units: Unit[], demand: number): Dispatch {
  const totalMin = units.reduce((s, u) => s + u.min, 0);
  const totalMax = units.reduce((s, u) => s + u.max, 0);
  if (demand < totalMin - 1e-9 || demand > totalMax + 1e-9) {
    fail('dispatchRange', { min: String(totalMin), max: String(totalMax) });
  }
  const at = (lambda: number): number[] =>
    units.map((u) => {
      const free = u.a > 0 ? (lambda - u.b) / (2 * u.a) : lambda > u.b ? u.max : u.min;
      return Math.min(u.max, Math.max(u.min, free));
    });
  let lo = Math.min(...units.map((u) => u.b)) - 1;
  let hi = Math.max(...units.map((u) => 2 * u.a * u.max + u.b)) + 1;
  for (let k = 0; k < 200; k++) {
    const mid = (lo + hi) / 2;
    if (at(mid).reduce((s, x) => s + x, 0) < demand) lo = mid;
    else hi = mid;
  }
  const lambda = (lo + hi) / 2;
  const p = at(lambda);
  // Units with a flat marginal cost equal to lambda can take up the remainder.
  let rest = demand - p.reduce((s, x) => s + x, 0);
  units.forEach((u, i) => {
    if (u.a === 0 && Math.abs(u.b - lambda) < 1e-6 && Math.abs(rest) > 1e-12) {
      const room = rest > 0 ? u.max - p[i]! : u.min - p[i]!;
      const take = rest > 0 ? Math.min(rest, room) : Math.max(rest, room);
      p[i]! += take;
      rest -= take;
    }
  });
  const limit = units.map((u, i) => (p[i]! <= u.min + 1e-9 ? 'min' : p[i]! >= u.max - 1e-9 ? 'max' : null));
  const cost = units.reduce((s, u, i) => s + unitCost(u, p[i]!), 0);
  return { p, lambda, cost, limit };
}

/** Reads the unit lines: `unit <a> <b> <c> <min> <max>`. */
export function parseUnits(text: string): Unit[] {
  const units: Unit[] = [];
  text.split('\n').forEach((raw, index) => {
    const stripped = raw.replace(/#.*/, '').trim();
    if (stripped === '') return;
    const words = stripped.split(/\s+/);
    const line = String(index + 1);
    if (words[0]!.toLowerCase() !== 'unit') fail('pfWord', { line, word: words[0]! });
    const nums = words.slice(1).map((w) => readNumber(w));
    if (nums.length !== 5) fail('pfCount', { line, word: 'unit', min: '5' });
    if (nums.some((x) => x === null || !Number.isFinite(x))) fail('pfNumber', { line, text: stripped });
    const [a, b, c, min, max] = nums as number[];
    if (a! < 0) fail('dispatchConvex', { line });
    if (min! < 0 || max! < min!) fail('dispatchLimits', { line });
    units.push({ a: a!, b: b!, c: c!, min: min!, max: max! });
  });
  if (units.length === 0) fail('dispatchNoUnits');
  return units;
}
