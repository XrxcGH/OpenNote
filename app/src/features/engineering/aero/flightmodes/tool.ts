// The dynamic modes tool: each root of the linearized equations is named as a mode, with its frequency, damping,
// period, and time to half or double, beside the two-state approximations.
import { AeroError, DEG } from '../common';
import type { XY } from '../common';
import { readNumber } from '../ui/spec';
import type { Inputs, Row, ToolSpec, Values } from '../ui/spec';
import { pretty } from '../ui/words';
import { flightModes, longitudinalA } from './engine';
import type { Axis, Mode, ModesResult } from './engine';

const axis = (v: Values): Axis => (v.axis === 'lateral' ? 'lateral' : 'longitudinal');
const fromDerivatives = (v: Values) => axis(v) === 'longitudinal' && v.source === 'derivatives';
const DERIVATIVES = ['Xu', 'Xw', 'Zu', 'Zw', 'Mu', 'Mw', 'Mq', 'Mwdot'] as const;

/** Reads a 4 by 4 matrix: semicolons end the rows, and spaces or commas split the entries. */
export function parseMatrix(text: string): number[][] {
  const rows = text
    .split(/[;\n]/)
    .map((row) => row.trim())
    .filter((row) => row !== '')
    .map((row) => row.split(/[\s,]+/).map((entry) => readNumber(entry) ?? NaN));
  if (rows.length !== 4 || rows.some((row) => row.length !== 4 || row.some((x) => !Number.isFinite(x))))
    throw new AeroError('matrixShape');
  return rows;
}

function matrixOf(inputs: Inputs): number[][] {
  if (!fromDerivatives(inputs.values)) return parseMatrix(inputs.s(axis(inputs.values) === 'lateral' ? 'Alat' : 'A'));
  const d = Object.fromEntries(DERIVATIVES.map((id) => [id, inputs.n(id)])) as Record<
    (typeof DERIVATIVES)[number],
    number
  >;
  return longitudinalA({ ...d, U0: inputs.q('U0'), theta0: inputs.q('theta0') / DEG });
}

const rootText = (m: { root: { re: number; im: number } }) =>
  m.root.im > 0 ? `${pretty(m.root.re, 5)} ± ${pretty(m.root.im, 5)}i` : pretty(m.root.re, 5);

function modeRows(m: Mode, i: number): Row[] {
  const vars = { mode: `@mode.${m.id}` };
  const rows: Row[] = [{ id: `root${i}`, label: 'root', vars, text: rootText(m), answer: true }];
  if (m.root.im > 0) {
    rows.push(
      { id: `wn${i}`, label: 'wn', vars, value: m.wn, sig: 5, unit: 'rad/s' },
      { id: `zeta${i}`, label: 'zeta', vars, value: m.zeta, sig: 4 },
    );
  } else if (m.root.re !== 0) {
    rows.push({ id: `tau${i}`, label: 'tau', vars, value: 1 / Math.abs(m.root.re), qty: 'time', sig: 4 });
  }
  if (m.period !== undefined) rows.push({ id: `period${i}`, label: 'period', vars, value: m.period, qty: 'time' });
  if (Number.isFinite(m.halfOrDouble))
    rows.push({ id: `t${i}`, label: m.stable ? 'half' : 'double', vars, value: m.halfOrDouble, qty: 'time', sig: 4 });
  return rows;
}

function sPlane(r: ModesResult) {
  const roots: XY[] = r.modes
    .flatMap((m) => (m.root.im > 0 ? [m.root, { re: m.root.re, im: -m.root.im }] : [m.root]))
    .map((z) => ({ x: z.re, y: z.im }));
  const approx: XY[] = r.approximations.flatMap((a) =>
    a.root
      ? [
          { x: a.root.re, y: a.root.im },
          { x: a.root.re, y: -a.root.im },
        ]
      : [],
  );
  return {
    title: 'sPlane',
    x: 're',
    y: 'im',
    series: [
      { label: 'roots', points: roots, style: 'dots' as const },
      { label: 'approx', points: approx, style: 'dots' as const },
    ],
    marks: r.modes.map((m) => ({ x: m.root.re, y: m.root.im, label: m.id })),
  };
}

export const spec: ToolSpec = {
  id: 'flightmodes',
  fields: [
    { id: 'axis', kind: 'choice', initial: 'longitudinal', options: ['longitudinal', 'lateral'] },
    {
      id: 'source',
      kind: 'choice',
      initial: 'matrix',
      options: ['matrix', 'derivatives'],
      when: (v) => axis(v) === 'longitudinal',
    },
    {
      id: 'A',
      kind: 'text',
      wide: true,
      initial: '-0.02 0.05 0 -9.81; -0.1 -1.2 60 0; 0.001 -0.05 -1.5 0; 0 0 1 0',
      when: (v) => axis(v) === 'longitudinal' && !fromDerivatives(v),
    },
    {
      id: 'Alat',
      kind: 'text',
      wide: true,
      initial: '-0.254 0 -53.6 9.81; -0.091 -8.4 2.19 0; 0.025 -0.35 -0.76 0; 0 1 0 0',
      when: (v) => axis(v) === 'lateral',
    },
    ...DERIVATIVES.map((id, i) => ({
      id,
      kind: 'number' as const,
      initial: ['-0.045', '0.036', '-0.37', '-2.02', '0', '-0.05', '-2.05', '-0.0051'][i]!,
      when: fromDerivatives,
    })),
    { id: 'U0', kind: 'quantity', qty: 'speed', initial: '67', when: fromDerivatives },
    { id: 'theta0', kind: 'quantity', qty: 'angle', initial: '0', when: fromDerivatives },
  ],
  run(inputs) {
    const r = flightModes({ axis: axis(inputs.values), A: matrixOf(inputs) });
    const rows = r.modes.flatMap(modeRows);
    r.approximations.forEach((a, i) =>
      rows.push({
        id: `approx${i}`,
        label: 'approx',
        vars: { mode: `@mode.${a.id}` },
        text:
          a.root && a.root.im === 0
            ? `s = ${pretty(a.root.re, 4)}`
            : `ωn = ${pretty(a.wn, 4)} rad/s, ζ = ${pretty(a.zeta, 3)}`,
      }),
    );
    const stable = r.modes.every((m) => m.stable);
    return {
      headline: { key: stable ? 'n.stable' : 'n.unstable' },
      rows,
      steps: r.steps,
      ...(r.steps[1]?.math ? { latex: r.steps[1].math } : {}),
      plots: [sPlane(r)],
    };
  },
};
