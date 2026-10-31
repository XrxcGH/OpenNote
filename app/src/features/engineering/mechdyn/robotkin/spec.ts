// The robot arm kinematics tool's form and results: a Denavit-Hartenberg table typed one joint per line, with the
// joint's current value in it, and a target for inverse kinematics.
import { fail, unwrap } from '../kit/errors';
import { q, word, type Cell } from '../kit/format';
import { readRows } from '../kit/lines';
import { num, str, type ResultRow, type ToolSpec } from '../kit/spec';
import { fromShown, type System } from '../kit/units';
import type { Plot } from '../types';
import { isPlanar, solveRobotKin, type DhConvention, type DhRow } from './engine';

const DEG = Math.PI / 180;

/** Rows typed as "R a α d θ [low high]" or "P a α d θ [low high]": lengths in the system's unit, angles in degrees. */
export function readDh(text: string, system: System): DhRow[] {
  return readRows(text, 4, 6).map(({ numbers, words }, i) => {
    const type = (words[0] ?? 'r').toUpperCase();
    if (words.length > 1 || (type !== 'R' && type !== 'P')) return fail('robotKinType', { row: String(i + 1) });
    if (numbers.length === 5) return fail('robotKinLimitPair', { row: String(i + 1) });
    const [a, alpha, d, theta, low, high] = numbers;
    const length = (v: number) => fromShown(v, 'length', system);
    const limit = (v: number | undefined) => (v === undefined ? null : type === 'R' ? v * DEG : length(v));
    return {
      type: type as DhRow['type'],
      a: length(a),
      alpha: alpha * DEG,
      d: length(d),
      theta: theta * DEG,
      min: limit(low),
      max: limit(high),
    };
  });
}

/** Planar two- and three-link arms are solved in closed form; a three-link one also takes the end angle φ. */
const takesEndAngle = (rows: readonly DhRow[], convention: DhConvention) =>
  convention === 'standard' && rows.length === 3 && isPlanar(rows) && rows.every((r) => r.d === 0);

const JACOBIAN_ROWS = ['vx', 'vy', 'vz', 'wx', 'wy', 'wz'];

export const robotKinSpec: ToolSpec = {
  fields: [
    { id: 'convention', type: 'choice', options: ['standard', 'modified'], first: 'standard' },
    { id: 'table', type: 'text', first: 'R 1 0 0 30\nR 1 0 0 45', rows: 4, hint: true },
    { id: 'x', type: 'quantity', kind: 'length', first: '1.124844 m' },
    { id: 'y', type: 'quantity', kind: 'length', first: '1.465926 m' },
    { id: 'z', type: 'quantity', kind: 'length', first: '0 m', hint: true },
    { id: 'phi', type: 'quantity', kind: 'angle', first: '0', hint: true },
  ],
  examples: [
    { id: 'planar', values: {} },
    {
      id: 'spatial',
      values: { table: 'R 0 90 0.5 30\nR 1 0 0 45\nR 1 0 0 -60', x: '1 m', y: '0.5 m', z: '1 m' },
    },
    {
      id: 'modified',
      values: {
        convention: 'modified',
        table: 'R 0 0 0.5 30\nR 0 90 0 45\nR 1 0 0 -60\nR 1 0 0 0',
        x: '1 m',
        y: '0.5 m',
        z: '1 m',
      },
    },
    {
      id: 'three',
      values: { table: 'R 0.3 0 0 0\nR 0.2 0 0 30\nR 0.1 0 0 30', x: '0.35 m', y: '0.2 m', z: '0 m', phi: '60' },
    },
    {
      id: 'scara',
      values: {
        table: 'R 0.4 0 0.3 0 -150 150\nR 0.3 180 0 30 -150 150\nP 0 0 0.1 0 0 0.2',
        x: '0.5 m',
        y: '0.2 m',
        z: '0.15 m',
      },
    },
  ],
  run(values, system) {
    const convention = str(values, 'convention') as DhConvention;
    const rows = readDh(str(values, 'table'), system);
    const endAngle = takesEndAngle(rows, convention);
    const third = endAngle ? num(values, 'phi') : num(values, 'z');
    const r = unwrap(solveRobotKin({ convention, rows, target: [num(values, 'x'), num(values, 'y'), third] }));
    const n = rows.length;
    const joint = (v: number, i: number): Cell => q(v, rows[i].type === 'R' ? 'angle' : 'length');
    const out: ResultRow[] = [
      { id: 'x', value: q(r.position[0], 'length'), sym: 'x', answer: true },
      { id: 'y', value: q(r.position[1], 'length'), sym: 'y', answer: true },
      { id: 'z', value: q(r.position[2], 'length'), sym: 'z', answer: true },
      { id: 'yaw', value: q(r.euler[0], 'angle'), sym: '\\psi' },
      { id: 'pitch', value: q(r.euler[1], 'angle'), sym: '\\theta' },
      { id: 'roll', value: q(r.euler[2], 'angle'), sym: '\\phi' },
      ...(r.planarDet !== null ? [{ id: 'detJ', value: r.planarDet, sym: '\\det J' }] : []),
      { id: 'manipulability', value: r.manipulability, sym: 'w' },
      { id: 'method', word: r.ik.method },
      { id: 'solutions', value: r.ik.solutions.filter((s) => s.error < 1e-6).length },
    ];
    const jointCols = Array.from({ length: n }, (_, j) => `j${j + 1}`);
    const ik = {
      id: 'ik',
      columns: ['solution', ...jointCols, 'miss', 'limits'],
      rows: r.ik.solutions.map((s): Cell[] => [
        word(s.label),
        ...s.q.map(joint),
        q(s.error, 'length'),
        word(s.withinLimits ? 'inLimits' : 'outLimits'),
      ]),
    };
    const tables = [
      ...(ik.rows.length ? [ik] : []),
      {
        id: 'T',
        columns: ['row', 'c1', 'c2', 'c3', 'c4'],
        rows: r.transforms[n - 1].map((row, i) => [
          word(`r${i + 1}`),
          ...row.map((v, j): Cell => (j === 3 && i < 3 ? q(v, 'length') : v)),
        ]),
      },
      {
        id: 'J',
        columns: ['row', ...jointCols],
        rows: r.J.map((row, i) => [word(JACOBIAN_ROWS[i]), ...row]),
      },
    ];
    const planar = isPlanar(rows) && convention === 'standard';
    const arm: Plot = {
      x: 'x',
      y: 'y',
      equal: true,
      series: [
        { name: 'armTop', points: r.joints.map(([x, y]) => [x, y]) },
        ...(planar
          ? []
          : [{ name: 'armFront' as const, points: r.joints.map(([x, , z]): [number, number] => [x, z]) }]),
      ],
    };
    const notes = [
      convention,
      'units',
      ...(endAngle ? ['endAngle'] : planar ? ['planarZ'] : []),
      ...(r.singular ? ['singular'] : []),
      ...(r.ik.reachable ? [] : ['unreachable']),
      ...(r.ik.solutions.some((s) => !s.withinLimits) ? ['limits'] : []),
    ];
    return { rows: out, steps: r.steps, tables, notes, plots: [arm, r.workspace] };
  },
};
