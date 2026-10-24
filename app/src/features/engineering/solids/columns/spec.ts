// The columns tool's form and results: the end conditions pick K, and the optional fields add slenderness, the
// Johnson parabola, and the secant formula as they are filled in.
import type { ResultRow, ToolSpec, Values } from '../kit/spec';
import { q } from '../kit/types';
import { END_K, solveColumn, stressCurves } from './engine';

const num = (values: Values, id: string) => values[id] as number;

export const columnsSpec: ToolSpec = {
  fields: [
    { id: 'ends', type: 'choice', options: [...Object.keys(END_K), 'custom'], first: 'pinned' },
    { id: 'K', type: 'quantity', kind: 'ratio', first: '1', when: (v) => v.ends === 'custom' },
    { id: 'E', type: 'quantity', kind: 'modulus', first: '200 GPa' },
    { id: 'I', type: 'quantity', kind: 'inertia', first: '8e6 mm^4' },
    { id: 'L', type: 'quantity', kind: 'span', first: '3 m' },
    { id: 'A', type: 'quantity', kind: 'area', first: '4000 mm^2', optional: true },
    { id: 'Sy', type: 'quantity', kind: 'stress', first: '250 MPa', optional: true },
    { id: 'P', type: 'quantity', kind: 'bigForce', first: '', optional: true },
    { id: 'e', type: 'quantity', kind: 'length', first: '10 mm', optional: true },
    { id: 'c', type: 'quantity', kind: 'length', first: '100 mm', optional: true },
  ],
  examples: [
    { id: 'euler', values: { ends: 'pinned', E: '200 GPa', I: '8e6 mm^4', L: '3 m', A: '', Sy: '', P: '' } },
    {
      id: 'johnson',
      values: { ends: 'pinned', E: '200 GPa', I: '8e6 mm^4', L: '3 m', A: '4000 mm^2', Sy: '250 MPa', P: '' },
    },
    {
      id: 'secant',
      values: {
        ends: 'pinned',
        E: '200 GPa',
        I: '8e6 mm^4',
        L: '3 m',
        A: '4000 mm^2',
        Sy: '250 MPa',
        P: '500 kN',
        e: '10 mm',
        c: '100 mm',
      },
    },
  ],
  run(values) {
    const ends = values.ends as keyof typeof END_K | 'custom';
    const K = ends === 'custom' ? num(values, 'K') : END_K[ends];
    const r = solveColumn({
      E: num(values, 'E'),
      I: num(values, 'I'),
      L: num(values, 'L'),
      K,
      A: num(values, 'A'),
      Sy: num(values, 'Sy'),
      P: num(values, 'P'),
      e: Number.isFinite(num(values, 'e')) ? num(values, 'e') : 0,
      c: Number.isFinite(num(values, 'c')) ? num(values, 'c') : 0,
    });
    const rows: ResultRow[] = [
      { id: 'Pcr', value: q(r.Pcr, 'bigForce'), sym: 'P_{cr}', answer: true },
      { id: 'Le', value: q(r.Le, 'span') },
    ];
    if (r.r !== undefined) {
      rows.push(
        { id: 'r', value: q(r.r, 'length') },
        { id: 'slenderness', value: r.slenderness ?? NaN, sym: 'L_e/r' },
        { id: 'sigmaEuler', value: q(r.sigmaEuler ?? NaN, 'stress') },
      );
    }
    if (r.Cc !== undefined) {
      rows.push(
        { id: 'Cc', value: r.Cc, sym: 'C_c' },
        { id: 'regime', word: r.regime },
        { id: 'sigmaCr', value: q(r.sigmaCr ?? NaN, 'stress'), sym: '\\sigma_{cr}', answer: true },
        { id: 'Pallow', value: q(r.Pallow ?? NaN, 'bigForce') },
      );
    }
    if (r.sigmaMax !== undefined)
      rows.push({ id: 'sigmaMax', value: q(r.sigmaMax, 'stress'), sym: '\\sigma_{max}', answer: true });
    if (r.Pyield !== undefined) rows.push({ id: 'Pyield', value: q(r.Pyield, 'bigForce') });
    const E = num(values, 'E');
    const Sy = Number.isFinite(num(values, 'Sy')) ? num(values, 'Sy') : undefined;
    const upTo = Math.max(200, (r.slenderness ?? 0) * 1.5);
    const curves = stressCurves(E, Sy, upTo);
    const series = [{ id: 'euler', points: curves.euler }, ...(Sy ? [{ id: 'johnson', points: curves.johnson }] : [])];
    const marks =
      r.slenderness !== undefined && r.sigmaCr !== undefined ? [{ x: r.slenderness, y: r.sigmaCr, id: 'here' }] : [];
    return {
      rows,
      steps: r.steps,
      notes: ['ideal', 'kValues', ...(r.sigmaMax !== undefined ? ['secant'] : [])],
      ...(r.r === undefined
        ? {}
        : {
            picture: {
              type: 'plot' as const,
              plot: {
                x: { label: 'slenderness', kind: 'ratio' },
                y: { label: 'stress', kind: 'stress' },
                series,
                marks,
              },
            },
          }),
    };
  },
};
