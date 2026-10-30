// The robot dynamics and control tool's form and results: a planar arm of up to three links typed one per line, a
// configuration with its rates and accelerations, and a joint-space controller with its gains and reference path.
import { fail, unwrap } from '../kit/errors';
import { q, word } from '../kit/format';
import { readList, readRows } from '../kit/lines';
import { num, str, type ResultRow, type ToolSpec, type Values } from '../kit/spec';
import { fromShown, type System } from '../kit/units';
import { solveRobotDyn, type ArmLink, type Controller, type Trajectory } from './engine';

const DEG = Math.PI / 180;

/** Links typed as "length mass com inertia", in the chosen system's units. */
export function readLinks(text: string, system: System): ArmLink[] {
  const rows = readRows(text, 4);
  if (rows.length > 3) return fail('robotLinks');
  return rows.map(({ numbers: [length, mass, com, inertia] }) => ({
    length: fromShown(length, 'length', system),
    mass: fromShown(mass, 'mass', system),
    com: fromShown(com, 'length', system),
    inertia: fromShown(inertia, 'massInertia', system),
  }));
}

const joints = (values: Values, id: string, scale = 1) => readList(str(values, id)).map((v) => v * scale);

export const robotDynSpec: ToolSpec = {
  fields: [
    { id: 'links', type: 'text', first: '1 1 1 0\n1 1 1 0', rows: 3, hint: true },
    { id: 'g', type: 'quantity', kind: 'acceleration', first: '9.81 m/s^2' },
    { id: 'q', type: 'text', first: '0 0', hint: true },
    { id: 'qd', type: 'text', first: '0 0', hint: true },
    { id: 'qdd', type: 'text', first: '0 0', hint: true },
    { id: 'controller', type: 'choice', options: ['ct', 'pdg', 'pd', 'none'], first: 'ct' },
    { id: 'kp', type: 'quantity', kind: 'ratio', first: '100', hint: true, when: (v) => v.controller !== 'none' },
    { id: 'kd', type: 'quantity', kind: 'ratio', first: '20', hint: true, when: (v) => v.controller !== 'none' },
    { id: 'trajectory', type: 'choice', options: ['step', 'quintic'], first: 'step' },
    { id: 'target', type: 'text', first: '45 30', hint: true },
    { id: 'moveTime', type: 'quantity', kind: 'time', first: '2 s', when: (v) => v.trajectory === 'quintic' },
    { id: 'duration', type: 'quantity', kind: 'time', first: '3 s' },
  ],
  examples: [
    { id: 'points', values: {} },
    { id: 'pdg', values: { controller: 'pdg', kp: '200', kd: '40', duration: '8 s' } },
    { id: 'pd', values: { controller: 'pd', kp: '200', kd: '40', duration: '8 s' } },
    {
      id: 'three',
      values: {
        links: '0.5 3 0.25 0.06\n0.4 2 0.2 0.03\n0.2 0.5 0.1 0.002',
        q: '-90 0 0',
        qd: '0 0 0',
        qdd: '0 0 0',
        trajectory: 'quintic',
        target: '30 45 -30',
        moveTime: '1.5 s',
        duration: '2 s',
      },
    },
  ],
  run(values, system) {
    const links = readLinks(str(values, 'links'), system);
    const controller = str(values, 'controller') as Controller;
    const r = unwrap(
      solveRobotDyn({
        links,
        g: num(values, 'g'),
        q: joints(values, 'q', DEG),
        qd: joints(values, 'qd'),
        qdd: joints(values, 'qdd'),
        controller,
        kp: controller === 'none' ? 0 : num(values, 'kp'),
        kd: controller === 'none' ? 0 : num(values, 'kd'),
        trajectory: str(values, 'trajectory') as Trajectory,
        target: joints(values, 'target', DEG),
        moveTime: str(values, 'trajectory') === 'quintic' ? num(values, 'moveTime') : 0,
        duration: num(values, 'duration'),
      }),
    );
    const n = links.length;
    const each = (id: string, sym: string, list: readonly number[], kind: 'moment' | 'angle'): ResultRow[] =>
      list.map((v, i) => ({ id, vars: { n: String(i + 1) }, value: q(v, kind), sym: `${sym}_${i + 1}` }));
    const rows: ResultRow[] = [
      ...each('tau', '\\tau', r.torque, 'moment').map((row) => ({ ...row, answer: true })),
      ...each('G', 'G', r.G, 'moment'),
      ...each('error', 'e', r.finalError, 'angle'),
    ];
    const columns = ['row', ...Array.from({ length: n }, (_, j) => `c${j + 1}`)];
    const tables = [
      {
        id: 'M',
        columns,
        rows: r.M.map((row, i) => [word(`r${i + 1}`), ...row.map((v) => q(v, 'massInertia'))]),
      },
    ];
    const notes = ['plane', 'angles', controller === 'ct' ? 'exact' : 'gains'];
    return { rows, steps: r.steps, tables, notes, plots: [r.angles, r.errors, r.torques] };
  },
};
