// The diode and transistor tool: diode and zener circuits, rectifier ripple, and the bias and small-signal gain of
// BJT and MOSFET amplifiers.
import type { Field, ToolSpec } from '../spec';
import { eng, fail, fmt, need, ok, positive } from '../shared';
import type { KitOk, KitRow, Values } from '../shared';
import {
  bjtBias,
  bjtGain,
  diodeCurve,
  diodePoint,
  mosfetBias,
  mosfetGain,
  rectifier,
  rectifierWaveform,
  zenerRegulator,
} from './engine';

const MODES = ['diode', 'zener', 'rectifier', 'bjt', 'mosfet'] as const;
const modeOf = (v: Values): string => v.mode ?? 'diode';
const inMode =
  (mode: string) =>
  (v: Values): boolean =>
    modeOf(v) === mode;

const choice = (id: string, label: Field['label'], initial: string, values: readonly string[], when?: Field['when']) =>
  ({
    id,
    label,
    initial,
    kind: 'select',
    options: values.map((value) => ({ value, label: value as Field['label'] })),
    when,
  }) satisfies Field;

const num = (id: string, label: Field['label'], initial: string, mode: string, unit?: string, hint?: Field['hint']) =>
  ({ id, label, initial, unit, hint, when: inMode(mode) }) satisfies Field;

const FIELDS: readonly Field[] = [
  choice('mode', 'semiMode', 'diode', MODES),
  num('dvs', 'sourceVoltage', '5', 'diode', 'V'),
  num('dr', 'seriesResistor', '1k', 'diode', 'Ω'),
  num('dis', 'saturationCurrent', '1e-14', 'diode', 'A'),
  num('dn', 'idealityFactor', '1', 'diode'),
  num('dvt', 'thermalVoltage', '25.852m', 'diode', 'V', 'thermalHint'),
  num('zvin', 'sourceVoltage', '12', 'zener', 'V'),
  num('zrs', 'seriesResistor', '220', 'zener', 'Ω'),
  num('zvz', 'zenerVoltage', '5.1', 'zener', 'V'),
  num('zrl', 'loadResistor', '1k', 'zener', 'Ω'),
  choice('kind', 'rectifierKind', 'halfwave', ['halfwave', 'fullwave'], inMode('rectifier')),
  num('rvp', 'peakInput', '10', 'rectifier', 'V'),
  num('rdrop', 'diodeDrop', '0.7', 'rectifier', 'V'),
  num('rhz', 'lineFrequency', '60', 'rectifier', 'Hz'),
  num('rload', 'loadResistor', '1k', 'rectifier', 'Ω'),
  num('rcap', 'smoothingCapacitor', '100u', 'rectifier', 'F'),
  num('bvcc', 'supplyVoltage', '12', 'bjt', 'V'),
  num('br1', 'upperDivider', '100k', 'bjt', 'Ω'),
  num('br2', 'lowerDivider', '20k', 'bjt', 'Ω'),
  num('brc', 'collectorResistor', '4.7k', 'bjt', 'Ω'),
  num('bre', 'emitterResistor', '1k', 'bjt', 'Ω'),
  num('bbeta', 'beta', '100', 'bjt'),
  num('bvbe', 'baseEmitterVoltage', '0.7', 'bjt', 'V'),
  num('bvt', 'thermalVoltage', '25.852m', 'bjt', 'V', 'thermalHint'),
  num('bearly', 'earlyVoltage', '100', 'bjt', 'V', 'blankHint'),
  num('brl', 'loadResistor', '10k', 'bjt', 'Ω', 'blankHint'),
  choice('bbypass', 'emitterBypass', 'bypassed', ['bypassed', 'unbypassed'], inMode('bjt')),
  num('mvdd', 'supplyVoltage', '12', 'mosfet', 'V'),
  num('mr1', 'upperDivider', '200k', 'mosfet', 'Ω'),
  num('mr2', 'lowerDivider', '100k', 'mosfet', 'Ω'),
  num('mrd', 'drainResistor', '3k', 'mosfet', 'Ω'),
  num('mrs', 'sourceResistor', '1k', 'mosfet', 'Ω'),
  num('mk', 'transconductanceParameter', '2m', 'mosfet', 'A/V²'),
  num('mvt', 'thresholdVoltage', '1', 'mosfet', 'V'),
  num('mlambda', 'channelModulation', '0.02', 'mosfet', undefined, 'blankHint'),
  num('mrl', 'loadResistor', '10k', 'mosfet', 'Ω', 'blankHint'),
  choice('mbypass', 'sourceBypass', 'bypassed', ['bypassed', 'unbypassed'], inMode('mosfet')),
];

/** A number that may be left blank (or 0) to mean "not present"; null then. */
function optional(values: Values, id: string, label: Field['label'], unit = ''): number | null {
  const text = (values[id] ?? '').trim();
  if (text === '' || text === '0') return null;
  return positive(values, id, label, unit);
}

const n = (value: number): string => fmt(value).replace('−', '-');

function diode(values: Values): KitOk {
  const vs = need(values, 'dvs', 'sourceVoltage', 'V');
  const r = positive(values, 'dr', 'seriesResistor', 'Ω');
  const is = positive(values, 'dis', 'saturationCurrent', 'A');
  const ideality = positive(values, 'dn', 'idealityFactor');
  const vt = positive(values, 'dvt', 'thermalVoltage', 'V');
  const p = diodePoint(vs, r, is, ideality, vt);
  const vMax = Math.min(Math.max(vs, 0.2), p.v * 1.15 + 0.05);
  const curve = diodeCurve(is, ideality, vt, vMax, 120);
  const ceiling = Math.abs(vs / r) * 1.3;
  const keep = curve.y.map((y) => y <= ceiling);
  return ok({
    rows: [
      { key: 'diodeVoltage', value: eng(p.v, 'V') },
      { key: 'diodeCurrent', value: eng(p.i, 'A') },
      { key: 'resistorVoltage', value: eng(vs - p.v, 'V') },
      { key: 'diodePower', value: eng(p.v * p.i, 'W') },
    ],
    steps: [
      { key: 'shockley', math: 'I = I_s\\left(e^{V_D/(nV_T)} - 1\\right)' },
      { key: 'diodeKvl', math: 'V_S = V_D + I R' },
      { key: 'diodeSolve', vars: { v: eng(p.v, 'V'), i: eng(p.i, 'A') } },
    ],
    answer: `V_D = ${eng(p.v, 'V')}, I = ${eng(p.i, 'A')}`,
    latex: `V_D = ${n(p.v)}\\ \\mathrm{V},\\quad I = ${n(p.i)}\\ \\mathrm{A}`,
    plot: {
      xLabel: 'V (V)',
      yLabel: 'I (A)',
      series: [
        { name: 'diode', x: curve.x.filter((_, i) => keep[i]), y: curve.y.filter((_, i) => keep[i]) },
        { name: 'load line', x: [0, vMax], y: [vs / r, (vs - vMax) / r] },
      ],
    },
    notes: ['diodeNote'],
  });
}

function zener(values: Values): KitOk {
  const vin = positive(values, 'zvin', 'sourceVoltage', 'V');
  const rs = positive(values, 'zrs', 'seriesResistor', 'Ω');
  const vz = positive(values, 'zvz', 'zenerVoltage', 'V');
  const rl = positive(values, 'zrl', 'loadResistor', 'Ω');
  const z = zenerRegulator(vin, rs, vz, rl);
  const rows: KitRow[] = [
    { key: 'regulating', value: '', word: z.regulating ? 'yes' : 'no' },
    { key: 'outputVoltage', value: eng(z.vout, 'V') },
    { key: 'supplyCurrent', value: eng(z.iSupply, 'A') },
    { key: 'zenerCurrent', value: eng(z.iZener, 'A') },
    { key: 'loadCurrent', value: eng(z.iLoad, 'A') },
    { key: 'minimumSupply', value: eng(z.vinMin, 'V') },
  ];
  return ok({
    rows,
    steps: [
      {
        key: 'zenerCheck',
        vars: { value: eng(z.vinMin, 'V') },
        math: 'V_{in,min} = V_Z\\left(1 + \\frac{R_s}{R_L}\\right)',
      },
      z.regulating
        ? {
            key: 'zenerOn',
            vars: { iz: eng(z.iZener, 'A') },
            math: 'I_Z = \\frac{V_{in} - V_Z}{R_s} - \\frac{V_Z}{R_L}',
          }
        : { key: 'zenerOff', vars: { value: eng(z.vout, 'V') }, math: 'V_{out} = V_{in}\\frac{R_L}{R_s + R_L}' },
    ],
    answer: `${z.regulating ? 'Regulating' : 'Not regulating'}: Vout = ${eng(z.vout, 'V')}, Iz = ${eng(z.iZener, 'A')}`,
    latex: `V_{out} = ${n(z.vout)}\\ \\mathrm{V},\\quad I_Z = ${n(z.iZener)}\\ \\mathrm{A}`,
    notes: ['zenerNote'],
  });
}

function rectifierTool(values: Values): KitOk {
  const full = (values.kind ?? 'halfwave') === 'fullwave';
  const vp = positive(values, 'rvp', 'peakInput', 'V');
  const drop = need(values, 'rdrop', 'diodeDrop', 'V');
  if (drop < 0) fail('nonNegative', { field: 'diodeDrop' });
  const hz = positive(values, 'rhz', 'lineFrequency', 'Hz');
  const r = positive(values, 'rload', 'loadResistor', 'Ω');
  const c = positive(values, 'rcap', 'smoothingCapacitor', 'F');
  const res = rectifier(vp, drop, hz, full, r, c);
  const w = rectifierWaveform(vp, drop, hz, full, r, c);
  return ok({
    rows: [
      { key: 'peakOutput', value: eng(res.peak, 'V') },
      { key: 'rippleVoltage', value: eng(res.ripple, 'V') },
      { key: 'rippleFrequency', value: eng(res.rippleHz, 'Hz') },
      { key: 'minimumOutput', value: eng(res.low, 'V') },
      { key: 'averageOutput', value: eng(res.dc, 'V') },
      { key: 'rippleRatio', value: `${fmt((res.ripple / res.dc) * 100)} %` },
      { key: 'diodePeakCurrent', value: eng(res.diodePeak, 'A') },
    ],
    steps: [
      { key: 'rectPeak', vars: { value: eng(res.peak, 'V') }, math: 'V_{peak} = V_p - V_D' },
      {
        key: 'rectRipple',
        vars: { f: eng(res.rippleHz, 'Hz'), value: eng(res.ripple, 'V') },
        math: 'V_r = \\frac{V_{peak}}{f\\,R\\,C}',
      },
      { key: 'rectAverage', vars: { value: eng(res.dc, 'V') }, math: 'V_{dc} \\approx V_{peak} - \\frac{V_r}{2}' },
    ],
    answer: `Ripple = ${eng(res.ripple, 'V')} peak to peak; average output ${eng(res.dc, 'V')}`,
    latex: `V_r = \\frac{V_{peak}}{f R C} = ${n(res.ripple)}\\ \\mathrm{V}`,
    plot: {
      xLabel: 't (s)',
      yLabel: 'v (V)',
      series: [
        { name: 'input', x: w.t, y: w.vin },
        { name: 'output', x: w.t, y: w.vout },
      ],
    },
    notes: ['rectifierNote'],
  });
}

function bjt(values: Values): KitOk {
  const vcc = positive(values, 'bvcc', 'supplyVoltage', 'V');
  const [r1, r2, rc, re] = [
    positive(values, 'br1', 'upperDivider', 'Ω'),
    positive(values, 'br2', 'lowerDivider', 'Ω'),
    positive(values, 'brc', 'collectorResistor', 'Ω'),
    positive(values, 'bre', 'emitterResistor', 'Ω'),
  ];
  const beta = positive(values, 'bbeta', 'beta');
  const vbe = need(values, 'bvbe', 'baseEmitterVoltage', 'V');
  const vt = positive(values, 'bvt', 'thermalVoltage', 'V');
  const b = bjtBias(vcc, r1, r2, rc, re, beta, vbe);
  const rows: KitRow[] = [
    { key: 'theveninVoltage', value: eng(b.vth, 'V') },
    { key: 'theveninResistance', value: eng(b.rth, 'Ω') },
    { key: 'baseCurrent', value: eng(b.ib, 'A') },
    { key: 'collectorCurrent', value: eng(b.ic, 'A') },
    { key: 'collectorEmitter', value: eng(b.vce, 'V') },
    { key: 'region', value: '', word: b.region },
  ];
  const steps: KitOk['steps'] = [
    {
      key: 'bjtThevenin',
      vars: { vth: eng(b.vth, 'V'), rth: eng(b.rth, 'Ω') },
      math: 'V_{Th} = V_{CC}\\frac{R_2}{R_1 + R_2},\\quad R_{Th} = R_1 \\parallel R_2',
    },
    {
      key: 'bjtBase',
      vars: { ib: eng(b.ib, 'A'), ic: eng(b.ic, 'A') },
      math: 'I_B = \\frac{V_{Th} - V_{BE}}{R_{Th} + (\\beta + 1)R_E},\\quad I_C = \\beta I_B',
    },
    { key: 'bjtCollector', vars: { vce: eng(b.vce, 'V') }, math: 'V_{CE} = V_{CC} - I_C R_C - I_E R_E' },
    { key: b.region === 'active' ? 'regionActive' : b.region === 'saturation' ? 'regionSaturated' : 'regionCutoff' },
  ];
  const notes: KitOk['notes'] = ['bjtNote'];
  let answer = `IC = ${eng(b.ic, 'A')}, VCE = ${eng(b.vce, 'V')} (${b.region})`;
  if (b.ic > 0) {
    const rlRaw = optional(values, 'brl', 'loadResistor', 'Ω');
    const early = optional(values, 'bearly', 'earlyVoltage', 'V');
    const bypassed = (values.bbypass ?? 'bypassed') === 'bypassed';
    const g = bjtGain(b, beta, vt, rc, re, rlRaw, early, bypassed, r1, r2);
    rows.push(
      { key: 'transconductance', value: eng(g.gm, 'S') },
      { key: 'baseResistance', value: eng(g.rpi, 'Ω') },
      { key: 'emitterResistance', value: eng(g.re, 'Ω') },
      { key: 'voltageGain', value: fmt(g.gain) },
      { key: 'inputResistance', value: eng(g.rin, 'Ω') },
      { key: 'outputResistance', value: eng(g.rout, 'Ω') },
    );
    steps.push({
      key: bypassed ? 'bjtGainBypassed' : 'bjtGainUnbypassed',
      vars: { gm: eng(g.gm, 'S'), gain: fmt(g.gain) },
      math: bypassed
        ? 'g_m = \\frac{I_C}{V_T},\\quad A_v = -g_m\\,(R_C \\parallel R_L \\parallel r_o)'
        : 'A_v = \\frac{-\\beta\\,(R_C \\parallel R_L)}{r_\\pi + (\\beta + 1)R_E}',
    });
    if (b.region === 'saturation') notes.push('saturatedGainNote');
    answer += `; gain ${fmt(g.gain)}`;
  }
  return ok({
    rows,
    steps,
    answer,
    latex: `I_C = ${n(b.ic)}\\ \\mathrm{A},\\quad V_{CE} = ${n(b.vce)}\\ \\mathrm{V}`,
    plot: {
      xLabel: 'V_CE (V)',
      yLabel: 'I_C (A)',
      series: [{ name: 'load line', x: [0, vcc], y: [vcc / (rc + re), 0] }],
    },
    notes,
  });
}

function mosfet(values: Values): KitOk {
  const vdd = positive(values, 'mvdd', 'supplyVoltage', 'V');
  const [r1, r2, rd] = [
    positive(values, 'mr1', 'upperDivider', 'Ω'),
    positive(values, 'mr2', 'lowerDivider', 'Ω'),
    positive(values, 'mrd', 'drainResistor', 'Ω'),
  ];
  const rsText = (values.mrs ?? '').trim();
  const rs = rsText === '' || rsText === '0' ? 0 : positive(values, 'mrs', 'sourceResistor', 'Ω');
  const k = positive(values, 'mk', 'transconductanceParameter', 'A/V²');
  const vt = need(values, 'mvt', 'thresholdVoltage', 'V');
  const m = mosfetBias(vdd, r1, r2, rd, rs, k, vt);
  const rows: KitRow[] = [
    { key: 'gateVoltage', value: eng(m.vg, 'V') },
    { key: 'gateSource', value: eng(m.vgs, 'V') },
    { key: 'overdrive', value: eng(m.vov, 'V') },
    { key: 'drainCurrent', value: eng(m.id, 'A') },
    { key: 'drainSource', value: eng(m.vds, 'V') },
    { key: 'region', value: '', word: m.region },
  ];
  const steps: KitOk['steps'] = [
    { key: 'mosGate', vars: { vg: eng(m.vg, 'V') }, math: 'V_G = V_{DD}\\frac{R_2}{R_1 + R_2}' },
    {
      key: 'mosSquareLaw',
      vars: { id: eng(m.id, 'A'), vov: eng(m.vov, 'V') },
      math: 'I_D = \\frac{k}{2}(V_{GS} - V_t)^2,\\quad V_{GS} = V_G - I_D R_S',
    },
    { key: 'mosDrain', vars: { vds: eng(m.vds, 'V') }, math: 'V_{DS} = V_{DD} - I_D(R_D + R_S)' },
    {
      key: m.region === 'saturation' ? 'mosSaturation' : m.region === 'triode' ? 'mosTriode' : 'mosCutoff',
      math: m.region === 'saturation' ? 'V_{DS} \\ge V_{GS} - V_t' : undefined,
    },
  ];
  const notes: KitOk['notes'] = ['mosNote'];
  let answer = `ID = ${eng(m.id, 'A')}, VDS = ${eng(m.vds, 'V')} (${m.region})`;
  if (m.region === 'saturation') {
    const rl = optional(values, 'mrl', 'loadResistor', 'Ω');
    const lambdaText = (values.mlambda ?? '').trim();
    const lambda = lambdaText === '' ? 0 : need(values, 'mlambda', 'channelModulation');
    const bypassed = (values.mbypass ?? 'bypassed') === 'bypassed';
    const g = mosfetGain(m, k, rd, rs, rl, lambda, bypassed);
    rows.push(
      { key: 'transconductance', value: eng(g.gm, 'S') },
      { key: 'voltageGain', value: fmt(g.gain) },
      { key: 'outputResistance', value: eng(g.rout, 'Ω') },
    );
    steps.push({
      key: bypassed ? 'mosGainBypassed' : 'mosGainUnbypassed',
      vars: { gm: eng(g.gm, 'S'), gain: fmt(g.gain) },
      math: bypassed
        ? 'g_m = k(V_{GS} - V_t),\\quad A_v = -g_m\\,(R_D \\parallel R_L \\parallel r_o)'
        : 'A_v = \\frac{-g_m\\,(R_D \\parallel R_L)}{1 + g_m R_S}',
    });
    answer += `; gain ${fmt(g.gain)}`;
  }
  return ok({
    rows,
    steps,
    answer,
    latex: `I_D = ${n(m.id)}\\ \\mathrm{A},\\quad V_{DS} = ${n(m.vds)}\\ \\mathrm{V}`,
    plot: {
      xLabel: 'V_DS (V)',
      yLabel: 'I_D (A)',
      series: [{ name: 'load line', x: [0, vdd], y: [vdd / (rd + rs), 0] }],
    },
    notes,
  });
}

const MODE: Record<string, (values: Values) => KitOk> = { diode, zener, rectifier: rectifierTool, bjt, mosfet };

export const spec: ToolSpec = {
  id: 'semis',
  fields: FIELDS,
  run: (values) => (MODE[modeOf(values)] ?? diode)(values),
};
