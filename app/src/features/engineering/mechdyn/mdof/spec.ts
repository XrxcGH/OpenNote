// The multi-degree-of-freedom and continuous vibration tool's form and results: a chain of masses, springs, and
// dampers, or M, K, and C typed as matrices, with a starting state and a harmonic force; or a continuous string,
// bar, shaft, or beam with its end conditions.
import { fail, unwrap } from '../kit/errors';
import { q, type Cell } from '../kit/format';
import { readList, readRows } from '../kit/lines';
import { num, str, type ResultRow, type ResultTable, type ToolSpec, type Values } from '../kit/spec';
import { fromShown, type Kind, type System } from '../kit/units';
import type { Plot } from '../types';
import { buildChain, solveContinuous, solveLumped, type AxialEnds, type BeamEnds, type MemberKind } from './engine';
import type { Mat } from '../num';

const lumped = (v: Values) => v.model !== 'member';
const chain = (v: Values) => v.model === 'chain';
const matrix = (v: Values) => v.model === 'matrix';
const member = (v: Values) => v.model === 'member';
const beam = (v: Values) => member(v) && v.kind === 'beam';

/** A list typed on one line, each number in the system's unit for `kind`. */
const list = (text: string, kind: Kind, system: System): number[] =>
  readList(text).map((v) => fromShown(v, kind, system));

/** A square matrix typed one row per line, each entry in the system's unit for `kind`. */
function readMatrix(text: string, kind: Kind, system: System): Mat {
  return readRows(text, 1, 12).map((row) => row.numbers.map((v) => fromShown(v, kind, system)));
}

/** A list padded with zeros, or cut, to n entries. */
const fit = (values: readonly number[], n: number): number[] => Array.from({ length: n }, (_, i) => values[i] ?? 0);

function runLumped(values: Values, system: System) {
  let M: Mat, K: Mat, C: Mat;
  if (str(values, 'model') === 'chain') {
    const masses = list(str(values, 'masses'), 'mass', system);
    if (masses.length === 0) return fail('mdofEmpty');
    const springs = list(str(values, 'springs'), 'stiffness', system);
    if (springs.length !== masses.length + 1) return fail('mdofSprings', { count: String(masses.length + 1) });
    const dampers = list(str(values, 'dampers'), 'damping', system);
    if (dampers.length > masses.length + 1) return fail('mdofDampers', { count: String(masses.length + 1) });
    ({ M, K, C } = buildChain({ masses, springs, dampers }));
  } else {
    M = readMatrix(str(values, 'M'), 'mass', system);
    K = readMatrix(str(values, 'K'), 'stiffness', system);
    const typed = str(values, 'C').trim();
    C = typed === '' ? M.map((row) => row.map(() => 0)) : readMatrix(typed, 'damping', system);
  }
  const n = M.length;
  const zeta = num(values, 'zeta');
  const duration = num(values, 'duration');
  const r = unwrap(
    solveLumped({
      M,
      K,
      C,
      zeta: Number.isFinite(zeta) ? zeta : 0,
      x0: fit(list(str(values, 'x0'), 'small', system), n),
      v0: fit(list(str(values, 'v0'), 'velocity', system), n),
      force: fit(list(str(values, 'force'), 'force', system), n),
      omega: num(values, 'omega'),
      duration: Number.isFinite(duration) ? duration : 0,
    }),
  );
  const rows: ResultRow[] = [
    ...r.omegas.map((w, i) => ({
      id: 'omega',
      vars: { n: String(i + 1) },
      value: q(w, 'angularSpeed'),
      sym: `\\omega_{${i + 1}}`,
      answer: true,
    })),
    ...r.freqs.map((f, i) => ({ id: 'f', vars: { n: String(i + 1) }, value: q(f, 'frequency'), sym: `f_{${i + 1}}` })),
  ];
  if (r.amplitudes)
    rows.push(
      ...r.amplitudes.map((x, i) => ({
        id: 'X',
        vars: { n: String(i + 1) },
        value: q(x, 'small'),
        sym: `X_{${i + 1}}`,
      })),
    );
  const modeCols = r.modes.map((_, k) => `m${k + 1}`);
  const tables: ResultTable[] = [
    {
      id: 'modes',
      columns: ['mass', ...modeCols],
      rows: r.modes[0].map((_, i): Cell[] => [i + 1, ...r.modes.map((phi) => phi[i])]),
    },
    {
      id: 'shapes',
      columns: ['mass', ...modeCols],
      rows: r.shapes[0].map((_, i): Cell[] => [i + 1, ...r.shapes.map((phi) => phi[i])]),
    },
  ];
  const plots: Plot[] = [r.modePlot, r.response, ...(r.frequency ? [r.frequency] : [])];
  const hasC = C.some((row) => row.some((v) => v !== 0));
  const notes = [
    'linear',
    'normalized',
    hasC ? 'modalDamping' : 'zeta',
    ...(r.omegas[0] < 1e-9 * (r.omegas[n - 1] || 1) ? ['rigid'] : []),
    ...(r.amplitudes ? ['steady'] : []),
  ];
  return { rows, steps: r.steps, tables, notes, plots };
}

function runMember(values: Values) {
  const kind = str(values, 'kind') as MemberKind;
  const ends = (
    kind === 'beam' ? str(values, 'beamEnds') : kind === 'string' ? 'fixed-fixed' : str(values, 'axialEnds')
  ) as BeamEnds | AxialEnds;
  const r = unwrap(
    solveContinuous({
      kind,
      ends,
      length: num(values, 'L'),
      tension: kind === 'string' ? num(values, 'tension') : 0,
      massPerLength: kind === 'string' ? num(values, 'mu') : 0,
      modulus: kind === 'string' ? 0 : num(values, 'modulus'),
      density: kind === 'string' ? 0 : num(values, 'density'),
      I: kind === 'beam' ? num(values, 'I') : 0,
      A: kind === 'beam' ? num(values, 'A') : 0,
      modes: num(values, 'modes'),
    }),
  );
  const rows: ResultRow[] = [
    ...r.omegas.map((w, i) => ({
      id: 'omega',
      vars: { n: String(i + 1) },
      value: q(w, 'angularSpeed'),
      sym: `\\omega_{${i + 1}}`,
      answer: i === 0,
    })),
    ...r.freqs.map((f, i) => ({
      id: 'f',
      vars: { n: String(i + 1) },
      value: q(f, 'frequency'),
      sym: `f_{${i + 1}}`,
      answer: i === 0,
    })),
  ];
  const tables: ResultTable[] = [
    {
      id: kind === 'beam' ? 'beamRoots' : 'roots',
      columns: ['mode', 'root', 'omega', 'f'],
      rows: r.roots.map((root, i): Cell[] => [i + 1, root, q(r.omegas[i], 'angularSpeed'), q(r.freqs[i], 'frequency')]),
    },
  ];
  const notes = [
    kind === 'beam' ? 'eulerBernoulli' : kind === 'shaft' ? 'shaft' : 'wave',
    ...(kind === 'string' ? ['stringEnds'] : []),
  ];
  return { rows, steps: r.steps, tables, notes, plots: [r.modePlot] };
}

export const mdofSpec: ToolSpec = {
  fields: [
    { id: 'model', type: 'choice', options: ['chain', 'matrix', 'member'], first: 'chain' },
    { id: 'masses', type: 'text', first: '1 1', hint: true, when: chain },
    { id: 'springs', type: 'text', first: '1 1 1', hint: true, when: chain },
    { id: 'dampers', type: 'text', first: '', hint: true, when: chain },
    { id: 'M', type: 'text', first: '2 0\n0 1', rows: 3, hint: true, when: matrix },
    { id: 'K', type: 'text', first: '3000 -1000\n-1000 1000', rows: 3, hint: true, when: matrix },
    { id: 'C', type: 'text', first: '', rows: 3, hint: true, when: matrix },
    { id: 'zeta', type: 'quantity', kind: 'ratio', first: '', optional: true, hint: true, when: lumped },
    { id: 'x0', type: 'text', first: '10 0', hint: true, when: lumped },
    { id: 'v0', type: 'text', first: '', hint: true, when: lumped },
    { id: 'force', type: 'text', first: '', hint: true, when: lumped },
    { id: 'omega', type: 'quantity', kind: 'angularSpeed', first: '1.2 rad/s', when: lumped },
    { id: 'duration', type: 'quantity', kind: 'time', first: '', optional: true, hint: true, when: lumped },
    { id: 'kind', type: 'choice', options: ['beam', 'string', 'bar', 'shaft'], first: 'beam', when: member },
    {
      id: 'beamEnds',
      type: 'choice',
      options: ['fixed-free', 'pinned-pinned', 'fixed-fixed', 'fixed-pinned', 'free-free'],
      first: 'fixed-free',
      when: beam,
    },
    {
      id: 'axialEnds',
      type: 'choice',
      options: ['fixed-fixed', 'fixed-free', 'free-free'],
      first: 'fixed-fixed',
      when: (v) => member(v) && (v.kind === 'bar' || v.kind === 'shaft'),
    },
    { id: 'L', type: 'quantity', kind: 'length', first: '1 m', when: member },
    { id: 'tension', type: 'quantity', kind: 'force', first: '100 N', when: (v) => member(v) && v.kind === 'string' },
    {
      id: 'mu',
      type: 'quantity',
      kind: 'massPerLength',
      first: '0.01 kg/m',
      when: (v) => member(v) && v.kind === 'string',
    },
    {
      id: 'modulus',
      type: 'quantity',
      kind: 'modulus',
      first: '200 GPa',
      hint: true,
      when: (v) => member(v) && v.kind !== 'string',
    },
    {
      id: 'density',
      type: 'quantity',
      kind: 'density',
      first: '7850 kg/m^3',
      when: (v) => member(v) && v.kind !== 'string',
    },
    { id: 'I', type: 'quantity', kind: 'areaInertia', first: '10000 mm^4', when: beam },
    { id: 'A', type: 'quantity', kind: 'area', first: '100 mm^2', when: beam },
    { id: 'modes', type: 'quantity', kind: 'count', first: '3', when: member },
  ],
  examples: [
    { id: 'two', values: {} },
    { id: 'three', values: { masses: '1 1 1', springs: '1 1 1 0', x0: '10 0 0' } },
    {
      id: 'absorber',
      values: { masses: '1 0.1', springs: '100 10 0', x0: '0 0', force: '10 0', omega: '10 rad/s' },
    },
    { id: 'matrix', values: { model: 'matrix', x0: '10 0', zeta: '0.02' } },
    { id: 'cantilever', values: { model: 'member' } },
    { id: 'string', values: { model: 'member', kind: 'string' } },
  ],
  run(values, system) {
    return lumped(values) ? runLumped(values, system) : runMember(values);
  },
};
