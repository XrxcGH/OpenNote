// The columns tool's form and results: the end conditions pick K, and the optional fields add slenderness, the
// Johnson parabola, and the secant formula as they are filled in.
import type { ResultRow, ToolSpec, Values } from '../kit/spec';
import { q } from '../kit/types';
import { END_K, PLATE_K, plateBuckling, solveColumn, stressCurves } from './engine';

const num = (values: Values, id: string) => values[id] as number;
const column = (v: Values) => v.problem !== 'plate';
const plate = (v: Values) => v.problem === 'plate';

function runPlate(values: Values) {
  const r = plateBuckling({
    edges: values.edges as keyof typeof PLATE_K,
    E: num(values, 'E'),
    nu: num(values, 'nu'),
    b: num(values, 'b'),
    t: num(values, 't'),
    a: num(values, 'a'),
    Sy: num(values, 'Sy'),
  });
  const rows: ResultRow[] = [
    { id: 'kPlate', value: r.k, sym: 'k' },
    ...(r.m === undefined ? [] : [{ id: 'm', value: r.m, sym: 'm' }]),
    { id: 'sigmaPlate', value: q(r.sigmaCr, 'stress'), sym: '\\sigma_{cr}', answer: true },
    { id: 'Ncr', value: q(r.Ncr, 'lineLoad'), sym: 'N_{cr}' },
  ];
  return { rows, steps: r.steps, notes: ['plate', ...(r.yields ? ['plateYield'] : [])] };
}

export const columnsSpec: ToolSpec = {
  fields: [
    { id: 'problem', type: 'choice', options: ['column', 'plate'], first: 'column' },
    { id: 'ends', type: 'choice', options: [...Object.keys(END_K), 'custom'], first: 'pinned', when: column },
    { id: 'K', type: 'quantity', kind: 'ratio', first: '1', when: (v) => column(v) && v.ends === 'custom' },
    { id: 'edges', type: 'choice', options: Object.keys(PLATE_K), first: 'ss', when: plate },
    { id: 'E', type: 'quantity', kind: 'modulus', first: '200 GPa' },
    { id: 'nu', type: 'quantity', kind: 'ratio', first: '0.3', when: plate },
    { id: 'b', type: 'quantity', kind: 'length', first: '500 mm', when: plate },
    { id: 't', type: 'quantity', kind: 'length', first: '10 mm', when: plate },
    { id: 'a', type: 'quantity', kind: 'length', first: '', optional: true, when: (v) => plate(v) && v.edges === 'ss' },
    { id: 'I', type: 'quantity', kind: 'inertia', first: '8e6 mm^4', when: column },
    { id: 'L', type: 'quantity', kind: 'span', first: '3 m', when: column },
    { id: 'A', type: 'quantity', kind: 'area', first: '4000 mm^2', optional: true, when: column },
    { id: 'Sy', type: 'quantity', kind: 'stress', first: '250 MPa', optional: true },
    { id: 'P', type: 'quantity', kind: 'bigForce', first: '', optional: true, when: column },
    { id: 'e', type: 'quantity', kind: 'length', first: '10 mm', optional: true, when: column },
    { id: 'c', type: 'quantity', kind: 'length', first: '100 mm', optional: true, when: column },
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
    {
      id: 'plate',
      values: { problem: 'plate', edges: 'ss', E: '200 GPa', nu: '0.3', b: '500 mm', t: '10 mm', a: '750 mm' },
    },
  ],
  run(values) {
    if (plate(values)) return runPlate(values);
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
