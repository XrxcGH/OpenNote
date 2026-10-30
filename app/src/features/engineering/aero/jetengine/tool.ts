// The jet engine tool: an ideal or non-ideal turbojet, turbofan, or ramjet on design. The ambient state comes from
// the standard atmosphere or is typed. It shows a station table and sweeps specific thrust and fuel consumption
// against the compressor pressure ratio (or the flight Mach number, for a ramjet).
import { atmosphere } from '../atmosphere/engine';
import type { Inputs, PlotSpec, Row, TableSpec, ToolSpec, Values } from '../ui/spec';
import { IDEAL, cycle, sweep } from './engine';
import type { CycleInput, CycleResult, EngineType, Losses } from './engine';

const TYPES: readonly EngineType[] = ['turbojet', 'turbofan', 'ramjet'];
const typeOf = (v: Values): EngineType => TYPES.find((type) => type === v.type) ?? 'turbojet';
const real = (v: Values) => v.model === 'real';
const fan = (v: Values) => typeOf(v) === 'turbofan';
const turbo = (v: Values) => typeOf(v) !== 'ramjet';
const burning = (v: Values) => typeOf(v) === 'turbojet' && v.afterburner === 'on';

type LossId = keyof Losses;
const LOSSES: readonly { id: LossId; initial: string; when?: (v: Values) => boolean }[] = [
  { id: 'piDmax', initial: '0.98' },
  { id: 'piB', initial: '0.96' },
  { id: 'piN', initial: '0.98' },
  { id: 'piFn', initial: '0.98', when: fan },
  { id: 'ec', initial: '0.9', when: turbo },
  { id: 'ef', initial: '0.89', when: fan },
  { id: 'et', initial: '0.89', when: turbo },
  { id: 'etaB', initial: '0.99' },
  { id: 'etaM', initial: '0.99', when: turbo },
  { id: 'etaAB', initial: '0.97', when: burning },
  { id: 'piAB', initial: '0.94', when: burning },
  { id: 'p0p9', initial: '1' },
  { id: 'p0p19', initial: '1', when: fan },
];

function ambient(inputs: Inputs): { T0: number; P0: number } {
  if (inputs.c('ambient') !== 'altitude') return { T0: inputs.q('T0'), P0: inputs.q('P0') };
  const air = atmosphere({ mode: 'altitude', altitude: inputs.q('altitude'), kind: 'geometric' });
  return { T0: air.T, P0: air.p };
}

function cycleInput(inputs: Inputs): CycleInput {
  const v = inputs.values;
  const type = typeOf(v);
  const losses = Object.fromEntries(
    LOSSES.map((loss) => [loss.id, real(v) && (!loss.when || loss.when(v)) ? inputs.n(loss.id) : IDEAL[loss.id]]),
  ) as unknown as Losses;
  const gammaC = inputs.n('gammaC');
  const cpC = inputs.q('cpC');
  return {
    type,
    ideal: !real(v),
    M0: inputs.n('M0'),
    ...ambient(inputs),
    gammaC,
    cpC,
    gammaT: real(v) ? inputs.n('gammaT') : gammaC,
    cpT: real(v) ? inputs.q('cpT') : cpC,
    hPR: inputs.q('hPR'),
    Tt4: inputs.q('Tt4'),
    piC: turbo(v) ? inputs.n('piC') : 1,
    piF: fan(v) ? inputs.n('piF') : 1,
    alpha: fan(v) ? inputs.n('alpha') : 0,
    ...(burning(v) ? { Tt7: inputs.q('Tt7') } : {}),
    losses,
  };
}

function rows(input: CycleInput, r: CycleResult, m0: number | undefined): Row[] {
  const k = r.ratios;
  const out: Row[] = [
    { id: 'specificThrust', value: r.specificThrust, qty: 'specificThrust', sig: 5, answer: true },
    { id: 'S', value: r.S, qty: 'tsfc', sig: 5, answer: true },
    { id: 'f', value: r.f, sig: 5, answer: true },
  ];
  if (input.Tt7 !== undefined) out.push({ id: 'fAB', value: r.fAB, sig: 5 }, { id: 'fO', value: r.fO, sig: 5 });
  out.push(
    { id: 'etaTh', value: r.etaTh, sig: 5 },
    { id: 'etaP', value: r.etaP, sig: 5 },
    { id: 'etaO', value: r.etaO, sig: 5 },
    { id: 'V9', value: r.V9, qty: 'speed', sig: 5 },
    { id: 'M9', value: r.M9, sig: 5 },
  );
  if (r.V19 !== undefined) out.push({ id: 'V19', value: r.V19, qty: 'speed', sig: 5 });
  if (r.FR !== undefined) out.push({ id: 'FR', value: r.FR, sig: 5 });
  if (m0 !== undefined)
    out.push(
      { id: 'thrust', value: r.specificThrust * m0, qty: 'force', sig: 5 },
      { id: 'fuelFlow', value: r.S * r.specificThrust * m0, qty: 'massFlow', sig: 5 },
    );
  out.push(
    { id: 'V0', value: r.V0, qty: 'speed', sig: 5 },
    { id: 'T0', value: input.T0, qty: 'temperature', sig: 5 },
    { id: 'P0', value: input.P0, qty: 'pressure', sig: 5 },
    { id: 'tauR', value: k.tauR, sig: 5 },
    { id: 'piR', value: k.piR, sig: 5 },
  );
  if (!input.ideal) out.push({ id: 'piD', value: k.piD, sig: 5 });
  out.push({ id: 'tauL', value: k.tauL, sig: 5 });
  if (input.type !== 'ramjet') {
    out.push({ id: 'tauC', value: k.tauC, sig: 5 });
    if (!input.ideal) out.push({ id: 'etaC', value: k.etaC, sig: 4 });
  }
  if (input.type === 'turbofan') {
    out.push({ id: 'tauF', value: k.tauF, sig: 5 });
    if (!input.ideal) out.push({ id: 'etaF', value: k.etaF, sig: 4 });
  }
  if (input.type !== 'ramjet') {
    out.push({ id: 'tauT', value: k.tauT, sig: 5 }, { id: 'piT', value: k.piT, sig: 5 });
    if (!input.ideal) out.push({ id: 'etaT', value: k.etaT, sig: 4 });
  }
  return out;
}

function plots(input: CycleInput, r: CycleResult): PlotSpec[] {
  const ram = input.type === 'ramjet';
  const x = ram ? input.M0 : input.piC;
  const plot = (title: string, y: string, pick: (c: CycleResult) => number): PlotSpec => ({
    title,
    x: ram ? 'M0' : 'piC',
    y,
    series: [{ label: y, points: sweep(input, pick) }],
    marks: [{ x, y: pick(r), label: 'design' }],
  });
  return [
    plot(ram ? 'sweepFRam' : 'sweepF', 'F', (c) => c.specificThrust),
    plot(ram ? 'sweepSRam' : 'sweepS', 'S', (c) => c.S * 1e6),
  ];
}

const stationTable = (r: CycleResult): TableSpec => ({
  title: 'stations',
  columns: [{ key: 'station' }, { key: 'Tt', qty: 'temperature' }, { key: 'Pt', qty: 'pressure' }],
  rows: r.stations.map((s) => [`@st.${s.id}`, s.Tt, s.Pt]),
});

export const spec: ToolSpec = {
  id: 'jetengine',
  fields: [
    { id: 'type', kind: 'choice', initial: 'turbojet', options: TYPES },
    { id: 'model', kind: 'choice', initial: 'ideal', options: ['ideal', 'real'] },
    { id: 'afterburner', kind: 'choice', initial: 'off', options: ['off', 'on'], when: (v) => !fan(v) && turbo(v) },
    { id: 'ambient', kind: 'choice', initial: 'altitude', options: ['altitude', 'typed'] },
    { id: 'altitude', kind: 'quantity', qty: 'altitude', initial: '11000', when: (v) => v.ambient !== 'typed' },
    { id: 'T0', kind: 'quantity', qty: 'temperature', initial: '216.7', when: (v) => v.ambient === 'typed' },
    { id: 'P0', kind: 'quantity', qty: 'pressure', initial: '22632', when: (v) => v.ambient === 'typed' },
    { id: 'M0', kind: 'number', initial: '0.85' },
    { id: 'Tt4', kind: 'quantity', qty: 'temperature', initial: '1600' },
    { id: 'piC', kind: 'number', initial: '20', when: turbo },
    { id: 'piF', kind: 'number', initial: '1.6', when: fan },
    { id: 'alpha', kind: 'number', initial: '5', when: fan },
    { id: 'Tt7', kind: 'quantity', qty: 'temperature', initial: '2200', when: burning },
    { id: 'hPR', kind: 'quantity', qty: 'specificEnergy', initial: '42.8' },
    { id: 'gammaC', kind: 'number', initial: '1.4' },
    { id: 'cpC', kind: 'quantity', qty: 'gasConstant', initial: '1004' },
    { id: 'gammaT', kind: 'number', initial: '1.33', when: real },
    { id: 'cpT', kind: 'quantity', qty: 'gasConstant', initial: '1156', when: real },
    ...LOSSES.map((loss) => ({
      id: loss.id,
      kind: 'number' as const,
      initial: loss.initial,
      when: (v: Values) => real(v) && (!loss.when || loss.when(v)),
    })),
    { id: 'm0', kind: 'quantity', qty: 'massFlow', initial: '', optional: true },
  ],
  run(inputs) {
    const input = cycleInput(inputs);
    const r = cycle(input);
    const thrust = r.steps.find((s) => s.key === 'jeThrust');
    return {
      ...(r.specificThrust > 0 ? {} : { headline: { key: 'n.noThrust' } }),
      rows: rows(input, r, inputs.qOpt('m0')),
      steps: r.steps,
      ...(thrust?.math ? { latex: thrust.math } : {}),
      tables: [stationTable(r)],
      plots: plots(input, r),
    };
  },
};
