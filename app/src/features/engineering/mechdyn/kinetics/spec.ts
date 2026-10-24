// The particle and planar rigid-body dynamics tool's form and results: motion from typed coordinates (rectangular
// or polar), relative motion of two points on a rigid body, an impact, or a body rolling down an incline.
import { unwrap } from '../kit/errors';
import { q } from '../kit/format';
import { num, str, type Outcome, type ResultRow, type ToolSpec, type Values } from '../kit/spec';
import { solveCoords, solveImpact, solveRigid, solveRolling, type RollingShape } from './engine';

const pair = (values: Values, x: string, y: string): [number, number] => [num(values, x), num(values, y)];

function coords(values: Values): Outcome {
  const polar = values.system === 'polar';
  const r = unwrap(
    solveCoords({
      system: polar ? 'polar' : 'rect',
      first: str(values, 'first'),
      second: str(values, 'second'),
      t: num(values, 't'),
      tEnd: num(values, 'tEnd'),
    }),
  );
  const rows: ResultRow[] = [
    { id: 'x', value: q(r.position[0], 'length'), sym: 'x' },
    { id: 'y', value: q(r.position[1], 'length'), sym: 'y' },
    { id: 'vx', value: q(r.velocity[0], 'velocity'), sym: 'v_x' },
    { id: 'vy', value: q(r.velocity[1], 'velocity'), sym: 'v_y' },
    { id: 'speed', value: q(r.speed, 'velocity'), sym: 'v', answer: true },
    { id: 'ax', value: q(r.acceleration[0], 'acceleration'), sym: 'a_x' },
    { id: 'ay', value: q(r.acceleration[1], 'acceleration'), sym: 'a_y' },
    { id: 'at', value: q(r.at, 'acceleration'), sym: 'a_t' },
    { id: 'an', value: q(r.an, 'acceleration'), sym: 'a_n' },
  ];
  if (r.rho !== null) rows.push({ id: 'rho', value: q(r.rho, 'length'), sym: '\\rho' });
  if (r.polar)
    rows.push(
      { id: 'vr', value: q(r.polar.vr, 'velocity'), sym: 'v_r', answer: true },
      { id: 'vth', value: q(r.polar.vth, 'velocity'), sym: 'v_\\theta', answer: true },
      { id: 'ar', value: q(r.polar.ar, 'acceleration'), sym: 'a_r', answer: true },
      { id: 'ath', value: q(r.polar.ath, 'acceleration'), sym: 'a_\\theta', answer: true },
    );
  return { rows, steps: r.steps, notes: ['coordsUnits'], plots: [r.path] };
}

function rigid(values: Values): Outcome {
  const r = unwrap(
    solveRigid({
      A: pair(values, 'Ax', 'Ay'),
      B: pair(values, 'Bx', 'By'),
      vA: pair(values, 'vAx', 'vAy'),
      aA: pair(values, 'aAx', 'aAy'),
      omega: num(values, 'omega'),
      alpha: num(values, 'alpha'),
    }),
  );
  const rows: ResultRow[] = [
    { id: 'vBx', value: q(r.vB[0], 'velocity'), sym: 'v_{Bx}', answer: true },
    { id: 'vBy', value: q(r.vB[1], 'velocity'), sym: 'v_{By}', answer: true },
    { id: 'vB', value: q(Math.hypot(...r.vB), 'velocity'), sym: 'v_B' },
    { id: 'aBx', value: q(r.aB[0], 'acceleration'), sym: 'a_{Bx}' },
    { id: 'aBy', value: q(r.aB[1], 'acceleration'), sym: 'a_{By}' },
    { id: 'aB', value: q(Math.hypot(...r.aB), 'acceleration'), sym: 'a_B' },
  ];
  if (r.ic) rows.push({ id: 'icx', value: q(r.ic[0], 'length') }, { id: 'icy', value: q(r.ic[1], 'length') });
  else rows.push({ id: 'ic', word: 'translation' });
  return { rows, steps: r.steps, notes: ['planar'] };
}

function impact(values: Values): Outcome {
  const r = unwrap(
    solveImpact({
      m1: num(values, 'm1'),
      m2: num(values, 'm2'),
      v1: pair(values, 'v1x', 'v1y'),
      v2: pair(values, 'v2x', 'v2y'),
      e: num(values, 'e'),
      line: num(values, 'line'),
    }),
  );
  const rows: ResultRow[] = [
    { id: 'n1After', value: q(r.n1After, 'velocity'), sym: "v_{1n}'", answer: true },
    { id: 'n2After', value: q(r.n2After, 'velocity'), sym: "v_{2n}'", answer: true },
    { id: 'v1xAfter', value: q(r.v1[0], 'velocity') },
    { id: 'v1yAfter', value: q(r.v1[1], 'velocity') },
    { id: 'v2xAfter', value: q(r.v2[0], 'velocity') },
    { id: 'v2yAfter', value: q(r.v2[1], 'velocity') },
    { id: 'energyBefore', value: q(r.energyBefore, 'energy'), sym: 'T_1' },
    { id: 'energyAfter', value: q(r.energyAfter, 'energy'), sym: 'T_2' },
    { id: 'energyLost', value: q(r.energyLost, 'energy'), sym: '\\Delta T', answer: true },
    { id: 'impulse', value: q(r.impulse, 'impulse'), sym: '\\hat F' },
  ];
  return { rows, steps: r.steps, notes: ['smooth'] };
}

function rolling(values: Values): Outcome {
  const shape = str(values, 'shape') as RollingShape;
  const mu = num(values, 'mu');
  const r = unwrap(
    solveRolling({
      shape,
      factor: shape === 'custom' ? num(values, 'factor') : 0,
      angle: num(values, 'angle'),
      mass: num(values, 'mass'),
      radius: num(values, 'radius'),
      g: num(values, 'g'),
      distance: num(values, 'distance'),
      mu: Number.isFinite(mu) ? mu : 0,
    }),
  );
  const rows: ResultRow[] = [
    { id: 'factor', value: r.factor, sym: 'I/(mr^2)' },
    { id: 'acceleration', value: q(r.acceleration, 'acceleration'), sym: 'a', answer: true },
    { id: 'alpha', value: q(r.alpha, 'angularAcc'), sym: '\\alpha' },
    { id: 'friction', value: q(r.friction, 'force'), sym: 'f' },
    { id: 'muNeeded', value: r.muNeeded, sym: '\\mu_\\text{needed}' },
    { id: 'slipping', word: r.slipping ? 'slips' : 'rolls' },
    { id: 'speedAfter', value: q(r.speed, 'velocity'), sym: 'v', answer: true },
  ];
  return { rows, steps: r.steps, notes: ['rigidBody'] };
}

const isMode = (mode: string) => (v: Values) => v.mode === mode;
const coord = isMode('coords');
const body = isMode('rigid');
const hit = isMode('impact');
const roll = isMode('rolling');

const quantity = (id: string, kind: 'length' | 'velocity' | 'acceleration' | 'mass', first: string, when = body) =>
  ({ id, type: 'quantity', kind, first, when }) as const;

export const kineticsSpec: ToolSpec = {
  fields: [
    { id: 'mode', type: 'choice', options: ['coords', 'rigid', 'impact', 'rolling'], first: 'coords' },
    { id: 'system', type: 'choice', options: ['polar', 'rect'], first: 'polar', when: coord },
    { id: 'first', type: 'text', first: '2*t^2', hint: true, when: coord },
    { id: 'second', type: 'text', first: 't', hint: true, when: coord },
    { id: 't', type: 'quantity', kind: 'time', first: '1 s', when: coord },
    { id: 'tEnd', type: 'quantity', kind: 'time', first: '2 s', when: coord },
    quantity('Ax', 'length', '0 m'),
    quantity('Ay', 'length', '0 m'),
    quantity('Bx', 'length', '0.3 m'),
    quantity('By', 'length', '0.4 m'),
    quantity('vAx', 'velocity', '2 m/s'),
    quantity('vAy', 'velocity', '0 m/s'),
    quantity('aAx', 'acceleration', '0 m/s^2'),
    quantity('aAy', 'acceleration', '0 m/s^2'),
    { id: 'omega', type: 'quantity', kind: 'angularSpeed', first: '4 rad/s', when: body },
    { id: 'alpha', type: 'quantity', kind: 'angularAcc', first: '-2 rad/s^2', when: body },
    quantity('m1', 'mass', '2 kg', hit),
    quantity('m2', 'mass', '3 kg', hit),
    quantity('v1x', 'velocity', '5 m/s', hit),
    quantity('v1y', 'velocity', '0 m/s', hit),
    quantity('v2x', 'velocity', '-1 m/s', hit),
    quantity('v2y', 'velocity', '0 m/s', hit),
    { id: 'e', type: 'quantity', kind: 'ratio', first: '0.8', when: hit },
    { id: 'line', type: 'quantity', kind: 'angle', first: '0', hint: true, when: hit },
    {
      id: 'shape',
      type: 'choice',
      options: ['disk', 'hoop', 'sphere', 'shell', 'custom'],
      first: 'disk',
      when: roll,
    },
    { id: 'factor', type: 'quantity', kind: 'ratio', first: '0.5', when: (v) => roll(v) && v.shape === 'custom' },
    { id: 'angle', type: 'quantity', kind: 'angle', first: '30', when: roll },
    quantity('mass', 'mass', '1 kg', roll),
    { id: 'radius', type: 'quantity', kind: 'small', first: '100 mm', when: roll },
    quantity('g', 'acceleration', '9.81 m/s^2', roll),
    quantity('distance', 'length', '1 m', roll),
    { id: 'mu', type: 'quantity', kind: 'ratio', first: '', optional: true, hint: true, when: roll },
  ],
  examples: [
    { id: 'polar', values: { mode: 'coords', system: 'polar', first: '2*t^2', second: 't', t: '1 s' } },
    { id: 'projectile', values: { mode: 'coords', system: 'rect', first: '20*t', second: '15*t - 4.905*t^2' } },
    { id: 'rigid', values: { mode: 'rigid' } },
    { id: 'impact', values: { mode: 'impact' } },
    { id: 'oblique', values: { mode: 'impact', v1y: '2 m/s', line: '30' } },
    { id: 'rolling', values: { mode: 'rolling' } },
    { id: 'slipping', values: { mode: 'rolling', shape: 'hoop', angle: '60', mu: '0.2' } },
  ],
  run(values) {
    if (values.mode === 'rigid') return rigid(values);
    if (values.mode === 'impact') return impact(values);
    if (values.mode === 'rolling') return rolling(values);
    return coords(values);
  },
};
