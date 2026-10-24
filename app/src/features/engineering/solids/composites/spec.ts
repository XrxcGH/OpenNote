// The laminate tool's form: the ply's elastic constants and thickness, the layup typed in the usual notation, the
// loads per unit width, and optional strengths for the failure criteria and first-ply failure.
import type { ResultRow, ResultTable, ToolSpec, Values } from '../kit/spec';
import { q, type StepValue } from '../kit/types';
import type { Kind } from '../kit/units';
import { laminate, readLayup } from './engine';

const num = (values: Values, id: string) => values[id] as number;
const or0 = (values: Values, id: string) => (Number.isFinite(num(values, id)) ? num(values, id) : 0);
const STRENGTHS = ['Xt', 'Xc', 'Yt', 'Yc', 'S'] as const;

const matrix = (id: string, m: readonly (readonly number[])[], kind: Kind): ResultTable => ({
  id,
  columns: ['ij', 'c1', 'c2', 'c6'],
  rows: m.map((row, i) => [['1', '2', '6'][i], ...row.map((value) => q(value, kind))]),
});

export const compositesSpec: ToolSpec = {
  fields: [
    { id: 'E1', type: 'quantity', kind: 'modulus', first: '181 GPa' },
    { id: 'E2', type: 'quantity', kind: 'modulus', first: '10.3 GPa' },
    { id: 'nu12', type: 'quantity', kind: 'ratio', first: '0.28' },
    { id: 'G12', type: 'quantity', kind: 'modulus', first: '7.17 GPa' },
    { id: 't', type: 'quantity', kind: 'length', first: '0.125 mm' },
    { id: 'layup', type: 'text', rows: 1, first: '[0/90]s' },
    { id: 'Nx', type: 'quantity', kind: 'lineLoad', first: '100 N/mm', optional: true },
    { id: 'Ny', type: 'quantity', kind: 'lineLoad', first: '', optional: true },
    { id: 'Nxy', type: 'quantity', kind: 'lineLoad', first: '', optional: true },
    { id: 'Mx', type: 'quantity', kind: 'smallForce', first: '', optional: true },
    { id: 'My', type: 'quantity', kind: 'smallForce', first: '', optional: true },
    { id: 'Mxy', type: 'quantity', kind: 'smallForce', first: '', optional: true },
    { id: 'Xt', type: 'quantity', kind: 'stress', first: '', optional: true },
    { id: 'Xc', type: 'quantity', kind: 'stress', first: '', optional: true },
    { id: 'Yt', type: 'quantity', kind: 'stress', first: '', optional: true },
    { id: 'Yc', type: 'quantity', kind: 'stress', first: '', optional: true },
    { id: 'S', type: 'quantity', kind: 'stress', first: '', optional: true },
  ],
  examples: [
    { id: 'crossPly', values: { layup: '[0/90]s', Nx: '100 N/mm', Mx: '' } },
    { id: 'angle', values: { layup: '[±30]s', Nx: '100 N/mm', Mx: '' } },
    {
      id: 'quasi',
      values: {
        layup: '[0/45/-45/90]s',
        Nx: '100 N/mm',
        Xt: '1500 MPa',
        Xc: '1500 MPa',
        Yt: '40 MPa',
        Yc: '246 MPa',
        S: '68 MPa',
      },
    },
    { id: 'bent', values: { layup: '[0/90]', Nx: '', Mx: '10 N' } },
  ],
  run(values) {
    const given = STRENGTHS.filter((id) => Number.isFinite(num(values, id)));
    const strengths =
      given.length === STRENGTHS.length
        ? {
            Xt: num(values, 'Xt'),
            Xc: num(values, 'Xc'),
            Yt: num(values, 'Yt'),
            Yc: num(values, 'Yc'),
            S: num(values, 'S'),
          }
        : undefined;
    const degrees = readLayup(String(values.layup));
    const r = laminate({
      lamina: { E1: num(values, 'E1'), E2: num(values, 'E2'), nu12: num(values, 'nu12'), G12: num(values, 'G12') },
      t: num(values, 't'),
      angles: degrees.map((d) => (d * Math.PI) / 180),
      N: [or0(values, 'Nx'), or0(values, 'Ny'), or0(values, 'Nxy')],
      M: [or0(values, 'Mx'), or0(values, 'My'), or0(values, 'Mxy')],
      ...(strengths ? { strengths } : {}),
    });
    const rows: ResultRow[] = [
      { id: 'Q11', value: q(r.Q.Q11, 'stress'), sym: 'Q_{11}' },
      { id: 'Q12', value: q(r.Q.Q12, 'stress'), sym: 'Q_{12}' },
      { id: 'Q22', value: q(r.Q.Q22, 'stress'), sym: 'Q_{22}' },
      { id: 'Q66', value: q(r.Q.Q66, 'stress'), sym: 'Q_{66}' },
      { id: 'h', value: q(r.h, 'length'), sym: 'h' },
      { id: 'Ex', value: q(r.engineering.Ex, 'modulus'), sym: 'E_x', answer: true },
      { id: 'Ey', value: q(r.engineering.Ey, 'modulus'), sym: 'E_y', answer: true },
      { id: 'Gxy', value: q(r.engineering.Gxy, 'modulus'), sym: 'G_{xy}', answer: true },
      { id: 'nuxy', value: r.engineering.nuxy, sym: '\\nu_{xy}' },
      { id: 'ex', value: q(r.e0[0], 'strain'), sym: '\\varepsilon_x^0' },
      { id: 'ey', value: q(r.e0[1], 'strain'), sym: '\\varepsilon_y^0' },
      { id: 'gxy', value: q(r.e0[2], 'strain'), sym: '\\gamma_{xy}^0' },
      { id: 'kx', value: q(r.kappa[0], 'curvature'), sym: '\\kappa_x' },
      { id: 'ky', value: q(r.kappa[1], 'curvature'), sym: '\\kappa_y' },
      { id: 'kxy', value: q(r.kappa[2], 'curvature'), sym: '\\kappa_{xy}' },
    ];
    const notes = ['axes', 'plies', 'moments'];
    const faceColumns = ['ply', 'z', 'sx', 'sy', 'txy', 's1', 's2', 't12'];
    if (strengths) {
      const ratios = r.faces.map((f) => f.ratioWu ?? Infinity);
      const worst = ratios.indexOf(Math.min(...ratios));
      rows.push(
        { id: 'ratio', value: ratios[worst], sym: 'R_{TW}', answer: true },
        { id: 'firstPly', value: r.faces[worst].ply },
        { id: 'ratioMax', value: Math.min(...r.faces.map((f) => f.ratioMax ?? Infinity)), sym: 'R_{MS}' },
        { id: 'ratioHill', value: Math.min(...r.faces.map((f) => f.ratioHill ?? Infinity)), sym: 'R_{TH}' },
      );
      faceColumns.push('maxStress', 'tsaiHill', 'tsaiWu');
      notes.push('failure');
    }
    const faceRows = r.faces.map((f) => {
      const cells: StepValue[] = [
        String(f.ply),
        q(f.z, 'length'),
        ...f.global.map((s) => q(s, 'stress')),
        ...f.local.map((s) => q(s, 'stress')),
      ];
      if (strengths) cells.push(f.maxStress ?? NaN, f.tsaiHill ?? NaN, f.tsaiWu ?? NaN);
      return cells;
    });
    const qbarRows = r.Qbar.map((Qk, k) => [
      String(k + 1),
      q((degrees[k] * Math.PI) / 180, 'angle'),
      ...[Qk[0][0], Qk[0][1], Qk[0][2], Qk[1][1], Qk[1][2], Qk[2][2]].map((value) => q(value, 'stress')),
    ]);
    return {
      rows,
      steps: r.steps,
      tables: [
        { id: 'qbar', columns: ['ply', 'theta', 'Q11', 'Q12', 'Q16', 'Q22', 'Q26', 'Q66'], rows: qbarRows },
        matrix('A', r.A, 'lineLoad'),
        matrix('B', r.B, 'smallForce'),
        matrix('D', r.D, 'moment'),
        { id: 'faces', columns: faceColumns, rows: faceRows },
      ],
      notes,
      picture: {
        type: 'plot',
        plot: {
          x: { label: 'stress', kind: 'stress' },
          y: { label: 'z', kind: 'length' },
          series: [
            { id: 'sx', points: r.faces.map((f) => [f.global[0], f.z] as const) },
            { id: 'sy', points: r.faces.map((f) => [f.global[1], f.z] as const), dashed: true },
          ],
        },
      },
    };
  },
};
