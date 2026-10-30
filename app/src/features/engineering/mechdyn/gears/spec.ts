// The gears tool's form and results: a spur gear pair (geometry, contact ratio, interference, and tooth forces), a
// simple or compound train typed one mesh per line, or a planetary train by the tabular method.
import { unwrap } from '../kit/errors';
import { q, word } from '../kit/format';
import { readRows } from '../kit/lines';
import { num, str, type Outcome, type ResultRow, type ToolSpec, type Values } from '../kit/spec';
import { MEMBERS, solveGearPair, solvePlanetary, solveTrain, type Member, type PlanetaryInput } from './engine';

const PLANET_MEMBERS = ['sun', 'ring', 'carrier'] as const;

function pair(values: Values): Outcome {
  const P = num(values, 'pitch');
  const module = str(values, 'sizing') === 'diametral' ? 0.0254 / P : num(values, 'module');
  const r = unwrap(
    solveGearPair({
      module,
      N1: num(values, 'N1'),
      N2: num(values, 'N2'),
      phi: num(values, 'phi'),
      addendum: num(values, 'addendum'),
      power: num(values, 'power'),
      speed: num(values, 'speed'),
    }),
  );
  const rows: ResultRow[] = [
    { id: 'center', value: q(r.center, 'small'), sym: 'C', answer: true },
    { id: 'ratio', value: r.ratio, sym: 'm_G' },
    { id: 'r1', value: q(r.r1, 'small'), sym: 'r_1' },
    { id: 'r2', value: q(r.r2, 'small'), sym: 'r_2' },
    { id: 'rb1', value: q(r.rb1, 'small'), sym: 'r_{b1}' },
    { id: 'rb2', value: q(r.rb2, 'small'), sym: 'r_{b2}' },
    { id: 'ra1', value: q(r.ra1, 'small') },
    { id: 'ra2', value: q(r.ra2, 'small') },
    { id: 'rf1', value: q(r.rf1, 'small') },
    { id: 'rf2', value: q(r.rf2, 'small') },
    { id: 'circularPitch', value: q(r.circularPitch, 'small'), sym: 'p' },
    { id: 'basePitch', value: q(r.basePitch, 'small'), sym: 'p_b' },
    { id: 'contactLength', value: q(r.contactLength, 'small'), sym: 'Z' },
    { id: 'contactRatio', value: r.contactRatio, sym: 'm_c', answer: true },
    { id: 'minTeeth', value: r.minTeeth, sym: 'N_{min}' },
    { id: 'minTeethWhole', value: r.minTeethWhole },
    { id: 'interference', word: r.interference ? 'yes' : 'no' },
    { id: 'speed2', value: q(r.speed2, 'rpm'), sym: '\\omega_2' },
  ];
  if (r.forces) {
    rows.push(
      { id: 'torque', value: q(r.forces.torque, 'moment'), sym: 'T_1' },
      { id: 'pitchSpeed', value: q(r.forces.pitchSpeed, 'velocity'), sym: 'V' },
      { id: 'tangential', value: q(r.forces.tangential, 'force'), sym: 'W_t', answer: true },
      { id: 'radial', value: q(r.forces.radial, 'force'), sym: 'W_r' },
      { id: 'total', value: q(r.forces.total, 'force'), sym: 'W' },
    );
  }
  return { rows, steps: r.steps, notes: ['standard', 'forces'] };
}

function train(values: Values): Outcome {
  const stages = readRows(str(values, 'stages'), 2).map((row) => ({
    driver: row.numbers[0],
    driven: row.numbers[1],
    internal: row.words.some((word) => word === 'internal' || word === 'ring' || word === 'i'),
  }));
  const r = unwrap(solveTrain(stages, num(values, 'inputSpeed')));
  const rows: ResultRow[] = [
    { id: 'value', value: r.value, sym: 'e', answer: true },
    { id: 'trainRatio', value: r.ratio },
    { id: 'outputSpeed', value: q(r.outputSpeed, 'rpm'), sym: '\\omega_\\text{out}', answer: true },
  ];
  const table = {
    id: 'shafts',
    columns: ['mesh', 'driver', 'driven', 'speed'],
    rows: stages.map((s, i) => [String(i + 1), s.driver, s.driven, q(r.speeds[i], 'rpm')]),
  };
  return { rows, steps: r.steps, tables: [table], notes: ['sign'] };
}

function planetary(values: Values): Outcome {
  const input: PlanetaryInput = {
    sun: num(values, 'sun'),
    ring: num(values, 'ring'),
    planet: num(values, 'planet'),
    planets: num(values, 'planets'),
    fixed: str(values, 'fixed') as PlanetaryInput['fixed'],
    input: str(values, 'inputMember') as PlanetaryInput['input'],
    output: str(values, 'outputMember') as Member,
    inputSpeed: num(values, 'inputSpeed'),
  };
  const r = unwrap(solvePlanetary(input));
  const rows: ResultRow[] = [
    { id: 'planetRatio', value: r.ratio, sym: '\\omega_\\text{in}/\\omega_\\text{out}', answer: true },
    { id: 'outputSpeed', value: q(r.speeds[input.output], 'rpm'), sym: '\\omega_\\text{out}', answer: true },
    { id: 'planetTeeth', value: r.planet },
    { id: 'willis', value: r.willisResidual },
  ];
  if (r.spacingOk !== null) rows.push({ id: 'spacing', word: r.spacingOk ? 'yes' : 'no' });
  const table = {
    id: 'tabular',
    columns: ['row', ...MEMBERS],
    rows: r.table.map((one) => [word(one.row), ...MEMBERS.map((m) => q(one.values[m], 'rpm'))]),
  };
  return { rows, steps: r.steps, tables: [table], notes: ['planetSign'] };
}

const isMode = (mode: string) => (v: Values) => v.mode === mode;
const isPair = isMode('pair');
const isPlanet = isMode('planetary');

export const gearsSpec: ToolSpec = {
  fields: [
    { id: 'mode', type: 'choice', options: ['pair', 'train', 'planetary'], first: 'pair' },
    { id: 'sizing', type: 'choice', options: ['module', 'diametral'], first: 'module', when: isPair },
    { id: 'module', type: 'quantity', kind: 'small', first: '2 mm', when: (v) => isPair(v) && v.sizing === 'module' },
    { id: 'pitch', type: 'quantity', kind: 'count', first: '10', when: (v) => isPair(v) && v.sizing !== 'module' },
    { id: 'N1', type: 'quantity', kind: 'count', first: '20', when: isPair },
    { id: 'N2', type: 'quantity', kind: 'count', first: '40', when: isPair },
    { id: 'phi', type: 'quantity', kind: 'angle', first: '20', when: isPair },
    { id: 'addendum', type: 'quantity', kind: 'ratio', first: '1', hint: true, when: isPair },
    { id: 'power', type: 'quantity', kind: 'power', first: '5 kW', hint: true, when: isPair },
    { id: 'speed', type: 'quantity', kind: 'rpm', first: '1500', when: isPair },
    { id: 'stages', type: 'text', rows: 4, first: '20 60\n15 45', hint: true, when: isMode('train') },
    { id: 'sun', type: 'quantity', kind: 'count', first: '30', when: isPlanet },
    { id: 'ring', type: 'quantity', kind: 'count', first: '90', when: isPlanet },
    { id: 'planet', type: 'quantity', kind: 'count', first: '0', hint: true, when: isPlanet },
    { id: 'planets', type: 'quantity', kind: 'count', first: '3', hint: true, when: isPlanet },
    { id: 'fixed', type: 'choice', options: PLANET_MEMBERS, first: 'ring', when: isPlanet },
    { id: 'inputMember', type: 'choice', options: PLANET_MEMBERS, first: 'sun', when: isPlanet },
    { id: 'outputMember', type: 'choice', options: [...PLANET_MEMBERS, 'planet'], first: 'carrier', when: isPlanet },
    { id: 'inputSpeed', type: 'quantity', kind: 'rpm', first: '1000', when: (v) => !isPair(v) },
  ],
  examples: [
    { id: 'pair', values: { mode: 'pair' } },
    { id: 'small', values: { mode: 'pair', N1: '12', N2: '12' } },
    { id: 'compound', values: { mode: 'train', stages: '20 60\n15 45' } },
    { id: 'planetary', values: { mode: 'planetary' } },
  ],
  run(values) {
    if (values.mode === 'train') return train(values);
    if (values.mode === 'planetary') return planetary(values);
    return pair(values);
  },
};
