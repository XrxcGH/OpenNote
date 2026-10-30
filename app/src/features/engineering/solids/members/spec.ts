// The members tool's form, with four kinds of loading. Axial members are free or fixed at both ends, with a
// temperature change. Torsion covers round and thin-walled shafts, by torque or by power and speed. Bending at a
// point is unsymmetric, with VQ/(It). Combined loads act at a point of a rectangle or round section, and give the
// element's principal stresses.
import type { Outcome, ResultRow, ToolSpec, Values } from '../kit/spec';
import { q } from '../kit/types';
import { criteria } from '../stress/engine';
import {
  axialMember,
  bendingPoint,
  combinedPoint,
  torsionMember,
  type CombinedShape,
  type TorsionSection,
} from './engine';

const num = (values: Values, id: string) => values[id] as number;
const or0 = (values: Values, id: string) => (Number.isFinite(num(values, id)) ? num(values, id) : 0);
const isMode =
  (...modes: string[]) =>
  (v: Values) =>
    modes.includes(v.mode as string);
const torsionOf =
  (...sections: string[]) =>
  (v: Values) =>
    v.mode === 'torsion' && sections.includes(v.section as string);
const shapeOf =
  (...shapes: string[]) =>
  (v: Values) =>
    v.mode === 'combined' && shapes.includes(v.shape as string);

function runAxial(values: Values): Outcome {
  const fixed = values.ends === 'fixed';
  const r = axialMember({
    ends: fixed ? 'fixed' : 'free',
    P: num(values, 'P'),
    A: num(values, 'A'),
    L: num(values, 'L'),
    E: num(values, 'E'),
    a: num(values, 'a'),
    alpha: num(values, 'alpha'),
    dT: num(values, 'dT'),
  });
  const rows: ResultRow[] = fixed
    ? [
        { id: 'N1', value: q(r.N1, 'bigForce'), sym: 'N_1' },
        { id: 'N2', value: q(r.N2 ?? NaN, 'bigForce'), sym: 'N_2' },
        { id: 'sigma1', value: q(r.sigma1, 'stress'), sym: '\\sigma_1', answer: true },
        { id: 'sigma2', value: q(r.sigma2 ?? NaN, 'stress'), sym: '\\sigma_2', answer: true },
        { id: 'ua', value: q(r.delta, 'deflection'), sym: 'u_a' },
      ]
    : [
        { id: 'sigma', value: q(r.sigma1, 'stress'), sym: '\\sigma', answer: true },
        { id: 'delta', value: q(r.delta, 'deflection'), sym: '\\delta', answer: true },
        { id: 'strain', value: q(r.strain, 'strain'), sym: '\\varepsilon' },
      ];
  return { rows, steps: r.steps, notes: ['axialSigns', fixed ? 'fixedEnds' : 'freeEnd', 'elastic'] };
}

function runTorsion(values: Values): Outcome {
  const section = values.section as TorsionSection;
  const byPower = values.by === 'power';
  const r = torsionMember({
    section,
    ...(byPower ? { power: num(values, 'power'), speed: num(values, 'n') } : { T: num(values, 'T') }),
    L: num(values, 'L'),
    G: num(values, 'G'),
    d: num(values, 'd'),
    di: num(values, 'di'),
    bm: num(values, 'bm'),
    hm: num(values, 'hm'),
    t: num(values, 't'),
    s: num(values, 's'),
  });
  const rows: ResultRow[] = [];
  if (byPower) rows.push({ id: 'T', value: q(r.T, 'smallMoment'), sym: 'T', answer: true });
  if (r.Am !== undefined) rows.push({ id: 'Am', value: q(r.Am, 'area'), sym: 'A_m' });
  rows.push(
    { id: 'J', value: q(r.J, 'inertia'), sym: 'J' },
    { id: 'tauMax', value: q(r.tauMax, 'stress'), sym: '\\tau_{max}', answer: true },
  );
  if (r.tauMin !== undefined) rows.push({ id: 'tauMin', value: q(r.tauMin, 'stress'), sym: '\\tau_i' });
  rows.push(
    { id: 'phi', value: q(r.phi, 'radians'), sym: '\\phi', answer: true },
    { id: 'phiDeg', value: q(r.phi, 'angle') },
    { id: 'gamma', value: q(r.gammaMax, 'strain'), sym: '\\gamma_{max}' },
  );
  const notes = ['torsionElastic'];
  if (section === 'thinClosed') notes.push('bredt');
  if (section === 'thinOpen') notes.push('openWall');
  return { rows, steps: r.steps, notes };
}

function runBending(values: Values): Outcome {
  const r = bendingPoint({
    My: or0(values, 'My'),
    Mz: or0(values, 'Mz'),
    Iy: num(values, 'Iy'),
    Iz: num(values, 'Iz'),
    Iyz: num(values, 'Iyz'),
    y: num(values, 'y'),
    z: num(values, 'z'),
    N: num(values, 'N'),
    A: num(values, 'Ab'),
    V: num(values, 'V'),
    Q: num(values, 'Q'),
    t: num(values, 'tw'),
  });
  const rows: ResultRow[] = [
    { id: 'sigmaN', value: q(r.sigmaN, 'stress') },
    { id: 'sigmaY', value: q(r.sigmaY, 'stress') },
    { id: 'sigmaZ', value: q(r.sigmaZ, 'stress') },
    { id: 'sigma', value: q(r.sigma, 'stress'), sym: '\\sigma', answer: true },
    { id: 'alpha', value: q(r.alpha, 'angle'), sym: '\\alpha' },
  ];
  if (r.tau !== undefined) rows.push({ id: 'tau', value: q(r.tau, 'stress'), sym: '\\tau', answer: true });
  return { rows, steps: r.steps, notes: ['bendingAxes', 'neutralAngle', ...(r.tau === undefined ? [] : ['shearQ'])] };
}

function runCombined(values: Values): Outcome {
  const r = combinedPoint({
    shape: values.shape as CombinedShape,
    b: num(values, 'b'),
    h: num(values, 'h'),
    d: num(values, 'd'),
    di: num(values, 'di'),
    N: num(values, 'N'),
    Vy: num(values, 'Vy'),
    Vz: num(values, 'Vz'),
    T: num(values, 'T'),
    My: num(values, 'My'),
    Mz: num(values, 'Mz'),
    y: num(values, 'y'),
    z: num(values, 'z'),
  });
  const c = criteria(r.principal, { Sy: num(values, 'Sy') });
  const rows: ResultRow[] = [
    { id: 'sigma', value: q(r.sigma, 'stress'), sym: '\\sigma_x', answer: true },
    { id: 'tauXy', value: q(r.tauXy, 'stress'), sym: '\\tau_{xy}', answer: true },
    { id: 'tauXz', value: q(r.tauXz, 'stress'), sym: '\\tau_{xz}', answer: true },
    { id: 's1', value: q(r.principal[0], 'stress'), sym: '\\sigma_1' },
    { id: 's3', value: q(r.principal[2], 'stress'), sym: '\\sigma_3' },
    { id: 'tauAbs', value: q(c.tauMax, 'stress'), sym: '\\tau_{abs}' },
    { id: 'vonMises', value: q(c.vonMises, 'stress'), sym: "\\sigma'", answer: true },
  ];
  if (c.nVonMises !== undefined) rows.push({ id: 'nVonMises', value: c.nVonMises, sym: 'n_{vM}', answer: true });
  if (c.nTresca !== undefined) rows.push({ id: 'nTresca', value: c.nTresca, sym: 'n_T' });
  const notes = ['combinedAxes', 'element'];
  if (values.shape !== 'rect') notes.push('chordShear');
  return {
    rows,
    steps: [...r.steps, ...c.steps],
    tables: [
      {
        id: 'parts',
        columns: ['load', 'sigma', 'tauXy', 'tauXz'],
        rows: r.parts.map(([load, s, txy, txz]) => [load, q(s, 'stress'), q(txy, 'stress'), q(txz, 'stress')]),
      },
    ],
    notes,
  };
}

export const membersSpec: ToolSpec = {
  fields: [
    { id: 'mode', type: 'choice', options: ['axial', 'torsion', 'bending', 'combined'], first: 'torsion' },
    { id: 'ends', type: 'choice', options: ['free', 'fixed'], first: 'free', when: isMode('axial') },
    { id: 'P', type: 'quantity', kind: 'bigForce', first: '50 kN', when: isMode('axial') },
    { id: 'A', type: 'quantity', kind: 'area', first: '500 mm^2', when: isMode('axial') },
    { id: 'E', type: 'quantity', kind: 'modulus', first: '200 GPa', when: isMode('axial') },
    { id: 'a', type: 'quantity', kind: 'span', first: '0.4 m', when: (v) => v.mode === 'axial' && v.ends === 'fixed' },
    { id: 'alpha', type: 'quantity', kind: 'expansion', first: '', optional: true, when: isMode('axial') },
    { id: 'dT', type: 'quantity', kind: 'tempChange', first: '', optional: true, when: isMode('axial') },
    {
      id: 'section',
      type: 'choice',
      options: ['solid', 'hollow', 'thinClosed', 'thinOpen'],
      first: 'solid',
      when: isMode('torsion'),
    },
    { id: 'by', type: 'choice', options: ['torque', 'power'], first: 'torque', when: isMode('torsion') },
    {
      id: 'T',
      type: 'quantity',
      kind: 'smallMoment',
      first: '1 kN·m',
      when: (v) => (v.mode === 'torsion' && v.by === 'torque') || v.mode === 'combined',
      optional: true,
    },
    {
      id: 'power',
      type: 'quantity',
      kind: 'power',
      first: '10 kW',
      when: (v) => v.mode === 'torsion' && v.by === 'power',
    },
    {
      id: 'n',
      type: 'quantity',
      kind: 'speed',
      first: '1500 rpm',
      when: (v) => v.mode === 'torsion' && v.by === 'power',
    },
    { id: 'shape', type: 'choice', options: ['rect', 'circle', 'tube'], first: 'circle', when: isMode('combined') },
    { id: 'b', type: 'quantity', kind: 'length', first: '50 mm', when: shapeOf('rect') },
    { id: 'h', type: 'quantity', kind: 'length', first: '100 mm', when: shapeOf('rect') },
    {
      id: 'd',
      type: 'quantity',
      kind: 'length',
      first: '50 mm',
      when: (v) => torsionOf('solid', 'hollow')(v) || shapeOf('circle', 'tube')(v),
    },
    {
      id: 'di',
      type: 'quantity',
      kind: 'length',
      first: '30 mm',
      when: (v) => torsionOf('hollow')(v) || shapeOf('tube')(v),
    },
    { id: 'bm', type: 'quantity', kind: 'length', first: '100 mm', when: torsionOf('thinClosed') },
    { id: 'hm', type: 'quantity', kind: 'length', first: '50 mm', when: torsionOf('thinClosed') },
    { id: 's', type: 'quantity', kind: 'length', first: '150 mm', when: torsionOf('thinOpen') },
    { id: 't', type: 'quantity', kind: 'length', first: '2 mm', when: torsionOf('thinClosed', 'thinOpen') },
    { id: 'L', type: 'quantity', kind: 'span', first: '1 m', when: isMode('axial', 'torsion') },
    { id: 'G', type: 'quantity', kind: 'modulus', first: '80 GPa', when: isMode('torsion') },
    { id: 'N', type: 'quantity', kind: 'bigForce', first: '', optional: true, when: isMode('bending', 'combined') },
    { id: 'Ab', type: 'quantity', kind: 'area', first: '', optional: true, when: isMode('bending') },
    { id: 'Vy', type: 'quantity', kind: 'bigForce', first: '', optional: true, when: isMode('combined') },
    { id: 'Vz', type: 'quantity', kind: 'bigForce', first: '', optional: true, when: isMode('combined') },
    { id: 'My', type: 'quantity', kind: 'bigMoment', first: '', optional: true, when: isMode('bending', 'combined') },
    {
      id: 'Mz',
      type: 'quantity',
      kind: 'bigMoment',
      first: '10 kN·m',
      optional: true,
      when: isMode('bending', 'combined'),
    },
    { id: 'Iy', type: 'quantity', kind: 'inertia', first: '2e6 mm^4', when: isMode('bending') },
    { id: 'Iz', type: 'quantity', kind: 'inertia', first: '8e6 mm^4', when: isMode('bending') },
    { id: 'Iyz', type: 'quantity', kind: 'inertia', first: '', optional: true, when: isMode('bending') },
    { id: 'y', type: 'quantity', kind: 'length', first: '25 mm', when: isMode('bending', 'combined') },
    { id: 'z', type: 'quantity', kind: 'length', first: '0 mm', when: isMode('bending', 'combined') },
    { id: 'V', type: 'quantity', kind: 'bigForce', first: '', optional: true, when: isMode('bending') },
    { id: 'Q', type: 'quantity', kind: 'volume', first: '', optional: true, when: isMode('bending') },
    { id: 'tw', type: 'quantity', kind: 'length', first: '', optional: true, when: isMode('bending') },
    { id: 'Sy', type: 'quantity', kind: 'stress', first: '', optional: true, when: isMode('combined') },
  ],
  examples: [
    { id: 'shaft', values: { mode: 'torsion', section: 'solid', by: 'torque', T: '1 kN·m', d: '50 mm', L: '1 m' } },
    {
      id: 'box',
      values: { mode: 'torsion', section: 'thinClosed', by: 'torque', T: '500 N·m', bm: '100 mm', hm: '50 mm' },
    },
    { id: 'power', values: { mode: 'torsion', section: 'solid', by: 'power', power: '10 kW', n: '1500 rpm' } },
    {
      id: 'thermal',
      values: { mode: 'axial', ends: 'fixed', P: '0', A: '500 mm^2', alpha: '12e-6 K^-1', dT: '50 K' },
    },
    {
      id: 'skew',
      values: { mode: 'bending', My: '0', Mz: '10 kN·m', Iy: '2e6 mm^4', Iz: '8e6 mm^4', Iyz: '2e6 mm^4' },
    },
    {
      id: 'sign',
      values: {
        mode: 'combined',
        shape: 'circle',
        d: '50 mm',
        N: '',
        Vy: '5 kN',
        Vz: '',
        T: '1 kN·m',
        My: '',
        Mz: '0.5 kN·m',
        y: '0 mm',
        z: '25 mm',
      },
    },
  ],
  run(values) {
    if (values.mode === 'axial') return runAxial(values);
    if (values.mode === 'bending') return runBending(values);
    if (values.mode === 'combined') return runCombined(values);
    return runTorsion(values);
  },
};
