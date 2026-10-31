// Project networks on an activity-on-node table: a forward pass for the earliest start and finish, a backward pass
// for the latest, slack, and the critical path. With three estimates per activity, PERT gives each one a mean
// (a + 4m + b) / 6 and a variance ((b - a) / 6)^2, and the chance of finishing by a deadline from the normal curve.
// Earned value compares planned value, earned value, and actual cost.
//
//   A 3            (an activity with no predecessors)
//   B 2 | A        (after A)
//   D 2 | B, C     (after B and C)
//   E 2 4 6 | D    (optimistic, most likely, pessimistic)
import { erfc } from '../../kits/num/special/gamma';
import { step } from '../core/step';
import type { Step } from '../core/step';
import { fail, lines, num, numbers } from '../core/util';

export interface Activity {
  name: string;
  /** The duration, or the PERT mean when three estimates were given. */
  dur: number;
  variance: number;
  three: [number, number, number] | null;
  preds: string[];
}

export function parseActivities(text: string): Activity[] {
  const out: Activity[] = [];
  lines(text).forEach((raw, k) => {
    const line = k + 1;
    const [head, tail = ''] = raw.split('|');
    const m = /^\s*([A-Za-z0-9_]+)\s*[:,]?\s*(.*)$/.exec(head);
    if (!m) return fail('pmLine', { line });
    const values = numbers(m[2].replace(/,/g, ' '));
    if (!values || (values.length !== 1 && values.length !== 3)) return fail('pmDuration', { line, name: m[1] });
    if (values.some((v) => v < 0)) fail('pmNegative', { line, name: m[1] });
    let three: Activity['three'] = null;
    let dur = values[0];
    let variance = 0;
    if (values.length === 3) {
      const [a, mid, b] = values;
      if (!(a <= mid && mid <= b)) fail('pmOrder', { line, name: m[1] });
      three = [a, mid, b];
      dur = (a + 4 * mid + b) / 6;
      variance = ((b - a) / 6) ** 2;
    }
    const preds = tail
      .split(/[\s,;]+/)
      .map((p) => p.trim())
      .filter((p) => p && p !== '-');
    if (out.some((a) => a.name === m[1])) fail('pmDuplicate', { name: m[1] });
    out.push({ name: m[1], dur, variance, three, preds });
  });
  if (out.length === 0) fail('pmEmpty');
  if (out.length > 60) fail('pmTooBig', { count: 60 });
  const names = new Set(out.map((a) => a.name));
  for (const a of out)
    for (const p of a.preds) {
      if (!names.has(p)) fail('pmUnknown', { name: a.name, pred: p });
      if (p === a.name) fail('pmSelf', { name: a.name });
    }
  return out;
}

export interface Schedule {
  acts: Activity[];
  /** Indices in an order where every activity comes after its predecessors. */
  order: number[];
  es: number[];
  ef: number[];
  ls: number[];
  lf: number[];
  slack: number[];
  critical: boolean[];
  length: number;
  /** Critical paths from a start activity to an end activity, as names, up to 20. */
  paths: string[][];
  /** The largest sum of variances along a critical path. */
  variance: number;
  steps: Step[];
}

const EPS = 1e-9;

export function cpm(acts: Activity[]): Schedule {
  const n = acts.length;
  const index = new Map(acts.map((a, i) => [a.name, i]));
  const preds = acts.map((a) => a.preds.map((p) => index.get(p)!));
  const succs = acts.map((_, i) => preds.flatMap((ps, j) => (ps.includes(i) ? [j] : [])));
  const order: number[] = [];
  const indeg = preds.map((p) => p.length);
  const ready = indeg.flatMap((d, i) => (d === 0 ? [i] : []));
  while (ready.length) {
    const i = ready.shift()!;
    order.push(i);
    for (const j of succs[i]) if (--indeg[j] === 0) ready.push(j);
  }
  if (order.length < n) {
    const stuck = acts.filter((_, i) => !order.includes(i)).map((a) => a.name);
    fail('pmCycle', { names: stuck.join(', ') });
  }
  const steps: Step[] = [];
  const es = Array<number>(n).fill(0);
  const ef = Array<number>(n).fill(0);
  for (const i of order) {
    es[i] = Math.max(0, ...preds[i].map((p) => ef[p]));
    ef[i] = es[i] + acts[i].dur;
    steps.push(
      step(preds[i].length ? 'pmForward' : 'pmForwardStart', {
        name: acts[i].name,
        preds: preds[i].map((p) => acts[p].name).join(', '),
        es: num(es[i]),
        ef: num(ef[i]),
      }),
    );
  }
  const length = Math.max(...ef);
  const ls = Array<number>(n).fill(0);
  const lf = Array<number>(n).fill(0);
  for (const i of [...order].reverse()) {
    lf[i] = Math.min(length, ...succs[i].map((s) => ls[s]));
    ls[i] = lf[i] - acts[i].dur;
    steps.push(
      step(succs[i].length ? 'pmBackward' : 'pmBackwardEnd', {
        name: acts[i].name,
        succs: succs[i].map((s) => acts[s].name).join(', '),
        lf: num(lf[i]),
        ls: num(ls[i]),
      }),
    );
  }
  const slack = ls.map((l, i) => l - es[i]);
  const critical = slack.map((s) => Math.abs(s) <= EPS);
  const paths: string[][] = [];
  const walk = (i: number, path: number[]) => {
    if (paths.length >= 20) return;
    const next = succs[i].filter((j) => critical[j] && Math.abs(es[j] - ef[i]) <= EPS);
    if (Math.abs(ef[i] - length) <= EPS && succs[i].every((j) => !critical[j] || Math.abs(es[j] - ef[i]) > EPS))
      paths.push(path.map((k) => acts[k].name));
    for (const j of next) walk(j, [...path, j]);
  };
  for (const i of order) if (critical[i] && preds[i].length === 0 && es[i] <= EPS) walk(i, [i]);
  const variance = Math.max(0, ...paths.map((p) => p.reduce((s, name) => s + acts[index.get(name)!].variance, 0)));
  return { acts, order, es, ef, ls, lf, slack, critical, length, paths, variance, steps };
}

/** The standard normal distribution function. */
export const normalCdf = (z: number): number => 0.5 * erfc(-z / Math.SQRT2);

export interface EarnedValue {
  cv: number;
  sv: number;
  cpi: number;
  spi: number;
  eac: number;
  etc: number;
  vac: number;
  tcpi: number;
}

export function earnedValue(bac: number, pv: number, ev: number, ac: number): EarnedValue {
  if ([bac, pv, ev, ac].some((x) => !Number.isFinite(x) || x < 0)) fail('evNegative');
  if (bac <= 0) fail('evBudget');
  if (ac <= 0 || pv <= 0) fail('evZero');
  const cpi = ev / ac;
  const spi = ev / pv;
  const eac = cpi > 0 ? bac / cpi : Infinity;
  return {
    cv: ev - ac,
    sv: ev - pv,
    cpi,
    spi,
    eac,
    etc: eac - ac,
    vac: bac - eac,
    tcpi: bac === ac ? Infinity : (bac - ev) / (bac - ac),
  };
}

/** A crash limit for an activity: the shortest it can take, and the cost of each unit of time taken off. */
export interface CrashLimit {
  min: number;
  slope: number;
}

export interface CrashRound {
  /** The activities shortened together, each by `by`. */
  names: string[];
  by: number;
  length: number;
  cost: number;
  total: number;
}

export interface Crashed {
  rounds: CrashRound[];
  durations: Map<string, number>;
  length: number;
  cost: number;
  /** True when every critical path ran out of crashable time before the target. */
  stuck: boolean;
}

/** Lines such as "A 3 100": A can be crashed down to 3, at 100 per unit of time saved. */
export function parseCrash(text: string, acts: readonly Activity[]): Map<string, CrashLimit> {
  const out = new Map<string, CrashLimit>();
  lines(text).forEach((raw, k) => {
    const m = /^\s*([A-Za-z0-9_]+)\s*[:,]?\s*(.*)$/.exec(raw);
    const values = m ? numbers(m[2].replace(/,/g, ' ')) : null;
    if (!m || !values || values.length !== 2) return fail('crashLine', { line: k + 1 });
    const act = acts.find((a) => a.name === m[1]);
    if (!act) return fail('crashUnknown', { name: m[1] });
    if (act.three) fail('crashPert', { name: m[1] });
    const [min, slope] = values;
    if (!(min >= 0 && min <= act.dur) || !(slope >= 0)) fail('crashValues', { name: m[1] });
    out.set(m[1], { min, slope });
  });
  return out;
}

/**
 * Crashing to a target length: each round shortens the cheapest set of activities that cuts every critical path,
 * by as much as keeps the critical paths the same, until the target is met or no critical path can be shortened.
 */
export function crash(acts: readonly Activity[], limits: Map<string, CrashLimit>, target: number): Crashed {
  const dur = new Map(acts.map((a) => [a.name, a.dur]));
  const succs = acts.map((a) => acts.flatMap((b, j) => (b.preds.includes(a.name) ? [j] : [])));
  const starts = acts.flatMap((a, i) => (a.preds.length === 0 ? [i] : []));
  const allPaths: number[][] = [];
  const walk = (i: number, path: number[]) => {
    if (allPaths.length > 2000) fail('crashPaths', { max: 2000 });
    if (succs[i].length === 0) allPaths.push(path);
    for (const j of succs[i]) walk(j, [...path, j]);
  };
  starts.forEach((i) => walk(i, [i]));
  const lengthOf = (p: number[]) => p.reduce((s, i) => s + dur.get(acts[i].name)!, 0);
  const rounds: CrashRound[] = [];
  let total = 0;
  let stuck = false;
  for (let guard = 0; guard < 1000; guard += 1) {
    const lengths = allPaths.map(lengthOf);
    const length = Math.max(...lengths);
    if (length <= target + EPS) break;
    const criticalPaths = allPaths.filter((_, k) => lengths[k] >= length - EPS);
    const room = (i: number) => dur.get(acts[i].name)! - (limits.get(acts[i].name)?.min ?? dur.get(acts[i].name)!);
    const candidates = [...new Set(criticalPaths.flat())].filter((i) => room(i) > EPS).sort((a, b) => a - b);
    const slope = (i: number) => limits.get(acts[i].name)!.slope;
    const cuts = (set: number[]) => criticalPaths.every((p) => p.some((i) => set.includes(i)));
    let best: number[] | null = null;
    let bestCost = Infinity;
    if (candidates.length <= 14) {
      for (let mask = 1; mask < 1 << candidates.length; mask += 1) {
        const set = candidates.filter((_, k) => mask & (1 << k));
        const cost = set.reduce((s, i) => s + slope(i), 0);
        if (cost < bestCost - EPS && cuts(set)) [best, bestCost] = [set, cost];
      }
    } else {
      // Too many to try every set: take the cheapest activity on each path not yet cut.
      const set: number[] = [];
      for (const p of criticalPaths)
        if (!p.some((i) => set.includes(i))) {
          const options = p.filter((i) => candidates.includes(i)).sort((a, b) => slope(a) - slope(b));
          if (options.length) set.push(options[0]);
        }
      if (cuts(set)) [best, bestCost] = [set, set.reduce((s, i) => s + slope(i), 0)];
    }
    if (!best) {
      stuck = true;
      break;
    }
    // Shorten by whole units, or less when an activity runs out, the target is near, or another path catches up.
    const next = Math.max(0, ...lengths.filter((l) => l < length - EPS));
    const by = Math.min(1, ...best.map(room), length - target, length - next);
    for (const i of best) dur.set(acts[i].name, dur.get(acts[i].name)! - by);
    total += by * bestCost;
    rounds.push({
      names: best.map((i) => acts[i].name),
      by,
      length: Math.max(...allPaths.map(lengthOf)),
      cost: by * bestCost,
      total,
    });
  }
  return { rounds, durations: dur, length: Math.max(...allPaths.map(lengthOf)), cost: total, stuck };
}
