// Behavior observation and single-case data. A session log of timed events and states gives counts, rates,
// durations, time budgets, bouts, latencies, and transitions. The same log can be scored by interval: partial,
// whole, or momentary (scan). Two observers' interval records give agreement. A single-case series by phase gives
// level, trend, variability, and the overlap measures PND, NAP, and Tau.
import { presenceKappa } from '../agreement/kappa';
import { lineFit, mean, median, sd } from '../kit/num';
import { lines, readNumber } from '../kit/parse';
import { fail } from '../kit/types';

const parts = (text: string): string[] => text.split(/\t|\||,/).map((part) => part.trim());

export type Kind = 'event' | 'state';

export interface Behavior {
  readonly name: string;
  readonly kind: Kind;
  /** States in the same group exclude each other: starting one ends the others. Empty for none. */
  readonly group: string;
}

/** An ethogram, one behavior a line: name | event or state | exclusive group (optional). */
export function readEthogram(text: string): Behavior[] {
  const found = lines(text);
  if (found.length === 0) fail('empty', {}, 'ethogram');
  const out: Behavior[] = [];
  for (const { line, text: one } of found) {
    const [name, kindText = 'event', group = ''] = parts(one);
    const kind = kindText.toLowerCase();
    if (!name || (kind !== 'event' && kind !== 'state')) fail('ethogramLine', { line }, 'ethogram');
    if (out.some((b) => b.name === name)) fail('sameBehavior', { name }, 'ethogram');
    out.push({ name, kind, group });
  }
  return out;
}

export interface Mark {
  readonly time: number;
  readonly name: string;
  /** For a state: true to start it, false to stop it. Events are always true. */
  readonly on: boolean;
}

/** A session log, one mark a line: time in seconds | behavior | start or stop (states only, start by default). */
export function readLog(text: string, ethogram: readonly Behavior[], session: number): Mark[] {
  const found = lines(text);
  if (found.length === 0) fail('empty', {}, 'log');
  let last = -Infinity;
  return found.map(({ line, text: one }) => {
    const [timeText, name, what = 'start'] = parts(one);
    const time = readNumber(timeText ?? '');
    if (Number.isNaN(time) || !name) fail('logLine', { line }, 'log');
    if (time < 0 || time > session) fail('logTime', { line, session }, 'log');
    if (time < last) fail('logOrder', { line }, 'log');
    last = time;
    const behavior = ethogram.find((b) => b.name === name);
    if (!behavior) fail('unknownBehavior', { name, line }, 'log');
    const word = what.toLowerCase();
    if (word !== 'start' && word !== 'stop') fail('logLine', { line }, 'log');
    return { time, name, on: behavior.kind === 'event' || word === 'start' };
  });
}

export interface Bout {
  readonly name: string;
  readonly start: number;
  readonly end: number;
}

/**
 * The bouts of each state and the times of each event. A state runs from its start to its stop, to the start of
 * another state in its group, or to the end of the session. Starting a state that is running changes nothing.
 */
export function boutsOf(
  marks: readonly Mark[],
  ethogram: readonly Behavior[],
  session: number,
): { bouts: Bout[]; events: Map<string, number[]> } {
  const running = new Map<string, number>();
  const bouts: Bout[] = [];
  const events = new Map<string, number[]>(ethogram.filter((b) => b.kind === 'event').map((b) => [b.name, []]));
  const stop = (name: string, time: number) => {
    const start = running.get(name);
    if (start === undefined) return;
    running.delete(name);
    bouts.push({ name, start, end: time });
  };
  for (const mark of marks) {
    const behavior = ethogram.find((b) => b.name === mark.name)!;
    if (behavior.kind === 'event') {
      events.get(mark.name)!.push(mark.time);
      continue;
    }
    if (!mark.on) {
      stop(mark.name, mark.time);
      continue;
    }
    if (running.has(mark.name)) continue;
    if (behavior.group !== '')
      for (const other of ethogram)
        if (other.name !== mark.name && other.group === behavior.group) stop(other.name, mark.time);
    running.set(mark.name, mark.time);
  }
  for (const name of [...running.keys()]) stop(name, session);
  bouts.sort((a, b) => a.start - b.start || a.end - b.end);
  return { bouts, events };
}

export interface BehaviorSummary {
  readonly name: string;
  readonly kind: Kind;
  /** Bouts for a state, occurrences for an event. */
  readonly count: number;
  /** Per minute. */
  readonly rate: number;
  /** Seconds; NaN for an event. */
  readonly total: number;
  readonly meanBout: number;
  /** Share of the session; NaN for an event. */
  readonly budget: number;
  /** Seconds from the start to the first occurrence; NaN when it never happens. */
  readonly latency: number;
}

export interface Session {
  readonly behaviors: readonly BehaviorSummary[];
  /** Onsets in time order, for the transitions. */
  readonly sequence: readonly string[];
  /** Rows are the behavior before, columns the one after. */
  readonly transitions: readonly (readonly number[])[];
  readonly bouts: readonly Bout[];
}

export function summarize(marks: readonly Mark[], ethogram: readonly Behavior[], session: number): Session {
  if (!(session > 0)) fail('positive', {}, 'session');
  const { bouts, events } = boutsOf(marks, ethogram, session);
  const minutes = session / 60;
  const behaviors = ethogram.map((b): BehaviorSummary => {
    if (b.kind === 'event') {
      const times = events.get(b.name)!;
      return {
        name: b.name,
        kind: b.kind,
        count: times.length,
        rate: times.length / minutes,
        total: NaN,
        meanBout: NaN,
        budget: NaN,
        latency: times.length > 0 ? times[0] : NaN,
      };
    }
    const mine = bouts.filter((one) => one.name === b.name);
    const total = mine.reduce((s, one) => s + (one.end - one.start), 0);
    return {
      name: b.name,
      kind: b.kind,
      count: mine.length,
      rate: mine.length / minutes,
      total,
      meanBout: mine.length > 0 ? total / mine.length : NaN,
      budget: total / session,
      latency: mine.length > 0 ? mine[0].start : NaN,
    };
  });
  const onsets = [
    ...bouts.map((one) => ({ time: one.start, name: one.name })),
    ...[...events].flatMap(([name, times]) => times.map((time) => ({ time, name }))),
  ].sort((a, b) => a.time - b.time);
  const sequence = onsets.map((one) => one.name);
  const names = ethogram.map((b) => b.name);
  const transitions = names.map(() => names.map(() => 0));
  for (let k = 1; k < sequence.length; k += 1)
    transitions[names.indexOf(sequence[k - 1])][names.indexOf(sequence[k])] += 1;
  return { behaviors, sequence, transitions, bouts };
}

export type IntervalRule = 'partial' | 'whole' | 'momentary';

/**
 * Each interval scored 1 or 0 for one behavior. Partial: the behavior happens at any time in the interval (an
 * event at its start counts, one at its end belongs to the next). Whole: a state lasts the whole interval.
 * Momentary: a state is running at the end of the interval, as a scan sample takes it. A state runs from its
 * start up to, not including, its end, as in partial scoring: at a change the new state is seen, the old one is
 * not. At the session's last instant a state that runs to the end is still seen.
 */
export function scoreIntervals(
  name: string,
  session: Session,
  events: readonly number[],
  length: number,
  total: number,
  rule: IntervalRule,
): number[] {
  if (!(length > 0)) fail('positive', {}, 'interval');
  const count = Math.floor(total / length + 1e-9);
  if (count < 1) fail('intervalLong', {}, 'interval');
  const mine = session.bouts.filter((one) => one.name === name);
  return Array.from({ length: count }, (_, i) => {
    const a = i * length;
    const b = a + length;
    if (rule === 'partial')
      return mine.some((one) => one.start < b && one.end > a) || events.some((t) => t >= a && t < b) ? 1 : 0;
    if (rule === 'whole') return mine.some((one) => one.start <= a && one.end >= b) ? 1 : 0;
    const last = b >= total - 1e-9;
    return mine.some((one) => one.start <= b && (one.end > b || (last && one.end >= b))) ? 1 : 0;
  });
}

export interface ObserverAgreement {
  readonly intervals: number;
  /** Intervals scored alike over all intervals. */
  readonly total: number;
  /** Over intervals where either scored the behavior; NaN when neither did. */
  readonly occurrence: number;
  /** Over intervals where either did not score it; NaN when both always did. */
  readonly nonoccurrence: number;
  readonly kappa: number;
}

/** A record of 1s and 0s. Spaces and commas between them are ignored. */
export function readRecord(text: string, field: string): number[] {
  const clean = text.replace(/[\s,;|]+/g, '');
  if (clean === '') fail('empty', {}, field);
  if (!/^[01]+$/.test(clean)) fail('record', {}, field);
  return [...clean].map(Number);
}

export function observers(first: readonly number[], second: readonly number[]): ObserverAgreement {
  if (first.length !== second.length) fail('sameIntervals', { a: first.length, b: second.length }, 'second');
  const n = first.length;
  const same = first.filter((v, i) => v === second[i]).length;
  const either = first.filter((v, i) => v === 1 || second[i] === 1).length;
  const both = first.filter((v, i) => v === 1 && second[i] === 1).length;
  const eitherNot = first.filter((v, i) => v === 0 || second[i] === 0).length;
  const neither = first.filter((v, i) => v === 0 && second[i] === 0).length;
  const k = presenceKappa(
    first.map((v) => v === 1),
    second.map((v) => v === 1),
  );
  return {
    intervals: n,
    total: same / n,
    occurrence: either === 0 ? NaN : both / either,
    nonoccurrence: eitherNot === 0 ? NaN : neither / eitherNot,
    kappa: k.kappa,
  };
}

export interface Phase {
  readonly name: string;
  readonly values: readonly number[];
  /** Session numbers, counting on from the phase before. */
  readonly sessions: readonly number[];
}

/** Phases in order, one a line: name | values separated by spaces or commas. */
export function readPhases(text: string): Phase[] {
  const found = lines(text);
  if (found.length < 2) fail('fewPhases', {}, 'phases');
  let next = 1;
  return found.map(({ line, text: one }) => {
    const at = one.search(/[|:\t]/);
    if (at < 1) fail('phaseLine', { line }, 'phases');
    const name = one.slice(0, at).trim();
    const values = one
      .slice(at + 1)
      .split(/[\s,;]+/)
      .filter((cell) => cell !== '')
      .map((cell) => {
        const value = readNumber(cell);
        if (Number.isNaN(value)) fail('badCell', { cell, line }, 'phases');
        return value;
      });
    if (values.length === 0) fail('phaseLine', { line }, 'phases');
    const sessions = values.map((_, i) => next + i);
    next += values.length;
    return { name, values, sessions };
  });
}

export interface PhaseSummary {
  readonly n: number;
  readonly mean: number;
  readonly median: number;
  /** Sample SD; NaN for 1 point. */
  readonly sd: number;
  readonly min: number;
  readonly max: number;
  /** Least-squares slope per session; NaN for 1 point. */
  readonly slope: number;
  readonly intercept: number;
  /** The split-middle line: through the medians of each half (the middle point is left out when n is odd). */
  readonly splitSlope: number;
  readonly splitIntercept: number;
}

export function phaseSummary(phase: Phase): PhaseSummary {
  const { values, sessions } = phase;
  const n = values.length;
  const fit = n >= 2 ? lineFit(sessions, values) : { slope: NaN, intercept: NaN };
  let splitSlope = NaN;
  let splitIntercept = NaN;
  if (n >= 2) {
    const half = Math.floor(n / 2);
    const x1 = median(sessions.slice(0, half));
    const y1 = median(values.slice(0, half));
    const x2 = median(sessions.slice(n - half));
    const y2 = median(values.slice(n - half));
    splitSlope = (y2 - y1) / (x2 - x1);
    splitIntercept = y1 - splitSlope * x1;
  }
  return {
    n,
    mean: mean(values),
    median: median(values),
    sd: n >= 2 ? sd(values) : NaN,
    min: Math.min(...values),
    max: Math.max(...values),
    slope: fit.slope,
    intercept: fit.intercept,
    splitSlope,
    splitIntercept,
  };
}

export interface Overlap {
  /** Share of B points beyond the most extreme A point in the wanted direction. */
  readonly pnd: number;
  readonly beyond: number;
  /** (B-better pairs + half the ties) / (nA nB). */
  readonly nap: number;
  /** (B-better pairs - A-better pairs) / (nA nB). */
  readonly tau: number;
  readonly better: number;
  readonly worse: number;
  readonly ties: number;
  readonly pairs: number;
}

/** The overlap of a baseline A and an intervention B, for a behavior meant to increase or decrease. */
export function overlap(a: readonly number[], b: readonly number[], increase: boolean): Overlap {
  if (a.length === 0 || b.length === 0) fail('empty', {}, 'phases');
  const sign = increase ? 1 : -1;
  const edge = increase ? Math.max(...a) : Math.min(...a);
  const beyond = b.filter((y) => sign * (y - edge) > 0).length;
  let better = 0;
  let worse = 0;
  let ties = 0;
  for (const y of b)
    for (const x of a) {
      const d = sign * (y - x);
      if (d > 0) better += 1;
      else if (d < 0) worse += 1;
      else ties += 1;
    }
  const pairs = a.length * b.length;
  return {
    pnd: beyond / b.length,
    beyond,
    nap: (better + 0.5 * ties) / pairs,
    tau: (better - worse) / pairs,
    better,
    worse,
    ties,
    pairs,
  };
}
