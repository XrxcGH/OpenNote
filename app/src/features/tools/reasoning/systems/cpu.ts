// Processors. CPU scheduling (FCFS, SJF, SRTF, round robin, priority with and without preemption, and a 3-level
// feedback queue) gives a schedule and per-process times. Real-time tests cover the rate-monotonic bound, response
// times, and EDF. A 5-stage pipeline shows stalls with and without forwarding, and branch predictors count hits.
// Amdahl, Gustafson, CPI, and MIPS round it out.
import { fail, lines } from '../core/util';

export interface Proc {
  name: string;
  arrival: number;
  burst: number;
  priority: number;
}

/** Lines `name arrival burst [priority]`. */
export function parseProcs(text: string): Proc[] {
  const out = lines(text).map((l) => {
    const w = l.split(/[\s,]+/).filter(Boolean);
    const nums = w.slice(1).map(Number);
    if (w.length < 3 || w.length > 4 || nums.some((x) => !Number.isFinite(x) || x < 0)) fail('procLine', { line: l });
    if (!(nums[1] > 0)) fail('procLine', { line: l });
    return { name: w[0], arrival: nums[0], burst: nums[1], priority: nums[2] ?? 0 };
  });
  if (!out.length) fail('noProcs');
  if (out.length > 100) fail('tooManyProcs', { max: 100 });
  return out;
}

export const SCHEDULERS = ['fcfs', 'sjf', 'srtf', 'rr', 'priority', 'ppriority', 'mlfq'] as const;
export type Scheduler = (typeof SCHEDULERS)[number];

export interface Slice {
  name: string;
  start: number;
  end: number;
}

export interface ProcTimes {
  name: string;
  completion: number;
  turnaround: number;
  waiting: number;
  response: number;
}

export function schedule(
  procs: readonly Proc[],
  algo: Scheduler,
  quantum = 4,
): { slices: Slice[]; times: ProcTimes[] } {
  if ((algo === 'rr' || algo === 'mlfq') && !(quantum > 0)) fail('quantum');
  const left = new Map(procs.map((p) => [p.name, p.burst]));
  const first = new Map<string, number>();
  const done = new Map<string, number>();
  const level = new Map(procs.map((p) => [p.name, 0]));
  const slices: Slice[] = [];
  const order = new Map(procs.map((p, i) => [p.name, i]));
  const queue: string[] = [];
  const queued = new Set<string>();
  let t = 0;
  let current: string | null = null;
  let sliceUsed = 0;
  const arrivals = [...procs].sort((a, b) => a.arrival - b.arrival || order.get(a.name)! - order.get(b.name)!);
  let next = 0;
  const admit = (until: number) => {
    while (next < arrivals.length && arrivals[next].arrival <= until + 1e-12) {
      queue.push(arrivals[next].name);
      queued.add(arrivals[next].name);
      next += 1;
    }
  };
  const byName = new Map(procs.map((p) => [p.name, p]));
  const pick = (): string | null => {
    if (!queue.length) return null;
    const key = (n: string): number[] => {
      const p = byName.get(n)!;
      if (algo === 'sjf') return [p.burst];
      if (algo === 'srtf') return [left.get(n)!];
      if (algo === 'priority' || algo === 'ppriority') return [p.priority];
      if (algo === 'mlfq') return [level.get(n)!];
      return [];
    };
    let best = 0;
    for (let i = 1; i < queue.length; i += 1) {
      const a = key(queue[i]);
      const b = key(queue[best]);
      if (a.length && a[0] < b[0] - 1e-12) best = i;
    }
    const [n] = queue.splice(best, 1);
    queued.delete(n);
    return n;
  };
  const preemptive = algo === 'srtf' || algo === 'ppriority' || algo === 'mlfq';
  const sliceOf = (n: string) =>
    algo === 'rr'
      ? quantum
      : algo === 'mlfq'
        ? level.get(n)! >= 2
          ? Infinity
          : quantum * 2 ** level.get(n)!
        : Infinity;
  for (let guard = 0; done.size < procs.length; guard += 1) {
    if (guard > 100_000) fail('scheduleLong');
    admit(t);
    if (current === null) {
      current = pick();
      sliceUsed = 0;
      if (current === null) {
        t = arrivals[next].arrival;
        continue;
      }
      if (!first.has(current)) first.set(current, t);
    }
    const n = current;
    const rem = left.get(n)!;
    const room = sliceOf(n) - sliceUsed;
    const nextArrival = next < arrivals.length ? arrivals[next].arrival : Infinity;
    let run = Math.min(rem, room);
    if (preemptive && nextArrival < t + run) run = nextArrival - t;
    const last = slices[slices.length - 1];
    if (last && last.name === n && Math.abs(last.end - t) < 1e-12) last.end = t + run;
    else slices.push({ name: n, start: t, end: t + run });
    t += run;
    sliceUsed += run;
    left.set(n, rem - run);
    admit(t);
    if (left.get(n)! <= 1e-12) {
      done.set(n, t);
      current = null;
      continue;
    }
    if (sliceUsed >= sliceOf(n) - 1e-12) {
      if (algo === 'mlfq') level.set(n, Math.min(2, level.get(n)! + 1));
      queue.push(n);
      queued.add(n);
      current = null;
      continue;
    }
    if (preemptive) {
      const better = queue.some((m) => {
        const p = byName.get(m)!;
        if (algo === 'srtf') return left.get(m)! < left.get(n)! - 1e-12;
        if (algo === 'ppriority') return p.priority < byName.get(n)!.priority;
        return level.get(m)! < level.get(n)!;
      });
      if (better) {
        queue.push(n);
        queued.add(n);
        current = null;
      }
    }
  }
  const times = procs.map((p) => {
    const completion = done.get(p.name)!;
    const turnaround = completion - p.arrival;
    return {
      name: p.name,
      completion,
      turnaround,
      waiting: turnaround - p.burst,
      response: first.get(p.name)! - p.arrival,
    };
  });
  return { slices, times };
}

/* ---------- Real-time ---------- */

export interface Task {
  c: number;
  t: number;
  d: number;
}

export function parseTasks(text: string): Task[] {
  const out = lines(text).map((l) => {
    const n = l
      .split(/[\s,]+/)
      .filter(Boolean)
      .map(Number);
    if (n.length < 2 || n.length > 3 || n.some((x) => !(x > 0))) fail('taskLine', { line: l });
    return { c: n[0], t: n[1], d: n[2] ?? n[1] };
  });
  if (!out.length) fail('noTasks');
  return out;
}

export const rmBound = (n: number): number => n * (2 ** (1 / n) - 1);

/** Response times under rate-monotonic priorities (shorter period first): null when one passes its deadline. */
export function responseTimes(tasks: readonly Task[]): { order: number[]; r: (number | null)[] } {
  const order = tasks.map((_, i) => i).sort((a, b) => tasks[a].t - tasks[b].t || a - b);
  const r: (number | null)[] = new Array(tasks.length).fill(null);
  order.forEach((i, rank) => {
    const higher = order.slice(0, rank);
    let x = tasks[i].c;
    for (let it = 0; it < 10_000; it += 1) {
      const next = tasks[i].c + higher.reduce((a, j) => a + Math.ceil(x / tasks[j].t - 1e-12) * tasks[j].c, 0);
      if (next > tasks[i].d + 1e-12) {
        x = Infinity;
        break;
      }
      if (Math.abs(next - x) < 1e-12) break;
      x = next;
    }
    r[i] = Number.isFinite(x) ? x : null;
  });
  return { order, r };
}

/* ---------- Pipeline ---------- */

export interface Instr {
  text: string;
  op: string;
  dest: string | null;
  reads: string[];
  /** A register a store needs at the memory stage, not the execute stage. */
  storeData: string | null;
  load: boolean;
}

const REG = /^(\$?[a-z]+\d*|x\d+|r\d+)$/i;

export function parseProgram(text: string): Instr[] {
  const out = lines(text).map((raw) => {
    const l = raw.replace(/^\w+:\s*/, '').trim();
    const [op, ...rest] = l.split(/\s+/);
    const args = rest
      .join(' ')
      .split(/\s*,\s*/)
      .filter(Boolean);
    const o = op.toLowerCase();
    const mem = (a: string) => /\((.+)\)/.exec(a)?.[1] ?? fail('instrLine', { line: raw });
    if (o === 'nop') return { text: raw, op: o, dest: null, reads: [], storeData: null, load: false };
    if (o === 'lw' || o === 'ld' || o === 'lb' || o === 'lh')
      return { text: raw, op: o, dest: args[0], reads: [mem(args[1] ?? '')], storeData: null, load: true };
    if (o === 'sw' || o === 'sd' || o === 'sb' || o === 'sh')
      return { text: raw, op: o, dest: null, reads: [mem(args[1] ?? '')], storeData: args[0], load: false };
    if (/^b/.test(o))
      return {
        text: raw,
        op: o,
        dest: null,
        reads: args.slice(0, 2).filter((a) => REG.test(a)),
        storeData: null,
        load: false,
      };
    if (o === 'j' || o === 'jal') return { text: raw, op: o, dest: null, reads: [], storeData: null, load: false };
    if (args.length < 2) fail('instrLine', { line: raw });
    return {
      text: raw,
      op: o,
      dest: args[0],
      reads: args.slice(1).filter((a) => REG.test(a)),
      storeData: null,
      load: false,
    };
  });
  if (!out.length) fail('noProgram');
  if (out.length > 60) fail('programLong', { max: 60 });
  return out;
}

const isZero = (r: string) => /^(\$?zero|\$0|r0|x0)$/i.test(r);

export interface Staged {
  instr: Instr;
  /** The cycle it enters fetch; it may wait there while the instruction ahead is stalled. */
  enter: number;
  fetch: number;
  decode: number;
  stalls: number;
  /** For each stall, the earlier instruction it waits on. */
  waitsOn: number | null;
}

/** Cycle numbers from 1: fetch, then decode (held while stalled), then execute, memory, and write back in turn. */
export function pipeline(
  program: readonly Instr[],
  forwarding: boolean,
): { staged: Staged[]; cycles: number; stalls: number } {
  const staged: Staged[] = [];
  program.forEach((ins, i) => {
    const enter = i === 0 ? 1 : staged[i - 1].fetch + 1;
    const fetch = i === 0 ? 1 : Math.max(staged[i - 1].fetch + 1, staged[i - 1].decode);
    let decode = Math.max(fetch + 1, i === 0 ? 2 : staged[i - 1].decode + 1);
    const base = decode;
    let waitsOn: number | null = null;
    for (let j = 0; j < i; j += 1) {
      const p = staged[j];
      const d = p.instr.dest;
      if (!d || isZero(d)) continue;
      // The latest producer wins: skip it if a later one writes the same register first.
      if (staged.slice(j + 1, i).some((q) => q.instr.dest === d)) continue;
      const ex = p.decode + 1;
      const mem = ex + 1;
      const wb = mem + 1;
      const need = (reg: string, atMem: boolean) => {
        if (reg !== d) return;
        let earliest: number;
        if (!forwarding) earliest = wb;
        else if (atMem) earliest = (p.instr.load ? mem : ex) + 1 - 2;
        else earliest = p.instr.load ? mem : ex;
        if (earliest > decode) {
          decode = earliest;
          waitsOn = j;
        }
      };
      ins.reads.forEach((r) => need(r, false));
      if (ins.storeData) need(ins.storeData, forwarding);
    }
    staged.push({ instr: ins, enter, fetch, decode, stalls: decode - base, waitsOn });
  });
  const last = staged[staged.length - 1];
  const cycles = last.decode + 3;
  return { staged, cycles, stalls: cycles - (program.length + 4) };
}

/* ---------- Branch prediction ---------- */

export function predict(outcomes: readonly boolean[], bits: 1 | 2, start = 0) {
  let state = bits === 1 ? Math.min(1, start) : Math.min(3, start);
  const rows = outcomes.map((taken) => {
    const guess = bits === 1 ? state === 1 : state >= 2;
    const before = state;
    if (bits === 1) state = taken ? 1 : 0;
    else state = taken ? Math.min(3, state + 1) : Math.max(0, state - 1);
    return { taken, guess, before, right: guess === taken };
  });
  return { rows, misses: rows.filter((r) => !r.right).length };
}

/* ---------- Performance ---------- */

export const amdahl = (p: number, n: number): number => 1 / (1 - p + p / n);
export const gustafson = (p: number, n: number): number => 1 - p + p * n;

/** CPI from an instruction mix of (share or count, cycles) pairs. */
export function cpiOf(mix: readonly [number, number][]): number {
  const total = mix.reduce((a, [w]) => a + w, 0);
  if (!(total > 0)) fail('mix');
  return mix.reduce((a, [w, c]) => a + (w / total) * c, 0);
}
