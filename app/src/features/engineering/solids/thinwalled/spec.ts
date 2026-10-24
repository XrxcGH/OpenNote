// The thin-walled tool's form: booms typed "x y B" and walls typed "i j t", one to a line, with shear forces
// through the shear center or at a point, a torque, and bending moments. Open, single-cell, and multi-cell sections
// all go through the same engine.
import type { DrawContext } from '../kit/picture';
import { typedLines } from '../kit/lines';
import { fixed, type ResultRow, type ToolSpec, type Values } from '../kit/spec';
import { fail, q } from '../kit/types';
import { fromShown, type System } from '../kit/units';
import { thinSvg } from './draw';
import { thinWalled, wallName, type Boom, type Wall } from './engine';

const num = (values: Values, id: string) => values[id] as number;
const or0 = (values: Values, id: string) => (Number.isFinite(num(values, id)) ? num(values, id) : 0);

function readBooms(text: string, system: System): Boom[] {
  return typedLines(text).map(({ words, line }) => {
    const n = words.map(Number);
    if (n.length !== 3 || !n.every(Number.isFinite)) fail('boomLine', String(line));
    return {
      x: fromShown(n[0], 'length', system),
      y: fromShown(n[1], 'length', system),
      B: fromShown(n[2], 'area', system),
    };
  });
}

function readWalls(text: string, system: System): Wall[] {
  return typedLines(text).map(({ words, line }) => {
    const n = words.map(Number);
    const sized = n.length === 3 || n.length === 4;
    if (!sized || !n.every(Number.isFinite) || !Number.isInteger(n[0]) || !Number.isInteger(n[1]))
      fail('wallLine', String(line));
    const wall = { i: n[0] - 1, j: n[1] - 1, t: fromShown(n[2], 'length', system) };
    return n.length === 4 ? { ...wall, tD: fromShown(n[3], 'length', system) } : wall;
  });
}

const BOX = '100 50 100\n-100 50 100\n-100 -50 100\n100 -50 100';
const BOX_WALLS = '1 2 1\n2 3 1\n3 4 1\n4 1 1';

export const thinwalledSpec: ToolSpec = {
  fields: [
    { id: 'booms', type: 'text', rows: 5, first: BOX, columns: fixed('length', 'length', 'area') },
    { id: 'walls', type: 'text', rows: 5, first: BOX_WALLS, columns: fixed(null, null, 'length', 'length') },
    { id: 'Sx', type: 'quantity', kind: 'bigForce', first: '', optional: true },
    { id: 'Sy', type: 'quantity', kind: 'bigForce', first: '10 kN', optional: true },
    { id: 'at', type: 'choice', options: ['shear', 'point'], first: 'shear' },
    { id: 'xp', type: 'quantity', kind: 'length', first: '0 mm', when: (v) => v.at === 'point' },
    { id: 'yp', type: 'quantity', kind: 'length', first: '0 mm', when: (v) => v.at === 'point' },
    { id: 'T', type: 'quantity', kind: 'smallMoment', first: '', optional: true },
    { id: 'Mx', type: 'quantity', kind: 'bigMoment', first: '', optional: true },
    { id: 'My', type: 'quantity', kind: 'bigMoment', first: '', optional: true },
    { id: 'G', type: 'quantity', kind: 'modulus', first: '', optional: true },
  ],
  examples: [
    { id: 'box', values: { booms: BOX, walls: BOX_WALLS, Sx: '', Sy: '10 kN', at: 'shear', T: '' } },
    {
      id: 'bredt',
      values: {
        booms: '0 0 100\n100 0 100\n100 50 100\n0 50 100',
        walls: '1 2 2\n2 3 2\n3 4 2\n4 1 2',
        Sy: '',
        T: '500 N·m',
      },
    },
    {
      id: 'twoCell',
      values: {
        booms: '0 0 100\n200 0 100\n300 0 100\n300 100 100\n200 100 100\n0 100 100',
        walls: '1 2 1\n2 3 1\n3 4 1\n4 5 1\n5 6 1\n6 1 1\n2 5 1',
        Sy: '',
        T: '1 kN·m',
        G: '27 GPa',
      },
    },
    {
      id: 'channel',
      values: {
        booms: '50 50 200\n0 50 300\n0 -50 300\n50 -50 200',
        walls: '1 2 2\n2 3 2\n3 4 2',
        Sy: '5 kN',
        at: 'shear',
      },
    },
    {
      id: 'skin',
      values: {
        booms: BOX,
        walls: '1 2 1 1\n2 3 1 1\n3 4 1 1\n4 1 1 1',
        Sy: '',
        Mx: '10 kN·m',
      },
    },
    {
      id: 'offset',
      values: { booms: BOX, walls: BOX_WALLS, Sy: '10 kN', at: 'point', xp: '50 mm', yp: '0 mm', Mx: '2 kN·m' },
    },
  ],
  run(values, system) {
    const r = thinWalled(readBooms(String(values.booms), system), readWalls(String(values.walls), system), {
      Sx: or0(values, 'Sx'),
      Sy: or0(values, 'Sy'),
      T: or0(values, 'T'),
      Mx: or0(values, 'Mx'),
      My: or0(values, 'My'),
      at: values.at === 'point' ? { x: num(values, 'xp'), y: num(values, 'yp') } : 'shear',
    });
    const { g, flows } = r;
    const taus = flows.flows.map((value, e) => value / g.walls[e].t);
    const worst = taus.reduce((best, value, e) => (Math.abs(value) > Math.abs(taus[best]) ? e : best), 0);
    const rows: ResultRow[] = [
      { id: 'xc', value: q(g.xc, 'length'), sym: '\\bar x' },
      { id: 'yc', value: q(g.yc, 'length'), sym: '\\bar y' },
      { id: 'Ixx', value: q(g.Ixx, 'inertia'), sym: 'I_{xx}' },
      { id: 'Iyy', value: q(g.Iyy, 'inertia'), sym: 'I_{yy}' },
      { id: 'Ixy', value: q(g.Ixy, 'inertia'), sym: 'I_{xy}' },
    ];
    if (r.center)
      rows.push(
        { id: 'xSC', value: q(r.center.x, 'length'), sym: 'x_{SC}', answer: true },
        { id: 'ySC', value: q(r.center.y, 'length'), sym: 'y_{SC}', answer: true },
      );
    rows.push(
      { id: 'qMax', value: q(flows.flows[worst], 'lineLoad'), sym: 'q_{max}', answer: true },
      { id: 'tauMax', value: q(taus[worst], 'stress'), sym: '\\tau_{max}' },
      { id: 'Gtheta', value: q(flows.Gtheta, 'stressPerLength'), sym: "G\\theta'", answer: true },
    );
    if (Number.isFinite(num(values, 'G')) && num(values, 'G') > 0)
      rows.push({ id: 'rate', value: q(flows.Gtheta / num(values, 'G'), 'twistRate'), sym: "\\theta'" });
    if (r.openTorsion)
      rows.push(
        { id: 'J', value: q(r.openTorsion.J, 'inertia'), sym: 'J' },
        { id: 'Tsc', value: q(r.openTorsion.T, 'smallMoment'), sym: 'T_{SC}' },
        { id: 'tauTorsion', value: q(r.openTorsion.tauMax, 'stress') },
      );
    const notes = ['idealized', 'signs'];
    if (g.cells.length === 0) notes.push('openSection');
    if (g.cells.length > 1) notes.push('multiCell');
    return {
      rows,
      steps: r.steps,
      tables: [
        {
          id: 'walls',
          columns: ['wall', 'L', 't', 'qb', 'q', 'tau'],
          rows: g.walls.map((w, e) => [
            wallName(g, e),
            q(g.lengths[e], 'length'),
            q(w.t, 'length'),
            q(flows.open[e], 'lineLoad'),
            q(flows.flows[e], 'lineLoad'),
            q(taus[e], 'stress'),
          ]),
        },
        {
          id: 'booms',
          columns: ['boom', 'x', 'y', 'B', 'sigma'],
          rows: g.booms.map((b, n) => [
            String(n + 1),
            q(b.x, 'length'),
            q(b.y, 'length'),
            q(b.B, 'area'),
            q(r.sigma[n], 'stress'),
          ]),
        },
        ...(g.cells.length === 0
          ? []
          : [
              {
                id: 'cells',
                columns: ['cell', 'A', 'q0'],
                rows: g.cells.map((cell, k) => [String(k + 1), q(cell.A, 'area'), q(flows.q0[k], 'lineLoad')]),
              },
            ]),
      ],
      notes,
      picture: { type: 'draw', draw: (ctx: DrawContext) => thinSvg(g, flows.flows, r.center, ctx) },
    };
  },
};
