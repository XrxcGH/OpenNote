// The three-dimensional rigid bodies tool's form and results. A student builds a body from parts or types its
// inertia tensor, then gives a starting angular velocity and a torque; or converts a rotation between its forms.
import { fail, unwrap } from '../kit/errors';
import { q, word, type Cell } from '../kit/format';
import { readList, readRows } from '../kit/lines';
import { num, str, type ResultRow, type ResultTable, type ToolSpec, type Values } from '../kit/spec';
import { fromShown, type Kind, type System } from '../kit/units';
import type { Mat } from '../num';
import { SHAPE_SIZES, solveRigid3d, type Body, type RigidResult, type Shape } from './engine';
import { solveRotation, type Quat, type RotationForm, type Vec3 } from './rotation';

const DEG = Math.PI / 180;
const bodies = (v: Values) => v.task === 'bodies';
const dynamics = (v: Values) => v.task !== 'rotation';
const rotation = (v: Values) => v.task === 'rotation';
const form = (f: RotationForm) => (v: Values) => rotation(v) && v.form === f;

/** Parts typed one per line: shape, mass, its sizes, x y z of its center, then optional yaw, pitch, and roll. */
export function readBodies(text: string, system: System): Body[] {
  return readRows(text, 4, 10).map(({ numbers, words }, i) => {
    const shape = words[0] as Shape | undefined;
    const line = String(i + 1);
    if (words.length !== 1 || !shape || !Object.hasOwn(SHAPE_SIZES, shape)) return fail('rigidShape', { line });
    const count = SHAPE_SIZES[shape];
    if (numbers.length !== 4 + count && numbers.length !== 7 + count)
      return fail('rigidLine', { line, count: String(count) });
    const length = (v: number) => fromShown(v, 'length', system);
    const [m, ...rest] = numbers;
    const sizes = rest.slice(0, count).map(length);
    const at = rest.slice(count, count + 3).map(length) as Vec3;
    const turn = (rest.length > count + 3 ? rest.slice(count + 3) : [0, 0, 0]).map((d) => d * DEG) as Vec3;
    return { shape, mass: fromShown(m, 'mass', system), sizes, at, turn };
  });
}

/** Three numbers on one line, in the system's unit for `kind`. */
function vector(text: string, kind: Kind, system: System, field: string): Vec3 {
  const values = readList(text);
  if (values.length !== 3) return fail('rigidVector', { field });
  return values.map((v) => fromShown(v, kind, system)) as Vec3;
}

function readMatrix(text: string, kind: Kind, system: System): Mat {
  return readRows(text, 3).map((row) => row.numbers.map((v) => fromShown(v, kind, system)));
}

const AXES = ['x', 'y', 'z'];

function tensorTables(r: RigidResult): ResultTable[] {
  const matrix = (id: string, A: Mat, kind: Kind | null): ResultTable => ({
    id,
    columns: ['row', 'c1', 'c2', 'c3'],
    rows: A.map((row, i): Cell[] => [word(AXES[i]), ...row.map((v) => (kind ? q(v, kind) : v))]),
  });
  return [matrix('tensor', r.tensor, 'massInertia'), matrix('axes', r.axes, null)];
}

function dynamicsRows(r: RigidResult): ResultRow[] {
  const I = (i: number, j: number, id: string, sym: string): ResultRow => ({
    id,
    value: q(r.tensor[i][j], 'massInertia'),
    sym,
  });
  const rows: ResultRow[] = [];
  if (r.mass !== null && r.center)
    rows.push(
      { id: 'mass', value: q(r.mass, 'mass'), sym: 'M' },
      ...r.center.map((c, k) => ({ id: `c${AXES[k]}`, value: q(c, 'length'), sym: `c_${AXES[k]}` })),
    );
  rows.push(
    I(0, 0, 'Ixx', 'I_{xx}'),
    I(1, 1, 'Iyy', 'I_{yy}'),
    I(2, 2, 'Izz', 'I_{zz}'),
    I(0, 1, 'Ixy', 'I_{xy}'),
    I(0, 2, 'Ixz', 'I_{xz}'),
    I(1, 2, 'Iyz', 'I_{yz}'),
    ...r.moments.map((m, k) => ({
      id: 'principal',
      vars: { n: String(k + 1) },
      value: q(m, 'massInertia'),
      sym: `I_${k + 1}`,
      answer: true,
    })),
    { id: 'energy', value: q(r.energy, 'energy'), sym: 'T' },
    { id: 'momentum', value: q(r.momentum, 'angularMomentum'), sym: '|\\mathbf H|' },
  );
  const s = r.axisymmetric;
  if (s) {
    rows.push(
      { id: 'bodyRate', value: q(s.bodyRate, 'angularSpeed'), sym: '\\Omega', answer: true },
      { id: 'spaceRate', value: q(s.spaceRate, 'angularSpeed'), sym: '\\dot\\phi' },
      { id: 'nutation', value: q(s.nutation, 'angle'), sym: '\\theta' },
    );
    if (s.gyroRate !== null) rows.push({ id: 'gyroRate', value: q(s.gyroRate, 'angularSpeed'), sym: '\\Omega_p' });
  }
  if (r.drift !== null) rows.push({ id: 'drift', value: r.drift });
  return rows;
}

function runDynamics(values: Values, system: System) {
  const typed = str(values, 'task') === 'tensor';
  const r = unwrap(
    solveRigid3d({
      bodies: typed ? null : readBodies(str(values, 'bodies'), system),
      tensor: typed ? readMatrix(str(values, 'tensor'), 'massInertia', system) : null,
      about: str(values, 'about') === 'center' ? 'center' : 'origin',
      omega0: vector(str(values, 'omega0'), 'angularSpeed', system, 'omega0'),
      torque: vector(str(values, 'torque'), 'moment', system, 'torque'),
      duration: num(values, 'duration'),
    }),
  );
  const notes = ['tensorSign', 'principalFrame', ...(r.axisymmetric ? ['axisymmetric'] : []), 'stability'];
  if (!typed) notes.unshift('bodies');
  return {
    rows: dynamicsRows(r),
    steps: r.steps,
    tables: tensorTables(r),
    notes: r.omegaPlot ? notes : [...notes, 'noRun'],
    plots: r.omegaPlot ? [r.omegaPlot] : [],
  };
}

function runRotation(values: Values) {
  const f = str(values, 'form') as RotationForm;
  const list = (id: string, count: number) => {
    if (f !== id) return new Array<number>(count).fill(0);
    const v = readList(str(values, id));
    return v.length === count ? v : fail('rigidCount', { field: id, count: String(count) });
  };
  const euler = list('euler', 3).map((d) => d * DEG) as Vec3;
  const quat = list('quaternion', 4) as Quat;
  const [angle, ...axis] = list('axisAngle', 4);
  const matrix = f === 'matrix' ? readRows(str(values, 'matrix'), 3).map((row) => row.numbers) : [[0, 0, 0]];
  const r = unwrap(solveRotation({ form: f, euler, quat, angle: angle * DEG, axis: axis as Vec3, matrix }));
  const rows: ResultRow[] = [
    ...['w', 'x', 'y', 'z'].map((id, i) => ({ id: `q${id}`, value: r.quat[i], sym: `q_${id}`, answer: true })),
    { id: 'angle', value: q(r.angle, 'angle'), sym: '\\theta', answer: true },
    ...r.axis.map((v, i) => ({ id: `n${AXES[i]}`, value: v, sym: `n_${AXES[i]}` })),
    { id: 'yaw', value: q(r.euler[0], 'angle'), sym: '\\psi' },
    { id: 'pitch', value: q(r.euler[1], 'angle'), sym: '\\theta' },
    { id: 'roll', value: q(r.euler[2], 'angle'), sym: '\\phi' },
  ];
  const table: ResultTable = {
    id: 'matrix',
    columns: ['row', 'c1', 'c2', 'c3'],
    rows: r.matrix.map((row, i): Cell[] => [word(AXES[i]), ...row]),
  };
  const notes = ['rotation', ...(r.gimbal ? ['gimbal'] : []), ...(r.normalized ? ['normalized'] : [])];
  return { rows, steps: r.steps, tables: [table], notes };
}

export const rigid3dSpec: ToolSpec = {
  fields: [
    { id: 'task', type: 'choice', options: ['bodies', 'tensor', 'rotation'], first: 'bodies' },
    { id: 'bodies', type: 'text', first: 'plate 2 0.4 0.2 0.2 0.1 0', rows: 4, hint: true, when: bodies },
    { id: 'about', type: 'choice', options: ['origin', 'center'], first: 'origin', when: bodies },
    { id: 'tensor', type: 'text', first: '1 0 0\n0 1 0\n0 0 2', rows: 3, hint: true, when: (v) => v.task === 'tensor' },
    { id: 'omega0', type: 'text', first: '1 0 10', hint: true, when: dynamics },
    { id: 'torque', type: 'text', first: '0 0 0', hint: true, when: dynamics },
    { id: 'duration', type: 'quantity', kind: 'time', first: '5 s', when: dynamics },
    {
      id: 'form',
      type: 'choice',
      options: ['euler', 'quaternion', 'axisAngle', 'matrix'],
      first: 'euler',
      when: rotation,
    },
    { id: 'euler', type: 'text', first: '30 20 10', hint: true, when: form('euler') },
    { id: 'quaternion', type: 'text', first: '1 0 0 0', hint: true, when: form('quaternion') },
    { id: 'axisAngle', type: 'text', first: '90 0 0 1', hint: true, when: form('axisAngle') },
    { id: 'matrix', type: 'text', first: '0 -1 0\n1 0 0\n0 0 1', rows: 3, hint: true, when: form('matrix') },
  ],
  examples: [
    { id: 'plate', values: {} },
    {
      id: 'assembly',
      values: { bodies: 'cylinder 4 0.05 0.3 0 0 0.15\nsphere 1 0.05 0 0 0.35\nrod 0.5 0.4 0 0 0', about: 'center' },
    },
    { id: 'axisymmetric', values: { task: 'tensor' } },
    {
      id: 'intermediate',
      values: { task: 'tensor', tensor: '1 0 0\n0 2 0\n0 0 3', omega0: '0.01 5 0.01', duration: '20 s' },
    },
    { id: 'top', values: { task: 'tensor', omega0: '0 0 50', torque: '0.5 0 0' } },
    { id: 'euler', values: { task: 'rotation' } },
    { id: 'gimbal', values: { task: 'rotation', euler: '30 90 0' } },
  ],
  run(values, system) {
    return rotation(values) ? runRotation(values) : runDynamics(values, system);
  },
};
