// The stress tool's form: plane stress (with an optional turned element), a full 3D tensor, or a strain rosette,
// and the optional strengths that add the failure criteria and their factors of safety.
import type { DrawContext } from '../kit/picture';
import type { Outcome, ResultRow, ResultTable, ToolSpec, Values } from '../kit/spec';
import { q, type KitStep } from '../kit/types';
import { criteria, hookePlane, planeStress, rosette, tensorStress, type RosetteType } from './engine';
import { mohrSvg, type MohrSpec } from './mohr';

const num = (values: Values, id: string) => values[id] as number;
const given = (values: Values, id: string) => Number.isFinite(num(values, id));
const isMode = (mode: string) => (v: Values) => v.mode === mode;
const stressOf = (mode: string[]) => (v: Values) => mode.includes(v.mode as string);

const S = 'kitSolids.stress.plot.';

function strengthRows(principal: readonly number[], values: Values, rows: ResultRow[], steps: KitStep[]) {
  const c = criteria(principal, {
    Sy: num(values, 'Sy'),
    Sut: num(values, 'Sut'),
    Suc: num(values, 'Suc'),
  });
  rows.push(
    { id: 'tauAbs', value: q(c.tauMax, 'stress') },
    { id: 'vonMises', value: q(c.vonMises, 'stress'), sym: "\\sigma'", answer: true },
  );
  if (c.nVonMises !== undefined) rows.push({ id: 'nVonMises', value: c.nVonMises, sym: 'n_{vM}', answer: true });
  if (c.nTresca !== undefined) rows.push({ id: 'nTresca', value: c.nTresca, sym: 'n_{T}' });
  if (c.nNormal !== undefined) rows.push({ id: 'nNormal', value: c.nNormal, sym: 'n_{MNS}' });
  if (c.nMohr !== undefined) rows.push({ id: 'nMohr', value: c.nMohr, sym: 'n_{CM}' });
  steps.push(...c.steps);
}

function circleThrough(a: number, b: number) {
  return { c: (a + b) / 2, r: Math.abs(a - b) / 2 };
}

const draw = (spec: MohrSpec) => ({ type: 'draw' as const, draw: (ctx: DrawContext) => mohrSvg(spec, ctx) });

function runPlane(values: Values): Outcome {
  const sx = num(values, 'sx');
  const sy = num(values, 'sy');
  const txy = num(values, 'txy');
  const r = planeStress({ sx, sy, txy }, given(values, 'theta') ? num(values, 'theta') : undefined);
  const steps = [...r.steps];
  const rows: ResultRow[] = [
    { id: 's1', value: q(r.s1, 'stress'), sym: '\\sigma_1', answer: true },
    { id: 's2', value: q(r.s2, 'stress'), sym: '\\sigma_2', answer: true },
    { id: 'thetaP', value: q(r.thetaP, 'angle'), sym: '\\theta_p' },
    { id: 'tauIn', value: q(r.R, 'stress'), sym: '\\tau_{max}', answer: true },
    { id: 'thetaS', value: q(r.thetaS, 'angle'), sym: '\\theta_s' },
    { id: 'average', value: q(r.C, 'stress'), sym: '\\sigma_{avg}' },
  ];
  if (r.rotated) {
    rows.push(
      { id: 'sxr', value: q(r.rotated.sx, 'stress'), sym: "\\sigma_{x'}" },
      { id: 'syr', value: q(r.rotated.sy, 'stress'), sym: "\\sigma_{y'}" },
      { id: 'txyr', value: q(r.rotated.txy, 'stress'), sym: "\\tau_{x'y'}" },
    );
  }
  strengthRows([r.s1, r.s2, 0], values, rows, steps);
  return {
    rows,
    steps,
    notes: ['signs', 'planeStress', 'mohr', ...criteriaNotes(values)],
    picture: draw({
      kind: 'stress',
      circles: [{ c: r.C, r: r.R }, circleThrough(r.s1, 0), circleThrough(r.s2, 0)],
      points: [
        { x: sx, y: txy, label: 'x' },
        { x: sy, y: -txy, label: 'y' },
      ],
      axes: { x: `${S}sigma`, y: `${S}tau` },
    }),
  };
}

function runTensor(values: Values): Outcome {
  const [sx, sy, sz] = ['sx', 'sy', 'sz'].map((id) => num(values, id));
  const [txy, tyz, tzx] = ['txy', 'tyz', 'tzx'].map((id) => num(values, id));
  const r = tensorStress([
    [sx, txy, tzx],
    [txy, sy, tyz],
    [tzx, tyz, sz],
  ]);
  const [s1, s2, s3] = r.values;
  const steps = [...r.steps];
  const rows: ResultRow[] = [
    { id: 's1', value: q(s1, 'stress'), sym: '\\sigma_1', answer: true },
    { id: 's2', value: q(s2, 'stress'), sym: '\\sigma_2', answer: true },
    { id: 's3', value: q(s3, 'stress'), sym: '\\sigma_3', answer: true },
  ];
  strengthRows(r.values, values, rows, steps);
  const table: ResultTable = {
    id: 'directions',
    columns: ['principal', 'lx', 'ly', 'lz'],
    rows: r.values.map((value, i) => [q(value, 'stress'), ...r.directions[i]]),
  };
  return {
    rows,
    steps,
    tables: [table],
    notes: ['signs', 'directions', ...criteriaNotes(values)],
    picture: draw({
      kind: 'stress',
      circles: [circleThrough(s1, s3), circleThrough(s1, s2), circleThrough(s2, s3)],
      points: [],
      axes: { x: `${S}sigma`, y: `${S}tau` },
    }),
  };
}

function runRosette(values: Values): Outcome {
  const r = rosette(values.rosette as RosetteType, num(values, 'ea'), num(values, 'eb'), num(values, 'ec'));
  const steps = [...r.steps];
  const rows: ResultRow[] = [
    { id: 'ex', value: q(r.ex, 'strain'), sym: '\\varepsilon_x' },
    { id: 'ey', value: q(r.ey, 'strain'), sym: '\\varepsilon_y' },
    { id: 'gxy', value: q(r.gxy, 'strain'), sym: '\\gamma_{xy}' },
    { id: 'e1', value: q(r.e1, 'strain'), sym: '\\varepsilon_1', answer: true },
    { id: 'e2', value: q(r.e2, 'strain'), sym: '\\varepsilon_2', answer: true },
    { id: 'thetaE', value: q(r.thetaP, 'angle'), sym: '\\theta_p', answer: true },
    { id: 'gammaMax', value: q(r.gammaMax, 'strain'), sym: '\\gamma_{max}' },
  ];
  const notes = ['rosette'];
  if (given(values, 'E') && given(values, 'nu')) {
    const h = hookePlane(r.ex, r.ey, r.gxy, num(values, 'E'), num(values, 'nu'));
    const p = planeStress(h);
    steps.push(h.step, ...p.steps.slice(0, 3));
    rows.push(
      { id: 'sx', value: q(h.sx, 'stress'), sym: '\\sigma_x' },
      { id: 'sy', value: q(h.sy, 'stress'), sym: '\\sigma_y' },
      { id: 'txy', value: q(h.txy, 'stress'), sym: '\\tau_{xy}' },
      { id: 's1', value: q(p.s1, 'stress'), sym: '\\sigma_1' },
      { id: 's2', value: q(p.s2, 'stress'), sym: '\\sigma_2' },
    );
    strengthRows([p.s1, p.s2, 0], values, rows, steps);
    notes.push('hooke', ...criteriaNotes(values));
  }
  return {
    rows,
    steps,
    notes,
    picture: draw({
      kind: 'strain',
      circles: [{ c: (r.e1 + r.e2) / 2, r: (r.e1 - r.e2) / 2 }],
      points: [
        { x: r.ex, y: r.gxy / 2, label: 'x' },
        { x: r.ey, y: -r.gxy / 2, label: 'y' },
      ],
      axes: { x: `${S}epsilon`, y: `${S}halfGamma` },
    }),
  };
}

function criteriaNotes(values: Values): string[] {
  return [...(given(values, 'Sy') ? ['ductile'] : []), ...(given(values, 'Sut') ? ['brittle'] : [])];
}

export const stressSpec: ToolSpec = {
  fields: [
    { id: 'mode', type: 'choice', options: ['plane', 'tensor', 'rosette'], first: 'plane' },
    { id: 'sx', type: 'quantity', kind: 'stress', first: '80 MPa', when: stressOf(['plane', 'tensor']) },
    { id: 'sy', type: 'quantity', kind: 'stress', first: '-40 MPa', when: stressOf(['plane', 'tensor']) },
    { id: 'sz', type: 'quantity', kind: 'stress', first: '0 MPa', when: isMode('tensor') },
    { id: 'txy', type: 'quantity', kind: 'stress', first: '25 MPa', when: stressOf(['plane', 'tensor']) },
    { id: 'tyz', type: 'quantity', kind: 'stress', first: '0 MPa', when: isMode('tensor') },
    { id: 'tzx', type: 'quantity', kind: 'stress', first: '0 MPa', when: isMode('tensor') },
    { id: 'theta', type: 'quantity', kind: 'angle', first: '', optional: true, when: isMode('plane') },
    { id: 'rosette', type: 'choice', options: ['rect', 'delta'], first: 'rect', when: isMode('rosette') },
    { id: 'ea', type: 'quantity', kind: 'strain', first: '500 µε', when: isMode('rosette') },
    { id: 'eb', type: 'quantity', kind: 'strain', first: '300 µε', when: isMode('rosette') },
    { id: 'ec', type: 'quantity', kind: 'strain', first: '-100 µε', when: isMode('rosette') },
    { id: 'E', type: 'quantity', kind: 'modulus', first: '', optional: true, when: isMode('rosette') },
    { id: 'nu', type: 'quantity', kind: 'ratio', first: '', optional: true, when: isMode('rosette') },
    { id: 'Sy', type: 'quantity', kind: 'stress', first: '', optional: true },
    { id: 'Sut', type: 'quantity', kind: 'stress', first: '', optional: true },
    { id: 'Suc', type: 'quantity', kind: 'stress', first: '', optional: true },
  ],
  examples: [
    { id: 'plane', values: { mode: 'plane', sx: '80 MPa', sy: '-40 MPa', txy: '25 MPa', theta: '30', Sy: '250 MPa' } },
    {
      id: 'tensor',
      values: {
        mode: 'tensor',
        sx: '50 MPa',
        sy: '-20 MPa',
        sz: '10 MPa',
        txy: '30 MPa',
        tyz: '-10 MPa',
        tzx: '20 MPa',
        Sy: '250 MPa',
      },
    },
    {
      id: 'rosette',
      values: { mode: 'rosette', rosette: 'rect', ea: '500 µε', eb: '300 µε', ec: '-100 µε', E: '200 GPa', nu: '0.3' },
    },
    {
      id: 'brittle',
      values: { mode: 'plane', sx: '-60 MPa', sy: '20 MPa', txy: '-30 MPa', theta: '', Sut: '200 MPa', Suc: '700 MPa' },
    },
  ],
  run(values) {
    if (values.mode === 'tensor') return runTensor(values);
    if (values.mode === 'rosette') return runRosette(values);
    return runPlane(values);
  },
};
