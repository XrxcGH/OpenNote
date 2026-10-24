// The performance tool has five modes: best speeds from the drag polar, range with endurance, climb with glide,
// level turns, and longitudinal static stability. The polar's fields are shared by the first three.
import { DEG } from '../common';
import { atmosphere } from '../atmosphere/engine';
import type { FieldDef, Inputs, Row, ToolOutput, ToolSpec, Values } from '../ui/spec';
import { climbGlide, kOf, polar, rangeEndurance, stability, turn } from './engine';
import type { Engine, Polar } from './engine';

type Mode = 'polar' | 'range' | 'climb' | 'turn' | 'stability';
const MODES: readonly Mode[] = ['polar', 'range', 'climb', 'turn', 'stability'];

const mode = (v: Values): Mode => MODES.find((m) => m === v.mode) ?? 'polar';
const usesPolar = (v: Values) => ['polar', 'range', 'climb'].includes(mode(v));
const engine = (v: Values): Engine => (v.engine === 'prop' ? 'prop' : 'jet');
const inMode =
  (...modes: Mode[]) =>
  (v: Values) =>
    modes.includes(mode(v));

const polarFields: readonly FieldDef[] = [
  { id: 'W', kind: 'quantity', qty: 'force', initial: '50000', when: usesPolar },
  { id: 'S', kind: 'quantity', qty: 'area', initial: '20', when: usesPolar },
  { id: 'CD0', kind: 'number', initial: '0.025', when: usesPolar },
  { id: 'kFrom', kind: 'choice', initial: 'k', options: ['k', 'eAR'], when: usesPolar },
  { id: 'k', kind: 'number', initial: '0.045', when: (v) => usesPolar(v) && v.kFrom !== 'eAR' },
  { id: 'e', kind: 'number', initial: '0.8', when: (v) => usesPolar(v) && v.kFrom === 'eAR' },
  { id: 'AR', kind: 'number', initial: '8', when: (v) => usesPolar(v) && v.kFrom === 'eAR' },
  { id: 'air', kind: 'choice', initial: 'altitude', options: ['altitude', 'density'], when: usesPolar },
  { id: 'altitude', kind: 'quantity', qty: 'altitude', initial: '0', when: (v) => usesPolar(v) && v.air !== 'density' },
  { id: 'rho', kind: 'quantity', qty: 'density', initial: '1.225', when: (v) => usesPolar(v) && v.air === 'density' },
];

const engineFields: readonly FieldDef[] = [
  { id: 'engine', kind: 'choice', initial: 'jet', options: ['jet', 'prop'], when: inMode('range', 'climb') },
  { id: 'fuel', kind: 'number', initial: '0.2', when: inMode('range') },
  { id: 'ct', kind: 'quantity', qty: 'rate', initial: '0.6', when: (v) => mode(v) === 'range' && engine(v) === 'jet' },
  { id: 'cp', kind: 'quantity', qty: 'psfc', initial: '2.7', when: (v) => mode(v) === 'range' && engine(v) === 'prop' },
  { id: 'etaP', kind: 'number', initial: '0.8', when: (v) => mode(v) === 'range' && engine(v) === 'prop' },
  { id: 'T', kind: 'quantity', qty: 'force', initial: '8000', when: (v) => mode(v) === 'climb' && engine(v) === 'jet' },
  {
    id: 'P',
    kind: 'quantity',
    qty: 'power',
    initial: '600000',
    when: (v) => mode(v) === 'climb' && engine(v) === 'prop',
  },
  { id: 'height', kind: 'quantity', qty: 'altitude', initial: '1000', optional: true, when: inMode('climb') },
];

const otherFields: readonly FieldDef[] = [
  { id: 'V', kind: 'quantity', qty: 'speed', initial: '100', when: inMode('turn') },
  { id: 'bank', kind: 'quantity', qty: 'angle', initial: '60', when: inMode('turn') },
  { id: 'hac', kind: 'number', initial: '0.25', when: inMode('stability') },
  { id: 'VH', kind: 'number', initial: '0.6', when: inMode('stability') },
  { id: 'slopeRatio', kind: 'number', initial: '0.8', when: inMode('stability') },
  { id: 'downwash', kind: 'number', initial: '0.4', when: inMode('stability') },
  { id: 'hcg', kind: 'number', initial: '0.3', when: inMode('stability') },
  { id: 'a', kind: 'number', initial: '', optional: true, when: inMode('stability') },
];

/** The polar's numbers in SI, with the density from the standard atmosphere when an altitude is given. */
function readPolar(inputs: Inputs): Polar {
  const k = inputs.c('kFrom') === 'eAR' ? kOf(inputs.n('e'), inputs.n('AR')) : inputs.n('k');
  const rho =
    inputs.c('air') === 'density'
      ? inputs.q('rho')
      : atmosphere({ mode: 'altitude', altitude: inputs.q('altitude'), kind: 'geometric' }).rho;
  return { W: inputs.q('W'), S: inputs.q('S'), CD0: inputs.n('CD0'), k, rho };
}

function polarOutput(p: Polar): ToolOutput {
  const r = polar(p);
  const rows: Row[] = [
    { id: 'rho', value: p.rho, qty: 'density', sig: 5 },
    { id: 'k', value: p.k, sig: 5 },
    { id: 'LDmax', value: r.LDmax, sig: 5, answer: true },
    { id: 'CLminD', value: r.CLminD, sig: 5, answer: true },
    { id: 'VminD', value: r.VminD, qty: 'speed', sig: 5, answer: true },
    { id: 'Dmin', value: r.Dmin, qty: 'force', sig: 5 },
    { id: 'CLminP', value: r.CLminP, sig: 5 },
    { id: 'VminP', value: r.VminP, qty: 'speed', sig: 5, answer: true },
    { id: 'Pmin', value: r.Pmin, qty: 'power', sig: 5 },
    { id: 'LDminP', value: r.LDminP, sig: 5 },
    { id: 'wingLoading', value: r.wingLoading, qty: 'pressure', sig: 5 },
  ];
  const kilo = (points: readonly { x: number; y: number }[]) => points.map((q) => ({ x: q.x, y: q.y / 1000 }));
  return {
    rows,
    steps: r.steps,
    ...(r.steps[1]?.math ? { latex: r.steps[1].math } : {}),
    plots: [
      {
        title: 'thrust',
        x: 'V',
        y: 'D',
        series: [{ label: 'D', points: kilo(r.plot.thrust) }],
        marks: [{ x: r.VminD, y: r.Dmin / 1000, label: 'minD' }],
      },
      {
        title: 'power',
        x: 'V',
        y: 'P',
        series: [{ label: 'P', points: kilo(r.plot.power) }],
        marks: [{ x: r.VminP, y: r.Pmin / 1000, label: 'minP' }],
      },
    ],
  };
}

function rangeOutput(p: Polar, inputs: Inputs): ToolOutput {
  const jet = engine(inputs.values) === 'jet';
  const r = rangeEndurance({
    ...p,
    engine: jet ? 'jet' : 'prop',
    fuelFraction: inputs.n('fuel'),
    ...(jet ? { ct: inputs.q('ct') } : { cp: inputs.q('cp'), etaP: inputs.n('etaP') }),
  });
  const rows: Row[] = [
    { id: 'CLrange', value: r.CLrange, sig: 5 },
    { id: 'CDrange', value: r.CDrange, sig: 5 },
    { id: 'range', value: r.range, qty: 'distance', sig: 5, answer: true },
  ];
  if (r.rangeCruiseClimb !== undefined)
    rows.push({ id: 'rangeCruiseClimb', value: r.rangeCruiseClimb, qty: 'distance', sig: 5 });
  rows.push(
    { id: 'CLendurance', value: r.CLendurance, sig: 5 },
    { id: 'endurance', value: r.endurance, qty: 'duration', sig: 5, answer: true },
    { id: 'Wf', value: r.Wf, qty: 'force', sig: 5 },
  );
  const main = r.steps.find((s) => s.key === 'pfJetRange' || s.key === 'pfPropRange');
  return { rows, steps: r.steps, ...(main?.math ? { latex: main.math } : {}) };
}

function climbOutput(p: Polar, inputs: Inputs): ToolOutput {
  const jet = engine(inputs.values) === 'jet';
  const height = inputs.qOpt('height');
  const r = climbGlide({
    ...p,
    engine: jet ? 'jet' : 'prop',
    ...(jet ? { thrust: inputs.q('T') } : { power: inputs.q('P') }),
    ...(height === undefined ? {} : { height }),
  });
  const rows: Row[] = [
    { id: 'maxClimbRate', value: r.maxClimbRate, qty: 'speed', sig: 5, answer: true },
    { id: 'speedForMaxClimb', value: r.speedForMaxClimb, qty: 'speed', sig: 5 },
  ];
  if (r.maxClimbAngle !== undefined) rows.push({ id: 'maxClimbAngle', value: r.maxClimbAngle / DEG, unit: '°' });
  rows.push(
    { id: 'glideAngle', value: r.glideAngle / DEG, sig: 4, unit: '°', answer: true },
    { id: 'minSinkRate', value: r.minSinkRate, qty: 'speed', sig: 4 },
    { id: 'minSinkSpeed', value: r.minSinkSpeed, qty: 'speed', sig: 5 },
  );
  if (r.glideRange !== undefined) rows.push({ id: 'glideRange', value: r.glideRange, qty: 'distance', sig: 5 });
  return { rows, steps: r.steps, ...(r.steps[0]?.math ? { latex: r.steps[0].math } : {}) };
}

function turnOutput(inputs: Inputs): ToolOutput {
  const r = turn({ V: inputs.q('V'), bank: inputs.q('bank') / DEG });
  return {
    rows: [
      { id: 'n', value: r.n, sig: 5, answer: true },
      { id: 'radius', value: r.radius, qty: 'length', sig: 5, answer: true },
      { id: 'turnRate', value: r.rate / DEG, sig: 5, unit: '°/s', answer: true },
    ],
    steps: r.steps,
    ...(r.steps[1]?.math ? { latex: r.steps[1].math } : {}),
  };
}

function stabilityOutput(inputs: Inputs): ToolOutput {
  const a = inputs.nOpt('a');
  const r = stability({
    hac: inputs.n('hac'),
    VH: inputs.n('VH'),
    slopeRatio: inputs.n('slopeRatio'),
    downwash: inputs.n('downwash'),
    hcg: inputs.n('hcg'),
    ...(a === undefined ? {} : { a }),
  });
  const rows: Row[] = [
    { id: 'hn', value: r.hn, sig: 5, answer: true },
    { id: 'margin', value: r.margin, sig: 5, answer: true },
  ];
  if (r.CmAlpha !== undefined) rows.push({ id: 'CmAlpha', value: r.CmAlpha, sig: 5, unit: 'per rad' });
  return {
    headline: { key: r.stable ? 'n.stable' : 'n.unstable' },
    rows,
    steps: r.steps,
    ...(r.steps[0]?.math ? { latex: r.steps[0].math } : {}),
  };
}

export const spec: ToolSpec = {
  id: 'performance',
  fields: [
    { id: 'mode', kind: 'choice', initial: 'polar', options: MODES },
    ...polarFields,
    ...engineFields,
    ...otherFields,
  ],
  run(inputs) {
    const chosen = mode(inputs.values);
    if (chosen === 'turn') return turnOutput(inputs);
    if (chosen === 'stability') return stabilityOutput(inputs);
    const p = readPolar(inputs);
    if (chosen === 'range') return rangeOutput(p, inputs);
    if (chosen === 'climb') return climbOutput(p, inputs);
    return polarOutput(p);
  },
};
