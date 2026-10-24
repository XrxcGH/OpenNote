// The linkage analyzer's form and results: a four-bar, a slider-crank with offset, or an inverted slider-crank, its
// link lengths, the circuit, the input angle and its rates, and a coupler point.
import { unwrap } from '../kit/errors';
import { q, word, type Cell } from '../kit/format';
import { num, str, type ResultRow, type ResultTable, type ToolSpec, type Values } from '../kit/spec';
import type { Plot } from '../types';
import { solveLinkage, type Circuit, type LinkageState, type LinkageType } from './engine';

const fourbar = (v: Values) => v.type === 'fourbar';
const slider = (v: Values) => v.type === 'slider';

/** The linkage drawn at the input angle: ground, crank, coupler, and output, then the coupler point. */
function drawing(type: LinkageType, s: LinkageState): Plot {
  const { O2, A, B, O4, C } = s.joints;
  const links: [number, number][] =
    type === 'inverted' ? [O2, A, O4!] : type === 'slider' ? [O2, A, B] : [O2, A, B, O4!];
  const coupler: [number, number][] = type === 'inverted' ? [O4!, C] : [A, C, B];
  return {
    x: 'x',
    y: 'y',
    equal: true,
    series: [
      { name: 'linkage', points: links },
      { name: 'couplerPoint', points: coupler },
    ],
  };
}

function stateRows(type: LinkageType, s: LinkageState): ResultRow[] {
  const ang = (id: string, v: number, sym: string, answer = true): ResultRow => ({
    id,
    value: q(v, 'angle'),
    sym,
    answer,
  });
  const rate = (id: string, v: number, sym: string): ResultRow => ({ id, value: q(v, 'angularSpeed'), sym });
  const acc = (id: string, v: number, sym: string): ResultRow => ({ id, value: q(v, 'angularAcc'), sym });
  if (type === 'fourbar')
    return [
      ang('theta3', s.theta3, '\\theta_3'),
      ang('theta4', s.theta4, '\\theta_4'),
      { ...rate('omega3', s.omega3, '\\omega_3'), answer: !s.toggle },
      { ...rate('omega4', s.omega4, '\\omega_4'), answer: !s.toggle },
      acc('alpha3', s.alpha3, '\\alpha_3'),
      acc('alpha4', s.alpha4, '\\alpha_4'),
      ang('transmission', s.transmission, '\\mu', false),
    ];
  const p = s.slider!;
  if (type === 'slider')
    return [
      ang('theta3', s.theta3, '\\theta_3', false),
      rate('omega3', s.omega3, '\\omega_3'),
      acc('alpha3', s.alpha3, '\\alpha_3'),
      { id: 'x', value: q(p.pos, 'small'), sym: 'x', answer: true },
      { id: 'v', value: q(p.vel, 'velocity'), sym: '\\dot x', answer: true },
      { id: 'a', value: q(p.acc, 'acceleration'), sym: '\\ddot x', answer: true },
      ang('transmission', s.transmission, '\\mu', false),
    ];
  return [
    ang('theta4', s.theta4, '\\theta_4'),
    { ...rate('omega4', s.omega4, '\\omega_4'), answer: true },
    { ...acc('alpha4', s.alpha4, '\\alpha_4'), answer: true },
    { id: 'b', value: q(p.pos, 'small'), sym: 'b' },
    { id: 'bDot', value: q(p.vel, 'velocity'), sym: '\\dot b' },
    { id: 'bDdot', value: q(p.acc, 'acceleration'), sym: '\\ddot b' },
    { id: 'coriolis', value: q(s.coriolis!, 'acceleration'), sym: '2\\dot b\\omega_4' },
    ang('transmission', s.transmission, '\\mu', false),
  ];
}

export const linkageSpec: ToolSpec = {
  fields: [
    { id: 'type', type: 'choice', options: ['fourbar', 'slider', 'inverted'], first: 'fourbar' },
    { id: 'a', type: 'quantity', kind: 'small', first: '20 mm' },
    { id: 'b', type: 'quantity', kind: 'small', first: '70 mm', when: (v) => v.type !== 'inverted' },
    { id: 'c', type: 'quantity', kind: 'small', first: '90 mm', when: fourbar },
    { id: 'e', type: 'quantity', kind: 'small', first: '0 mm', hint: true, when: slider },
    { id: 'd', type: 'quantity', kind: 'small', first: '60 mm', when: (v) => v.type !== 'slider' },
    { id: 'circuit', type: 'choice', options: ['open', 'crossed'], first: 'open', hint: true },
    { id: 'theta2', type: 'quantity', kind: 'angle', first: '30' },
    { id: 'omega2', type: 'quantity', kind: 'angularSpeed', first: '10 rad/s' },
    { id: 'alpha2', type: 'quantity', kind: 'angularAcc', first: '0 rad/s^2' },
    { id: 'p', type: 'quantity', kind: 'small', first: '35 mm', hint: true },
    { id: 'delta', type: 'quantity', kind: 'angle', first: '30' },
  ],
  examples: [
    { id: 'crankRocker', values: {} },
    { id: 'crossed', values: { circuit: 'crossed' } },
    {
      id: 'slider',
      values: { type: 'slider', a: '50 mm', b: '150 mm', e: '0 mm', theta2: '60', omega2: '100 rad/s' },
    },
    { id: 'offset', values: { type: 'slider', a: '50 mm', b: '150 mm', e: '20 mm', theta2: '60' } },
    { id: 'inverted', values: { type: 'inverted', a: '40 mm', d: '100 mm', theta2: '45', p: '150 mm', delta: '0' } },
    { id: 'tripleRocker', values: { a: '50 mm', theta2: '90' } },
  ],
  run(values) {
    const type = str(values, 'type') as LinkageType;
    const r = unwrap(
      solveLinkage({
        type,
        a: num(values, 'a'),
        b: type === 'inverted' ? 0 : num(values, 'b'),
        c: type === 'fourbar' ? num(values, 'c') : type === 'slider' ? num(values, 'e') : 0,
        d: type === 'slider' ? 0 : num(values, 'd'),
        circuit: str(values, 'circuit') as Circuit,
        theta2: num(values, 'theta2'),
        omega2: num(values, 'omega2'),
        alpha2: num(values, 'alpha2'),
        couplerDistance: num(values, 'p'),
        couplerAngle: num(values, 'delta'),
      }),
    );
    const s = r.state;
    const rows: ResultRow[] = [
      ...(r.grashof ? [{ id: 'grashof', word: r.grashof.cls }] : []),
      ...stateRows(type, s),
      { id: 'cx', value: q(s.coupler.pos[0], 'small'), sym: 'x_P' },
      { id: 'cy', value: q(s.coupler.pos[1], 'small'), sym: 'y_P' },
      { id: 'cv', value: q(Math.hypot(...s.coupler.vel), 'velocity'), sym: 'v_P' },
      { id: 'ca', value: q(Math.hypot(...s.coupler.acc), 'acceleration'), sym: 'a_P' },
    ];
    if (r.stroke) rows.push({ id: 'stroke', value: q(r.stroke.max - r.stroke.min, 'small'), sym: 's' });
    const tables: ResultTable[] = [];
    if (r.toggles.length)
      tables.push({
        id: 'toggles',
        columns: ['theta2', 'theta4', 'kind'],
        rows: r.toggles.map((t): Cell[] => [
          q(t.theta2, 'angle'),
          q(t.theta4, 'angle'),
          word(t.extended ? 'extended' : 'folded'),
        ]),
      });
    if (r.inputLimits.length)
      tables.push({ id: 'limits', columns: ['theta2'], rows: r.inputLimits.map((t): Cell[] => [q(t, 'angle')]) });
    const p = r.plots;
    const plots = [drawing(type, s), p.angles, p.velocities, p.accelerations, p.transmission, p.couplerCurve];
    const notes = [
      'signs',
      ...(type === 'slider' ? ['sliderAxis'] : type === 'inverted' ? ['invertedAxis'] : []),
      ...(r.grashof && r.grashof.cls !== 'crankRocker' && r.grashof.cls !== 'doubleCrank' ? ['gaps'] : []),
      ...(type === 'slider' && !r.stroke ? ['sliderLimited'] : []),
      'plotsSi',
    ];
    return { rows, steps: r.steps, tables, notes, plots };
  },
};
