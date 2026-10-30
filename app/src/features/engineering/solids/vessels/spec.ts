// The vessels tool's form: thin-walled cylinders and spheres, Lamé thick cylinders with their stress through the
// wall, press and shrink fits with the stress in the shaft and the hub, and Winkler curved beams of rectangles,
// circles, or stacked strips (for tees and I-sections).
import { typedLines } from '../kit/lines';
import type { PlotSeries } from '../kit/picture';
import { every, type Outcome, type ResultRow, type ToolSpec, type Values } from '../kit/spec';
import { fail, q } from '../kit/types';
import { fromShown, type System } from '../kit/units';
import { curvedBeam, shrinkFit, thickCylinder, thinVessel, type CurvedSection } from './engine';

const num = (values: Values, id: string) => values[id] as number;
const opt = (values: Values, id: string) => (Number.isFinite(num(values, id)) ? num(values, id) : undefined);
const isMode =
  (...modes: string[]) =>
  (v: Values) =>
    modes.includes(v.mode as string);
const curvedOf =
  (...sections: string[]) =>
  (v: Values) =>
    v.mode === 'curved' && sections.includes(v.section as string);

const span = (lo: number, hi: number, n = 60) => [...Array(n + 1).keys()].map((i) => lo + ((hi - lo) * i) / n);
const line = (xs: readonly number[], f: (x: number) => number) => xs.map((x) => [x, f(x)] as const);

function runThin(values: Values): Outcome {
  const shape = values.shape === 'sphere' ? 'sphere' : 'cylinder';
  const r = thinVessel(shape, num(values, 'p'), num(values, 'r'), num(values, 't'));
  const rows: ResultRow[] =
    shape === 'sphere'
      ? [{ id: 'sphere', value: q(r.hoop, 'stress'), sym: '\\sigma', answer: true }]
      : [
          { id: 'hoop', value: q(r.hoop, 'stress'), sym: '\\sigma_\\theta', answer: true },
          { id: 'axial', value: q(r.axial, 'stress'), sym: '\\sigma_a', answer: true },
        ];
  rows.push(
    { id: 'radial', value: q(r.radial, 'stress'), sym: '\\sigma_r' },
    { id: 'ratio', value: r.ratio, sym: 't/r' },
  );
  return { rows, steps: r.steps, notes: ['thinWall', r.ratio > 0.1 ? 'tooThickForThin' : 'thinOk', 'signs'] };
}

function runThick(values: Values): Outcome {
  const ri = num(values, 'ri');
  const ro = num(values, 'ro');
  const r = thickCylinder({
    ri,
    ro,
    pi: num(values, 'pi'),
    po: opt(values, 'po') ?? 0,
    ends: values.ends === 'open' ? 'open' : 'closed',
    E: num(values, 'E'),
    nu: num(values, 'nu'),
  });
  const rows: ResultRow[] = [
    { id: 'hoopIn', value: q(r.hoop(ri), 'stress'), sym: '\\sigma_\\theta(r_i)', answer: true },
    { id: 'radialIn', value: q(r.radial(ri), 'stress'), sym: '\\sigma_r(r_i)' },
    { id: 'hoopOut', value: q(r.hoop(ro), 'stress'), sym: '\\sigma_\\theta(r_o)', answer: true },
    { id: 'radialOut', value: q(r.radial(ro), 'stress'), sym: '\\sigma_r(r_o)' },
    { id: 'axial', value: q(r.axial, 'stress'), sym: '\\sigma_a' },
    { id: 'tauIn', value: q((r.hoop(ri) - r.radial(ri)) / 2, 'stress'), sym: '\\tau_{max}' },
  ];
  if (r.u) {
    rows.push(
      { id: 'uIn', value: q(r.u(ri), 'deflection'), sym: 'u(r_i)' },
      { id: 'uOut', value: q(r.u(ro), 'deflection'), sym: 'u(r_o)' },
    );
  }
  const radii = span(ri, ro, 5);
  return {
    rows,
    steps: r.steps,
    tables: [
      {
        id: 'wall',
        columns: ['r', 'radial', 'hoop'],
        rows: radii.map((x) => [q(x, 'length'), q(r.radial(x), 'stress'), q(r.hoop(x), 'stress')]),
      },
    ],
    notes: ['lame', 'signs', ...(r.u ? ['plane'] : [])],
    picture: {
      type: 'plot',
      plot: {
        x: { label: 'r', kind: 'length' },
        y: { label: 'stress', kind: 'stress' },
        series: [
          { id: 'hoop', points: line(span(ri, ro), r.hoop) },
          { id: 'radial', points: line(span(ri, ro), r.radial), dashed: true },
        ],
      },
    },
  };
}

function runFit(values: Values): Outcome {
  const [a, b, c] = [num(values, 'a'), num(values, 'b'), num(values, 'c')];
  const r = shrinkFit({
    a,
    b,
    c,
    delta: num(values, 'delta'),
    Ei: num(values, 'Ei'),
    nui: num(values, 'nui'),
    Eo: num(values, 'Eo'),
    nuo: num(values, 'nuo'),
    mu: opt(values, 'mu'),
    length: opt(values, 'lf'),
    alpha: opt(values, 'alpha'),
  });
  const rows: ResultRow[] = [
    { id: 'p', value: q(r.p, 'stress'), sym: 'p', answer: true },
    { id: 'hubBore', value: q(r.hubBore, 'stress'), sym: '\\sigma_{\\theta,hub}', answer: true },
    { id: 'hubOutside', value: q(r.hubOutside, 'stress') },
    { id: 'shaftSurface', value: q(r.shaftSurface, 'stress'), sym: '\\sigma_{\\theta,shaft}' },
    { id: 'shaftInside', value: q(r.shaftInside, 'stress') },
    { id: 'hubGrows', value: q(r.hubGrows, 'deflection') },
    { id: 'shaftShrinks', value: q(r.shaftShrinks, 'deflection') },
  ];
  if (r.torque !== undefined) rows.push({ id: 'torque', value: q(r.torque, 'smallMoment'), sym: 'T', answer: true });
  if (r.heat !== undefined) rows.push({ id: 'heat', value: q(r.heat, 'tempChange'), sym: '\\Delta T' });
  const shaft = thickCylinder({ ri: a, ro: b, pi: 0, po: r.p, ends: 'open' });
  const hub = thickCylinder({ ri: b, ro: c, pi: r.p, po: 0, ends: 'open' });
  const shaftHoop = a === 0 ? () => -r.p : shaft.hoop;
  const series: PlotSeries[] = [
    { id: 'shaftHoop', points: line(span(a, b), shaftHoop) },
    { id: 'hubHoop', points: line(span(b, c), hub.hoop) },
    {
      id: 'radial',
      points: [...line(span(a, b), a === 0 ? () => -r.p : shaft.radial), [b, NaN], ...line(span(b, c), hub.radial)],
      dashed: true,
    },
  ];
  return {
    rows,
    steps: r.steps,
    notes: ['fit', 'interference', 'signs'],
    picture: {
      type: 'plot',
      plot: { x: { label: 'r', kind: 'length' }, y: { label: 'stress', kind: 'stress' }, series },
    },
  };
}

function readStrips(text: string, system: System) {
  return typedLines(text).map(({ words, line: at }) => {
    const n = words.map(Number);
    if (n.length !== 3 || !n.every(Number.isFinite)) fail('stripLine', String(at));
    const [b, r1, r2] = n.map((value) => fromShown(value, 'length', system));
    return { b, r1, r2 };
  });
}

function runCurved(values: Values, system: System): Outcome {
  const kind = values.section as string;
  const section: CurvedSection =
    kind === 'circle'
      ? { kind: 'circle', d: num(values, 'd'), rc: num(values, 'rc') }
      : {
          kind: 'strips',
          strips:
            kind === 'strips'
              ? readStrips(String(values.strips), system)
              : [{ b: num(values, 'b'), r1: num(values, 'ri'), r2: num(values, 'ro') }],
        };
  const r = curvedBeam(section, num(values, 'M'), opt(values, 'N') ?? 0);
  const rows: ResultRow[] = [
    { id: 'A', value: q(r.A, 'area'), sym: 'A' },
    { id: 'rc', value: q(r.rc, 'length'), sym: 'r_c' },
    { id: 'rn', value: q(r.rn, 'length'), sym: 'r_n', answer: true },
    { id: 'e', value: q(r.e, 'length'), sym: 'e', answer: true },
    { id: 'inner', value: q(r.inner, 'stress'), sym: '\\sigma_i', answer: true },
    { id: 'outer', value: q(r.outer, 'stress'), sym: '\\sigma_o', answer: true },
    { id: 'straightInner', value: q(r.straightInner, 'stress') },
    { id: 'straightOuter', value: q(r.straightOuter, 'stress') },
  ];
  const radii = span(r.ri, r.ro);
  return {
    rows,
    steps: r.steps,
    notes: ['winkler', 'curvedSign'],
    picture: {
      type: 'plot',
      plot: {
        x: { label: 'r', kind: 'length' },
        y: { label: 'stress', kind: 'stress' },
        series: [
          { id: 'curved', points: line(radii, r.stress) },
          { id: 'straight', points: line(radii, r.straight), dashed: true },
        ],
        marks: [{ x: r.rn, y: r.stress(r.rn), id: 'neutral' }],
      },
    },
  };
}

export const vesselsSpec: ToolSpec = {
  fields: [
    { id: 'mode', type: 'choice', options: ['thin', 'thick', 'fit', 'curved'], first: 'thick' },
    { id: 'shape', type: 'choice', options: ['cylinder', 'sphere'], first: 'cylinder', when: isMode('thin') },
    { id: 'p', type: 'quantity', kind: 'stress', first: '2 MPa', when: isMode('thin') },
    { id: 'r', type: 'quantity', kind: 'length', first: '500 mm', when: isMode('thin') },
    { id: 't', type: 'quantity', kind: 'length', first: '10 mm', when: isMode('thin') },
    { id: 'section', type: 'choice', options: ['rect', 'circle', 'strips'], first: 'rect', when: isMode('curved') },
    { id: 'b', type: 'quantity', kind: 'length', first: '20 mm', when: curvedOf('rect') },
    {
      id: 'ri',
      type: 'quantity',
      kind: 'length',
      first: '50 mm',
      when: (v) => v.mode === 'thick' || curvedOf('rect')(v),
    },
    {
      id: 'ro',
      type: 'quantity',
      kind: 'length',
      first: '100 mm',
      when: (v) => v.mode === 'thick' || curvedOf('rect')(v),
    },
    { id: 'd', type: 'quantity', kind: 'length', first: '40 mm', when: curvedOf('circle') },
    { id: 'rc', type: 'quantity', kind: 'length', first: '60 mm', when: curvedOf('circle') },
    {
      id: 'strips',
      type: 'text',
      rows: 3,
      first: '60 50 60\n10 60 110',
      columns: every('length'),
      when: curvedOf('strips'),
    },
    { id: 'M', type: 'quantity', kind: 'bigMoment', first: '1 kN·m', when: isMode('curved') },
    { id: 'N', type: 'quantity', kind: 'bigForce', first: '', optional: true, when: isMode('curved') },
    { id: 'pi', type: 'quantity', kind: 'stress', first: '100 MPa', when: isMode('thick') },
    { id: 'po', type: 'quantity', kind: 'stress', first: '', optional: true, when: isMode('thick') },
    { id: 'ends', type: 'choice', options: ['closed', 'open'], first: 'closed', when: isMode('thick') },
    { id: 'E', type: 'quantity', kind: 'modulus', first: '', optional: true, when: isMode('thick') },
    { id: 'nu', type: 'quantity', kind: 'ratio', first: '', optional: true, when: isMode('thick') },
    { id: 'a', type: 'quantity', kind: 'length', first: '0 mm', when: isMode('fit') },
    { id: 'b2', type: 'quantity', kind: 'length', first: '25 mm', when: isMode('fit') },
    { id: 'c', type: 'quantity', kind: 'length', first: '50 mm', when: isMode('fit') },
    { id: 'delta', type: 'quantity', kind: 'deflection', first: '0.025 mm', when: isMode('fit') },
    { id: 'Ei', type: 'quantity', kind: 'modulus', first: '200 GPa', when: isMode('fit') },
    { id: 'nui', type: 'quantity', kind: 'ratio', first: '0.3', when: isMode('fit') },
    { id: 'Eo', type: 'quantity', kind: 'modulus', first: '200 GPa', when: isMode('fit') },
    { id: 'nuo', type: 'quantity', kind: 'ratio', first: '0.3', when: isMode('fit') },
    { id: 'mu', type: 'quantity', kind: 'ratio', first: '', optional: true, when: isMode('fit') },
    { id: 'lf', type: 'quantity', kind: 'length', first: '', optional: true, when: isMode('fit') },
    { id: 'alpha', type: 'quantity', kind: 'expansion', first: '', optional: true, when: isMode('fit') },
  ],
  examples: [
    { id: 'tank', values: { mode: 'thin', shape: 'cylinder', p: '2 MPa', r: '500 mm', t: '10 mm' } },
    { id: 'thick', values: { mode: 'thick', ri: '50 mm', ro: '100 mm', pi: '100 MPa', po: '' } },
    {
      id: 'shrink',
      values: { mode: 'fit', a: '0 mm', b2: '25 mm', c: '50 mm', delta: '0.025 mm', mu: '0.15', lf: '40 mm' },
    },
    { id: 'hook', values: { mode: 'curved', section: 'rect', b: '20 mm', ri: '50 mm', ro: '100 mm', M: '1 kN·m' } },
    { id: 'ring', values: { mode: 'curved', section: 'circle', d: '40 mm', rc: '60 mm', M: '0.5 kN·m' } },
    { id: 'tee', values: { mode: 'curved', section: 'strips', strips: '60 50 60\n10 60 110', M: '1 kN·m' } },
  ],
  run(values, system) {
    if (values.mode === 'thin') return runThin(values);
    if (values.mode === 'fit') return runFit({ ...values, b: values.b2 });
    if (values.mode === 'curved') return runCurved(values, system);
    return runThick(values);
  },
};
