// Time-to-event analysis. The Kaplan-Meier estimate multiplies (1 − d/n) over the event times, with Greenwood's
// standard errors and log-log intervals. The Nelson-Aalen estimate adds d/n. Median and quartile times are the
// first times the curve falls to 0.5, 0.75, and 0.25. The life table groups times into intervals. The log-rank test
// compares observed and expected events with the hypergeometric variance, optionally weighted (Peto-Peto) or
// within strata.
import { chiSquareUpper, normalQuantile } from '../kit/dist';
import { inverse, type Matrix } from '../kit/linalg';
import { fail } from '../kit/types';

export interface KmRow {
  readonly time: number;
  readonly atRisk: number;
  readonly events: number;
  readonly censored: number;
  readonly survival: number;
  readonly se: number;
  readonly low: number;
  readonly high: number;
  readonly hazard: number;
  readonly hazardSe: number;
}

export interface KmCurve {
  readonly rows: readonly KmRow[];
  readonly n: number;
  readonly events: number;
  readonly median: number;
  readonly medianLow: number;
  readonly medianHigh: number;
  readonly q25: number;
  readonly q75: number;
}

export function checkSurvival(time: readonly number[], event: readonly number[]): void {
  if (time.length === 0) fail('noCompleteRows');
  if (time.some((t) => !(t >= 0))) fail('timeNegative');
  if (event.some((e) => e !== 0 && e !== 1)) fail('eventCode');
}

/** The distinct times in order, with the rows at risk, the events, and the censored at each. */
function riskTable(time: readonly number[], event: readonly number[]) {
  const order = time.map((_, i) => i).sort((a, b) => time[a] - time[b]);
  const out: { time: number; atRisk: number; events: number; censored: number }[] = [];
  let atRisk = time.length;
  for (let k = 0; k < order.length;) {
    const t = time[order[k]];
    let d = 0;
    let c = 0;
    while (k < order.length && time[order[k]] === t) {
      if (event[order[k]] === 1) d += 1;
      else c += 1;
      k += 1;
    }
    out.push({ time: t, atRisk, events: d, censored: c });
    atRisk -= d + c;
  }
  return out;
}

/** The first time the curve is at or below p, or NaN when it never gets there. */
export function firstAtOrBelow(rows: readonly { time: number; value: number }[], p: number): number {
  return rows.find((row) => row.value <= p + 1e-12)?.time ?? NaN;
}

export function kaplanMeier(time: readonly number[], event: readonly number[], level = 0.95): KmCurve {
  checkSurvival(time, event);
  const z = normalQuantile(1 - (1 - level) / 2);
  let s = 1;
  let green = 0;
  let h = 0;
  let hv = 0;
  const rows: KmRow[] = riskTable(time, event).map((r) => {
    if (r.events > 0) {
      s *= 1 - r.events / r.atRisk;
      green += r.atRisk > r.events ? r.events / (r.atRisk * (r.atRisk - r.events)) : Infinity;
      h += r.events / r.atRisk;
      hv += r.events / r.atRisk ** 2;
    }
    const se = s * Math.sqrt(green);
    const spread = s > 0 && s < 1 && Number.isFinite(green) ? (z * Math.sqrt(green)) / Math.abs(Math.log(s)) : NaN;
    const low = s >= 1 ? 1 : Number.isNaN(spread) ? NaN : s ** Math.exp(spread);
    const high = s >= 1 ? 1 : Number.isNaN(spread) ? NaN : s ** Math.exp(-spread);
    return { ...r, survival: s, se: s >= 1 ? 0 : se, low, high, hazard: h, hazardSe: Math.sqrt(hv) };
  });
  const at = (pick: (r: KmRow) => number) =>
    rows.filter((r) => r.events > 0).map((r) => ({ time: r.time, value: pick(r) }));
  return {
    rows,
    n: time.length,
    events: event.reduce((a, b) => a + b, 0),
    median: firstAtOrBelow(
      at((r) => r.survival),
      0.5,
    ),
    medianLow: firstAtOrBelow(
      at((r) => r.high),
      0.5,
    ),
    medianHigh: firstAtOrBelow(
      at((r) => r.low),
      0.5,
    ),
    q25: firstAtOrBelow(
      at((r) => r.survival),
      0.75,
    ),
    q75: firstAtOrBelow(
      at((r) => r.survival),
      0.25,
    ),
  };
}

export interface LogRank {
  readonly groups: readonly string[];
  readonly observed: readonly number[];
  readonly expected: readonly number[];
  readonly chi2: number;
  readonly df: number;
  readonly p: number;
}

/** O − E and its variance matrix within one stratum, with weights from the pooled curve just before each time. */
function scoreParts(time: readonly number[], event: readonly number[], g: readonly number[], k: number, peto: boolean) {
  const o = new Array<number>(k).fill(0);
  const e = new Array<number>(k).fill(0);
  const v: Matrix = Array.from({ length: k }, () => new Array<number>(k).fill(0));
  const u = new Array<number>(k).fill(0);
  let pooled = 1;
  for (const r of riskTable(time, event)) {
    if (r.events === 0) continue;
    const n = r.atRisk;
    const d = r.events;
    const ng = new Array<number>(k).fill(0);
    const dg = new Array<number>(k).fill(0);
    time.forEach((t, i) => {
      if (t >= r.time) ng[g[i]] += 1;
      if (t === r.time && event[i] === 1) dg[g[i]] += 1;
    });
    const w = peto ? pooled : 1;
    for (let a = 0; a < k; a += 1) {
      const ea = (d * ng[a]) / n;
      o[a] += dg[a];
      e[a] += ea;
      u[a] += w * (dg[a] - ea);
      if (n < 2) continue;
      for (let b = 0; b < k; b += 1)
        v[a][b] += (w * w * d * (ng[a] / n) * ((a === b ? 1 : 0) - ng[b] / n) * (n - d)) / (n - 1);
    }
    pooled *= 1 - d / n;
  }
  return { o, e, u, v };
}

/** The log-rank test of k groups (Peto-Peto when `peto`), summed over strata when given. */
export function logRank(
  time: readonly number[],
  event: readonly number[],
  group: readonly string[],
  options: { peto?: boolean; strata?: readonly string[]; groups?: readonly string[] } = {},
): LogRank {
  checkSurvival(time, event);
  const groups = options.groups ?? [...new Set(group)].sort((a, b) => a.localeCompare(b));
  const k = groups.length;
  if (k < 2) fail('oneGroup');
  const index = group.map((g) => groups.indexOf(g));
  const strata = options.strata ?? group.map(() => '');
  const total = { o: new Array<number>(k).fill(0), e: new Array<number>(k).fill(0), u: new Array<number>(k).fill(0) };
  const v: Matrix = Array.from({ length: k }, () => new Array<number>(k).fill(0));
  for (const stratum of new Set(strata)) {
    const rows = strata.map((s, i) => (s === stratum ? i : -1)).filter((i) => i >= 0);
    const part = scoreParts(
      rows.map((i) => time[i]),
      rows.map((i) => event[i]),
      rows.map((i) => index[i]),
      k,
      options.peto === true,
    );
    for (let a = 0; a < k; a += 1) {
      total.o[a] += part.o[a];
      total.e[a] += part.e[a];
      total.u[a] += part.u[a];
      for (let b = 0; b < k; b += 1) v[a][b] += part.v[a][b];
    }
  }
  const sub = v.slice(0, k - 1).map((row) => row.slice(0, k - 1));
  const inv = inverse(sub);
  if (!inv) fail('noEventsCompare');
  const uu = total.u.slice(0, k - 1);
  const chi2 = uu.reduce((s, ua, a) => s + ua * inv[a].reduce((t, x, b) => t + x * uu[b], 0), 0);
  return { groups, observed: total.o, expected: total.e, chi2, df: k - 1, p: chiSquareUpper(chi2, k - 1) };
}

export interface LifeRow {
  readonly start: number;
  readonly end: number;
  readonly entering: number;
  readonly events: number;
  readonly withdrawn: number;
  readonly effective: number;
  readonly q: number;
  readonly survival: number;
  readonly se: number;
  readonly hazard: number;
  readonly density: number;
}

/** The actuarial life table: those withdrawn in an interval count as at risk for half of it. */
export function lifeTable(time: readonly number[], event: readonly number[], width: number): LifeRow[] {
  checkSurvival(time, event);
  if (!(width > 0)) fail('widthPositive');
  const last = Math.max(...time);
  const count = Math.min(200, Math.floor(last / width) + 1);
  if (last / width > 200) fail('tooManyIntervals', '200');
  const rows: LifeRow[] = [];
  let entering = time.length;
  let s = 1;
  let green = 0;
  for (let k = 0; k < count && entering > 0; k += 1) {
    const start = k * width;
    const end = start + width;
    const inside = time.map((t, i) => (t >= start && t < end ? i : -1)).filter((i) => i >= 0);
    const d = inside.filter((i) => event[i] === 1).length;
    const c = inside.length - d;
    const eff = entering - c / 2;
    const q = eff > 0 ? d / eff : 0;
    const next = s * (1 - q);
    green += q < 1 && eff > 0 ? q / (eff * (1 - q)) : 0;
    rows.push({
      start,
      end,
      entering,
      events: d,
      withdrawn: c,
      effective: eff,
      q,
      survival: next,
      se: next * Math.sqrt(green),
      hazard: eff - d / 2 > 0 ? d / (width * (eff - d / 2)) : NaN,
      density: (s - next) / width,
    });
    s = next;
    entering -= inside.length;
  }
  return rows;
}
