// The pipe flow tool's form and results: head loss from the flow, flow from the head loss, the diameter for a flow, a
// pump on a system curve, pipes in series and in parallel, and a pipe network by the Hardy Cross method.
import { fail, q, type KitStep } from '../kit/types';
import { readLines } from '../kit/lines';
import type { Outcome, ResultRow, ToolSpec, Values } from '../kit/spec';
import type { System } from '../kit/units';
import {
  diameterFromFlow,
  flowFromHeadLoss,
  hardyCross,
  headLossFromFlow,
  operatingPoint,
  parallelSplit,
  pipeSystemCurve,
  seriesLoss,
  type FluidProps,
  type PipeSpec,
  type PipeState,
} from './engine';

const num = (values: Values, id: string) => values[id] as number;
const steps = (list: unknown): KitStep[] => list as KitStep[];
const MODES = ['headLoss', 'flow', 'diameter', 'pump', 'series', 'parallel', 'network'] as const;
type Mode = (typeof MODES)[number];
const is =
  (...modes: Mode[]) =>
  (v: Values) =>
    modes.includes(v.mode as Mode);

const fluidOf = (values: Values): FluidProps => ({
  density: num(values, 'density'),
  viscosity: num(values, 'viscosity'),
});
const optional = (values: Values, id: string) => (Number.isFinite(num(values, id)) ? num(values, id) : 0);
const pipeOf = (values: Values): PipeSpec => ({
  diameter: num(values, 'diameter'),
  length: num(values, 'length'),
  roughness: optional(values, 'roughness'),
  sumK: optional(values, 'sumK'),
});

const PIPE_LINES = ['length', 'span', 'length', 'ratio'] as const;
const pipeFromLine = ([diameter, length, roughness, sumK]: number[]): PipeSpec => ({
  diameter,
  length,
  roughness,
  sumK,
});

function stateRows(s: PipeState): ResultRow[] {
  return [
    { id: 'headLoss', value: q(s.headLoss, 'span'), sym: 'h_L', answer: true },
    { id: 'pressureDrop', value: q(s.pressureDrop, 'pressure'), sym: '\\Delta p', answer: true },
    { id: 'flow', value: q(s.q, 'flow'), sym: 'Q' },
    { id: 'velocity', value: q(s.velocity, 'speed'), sym: 'V' },
    { id: 'reynolds', value: s.re, sym: '\\mathrm{Re}' },
    { id: 'regime', word: s.regime },
    { id: 'friction', value: s.f, sym: 'f' },
    { id: 'frictionHead', value: q(s.frictionHead, 'span') },
    { id: 'minorHead', value: q(s.minorHead, 'span') },
    { id: 'powerLoss', value: q(s.powerLoss, 'power') },
  ];
}

/** Least-squares quadratic H = c0 + c1 Q + c2 Q^2 through the points (exact for three). */
function fitQuadratic(points: number[][]): [number, number, number] {
  if (points.length < 3) fail('calc', 'Give at least three points of the pump curve.');
  const m = [
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
  ];
  for (const [x, y] of points) {
    const p = [1, x, x * x];
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) m[i][j] += p[i] * p[j];
      m[i][3] += p[i] * y;
    }
  }
  for (let c = 0; c < 3; c++) {
    let best = c;
    for (let r = c + 1; r < 3; r++) if (Math.abs(m[r][c]) > Math.abs(m[best][c])) best = r;
    if (Math.abs(m[best][c]) < 1e-300) fail('calc', 'The pump curve points must have different flows.');
    [m[c], m[best]] = [m[best], m[c]];
    for (let r = c + 1; r < 3; r++) {
      const f = m[r][c] / m[c][c];
      for (let k = c; k < 4; k++) m[r][k] -= f * m[c][k];
    }
  }
  const x = [0, 0, 0];
  for (let r = 2; r >= 0; r--) {
    let s = m[r][3];
    for (let k = r + 1; k < 3; k++) s -= m[r][k] * x[k];
    x[r] = s / m[r][r];
  }
  return [x[0], x[1], x[2]];
}

const HANDLERS: Record<Mode, (values: Values, system: System) => Outcome> = {
  headLoss: (values) => {
    const fluid = fluidOf(values);
    const s = headLossFromFlow(fluid, pipeOf(values), num(values, 'flowRate'));
    return { rows: stateRows(s), steps: steps(s.steps), notes: ['darcy', 'colebrook'] };
  },
  flow: (values) => {
    const fluid = fluidOf(values);
    const s = flowFromHeadLoss(fluid, pipeOf(values), num(values, 'headLossIn'));
    return {
      rows: stateRows(s).map((r) => ({ ...r, answer: r.id === 'flow' })),
      steps: steps(s.steps),
      notes: ['darcy', 'colebrook'],
    };
  },
  diameter: (values) => {
    const fluid = fluidOf(values);
    const s = diameterFromFlow(
      fluid,
      { length: num(values, 'length'), roughness: optional(values, 'roughness'), sumK: optional(values, 'sumK') },
      num(values, 'flowRate'),
      num(values, 'headLossIn'),
    );
    return {
      rows: [
        { id: 'diameter', value: q(s.diameter, 'length'), sym: 'D', answer: true },
        ...stateRows(s).map((r) => ({ ...r, answer: false })),
      ],
      steps: steps(s.steps),
      notes: ['darcy', 'colebrook'],
    };
  },
  pump: (values, system) => {
    const fluid = fluidOf(values);
    const points = readLines(String(values.pumpCurve), ['flow', 'span'], system);
    const [c0, c1, c2] = fitQuadratic(points);
    const pump = (flow: number) => c0 + c1 * flow + c2 * flow * flow;
    const sys = pipeSystemCurve(fluid, pipeOf(values), num(values, 'staticHead'));
    const qMax = Math.max(...points.map((p) => p[0]), 1e-6) * 3;
    const op = operatingPoint(pump, sys, qMax);
    const state = headLossFromFlow(fluid, pipeOf(values), op.q);
    const n = 40;
    const upTo = Math.min(qMax, op.q * 2);
    const grid = Array.from({ length: n + 1 }, (_, i) => (upTo * i) / n);
    return {
      rows: [
        { id: 'flow', value: q(op.q, 'flow'), sym: 'Q', answer: true },
        { id: 'head', value: q(op.head, 'span'), sym: 'H', answer: true },
        { id: 'velocity', value: q(state.velocity, 'speed') },
        { id: 'reynolds', value: state.re },
        { id: 'hydraulicPower', value: q(fluid.density * 9.80665 * op.q * op.head, 'power') },
      ],
      steps: steps([
        { key: 'fhPipesPumpFit', vars: { c0: String(c0), c1: String(c1), c2: String(c2) } },
        ...op.steps,
        ...state.steps,
      ]),
      notes: ['pumpFit', 'darcy'],
      picture: {
        type: 'plot',
        plot: {
          x: { label: 'flow', kind: 'flow' },
          y: { label: 'head', kind: 'span' },
          series: [
            { id: 'pump', points: grid.map((x) => [x, pump(x)] as [number, number]) },
            { id: 'system', points: grid.map((x) => [x, sys(x)] as [number, number]) },
          ],
          marks: [{ x: op.q, y: op.head, id: 'operating' }],
        },
      },
    };
  },
  series: (values, system) => {
    const fluid = fluidOf(values);
    const list = readLines(String(values.pipes), [...PIPE_LINES], system).map(pipeFromLine);
    const r = seriesLoss(fluid, list, num(values, 'flowRate'));
    return {
      rows: [
        { id: 'headLoss', value: q(r.headLoss, 'span'), sym: 'h_L', answer: true },
        {
          id: 'pressureDrop',
          value: q(fluid.density * 9.80665 * r.headLoss, 'pressure'),
          sym: '\\Delta p',
          answer: true,
        },
      ],
      tables: [
        {
          id: 'parts',
          columns: ['pipe', 'velocity', 'reynolds', 'friction', 'headLoss'],
          rows: r.parts.map((p, i) => [i + 1, q(p.velocity, 'speed'), p.re, p.f, q(p.headLoss, 'span')]),
        },
      ],
      steps: steps(
        r.parts.flatMap((p, i) => [
          { key: 'fhPipesPart', vars: { n: String(i + 1), hl: String(p.headLoss) } },
          ...p.steps,
        ]),
      ),
      notes: ['series'],
    };
  },
  parallel: (values, system) => {
    const fluid = fluidOf(values);
    const list = readLines(String(values.pipes), [...PIPE_LINES], system).map(pipeFromLine);
    const r = parallelSplit(fluid, list, num(values, 'flowRate'));
    return {
      rows: [
        { id: 'headLoss', value: q(r.headLoss, 'span'), sym: 'h_L', answer: true },
        {
          id: 'pressureDrop',
          value: q(fluid.density * 9.80665 * r.headLoss, 'pressure'),
          sym: '\\Delta p',
          answer: true,
        },
      ],
      tables: [
        {
          id: 'branches',
          columns: ['pipe', 'flow', 'velocity', 'reynolds', 'share'],
          rows: r.parts.map((p, i) => [
            i + 1,
            q(p.q, 'flow'),
            q(p.velocity, 'speed'),
            p.re,
            q(p.q / num(values, 'flowRate'), 'percent'),
          ]),
        },
      ],
      steps: steps([{ key: 'fhPipesSplit', vars: { hl: String(r.headLoss) } }]),
      notes: ['parallel'],
    };
  },
  network: (values, system) => {
    const fluid = fluidOf(values);
    const lines = readLines(String(values.netPipes), ['length', 'span', 'length', 'ratio', 'flow'], system);
    const list = lines.map((l) => pipeFromLine(l));
    const loops = String(values.loops)
      .split(/\r?\n/)
      .map((line, index) => ({ line, index }))
      .filter(({ line }) => line.trim() !== '')
      .map(({ line, index }) =>
        line
          .trim()
          .split(/[\s,;]+/)
          .map((token) => {
            const n = Number(token);
            if (!Number.isInteger(n) || n === 0 || Math.abs(n) > list.length) fail('partsLine', String(index + 1));
            return { pipe: Math.abs(n) - 1, sign: (n > 0 ? 1 : -1) as 1 | -1 };
          }),
      );
    const r = hardyCross({ fluid, pipes: list, loops, flows: lines.map((l) => l[4]) });
    return {
      rows: [
        { id: 'iterations', value: r.iterations },
        { id: 'loopResidual', value: q(Math.max(...r.loopResidual.map(Math.abs)), 'span') },
      ],
      tables: [
        {
          id: 'pipes',
          columns: ['pipe', 'flow', 'headLoss'],
          rows: r.flows.map((f, i) => [i + 1, q(f, 'flow'), q(r.headLoss[i], 'span')]),
        },
      ],
      steps: steps([{ key: 'fhPipesCross', vars: { n: String(r.iterations) } }]),
      notes: ['network'],
    };
  },
};

export const pipesSpec: ToolSpec = {
  fields: [
    { id: 'mode', type: 'choice', options: [...MODES], first: 'headLoss' },
    { id: 'density', type: 'quantity', kind: 'density', first: '998 kg/m^3' },
    { id: 'viscosity', type: 'quantity', kind: 'viscosity', first: '1.0 mPa·s' },
    { id: 'diameter', type: 'quantity', kind: 'length', first: '50 mm', when: is('headLoss', 'flow', 'pump') },
    {
      id: 'length',
      type: 'quantity',
      kind: 'span',
      first: '100 m',
      when: is('headLoss', 'flow', 'diameter', 'pump'),
    },
    {
      id: 'roughness',
      type: 'quantity',
      kind: 'length',
      first: '0.046 mm',
      optional: true,
      when: is('headLoss', 'flow', 'diameter', 'pump'),
    },
    {
      id: 'sumK',
      type: 'quantity',
      kind: 'ratio',
      first: '2',
      optional: true,
      when: is('headLoss', 'flow', 'diameter', 'pump'),
    },
    {
      id: 'flowRate',
      type: 'quantity',
      kind: 'flow',
      first: '5 L/s',
      when: is('headLoss', 'diameter', 'series', 'parallel'),
    },
    { id: 'headLossIn', type: 'quantity', kind: 'span', first: '10 m', when: is('flow', 'diameter') },
    { id: 'staticHead', type: 'quantity', kind: 'span', first: '8 m', when: is('pump') },
    { id: 'pumpCurve', type: 'text', first: '0, 30\n5, 26\n10, 18', rows: 4, when: is('pump') },
    {
      id: 'pipes',
      type: 'text',
      first: '50 mm, 100 m, 0.046 mm, 2\n40 mm, 60 m, 0.046 mm, 1',
      rows: 4,
      when: is('series', 'parallel'),
    },
    {
      id: 'netPipes',
      type: 'text',
      first:
        '100 mm, 300 m, 0.26 mm, 0, 20 L/s\n100 mm, 200 m, 0.26 mm, 0, 20 L/s\n80 mm, 250 m, 0.26 mm, 0, 10 L/s\n80 mm, 250 m, 0.26 mm, 0, 10 L/s',
      rows: 5,
      when: is('network'),
    },
    { id: 'loops', type: 'text', first: '1 2 -4 -3', rows: 3, when: is('network') },
  ],
  examples: [
    {
      id: 'steel',
      values: {
        mode: 'headLoss',
        diameter: '50 mm',
        length: '100 m',
        roughness: '0.046 mm',
        flowRate: '5 L/s',
        sumK: '2',
      },
    },
    {
      id: 'flow',
      values: {
        mode: 'flow',
        diameter: '50 mm',
        length: '100 m',
        roughness: '0.046 mm',
        headLossIn: '10 m',
        sumK: '2',
      },
    },
    {
      id: 'size',
      values: {
        mode: 'diameter',
        length: '100 m',
        roughness: '0.046 mm',
        flowRate: '5 L/s',
        headLossIn: '10 m',
        sumK: '2',
      },
    },
    { id: 'pump', values: { mode: 'pump', staticHead: '8 m', pumpCurve: '0, 30\n5, 26\n10, 18' } },
    { id: 'series', values: { mode: 'series', flowRate: '5 L/s' } },
    { id: 'parallel', values: { mode: 'parallel', flowRate: '10 L/s' } },
    { id: 'network', values: { mode: 'network' } },
  ],
  run(values, system): Outcome {
    return HANDLERS[values.mode as Mode](values, system);
  },
};
