// checks-disable-file length: worked-step formulas are written as one line each

// The forming tool: flow stress, rolling, forging, extrusion, and drawing; sheet bends and blanking; casting (solidification
// time, risers, pattern allowance); arc weld heat input; and the layers of an additive build. The engine is ../forming.ts.
import type { Row, ToolSpec, Values } from '../kit/spec';
import {
  averageFlowStress,
  bend,
  blanking,
  chvorinov,
  drawing,
  extrusion,
  forging,
  layers,
  patternSize,
  riser,
  rolling,
  weldHeat,
} from '../forming';
import { fmt } from '../types';
import { choiceField, failed, modeField, numField, optionalField, success } from './helpers';

const MODES = [
  'flow',
  'rolling',
  'forging',
  'extrusion',
  'drawing',
  'bend',
  'blanking',
  'solidify',
  'riser',
  'pattern',
  'weld',
  'layers',
] as const;

function flow(v: Values) {
  const r = averageFlowStress(v.k as number, v.n as number, v.strain as number);
  if (!r.ok) return failed(r);
  return success({
    rows: [{ id: 'yf', value: r.yf, dim: 'MPa', sym: 'Y_f', answer: true }],
    steps: [
      {
        key: 'flow',
        latex: `Y_f=\\dfrac{K\\varepsilon^n}{1+n}=\\dfrac{(${fmt(v.k as number)})(${fmt(v.strain as number)})^{${fmt(v.n as number)}}}{1+${fmt(v.n as number)}}=${fmt(r.yf)}\\ \\mathrm{MPa}`,
      },
    ],
    notes: ['flow'],
  });
}

function roll(v: Values) {
  const speed = Number.isFinite(v.speed as number) ? (v.speed as number) : null;
  const r = rolling(
    v.radius as number,
    v.h0 as number,
    v.hf as number,
    v.width as number,
    v.yf as number,
    v.mu as number,
    speed,
  );
  if (!r.ok) return failed(r);
  const rows: Row[] = [
    { id: 'draft', value: r.draft, dim: 'mm' },
    { id: 'contact', value: r.contact, dim: 'mm', sym: 'L', answer: true },
    { id: 'force', value: r.force, dim: 'N', sym: 'F', answer: true },
    { id: 'maxDraft', value: r.maxDraft, dim: 'mm', sym: '\\Delta h_{\\max}' },
  ];
  if (r.power !== null) rows.push({ id: 'power', value: r.power, dim: 'W', sym: 'P', answer: true });
  return success({ rows, steps: r.steps, notes: r.draft === 0 ? ['rolling', 'noDraft'] : ['rolling'] });
}

function forge(v: Values) {
  const r = forging(v.diameter as number, v.height as number, v.yf as number, v.mu as number);
  if (!r.ok) return failed(r);
  return success({
    rows: [
      { id: 'area', value: r.area, dim: 'mm2' },
      { id: 'kf', value: r.frictionFactor },
      { id: 'force', value: r.force, dim: 'N', sym: 'F', answer: true },
    ],
    steps: r.steps,
    notes: ['forging'],
  });
}

function extrude(v: Values) {
  const r = extrusion(
    v.a0 as number,
    v.af as number,
    v.yf as number,
    v.billetLength as number,
    v.billetDiameter as number,
    v.johnsonA as number,
    v.johnsonB as number,
  );
  if (!r.ok) return failed(r);
  return success({
    rows: [
      { id: 'ratio', value: r.ratio, sym: 'r_x' },
      { id: 'trueStrain', value: r.trueStrain },
      { id: 'extrusionStrain', value: r.extrusionStrain, sym: '\\varepsilon_x' },
      { id: 'pIndirect', value: r.pressureIndirect, dim: 'MPa', sym: 'p', answer: true },
      { id: 'pDirect', value: r.pressureDirect, dim: 'MPa', sym: 'p_{direct}', answer: true },
    ],
    steps: r.steps,
    notes: ['extrusion'],
  });
}

function draw(v: Values) {
  const r = drawing(v.a0 as number, v.af as number, v.yf as number, v.mu as number, v.halfAngle as number);
  if (!r.ok) return failed(r);
  return success({
    rows: [
      { id: 'strain', value: r.strain },
      { id: 'stress', value: r.stress, dim: 'MPa', sym: '\\sigma_d', answer: true },
      { id: 'stressRatio', value: r.stressRatio },
    ],
    steps: r.steps,
    notes: ['drawing'],
  });
}

function fold(v: Values) {
  const r = bend(v.angle as number, v.bendRadius as number, v.thickness as number, v.kFactor as number);
  if (!r.ok) return failed(r);
  return success({
    rows: [
      { id: 'allowance', value: r.allowance, dim: 'mm', sym: 'BA', answer: true },
      { id: 'setback', value: r.outsideSetback, dim: 'mm', sym: 'OSSB' },
      { id: 'deduction', value: r.deduction, dim: 'mm', sym: 'BD', answer: true },
    ],
    steps: r.steps,
    notes: ['bend'],
  });
}

function blank(v: Values) {
  const r = blanking(v.edge as number, v.thickness as number, v.uts as number);
  if (!r.ok) return failed(r);
  return success({
    rows: [{ id: 'force', value: r.force, dim: 'N', sym: 'F', answer: true }],
    steps: r.steps,
    notes: ['blanking'],
  });
}

function solidify(v: Values) {
  const r = chvorinov(v.b as number, v.volume as number, v.area as number, v.exponent as number);
  if (!r.ok) return failed(r);
  return success({
    rows: [
      { id: 'modulus', value: r.modulus, dim: 'cm', sym: 'V/A' },
      { id: 'time', value: r.time, dim: 'min', sym: 't', answer: true },
    ],
    steps: r.steps,
    notes: ['chvorinov'],
  });
}

function sizeRiser(v: Values) {
  const r = riser(
    v.volume as number,
    v.area as number,
    v.ratio as number,
    v.factor as number,
    v.riserForm === 'free' ? 'free' : 'top',
  );
  if (!r.ok) return failed(r);
  return success({
    rows: [
      { id: 'castingModulus', value: r.castingModulus, dim: 'cm' },
      { id: 'riserModulus', value: r.riserModulus, dim: 'cm' },
      { id: 'diameter', value: r.diameter, dim: 'cm', sym: 'D', answer: true },
      { id: 'height', value: r.height, dim: 'cm', sym: 'H', answer: true },
      { id: 'riserVolume', value: r.volume, dim: 'cm3' },
    ],
    steps: r.steps,
    notes: ['riser'],
  });
}

function pattern(v: Values) {
  const r = patternSize(v.length as number, (v.shrinkage as number) / 100);
  if (!r.ok) return failed(r);
  return success({
    rows: [{ id: 'pattern', value: r.pattern, dim: 'mm', sym: 'L_p', answer: true }],
    steps: [
      {
        key: 'pattern',
        latex: `L_p=L(1+s)=(${fmt(v.length as number)})(1+${fmt((v.shrinkage as number) / 100)})=${fmt(r.pattern)}\\ \\mathrm{mm}`,
      },
    ],
    notes: ['pattern'],
  });
}

function weld(v: Values) {
  const r = weldHeat(v.volts as number, v.amps as number, v.travel as number, v.efficiency as number);
  if (!r.ok) return failed(r);
  return success({
    rows: [{ id: 'heat', value: r.heatInput, dim: 'J/mm', sym: 'H', answer: true }],
    steps: r.steps,
    notes: ['weld'],
  });
}

function build(v: Values) {
  const r = layers(v.partHeight as number, v.layer as number, v.buildAngle as number);
  if (!r.ok) return failed(r);
  return success({
    rows: [
      { id: 'layers', value: r.layers, sym: 'n', answer: true, digits: 7 },
      { id: 'built', value: r.built, dim: 'mm' },
      { id: 'cusp', value: r.cusp, dim: 'mm', sym: 'c', answer: true },
    ],
    steps: r.steps,
    notes: ['layers'],
  });
}

const RUNNERS: Record<string, (v: Values) => ReturnType<typeof flow>> = {
  flow,
  rolling: roll,
  forging: forge,
  extrusion: extrude,
  drawing: draw,
  bend: fold,
  blanking: blank,
  solidify,
  riser: sizeRiser,
  pattern,
  weld,
  layers: build,
};

export const formingSpec: ToolSpec = {
  fields: [
    modeField([...MODES]),
    numField('k', '500', 'MPa', 'flow'),
    numField('n', '0.2', undefined, 'flow'),
    numField('strain', '0.5', undefined, 'flow'),
    numField('radius', '250', 'mm', 'rolling'),
    numField('bendRadius', '5', 'mm', 'bend'),
    numField('h0', '25', 'mm', 'rolling'),
    numField('hf', '20', 'mm', 'rolling'),
    numField('width', '300', 'mm', 'rolling'),
    numField('yf', '250', 'MPa', 'rolling', 'forging', 'extrusion', 'drawing'),
    numField('mu', '0.12', undefined, 'rolling', 'forging', 'drawing'),
    optionalField('speed', 'rev/s', 'rolling'),
    numField('diameter', '100', 'mm', 'forging'),
    numField('height', '50', 'mm', 'forging'),
    numField('partHeight', '30', 'mm', 'layers'),
    numField('a0', '5000', 'mm2', 'extrusion', 'drawing'),
    numField('af', '1000', 'mm2', 'extrusion', 'drawing'),
    numField('billetLength', '300', 'mm', 'extrusion'),
    numField('billetDiameter', '80', 'mm', 'extrusion'),
    numField('johnsonA', '0.8', undefined, 'extrusion'),
    numField('johnsonB', '1.4', undefined, 'extrusion'),
    numField('halfAngle', '6', 'deg', 'drawing'),
    numField('angle', '90', 'deg', 'bend'),
    numField('buildAngle', '45', 'deg', 'layers'),
    numField('thickness', '2', 'mm', 'bend', 'blanking'),
    numField('kFactor', '0.33', undefined, 'bend'),
    numField('edge', '157.08', 'mm', 'blanking'),
    numField('uts', '400', 'MPa', 'blanking'),
    numField('b', '2', 'min/cm2', 'solidify'),
    numField('volume', '1000', 'cm3', 'solidify', 'riser'),
    numField('area', '600', 'cm2', 'solidify', 'riser'),
    numField('exponent', '2', undefined, 'solidify'),
    choiceField('riserForm', ['top', 'free'], 'top', 'riser'),
    numField('ratio', '1.5', undefined, 'riser'),
    numField('factor', '1.25', undefined, 'riser'),
    numField('length', '200', 'mm', 'pattern'),
    numField('shrinkage', '1.3', undefined, 'pattern'),
    numField('volts', '24', 'V', 'weld'),
    numField('amps', '200', 'A', 'weld'),
    numField('travel', '5', 'mm/s', 'weld'),
    numField('efficiency', '0.8', undefined, 'weld'),
    numField('layer', '0.2', 'mm', 'layers'),
  ],
  run: (v) => (RUNNERS[String(v.mode)] ?? flow)(v),
  examples: [
    { id: 'roll', values: { mode: 'rolling' } },
    { id: 'forge', values: { mode: 'forging', diameter: '100', height: '50', yf: '200', mu: '0.2' } },
    { id: 'extrude', values: { mode: 'extrusion', yf: '1000' } },
    { id: 'wire', values: { mode: 'drawing', a0: '100', af: '80', yf: '250', mu: '0.1', halfAngle: '6' } },
    { id: 'fold', values: { mode: 'bend', bendRadius: '5', angle: '90', thickness: '2' } },
    { id: 'freeze', values: { mode: 'solidify' } },
    { id: 'print', values: { mode: 'layers', partHeight: '30', layer: '0.2', buildAngle: '45' } },
  ],
};
