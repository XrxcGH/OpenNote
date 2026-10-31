// The computer systems tool's memory, processor, and deadlock modes as forms. Networks, clocks, relational design,
// and digests are in formsNet.ts.
import { ganttFigure } from '../core/charts';
import { graphFigure } from '../core/graphFigure';
import { fail, lines, num } from '../core/util';
import type { Mode, Outcome, Table, ToolSpec, Values } from '../ui/types';
import { f, list, one, pick, qty, s, solveWith, whole, yes } from './common';
import {
  SCHEDULERS,
  amdahl,
  cpiOf,
  gustafson,
  parseProcs,
  parseProgram,
  parseTasks,
  pipeline,
  predict,
  responseTimes,
  rmBound,
  schedule,
} from './cpu';
import { parseMatrix, parseVector, ragCycle, request, safety } from './deadlock';
import { ALGEBRA, ARQ, CLOCKS, DELAYS, FDS, HASH, IPV6, ROUTING, SUBNET, THROUGHPUT, VLSM } from './formsNet';
import { amat, cacheShape, parseAccesses, replacePages, simulateCache, translate } from './memory';
import type { PageAlgo, Replace } from './memory';

const hex = (x: number) => `0x${x.toString(16).toUpperCase()}`;
const PAGE_ALGOS: readonly PageAlgo[] = ['fifo', 'lru', 'opt', 'clock'];

/* ---------- Memory ---------- */

function cacheOutcome(v: Values): Outcome {
  const bytes = qty(v, 'cacheSize', 'size', 8) / 8;
  const line = qty(v, 'lineSize', 'size', 8) / 8;
  const ways = whole(v, 'ways');
  const shape = cacheShape(bytes, line, ways, whole(v, 'addressBits', 1));
  const replace = pick<Replace>(v, 'replace', ['lru', 'fifo', 'random']);
  const writeBack = pick(v, 'write', ['back', 'through']) === 'back';
  const r = simulateCache(
    shape,
    parseAccesses(v.trace ?? ''),
    replace,
    writeBack,
    replace === 'random' ? whole(v, 'seed') : 1,
  );
  const n = r.rows.length;
  const rate = r.hits / n;
  return {
    ok: true,
    answer: s('cacheAnswer', { hits: r.hits, misses: r.misses, rate: num(rate * 100, 4) }),
    latex: `\\text{tag} = ${whole(v, 'addressBits', 1)} - ${shape.index} - ${shape.offset} = ${shape.tag}`,
    note: s(writeBack ? 'writeBackNote' : 'writeThroughNote', { writes: r.memoryWrites }),
    steps: [
      s('steps.cacheLines', { bytes, line, lines: shape.lines }),
      s('steps.cacheSets', { lines: shape.lines, ways: shape.ways, sets: shape.sets }),
      s('steps.cacheOffset', { line, offset: shape.offset }),
      s('steps.cacheIndex', { sets: shape.sets, index: shape.index }),
      s('steps.cacheTag', {
        bits: whole(v, 'addressBits', 1),
        index: shape.index,
        offset: shape.offset,
        tag: shape.tag,
      }),
      s('steps.cacheSplit'),
    ],
    tables: [
      {
        caption: s('table.trace'),
        header: [
          s('table.address'),
          s('table.tag'),
          s('table.set'),
          s('table.offset'),
          s('table.result'),
          s('table.evicted'),
        ],
        rows: r.rows.map((x) => [
          hex(x.address),
          hex(x.tag),
          String(x.set),
          String(x.offset),
          s(x.hit ? 'hit' : 'miss'),
          x.evicted === null ? '' : `${hex(x.evicted)}${x.writeBack ? ` (${s('written')})` : ''}`,
        ]),
      },
    ],
  };
}

function amatOutcome(v: Values): Outcome {
  const levels = lines(v.levels ?? '').map((l) => {
    const words = l.split(/[\s,]+/).filter(Boolean);
    const percent = words[1]?.endsWith('%') ?? false;
    const n = words.map((w) => Number(w.replace(/%$/, '')));
    if (n.length !== 2 || n.some((x) => !Number.isFinite(x))) fail('levelLine', { line: l });
    return { hit: n[0], missRate: percent || n[1] > 1 ? n[1] / 100 : n[1] };
  });
  const memory = one(v, 'memory');
  const r = amat(levels, memory);
  const tex = levels.reduceRight((inner, l) => `${num(l.hit)} + ${num(l.missRate)} \\times (${inner})`, num(memory));
  return {
    ok: true,
    answer: s('amatAnswer', { t: num(r.total, 6) }),
    latex: `\\text{AMAT} = ${tex} = ${num(r.total, 6)}`,
    steps: levels
      .map((l, i) =>
        s('steps.amatLevel', {
          level: i + 1,
          hit: num(l.hit),
          rate: num(l.missRate),
          next: num(i + 1 < levels.length ? r.parts[i + 1] : memory, 6),
          t: num(r.parts[i], 6),
        }),
      )
      .reverse(),
  };
}

function pageOutcome(v: Values): Outcome {
  const refs = list(v, 'refs');
  if (refs.some((x) => !Number.isInteger(x))) fail('numberList', { field: s('fields.refs') });
  const frames = whole(v, 'frames', 1);
  const algo = pick(v, 'pageAlgo', PAGE_ALGOS);
  const run = replacePages(refs, frames, algo);
  const counts = [frames, frames + 1].map((k) => PAGE_ALGOS.map((a) => replacePages(refs, k, a).faults));
  const anomaly = Array.from(
    { length: Math.min(64, frames + 3) },
    (_, k) => replacePages(refs, k + 1, 'fifo').faults,
  ).findIndex((x, k, all) => k > 0 && x > all[k - 1]);
  return {
    ok: true,
    answer: s('pageAnswer', { faults: run.faults, refs: refs.length, rate: num((run.faults / refs.length) * 100, 4) }),
    note: anomaly > 0 ? s('belady', { a: anomaly, b: anomaly + 1 }) : undefined,
    steps: [s(`steps.page_${algo}`)],
    tables: [
      {
        caption: s('table.frames'),
        header: [
          s('table.ref'),
          ...Array.from({ length: frames }, (_, i) => s('table.frame', { n: i + 1 })),
          s('table.result'),
          s('table.out'),
        ],
        rows: run.rows.map((x) => [
          String(x.page),
          ...x.frames.map((q) => (q === null ? '' : String(q))),
          s(x.fault ? 'fault' : 'hit'),
          x.out === null ? '' : String(x.out),
        ]),
      },
      {
        caption: s('table.compare'),
        header: [s('table.frameCount'), ...PAGE_ALGOS.map((a) => s(`options.pageAlgo.${a}`))],
        rows: counts.map((c, k) => [String(frames + k), ...c.map(String)]),
      },
    ],
  };
}

function translateOutcome(v: Values): Outcome {
  const pageSize = qty(v, 'pageSize', 'size', 8) / 8;
  const table = new Map<number, number | null>();
  for (const l of lines(v.pageTable ?? '')) {
    const m = /^(\d+)\s*[\s:,=]\s*(\d+|-)$/.exec(l);
    if (!m) fail('pageLine', { line: l });
    table.set(Number(m![1]), m![2] === '-' ? null : Number(m![2]));
  }
  const addresses = parseAccesses(v.addresses ?? '').map((a) => a.address);
  const r = translate(pageSize, table, whole(v, 'tlb'), addresses);
  const hits = r.filter((x) => x.tlbHit).length;
  const faults = r.filter((x) => x.physical === null).length;
  return {
    ok: true,
    answer: s('translateAnswer', { hits, count: r.length, faults }),
    steps: [s('steps.translate', { size: pageSize, bits: Math.log2(pageSize) })],
    tables: [
      {
        caption: s('table.translation'),
        header: [
          s('table.virtual'),
          s('table.page'),
          s('table.offset'),
          s('table.tlb'),
          s('table.frameNo'),
          s('table.physical'),
        ],
        rows: r.map((x) => [
          hex(x.virtual),
          String(x.page),
          String(x.offset),
          s(x.tlbHit ? 'hit' : 'miss'),
          x.frame === null ? s('notPresent') : String(x.frame),
          x.physical === null ? s('pageFault') : hex(x.physical),
        ]),
      },
    ],
  };
}

/* ---------- Processors ---------- */

function scheduleOutcome(v: Values): Outcome {
  const procs = parseProcs(v.procs ?? '');
  if (new Set(procs.map((p) => p.name)).size !== procs.length) fail('procNames');
  const algo = pick(v, 'scheduler', SCHEDULERS);
  const quantum = algo === 'rr' || algo === 'mlfq' ? one(v, 'quantum') : 4;
  const r = schedule(procs, algo, quantum);
  const avg = (k: 'waiting' | 'turnaround' | 'response') => r.times.reduce((a, x) => a + x[k], 0) / r.times.length;
  return {
    ok: true,
    answer: s('scheduleAnswer', {
      waiting: num(avg('waiting'), 6),
      turnaround: num(avg('turnaround'), 6),
      response: num(avg('response'), 6),
    }),
    steps: [s(`steps.sched_${algo}`, { q: num(quantum) }), s('steps.schedTimes')],
    tables: [
      {
        caption: s('table.times'),
        header: [
          s('table.process'),
          s('table.arrival'),
          s('table.burst'),
          s('table.completion'),
          s('table.turnaround'),
          s('table.waiting'),
          s('table.response'),
        ],
        rows: r.times.map((x, i) => [
          x.name,
          num(procs[i].arrival),
          num(procs[i].burst),
          num(x.completion),
          num(x.turnaround),
          num(x.waiting),
          num(x.response),
        ]),
      },
      {
        caption: s('table.slices'),
        header: [s('table.process'), s('table.start'), s('table.end')],
        rows: r.slices.map((x) => [x.name, num(x.start), num(x.end)]),
      },
    ],
    figure: {
      svg: ganttFigure(r.slices.map((x) => ({ row: x.name, start: x.start, end: x.end, tone: 'accent' as const }))),
      alt: s('ganttAlt', { slices: r.slices.map((x) => `${x.name} ${num(x.start)}–${num(x.end)}`).join(', ') }),
    },
  };
}

function realtimeOutcome(v: Values): Outcome {
  const tasks = parseTasks(v.tasks ?? '');
  const n = tasks.length;
  const u = tasks.reduce((a, x) => a + x.c / x.t, 0);
  const density = tasks.reduce((a, x) => a + x.c / Math.min(x.d, x.t), 0);
  const bound = rmBound(n);
  const rta = responseTimes(tasks);
  const implicit = tasks.every((x) => x.d === x.t);
  const rmOk = rta.r.every((x) => x !== null);
  const edfOk = implicit ? u <= 1 + 1e-12 : density <= 1 + 1e-12;
  return {
    ok: true,
    answer: s('rtAnswer', { u: num(u, 4), bound: num(bound, 4), rm: yes(rmOk), edf: yes(edfOk) }),
    latex: `U = \\sum \\frac{C_i}{T_i} = ${num(u, 6)},\\quad n(2^{1/n} - 1) = ${num(bound, 6)}`,
    note: u > 1 + 1e-12 ? s('overloaded') : implicit ? undefined : s('densityNote', { d: num(density, 4) }),
    steps: [
      s('steps.rtU', { u: num(u, 6) }),
      s(u <= bound + 1e-12 ? 'steps.rtBoundPass' : 'steps.rtBoundUnsure', { n, bound: num(bound, 6) }),
      s('steps.rtResponse'),
      s(implicit ? 'steps.edfImplicit' : 'steps.edfDensity'),
    ],
    tables: [
      {
        caption: s('table.tasks'),
        header: [
          s('table.task'),
          s('table.c'),
          s('table.t'),
          s('table.d'),
          s('table.priority'),
          s('table.r'),
          s('table.meets'),
        ],
        rows: tasks.map((x, i) => [
          String(i + 1),
          num(x.c),
          num(x.t),
          num(x.d),
          String(rta.order.indexOf(i) + 1),
          rta.r[i] === null ? s('missed') : num(rta.r[i]!),
          yes(rta.r[i] !== null),
        ]),
      },
    ],
  };
}

function pipelineOutcome(v: Values): Outcome {
  const prog = parseProgram(v.program ?? '');
  const fwd = pick(v, 'forwarding', ['on', 'off']) === 'on';
  const r = pipeline(prog, fwd);
  const width = Math.min(r.cycles, 80);
  const cells = r.staged.map((x) => {
    const row = new Array<string>(width).fill('');
    const put = (c: number, text: string) => c >= 1 && c <= width && (row[c - 1] = text);
    for (let c = x.enter; c <= x.fetch; c += 1) put(c, s('stage.if'));
    for (let c = x.fetch + 1; c < x.decode; c += 1) put(c, s('stage.stall'));
    put(x.decode, s('stage.id'));
    put(x.decode + 1, s('stage.ex'));
    put(x.decode + 2, s('stage.mem'));
    put(x.decode + 3, s('stage.wb'));
    return row;
  });
  const waits = r.staged
    .map((x) =>
      x.stalls > 0 && x.waitsOn !== null
        ? s('steps.stall', {
            instr: x.instr.text,
            n: x.stalls,
            on: prog[x.waitsOn].text,
            load: prog[x.waitsOn].load ? s('loadUse') : '',
          })
        : '',
    )
    .filter(Boolean);
  const cpi = r.cycles / prog.length;
  return {
    ok: true,
    answer: s('pipeAnswer', {
      cycles: r.cycles,
      stalls: r.stalls,
      cpi: num((prog.length + r.stalls) / prog.length, 4),
    }),
    latex: `\\text{cycles} = ${prog.length} + 4 + ${r.stalls} = ${r.cycles}`,
    note: s('pipeNote', { total: num(cpi, 4) }),
    steps: [s(fwd ? 'steps.pipeForward' : 'steps.pipeNoForward'), ...(waits.length ? waits : [s('steps.noStalls')])],
    tables: [
      {
        caption: s('table.cycles'),
        header: [s('table.instruction'), ...Array.from({ length: width }, (_, i) => String(i + 1))],
        rows: r.staged.map((x, i) => [x.instr.text, ...cells[i]]),
      },
    ],
  };
}

function branchOutcome(v: Values): Outcome {
  const outs = (v.outcomes ?? '').split(/[\s,]+/).filter(Boolean);
  if (!outs.length || outs.some((o) => !/^(t|n|1|0|taken|not)$/i.test(o))) fail('outcomes');
  const taken = outs.map((o) => /^(t|1|taken)$/i.test(o));
  const bits = pick(v, 'bits', ['2', '1']) === '1' ? 1 : 2;
  const start = whole(v, 'start');
  if (start > (bits === 1 ? 1 : 3)) fail('startState', { max: bits === 1 ? 1 : 3 });
  const r = predict(taken, bits, start);
  return {
    ok: true,
    answer: s('branchAnswer', {
      misses: r.misses,
      count: taken.length,
      rate: num(((taken.length - r.misses) / taken.length) * 100, 4),
    }),
    steps: [s(bits === 1 ? 'steps.bit1' : 'steps.bit2')],
    tables: [
      {
        caption: s('table.predictions'),
        header: [s('table.branch'), s('table.state'), s('table.guess'), s('table.actual'), s('table.right')],
        rows: r.rows.map((x, i) => [
          String(i + 1),
          String(x.before),
          s(x.guess ? 'taken' : 'notTaken'),
          s(x.taken ? 'taken' : 'notTaken'),
          yes(x.right),
        ]),
      },
    ],
  };
}

function performanceOutcome(v: Values): Outcome {
  const kind = pick(v, 'perf', ['amdahl', 'gustafson', 'cpi']);
  if (kind === 'cpi') {
    const mix = lines(v.mix ?? '').map((l) => {
      const n = l.split(/[\s,]+/).filter(Boolean);
      // A share may carry a %; shares are normalized, so 50% and 50 weigh the same.
      const w = Number(n[n.length - 2]?.replace(/%$/, ''));
      const c = Number(n[n.length - 1]);
      if (n.length < 2 || !(w >= 0) || !(c > 0)) fail('mixLine', { line: l });
      return [w, c] as [number, number];
    });
    const cpi = cpiOf(mix);
    const mhz = one(v, 'clock');
    const count = one(v, 'instructions');
    if (!(mhz > 0) || !(count > 0)) fail('positive');
    const seconds = (count * cpi) / (mhz * 1e6);
    return {
      ok: true,
      answer: s('cpiAnswer', { cpi: num(cpi, 6), mips: num(mhz / cpi, 6), time: num(seconds * 1e3, 6) }),
      latex:
        `\\text{CPI} = \\sum f_i c_i = ${num(cpi, 6)},\\quad ` +
        `\\text{MIPS} = \\frac{${num(mhz)}}{${num(cpi, 6)}} = ${num(mhz / cpi, 6)}`,
      steps: [s('steps.cpi'), s('steps.mips'), s('steps.cpuTime')],
    };
  }
  const p = one(v, 'parallel');
  if (!(p >= 0 && p <= 1)) fail('fraction', { field: s('fields.parallel') });
  const n = one(v, 'processors');
  if (!(n >= 1)) fail('processorsField');
  const fn = kind === 'amdahl' ? amdahl : gustafson;
  const sp = fn(p, n);
  const ns = [1, 2, 4, 8, 16, 32, 64, 128, 1024];
  return {
    ok: true,
    answer: s(`${kind}Answer`, { s: num(sp, 6), e: num((sp / n) * 100, 4) }),
    latex:
      kind === 'amdahl'
        ? `S = \\frac{1}{(1 - ${num(p)}) + \\frac{${num(p)}}{${num(n)}}} = ${num(sp, 6)}`
        : `S = (1 - ${num(p)}) + ${num(p)} \\times ${num(n)} = ${num(sp, 6)}`,
    note: kind === 'amdahl' ? s('amdahlLimit', { limit: p < 1 ? num(1 / (1 - p), 6) : '∞' }) : undefined,
    steps: [s(`steps.${kind}`)],
    tables: [
      {
        caption: s('table.speedups'),
        header: [s('table.n'), s('table.speedup'), s('table.efficiency')],
        rows: ns.map((k) => [String(k), num(fn(p, k), 6), `${num((fn(p, k) / k) * 100, 4)}%`]),
      },
    ],
  };
}

/* ---------- Deadlock ---------- */

const vec = (x: readonly number[]) => `(${x.join(', ')})`;

function bankerOutcome(v: Values): Outcome {
  const b = {
    alloc: parseMatrix(v.alloc ?? '', s('fields.alloc')),
    max: parseMatrix(v.max ?? '', s('fields.max')),
    available: parseVector(v.available ?? '', s('fields.available')),
  };
  const r = safety(b);
  const name = (i: number) => `P${i}`;
  const tables: Table[] = [
    {
      caption: s('table.state'),
      header: [s('table.process'), s('table.alloc'), s('table.max'), s('table.need')],
      rows: b.alloc.map((row, i) => [name(i), vec(row), vec(b.max[i]), vec(r.need[i])]),
    },
  ];
  const steps = [
    s('steps.need'),
    ...r.steps.map((x) => s('steps.bankerRun', { p: name(x.p), need: vec(r.need[x.p]), work: vec(x.work) })),
  ];
  let answer = r.safe
    ? s('safe', { order: r.order.map(name).join(', ') })
    : s('unsafe', { done: r.order.map(name).join(', ') || '∅' });
  const reqText = (v.request ?? '').trim();
  if (reqText) {
    const p = whole(v, 'process');
    const q = request(b, p, parseVector(reqText, s('fields.request')));
    answer += ` ${s(`request_${q.reason}`, { p: name(p), req: reqText, order: q.after?.order.map(name).join(', ') ?? '' })}`;
  }
  return { ok: true, answer, steps, tables };
}

function ragOutcome(v: Values): Outcome {
  const r = ragCycle(v.rag ?? '');
  const isProc = (q: string) => /^p/i.test(q);
  const onCycle = new Set(r.cycle ?? []);
  const cyc = r.cycle ?? [];
  const cycleEdge = (a: string, b: string) => cyc.some((q, i) => i + 1 < cyc.length && q === a && cyc[i + 1] === b);
  return {
    ok: true,
    answer: r.cycle ? s('ragCycle', { cycle: r.cycle.join(' → ') }) : s('ragNone'),
    note: s('ragNote'),
    figure:
      r.nodes.length <= 30
        ? {
            svg: graphFigure(
              r.nodes.map((q) => ({
                id: q,
                tone: onCycle.has(q) ? ('warn' as const) : isProc(q) ? ('accent' as const) : undefined,
              })),
              r.edges.map(([a, b]) => ({ from: a, to: b, bold: cycleEdge(a, b) })),
              { directed: true },
            ),
            alt: s('ragAlt', { edges: r.edges.map(([a, b]) => `${a} → ${b}`).join('; ') }),
          }
        : undefined,
  };
}

/* ---------- Modes ---------- */

const CACHE: Mode = {
  id: 'cache',
  fields: (v) => [
    f('cacheSize', '256 B', { help: true }),
    f('lineSize', '16 B'),
    f('ways', '2', { help: true }),
    f('addressBits', '16'),
    { id: 'replace', kind: 'select', options: ['lru', 'fifo', 'random'] },
    { id: 'write', kind: 'select', options: ['back', 'through'] },
    ...(v.replace === 'random' ? [f('seed', '1')] : []),
    f('trace', '0x0000\n0x0004\n0x0080\nW 0x0100\n0x0000\n0x0180\n0x0084', { kind: 'area', help: true }),
  ],
  solve: solveWith(cacheOutcome),
};

const AMAT: Mode = {
  id: 'amat',
  fields: [f('levels', '1 0.05', { kind: 'area', rows: 3, help: true }), f('memory', '100')],
  solve: solveWith(amatOutcome),
};

const PAGING: Mode = {
  id: 'paging',
  fields: [
    f('refs', '1 2 3 4 1 2 5 1 2 3 4 5', { wide: true }),
    f('frames', '3'),
    { id: 'pageAlgo', kind: 'select', options: PAGE_ALGOS },
  ],
  solve: solveWith(pageOutcome),
};

const TRANSLATE: Mode = {
  id: 'translate',
  fields: [
    f('pageSize', '4 KiB'),
    f('tlb', '2'),
    f('pageTable', '0 5\n1 -\n2 3', { kind: 'area', rows: 4, help: true }),
    f('addresses', '100, 8300, 200, 5000', { wide: true }),
  ],
  solve: solveWith(translateOutcome),
};

const SCHEDULE: Mode = {
  id: 'schedule',
  fields: (v) => [
    f('procs', 'P1 0 24\nP2 0 3\nP3 0 3', { kind: 'area', help: true }),
    { id: 'scheduler', kind: 'select', options: SCHEDULERS },
    ...(v.scheduler === 'rr' || v.scheduler === 'mlfq' ? [f('quantum', '4')] : []),
  ],
  solve: solveWith(scheduleOutcome),
};

const REALTIME: Mode = {
  id: 'realtime',
  fields: [f('tasks', '1 4\n2 6\n3 13', { kind: 'area', help: true })],
  solve: solveWith(realtimeOutcome),
};

const PIPELINE: Mode = {
  id: 'pipeline',
  fields: [
    f('program', 'lw x1, 0(x2)\nadd x3, x1, x4\nsub x5, x3, x6\nsw x5, 4(x2)', { kind: 'area', help: true }),
    { id: 'forwarding', kind: 'select', options: ['on', 'off'] },
  ],
  solve: solveWith(pipelineOutcome),
};

const BRANCH: Mode = {
  id: 'branch',
  fields: [
    f('outcomes', 'T T T N T T T N', { wide: true, help: true }),
    { id: 'bits', kind: 'select', options: ['2', '1'] },
    f('start', '3', { help: true }),
  ],
  solve: solveWith(branchOutcome),
};

const PERFORMANCE: Mode = {
  id: 'performance',
  fields: (v) => [
    { id: 'perf', kind: 'select', options: ['amdahl', 'gustafson', 'cpi'] },
    ...(v.perf === 'cpi'
      ? [
          f('mix', 'ALU 50 1\nload 20 5\nstore 10 4\nbranch 20 3', { kind: 'area' as const, help: true }),
          f('clock', '2000'),
          f('instructions', '1000000'),
        ]
      : [f('parallel', '0.9'), f('processors', '10')]),
  ],
  solve: solveWith(performanceOutcome),
};

const BANKER: Mode = {
  id: 'banker',
  fields: [
    f('alloc', '0 1 0\n2 0 0\n3 0 2\n2 1 1\n0 0 2', { kind: 'area', rows: 5 }),
    f('max', '7 5 3\n3 2 2\n9 0 2\n2 2 2\n4 3 3', { kind: 'area', rows: 5 }),
    f('available', '3 3 2'),
    f('process', '1'),
    f('request', '1 0 2', { help: true }),
  ],
  solve: solveWith(bankerOutcome),
};

const RAG: Mode = {
  id: 'rag',
  fields: [f('rag', 'P1 -> R1\nR1 -> P2\nP2 -> R2\nR2 -> P1', { kind: 'area', help: true })],
  solve: solveWith(ragOutcome),
};

export const SYSTEMS: ToolSpec = {
  id: 'systems',
  modes: [
    CACHE,
    AMAT,
    PAGING,
    TRANSLATE,
    SCHEDULE,
    REALTIME,
    PIPELINE,
    BRANCH,
    PERFORMANCE,
    BANKER,
    RAG,
    SUBNET,
    VLSM,
    IPV6,
    DELAYS,
    THROUGHPUT,
    ARQ,
    ROUTING,
    CLOCKS,
    FDS,
    ALGEBRA,
    HASH,
  ],
};
