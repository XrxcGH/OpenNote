// The digital logic tool's sequential modes as forms: flip-flop tables, state machines from a table (run, minimize,
// and design), and machines built for you (sequence detectors, counters, and shift registers).
import { graphFigure } from '../core/graphFigure';
import type { GraphEdge } from '../core/graphFigure';
import { integers } from '../core/util';
import { attempt, say, saySteps } from '../ui/say';
import type { Figure, Mode, Outcome, Table, Values } from '../ui/types';
import { design } from './design';
import type { Assignment, FlipFlop } from './design';
import { counter, detector, machineText, minimizeMachine, parseMachine, run, symbolsOf } from './fsm';
import type { CounterKind, Machine } from './fsm';

const T = 'digital';
const s = (path: string, vars?: Record<string, string | number>) => say(`${T}.${path}`, vars);

type FfRow = readonly [string, string];

/** Characteristic and excitation tables of the four flip-flops. */
const FF: Record<
  string,
  { equation: string; inputs: string; characteristic: readonly FfRow[]; excitation: readonly string[][] }
> = {
  SR: {
    equation: "Q+ = S + R'Q (with SR = 0)",
    inputs: 'S R',
    characteristic: [
      ['0 0', 'Q'],
      ['0 1', '0'],
      ['1 0', '1'],
      ['1 1', '–'],
    ],
    excitation: [
      ['0 → 0', '0 X'],
      ['0 → 1', '1 0'],
      ['1 → 0', '0 1'],
      ['1 → 1', 'X 0'],
    ],
  },
  D: {
    equation: 'Q+ = D',
    inputs: 'D',
    characteristic: [
      ['0', '0'],
      ['1', '1'],
    ],
    excitation: [
      ['0 → 0', '0'],
      ['0 → 1', '1'],
      ['1 → 0', '0'],
      ['1 → 1', '1'],
    ],
  },
  JK: {
    equation: "Q+ = JQ' + K'Q",
    inputs: 'J K',
    characteristic: [
      ['0 0', 'Q'],
      ['0 1', '0'],
      ['1 0', '1'],
      ['1 1', "Q'"],
    ],
    excitation: [
      ['0 → 0', '0 X'],
      ['0 → 1', '1 X'],
      ['1 → 0', 'X 1'],
      ['1 → 1', 'X 0'],
    ],
  },
  T: {
    equation: 'Q+ = T ⊕ Q',
    inputs: 'T',
    characteristic: [
      ['0', 'Q'],
      ['1', "Q'"],
    ],
    excitation: [
      ['0 → 0', '0'],
      ['0 → 1', '1'],
      ['1 → 0', '1'],
      ['1 → 1', '0'],
    ],
  },
};

export const FLIPFLOPS: Mode = {
  id: 'flipflops',
  fields: [{ id: 'ff', kind: 'select', options: ['SR', 'D', 'JK', 'T'] }],
  solve(v) {
    const ff = FF[v.ff] ?? FF.D;
    return {
      ok: true,
      answer: ff.equation,
      note: v.ff === 'SR' ? s('srNote') : undefined,
      tables: [
        { caption: s('table.characteristic'), header: [ff.inputs, 'Q+'], rows: ff.characteristic.map((r) => [...r]) },
        { caption: s('table.excitation'), header: ['Q → Q+', ff.inputs], rows: ff.excitation.map((r) => [...r]) },
      ],
    };
  },
};

/** The state diagram: Mealy arcs read input/output, Moore states show their output under the name. */
export function machineFigure(m: Machine): Figure {
  const merged = new Map<string, GraphEdge>();
  for (const st of m.states)
    for (const i of m.inputs) {
      const to = m.next[st][i];
      const text = m.kind === 'mealy' ? `${i}/${m.out[st][i]}` : i;
      const key = `${st}\u0000${to}`;
      const had = merged.get(key);
      merged.set(key, { from: st, to, label: had ? `${had.label}, ${text}` : text });
    }
  const nodes = m.states.map((st, i) => ({
    id: st,
    start: i === 0,
    note: m.kind === 'moore' ? m.out[st][''] : undefined,
  }));
  const arcs = [...merged.values()].map((e) => `${e.from} → ${e.to} (${e.label})`).join('; ');
  return {
    svg: graphFigure(nodes, [...merged.values()], { directed: true }),
    alt: s('diagramAlt', { count: m.states.length, arcs }),
  };
}

function stateTable(m: Machine): Table {
  return {
    caption: s('table.states'),
    header: [
      s('table.state'),
      ...m.inputs.map((i) => s('table.onInput', { input: i })),
      ...(m.kind === 'moore' ? [s('table.output')] : []),
    ],
    rows: m.states.map((st) => [
      st,
      ...m.inputs.map((i) => (m.kind === 'mealy' ? `${m.next[st][i]} / ${m.out[st][i]}` : m.next[st][i])),
      ...(m.kind === 'moore' ? [m.out[st]['']] : []),
    ]),
  };
}

function designParts(m: Machine, how: Assignment, ff: FlipFlop): { steps: string[]; table: Table } {
  const d = design(m, how, ff);
  return {
    steps: [
      s('steps.codes', { codes: m.states.map((st) => `${st} = ${d.codes[st]}`).join(', ') }),
      ...d.equations.map((e) => s('steps.equation', { name: e.name, sop: e.sop })),
    ],
    table: {
      caption: s('table.encoded'),
      header: [
        s('table.state'),
        s('table.code'),
        s('table.input'),
        s('table.next'),
        s('table.nextCode'),
        s('table.output'),
      ],
      rows: d.rows,
    },
  };
}

function fsmOutcome(v: Values): Outcome {
  const m = parseMachine(v.table ?? '');
  const syms = symbolsOf(m, v.input ?? '');
  const trace = run(m, syms);
  const min = minimizeMachine(m);
  const parts = designParts(min.machine, v.assign as Assignment, v.ff as FlipFlop);
  return {
    ok: true,
    answer: s('runAnswer', {
      outputs: trace.outputs.join(m.inputs.every((i) => i.length === 1) ? '' : ' ') || '–',
      end: trace.states[trace.states.length - 1],
    }),
    note:
      min.machine.states.length < m.states.length
        ? s('merged', { from: m.states.length, to: min.machine.states.length, text: machineText(min.machine) })
        : s('alreadyMinimal', { count: m.states.length }),
    steps: [...saySteps(T, min.steps), ...parts.steps],
    tables: [
      {
        caption: s('table.run'),
        header: [s('table.step'), s('table.state'), s('table.input'), s('table.next'), s('table.output')],
        rows: syms.map((x, i) => [String(i + 1), trace.states[i], x, trace.states[i + 1], trace.outputs[i]]),
      },
      parts.table,
      stateTable(min.machine),
    ],
    figure: machineFigure(m),
  };
}

export const FSM: Mode = {
  id: 'fsm',
  fields: [
    {
      id: 'table',
      kind: 'area',
      rows: 5,
      initial: 'S0: 0 -> S0 / 0, 1 -> S1 / 0\nS1: 0 -> S2 / 0, 1 -> S1 / 0\nS2: 0 -> S0 / 0, 1 -> S1 / 1',
      help: true,
    },
    { id: 'input', initial: '10101' },
    { id: 'assign', kind: 'select', options: ['binary', 'gray', 'onehot', 'named'] },
    { id: 'ff', kind: 'select', options: ['D', 'T', 'JK'] },
  ],
  solve: (v) => attempt(T, () => fsmOutcome(v)),
};

function buildOutcome(v: Values): Outcome {
  const kind = v.kind;
  const bits = integers(v.bits ?? '')?.[0] ?? 0;
  const m =
    kind === 'detector'
      ? detector((v.pattern ?? '').trim(), v.overlap === 'yes', v.machine === 'moore' ? 'moore' : 'mealy')
      : counter(kind as CounterKind, bits);
  const parts = designParts(m, kind === 'detector' ? 'binary' : 'named', 'D');
  return {
    ok: true,
    answer: s('builtAnswer', { count: m.states.length }),
    note: s('builtText', { text: machineText(m) }),
    steps: parts.steps,
    tables: [stateTable(m), parts.table],
    figure: machineFigure(m),
  };
}

export const BUILD: Mode = {
  id: 'build',
  fields: (v) => [
    { id: 'kind', kind: 'select', options: ['detector', 'up', 'down', 'gray', 'ring', 'johnson', 'shift'] },
    ...((v.kind ?? 'detector') === 'detector'
      ? [
          { id: 'pattern', initial: '101' },
          { id: 'overlap', kind: 'select' as const, options: ['yes', 'no'] },
          { id: 'machine', kind: 'select' as const, options: ['mealy', 'moore'] },
        ]
      : [{ id: 'bits', initial: '3' }]),
  ],
  solve: (v) => attempt(T, () => buildOutcome(v)),
};
