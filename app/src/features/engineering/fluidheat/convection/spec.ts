// The convection tool's form and results: any of the correlations for forced external, forced internal, and natural
// convection (as heat or mass transfer), and heat transfer in a tube with a fixed wall temperature or heat flux.
import { fail, q, type KitStep } from '../kit/types';
import type { Outcome, ResultRow, ToolSpec, Values } from '../kit/spec';
import type { System } from '../kit/units';
import { correlate, tubeFlow, type CorrelationId, type Fluid, type Geometry } from './engine';

const num = (values: Values, id: string) => values[id] as number;
const opt = (values: Values, id: string) => (Number.isFinite(num(values, id)) ? num(values, id) : undefined);
const steps = (list: unknown): KitStep[] => list as KitStep[];

const EXTERNAL = [
  'plateLocal',
  'plateLaminar',
  'plateTurbulent',
  'plateMixed',
  'cylinderCross',
  'sphereWhitaker',
  'sphereRanzMarshall',
];
const INTERNAL = ['tubeLaminarFlux', 'tubeLaminarTemp', 'tubeEntry', 'dittusBoelter', 'gnielinski', 'siederTate'];
const NATURAL = [
  'verticalPlateFull',
  'verticalPlateLaminar',
  'horizontalPlateUp',
  'horizontalPlateDown',
  'horizontalCylinder',
  'sphereNatural',
];

const correlation = (values: Values): CorrelationId => {
  const id =
    values.group === 'external' ? values.corrExt : values.group === 'internal' ? values.corrInt : values.corrNat;
  return id as CorrelationId;
};

const isCorrelation = (v: Values) => v.mode === 'correlation';
const inGroup = (group: string) => (v: Values) => v.mode === 'correlation' && v.group === group;
const isMass = (v: Values) => v.mode === 'correlation' && v.transfer === 'mass';
const isHeat = (v: Values) => v.mode === 'correlation' && v.transfer === 'heat';
const naturalHeat = (v: Values) => inGroup('natural')(v) && v.transfer === 'heat';
const isTube = (v: Values) => v.mode === 'tube';

function correlationOutcome(values: Values): Outcome {
  const mass = values.transfer === 'mass';
  const natural = values.group === 'natural';
  const id = correlation(values);
  const fluid: Fluid = {
    k: num(values, mass ? 'dab' : 'k'),
    nu: num(values, 'nu'),
    pr: num(values, mass ? 'sc' : 'pr'),
    ...(opt(values, 'muRatio') !== undefined ? { muRatio: opt(values, 'muRatio') } : {}),
  };
  const geometry: Geometry = { length: num(values, 'length') };
  if (natural) {
    if (mass) geometry.driving = Math.abs(num(values, 'drho'));
    else {
      const ts = num(values, 'tSurface');
      const tf = num(values, 'tFluid');
      geometry.deltaT = Math.abs(ts - tf);
      geometry.beta = opt(values, 'beta') ?? 1 / ((ts + tf) / 2);
    }
  } else {
    geometry.velocity = num(values, 'velocity');
    if (opt(values, 'tubeLength') !== undefined) geometry.tubeLength = opt(values, 'tubeLength');
    geometry.heating = values.heating !== 'no';
  }
  const r = correlate(id, fluid, geometry);
  const rows: ResultRow[] = [
    { id: mass ? 'sherwood' : 'nusselt', value: r.nusselt, sym: mass ? '\\mathrm{Sh}' : '\\mathrm{Nu}', answer: true },
    mass
      ? { id: 'hm', value: q(r.h, 'speed'), sym: 'h_m', answer: true }
      : { id: 'h', value: q(r.h, 'htc'), sym: 'h', answer: true },
  ];
  if (r.re !== undefined) rows.push({ id: 'reynolds', value: r.re, sym: '\\mathrm{Re}' });
  if (r.ra !== undefined) rows.push({ id: 'rayleigh', value: r.ra, sym: '\\mathrm{Ra}' });
  if (r.frictionFactor !== undefined) rows.push({ id: 'friction', value: r.frictionFactor, sym: 'f' });
  return { rows, steps: steps(r.steps), notes: [mass ? 'mass' : 'heat', ...r.warnings] };
}

function tubeOutcome(values: Values): Outcome {
  const wallTemperature = values.wall === 'temperature';
  const fluid: Fluid = { k: num(values, 'kT'), nu: num(values, 'nuT'), pr: num(values, 'prT') };
  const cp = num(values, 'cp');
  const density = num(values, 'rho');
  if (!(cp > 0) || !(density > 0)) fail('calc', 'The specific heat and the density must be above zero.');
  const r = tubeFlow({
    diameter: num(values, 'diameter'),
    length: num(values, 'tubeLengthT'),
    massFlow: num(values, 'massFlow'),
    tIn: num(values, 'tIn'),
    wall: wallTemperature
      ? { kind: 'temperature', value: num(values, 'wallTemp') }
      : { kind: 'flux', value: num(values, 'wallFlux') },
    correlation: values.tubeCorr as CorrelationId,
    propsAt: () => ({ fluid, cp, density }),
  });
  return {
    rows: [
      { id: 'tOut', value: q(r.tOut, 'temperature'), sym: 'T_{out}', answer: true },
      { id: 'heat', value: q(r.heat, 'heat'), sym: 'q', answer: true },
      { id: 'h', value: q(r.h, 'htc'), sym: 'h' },
      { id: 'reynolds', value: r.re, sym: '\\mathrm{Re}' },
      { id: 'velocity', value: q(r.velocity, 'speed') },
      { id: 'iterations', value: r.iterations },
    ],
    steps: steps([...r.correlation.steps, ...r.steps]),
    notes: ['tube', ...r.correlation.warnings],
  };
}

const HANDLERS: Record<string, (values: Values, system: System) => Outcome> = {
  correlation: correlationOutcome,
  tube: tubeOutcome,
};

export const convectionSpec: ToolSpec = {
  fields: [
    { id: 'mode', type: 'choice', options: ['correlation', 'tube'], first: 'correlation' },
    { id: 'transfer', type: 'choice', options: ['heat', 'mass'], first: 'heat', when: isCorrelation },
    {
      id: 'group',
      type: 'choice',
      options: ['external', 'internal', 'natural'],
      first: 'external',
      when: isCorrelation,
    },
    { id: 'corrExt', type: 'choice', options: EXTERNAL, first: 'plateLaminar', when: inGroup('external') },
    { id: 'corrInt', type: 'choice', options: INTERNAL, first: 'gnielinski', when: inGroup('internal') },
    { id: 'corrNat', type: 'choice', options: NATURAL, first: 'verticalPlateFull', when: inGroup('natural') },
    { id: 'length', type: 'quantity', kind: 'span', first: '1 m', when: isCorrelation },
    {
      id: 'velocity',
      type: 'quantity',
      kind: 'speed',
      first: '5 m/s',
      when: (v) => isCorrelation(v) && v.group !== 'natural',
    },
    { id: 'tubeLength', type: 'quantity', kind: 'span', first: '', optional: true, when: inGroup('internal') },
    { id: 'heating', type: 'choice', options: ['yes', 'no'], first: 'yes', when: inGroup('internal') },
    { id: 'tSurface', type: 'quantity', kind: 'temperature', first: '60 °C', when: naturalHeat },
    { id: 'tFluid', type: 'quantity', kind: 'temperature', first: '20 °C', when: naturalHeat },
    { id: 'beta', type: 'quantity', kind: 'expansion', first: '', optional: true, when: naturalHeat },
    { id: 'drho', type: 'quantity', kind: 'ratio', first: '0.01', when: (v) => inGroup('natural')(v) && isMass(v) },
    { id: 'k', type: 'quantity', kind: 'conductivity', first: '0.026 W/(m·K)', when: isHeat },
    { id: 'dab', type: 'quantity', kind: 'diffusivity', first: '0.25 cm^2/s', when: isMass },
    { id: 'nu', type: 'quantity', kind: 'kinematic', first: '15.9 mm^2/s', when: isCorrelation },
    { id: 'pr', type: 'quantity', kind: 'ratio', first: '0.71', when: isHeat },
    { id: 'sc', type: 'quantity', kind: 'ratio', first: '0.63', when: isMass },
    { id: 'muRatio', type: 'quantity', kind: 'ratio', first: '', optional: true, when: isCorrelation },
    { id: 'diameter', type: 'quantity', kind: 'length', first: '25 mm', when: isTube },
    { id: 'tubeLengthT', type: 'quantity', kind: 'span', first: '3 m', when: isTube },
    { id: 'massFlow', type: 'quantity', kind: 'massFlow', first: '0.1 kg/s', when: isTube },
    { id: 'tIn', type: 'quantity', kind: 'temperature', first: '20 °C', when: isTube },
    { id: 'wall', type: 'choice', options: ['temperature', 'flux'], first: 'temperature', when: isTube },
    {
      id: 'wallTemp',
      type: 'quantity',
      kind: 'temperature',
      first: '90 °C',
      when: (v) => isTube(v) && v.wall === 'temperature',
    },
    {
      id: 'wallFlux',
      type: 'quantity',
      kind: 'heatFlux',
      first: '5000 W/m²',
      when: (v) => isTube(v) && v.wall === 'flux',
    },
    { id: 'tubeCorr', type: 'choice', options: INTERNAL, first: 'gnielinski', when: isTube },
    { id: 'kT', type: 'quantity', kind: 'conductivity', first: '0.6 W/(m·K)', when: isTube },
    { id: 'nuT', type: 'quantity', kind: 'kinematic', first: '1.0 mm^2/s', when: isTube },
    { id: 'prT', type: 'quantity', kind: 'ratio', first: '7', when: isTube },
    { id: 'cp', type: 'quantity', kind: 'specificHeat', first: '4.18 kJ/(kg·K)', when: isTube },
    { id: 'rho', type: 'quantity', kind: 'density', first: '998 kg/m^3', when: isTube },
  ],
  examples: [
    {
      id: 'plate',
      values: {
        mode: 'correlation',
        transfer: 'heat',
        group: 'external',
        corrExt: 'plateMixed',
        length: '1 m',
        velocity: '20 m/s',
        k: '0.026 W/(m·K)',
        nu: '15.9 mm^2/s',
        pr: '0.71',
      },
    },
    {
      id: 'cylinder',
      values: {
        mode: 'correlation',
        transfer: 'heat',
        group: 'external',
        corrExt: 'cylinderCross',
        length: '20 mm',
        velocity: '10 m/s',
        k: '0.026 W/(m·K)',
        nu: '15.9 mm^2/s',
        pr: '0.71',
      },
    },
    {
      id: 'pipe',
      values: {
        mode: 'correlation',
        transfer: 'heat',
        group: 'internal',
        corrInt: 'gnielinski',
        length: '25 mm',
        velocity: '1.5 m/s',
        k: '0.6 W/(m·K)',
        nu: '1.0 mm^2/s',
        pr: '7',
      },
    },
    {
      id: 'wall',
      values: {
        mode: 'correlation',
        transfer: 'heat',
        group: 'natural',
        corrNat: 'verticalPlateFull',
        length: '0.5 m',
        tSurface: '60 °C',
        tFluid: '20 °C',
        k: '0.027 W/(m·K)',
        nu: '17 mm^2/s',
        pr: '0.71',
      },
    },
    {
      id: 'evaporation',
      values: {
        mode: 'correlation',
        transfer: 'mass',
        group: 'external',
        corrExt: 'plateMixed',
        length: '1 m',
        velocity: '20 m/s',
        dab: '0.25 cm^2/s',
        nu: '15.9 mm^2/s',
        sc: '0.63',
      },
    },
    {
      id: 'heater',
      values: {
        mode: 'tube',
        diameter: '25 mm',
        tubeLengthT: '3 m',
        massFlow: '0.1 kg/s',
        tIn: '20 °C',
        wall: 'temperature',
        wallTemp: '90 °C',
        tubeCorr: 'gnielinski',
      },
    },
  ],
  run(values, system): Outcome {
    return HANDLERS[values.mode as string](values, system);
  },
};
