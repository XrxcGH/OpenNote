// The op-amp and filter tool. It covers ideal amplifier stages; second-order active filter sections; the order and
// poles a filter specification needs; passive RC and RLC filters.
import type { Field, ToolSpec } from '../spec';
import { eng, fmt, logSpace, need, ok, positive } from '../shared';
import type { KitOk, KitRow, KitStep, NoteKey, Plot, Values } from '../shared';
import {
  biquadResponse,
  decibels,
  design,
  difference,
  differentiator,
  exactOrder,
  firstOrderStage,
  instrumentation,
  integrator,
  inverting,
  loss,
  multipleFeedbackLow,
  nonInverting,
  order,
  rcCutoff,
  sallenKeyHigh,
  sallenKeyLow,
  sallenKeyStage,
  seriesRlc,
  summing,
} from './engine';
import type { Family, Section } from './engine';

const MODES = ['amplifier', 'sallen', 'order', 'passive'] as const;
const CONFIGS = [
  'inverting',
  'noninverting',
  'summing',
  'difference',
  'instrumentation',
  'integrator',
  'differentiator',
] as const;
const SECTIONS = ['skLow', 'skHigh', 'mfbLow'] as const;

const modeOf = (v: Values): string => v.mode ?? 'amplifier';
const configOf = (v: Values): string => v.config ?? 'inverting';
const amp =
  (...configs: string[]) =>
  (v: Values) =>
    modeOf(v) === 'amplifier' && configs.includes(configOf(v));
const inMode =
  (mode: string) =>
  (v: Values): boolean =>
    modeOf(v) === mode;
const passive = (kind: string) => (v: Values) => modeOf(v) === 'passive' && (v.kind ?? 'rcpass') === kind;

const choice = (id: string, label: Field['label'], initial: string, values: readonly string[], when?: Field['when']) =>
  ({
    id,
    label,
    initial,
    kind: 'select',
    options: values.map((value) => ({ value, label: value as Field['label'] })),
    when,
  }) satisfies Field;

const FIELDS: readonly Field[] = [
  choice('mode', 'opMode', 'amplifier', MODES),
  choice('config', 'configuration', 'inverting', CONFIGS, inMode('amplifier')),
  { id: 'rin', label: 'inputResistor', initial: '1k', unit: 'Ω', when: amp('inverting') },
  { id: 'rf', label: 'feedbackResistor', initial: '10k', unit: 'Ω', when: amp('inverting', 'noninverting', 'summing') },
  { id: 'rg', label: 'groundResistor', initial: '1k', unit: 'Ω', when: amp('noninverting') },
  { id: 'rs1', label: 'input1Resistor', initial: '10k', unit: 'Ω', when: amp('summing') },
  { id: 'rs2', label: 'input2Resistor', initial: '20k', unit: 'Ω', when: amp('summing') },
  { id: 'rs3', label: 'input3Resistor', initial: '5k', unit: 'Ω', when: amp('summing') },
  { id: 'rd1', label: 'diffR1', initial: '1k', unit: 'Ω', when: amp('difference') },
  { id: 'rd2', label: 'diffR2', initial: '10k', unit: 'Ω', when: amp('difference') },
  { id: 'rd3', label: 'diffR3', initial: '1k', unit: 'Ω', when: amp('difference') },
  { id: 'rd4', label: 'diffR4', initial: '10k', unit: 'Ω', when: amp('difference') },
  { id: 'rif', label: 'instrumentR', initial: '25k', unit: 'Ω', when: amp('instrumentation') },
  { id: 'rig', label: 'instrumentRg', initial: '1k', unit: 'Ω', when: amp('instrumentation') },
  { id: 'rio1', label: 'outputStageIn', initial: '10k', unit: 'Ω', when: amp('instrumentation') },
  { id: 'rio2', label: 'outputStageFeedback', initial: '10k', unit: 'Ω', when: amp('instrumentation') },
  { id: 'rt', label: 'resistance', initial: '10k', unit: 'Ω', when: amp('integrator', 'differentiator') },
  { id: 'ct', label: 'capacitance', initial: '10n', unit: 'F', when: amp('integrator', 'differentiator') },
  { id: 'hz', label: 'frequencyHz', initial: '1k', unit: 'Hz', when: amp('integrator', 'differentiator') },
  {
    id: 'v1',
    label: 'voltage1',
    initial: '0.5',
    unit: 'V',
    when: amp('inverting', 'noninverting', 'summing', 'difference', 'instrumentation'),
  },
  { id: 'v2', label: 'voltage2', initial: '0.2', unit: 'V', when: amp('summing', 'difference', 'instrumentation') },
  { id: 'v3', label: 'voltage3', initial: '-0.1', unit: 'V', when: amp('summing') },
  choice('section', 'sectionKind', 'skLow', SECTIONS, inMode('sallen')),
  { id: 'sr1', label: 'sectionR1', initial: '10k', unit: 'Ω', when: inMode('sallen') },
  { id: 'sr2', label: 'sectionR2', initial: '10k', unit: 'Ω', when: inMode('sallen') },
  {
    id: 'sr3',
    label: 'sectionR3',
    initial: '10k',
    unit: 'Ω',
    when: (v) => inMode('sallen')(v) && v.section === 'mfbLow',
  },
  { id: 'sc1', label: 'sectionC1', initial: '22n', unit: 'F', when: inMode('sallen') },
  { id: 'sc2', label: 'sectionC2', initial: '10n', unit: 'F', when: inMode('sallen') },
  choice('family', 'family', 'butterworth', ['butterworth', 'chebyshev'], inMode('order')),
  { id: 'fp', label: 'passbandEdge', initial: '1k', unit: 'Hz', when: inMode('order') },
  { id: 'ap', label: 'passbandLoss', initial: '3.0103', when: inMode('order') },
  { id: 'fs', label: 'stopbandEdge', initial: '3k', unit: 'Hz', when: inMode('order') },
  { id: 'as', label: 'stopbandLoss', initial: '40', when: inMode('order') },
  { id: 'cap', label: 'designCapacitor', initial: '10n', unit: 'F', when: inMode('order') },
  choice('kind', 'passiveKind', 'rcpass', ['rcpass', 'rlcpass'], inMode('passive')),
  { id: 'pr', label: 'resistance', initial: '1k', unit: 'Ω', when: inMode('passive') },
  { id: 'pc', label: 'capacitance', initial: '100n', unit: 'F', when: inMode('passive') },
  { id: 'pl', label: 'inductance', initial: '10m', unit: 'H', when: passive('rlcpass') },
];

const n = (value: number): string => fmt(value).replace('−', '-');

function gainRows(gain: number, vout: number | null, extra: KitRow[] = []): KitRow[] {
  const rows: KitRow[] = [
    { key: 'opGain', value: fmt(gain) },
    { key: 'gainDb', value: `${fmt(decibels(gain))} dB${gain < 0 ? ' (inverting)' : ''}` },
    ...extra,
  ];
  if (vout !== null) rows.push({ key: 'outputVoltage', value: eng(vout, 'V') });
  return rows;
}

const vOf =
  (values: Values) =>
  (id: string, label: Field['label'] = 'voltage1') =>
    need(values, id, label, 'V');
const resOf = (values: Values) => (id: string, label: Field['label']) => positive(values, id, label, 'Ω');

function invertingStage(values: Values): KitOk {
  const v = vOf(values);
  const res = resOf(values);
  const rin = res('rin', 'inputResistor');
  const rf = res('rf', 'feedbackResistor');
  const g = inverting(rin, rf);
  const vout = g.gain * v('v1');
  return ok({
    rows: gainRows(g.gain, vout, [{ key: 'inputR', value: eng(rin, 'Ω') }]),
    steps: [
      { key: 'virtualShort' },
      { key: 'invertingGain', vars: { gain: n(g.gain) }, math: 'A_v = -\\frac{R_f}{R_{in}}' },
      { key: 'outputStep', vars: { value: eng(vout, 'V') }, math: 'V_{out} = A_v V_{in}' },
    ],
    answer: `Gain = ${n(g.gain)}, Vout = ${eng(vout, 'V')}`,
    latex: `A_v = -\\frac{R_f}{R_{in}} = ${n(g.gain)},\\quad V_{out} = ${n(vout)}\\ \\mathrm{V}`,
    notes: ['opampNote'],
  });
}

function nonInvertingStage(values: Values): KitOk {
  const v = vOf(values);
  const res = resOf(values);
  const rf = res('rf', 'feedbackResistor');
  const rg = res('rg', 'groundResistor');
  const g = nonInverting(rf, rg);
  const vout = g.gain * v('v1');
  return ok({
    rows: gainRows(g.gain, vout),
    steps: [
      { key: 'virtualShort' },
      { key: 'nonInvertingGain', vars: { gain: n(g.gain) }, math: 'A_v = 1 + \\frac{R_f}{R_g}' },
      { key: 'outputStep', vars: { value: eng(vout, 'V') }, math: 'V_{out} = A_v V_{in}' },
    ],
    answer: `Gain = ${n(g.gain)}, Vout = ${eng(vout, 'V')}`,
    latex: `A_v = 1 + \\frac{R_f}{R_g} = ${n(g.gain)},\\quad V_{out} = ${n(vout)}\\ \\mathrm{V}`,
    notes: ['opampNote'],
  });
}

function summingStage(values: Values): KitOk {
  const v = vOf(values);
  const res = resOf(values);
  const rf = res('rf', 'feedbackResistor');
  const rs = [res('rs1', 'input1Resistor'), res('rs2', 'input2Resistor'), res('rs3', 'input3Resistor')];
  const vs = [v('v1'), v('v2', 'voltage2'), v('v3', 'voltage3')];
  const r = summing(rf, rs, vs);
  return ok({
    rows: [
      ...r.gains.map((g, i): KitRow => ({ key: 'inputGain', vars: { n: String(i + 1) }, value: fmt(g) })),
      { key: 'outputVoltage', value: eng(r.vout, 'V') },
    ],
    steps: [
      { key: 'virtualShort' },
      {
        key: 'summingGain',
        math: 'V_{out} = -R_f\\left(\\frac{V_1}{R_1} + \\frac{V_2}{R_2} + \\frac{V_3}{R_3}\\right)',
      },
      { key: 'outputStep', vars: { value: eng(r.vout, 'V') } },
    ],
    answer: `Vout = ${eng(r.vout, 'V')}`,
    latex: `V_{out} = -R_f\\sum \\frac{V_i}{R_i} = ${n(r.vout)}\\ \\mathrm{V}`,
    notes: ['opampNote'],
  });
}

function differenceStage(values: Values): KitOk {
  const v = vOf(values);
  const res = resOf(values);
  const [r1, r2, r3, r4] = [res('rd1', 'diffR1'), res('rd2', 'diffR2'), res('rd3', 'diffR3'), res('rd4', 'diffR4')];
  const r = difference(r1, r2, r3, r4, v('v1'), v('v2', 'voltage2'));
  return ok({
    rows: [
      { key: 'gainV1', value: fmt(r.gain1) },
      { key: 'gainV2', value: fmt(r.gain2) },
      { key: 'outputVoltage', value: eng(r.vout, 'V') },
      { key: 'matchedRatio', value: '', word: r.matched ? 'yes' : 'no' },
    ],
    steps: [
      { key: 'virtualShort' },
      {
        key: 'differenceGain',
        math: 'V_{out} = V_2\\,\\frac{R_4}{R_3 + R_4}\\left(1 + \\frac{R_2}{R_1}\\right) - V_1\\frac{R_2}{R_1}',
      },
      { key: 'outputStep', vars: { value: eng(r.vout, 'V') } },
    ],
    answer: `Vout = ${eng(r.vout, 'V')} (gain ${fmt(r.gain1)} from V1 and ${fmt(r.gain2)} from V2)`,
    latex: `V_{out} = ${n(r.gain2)}V_2 ${r.gain1 < 0 ? '-' : '+'} ${n(Math.abs(r.gain1))}V_1 = ${n(r.vout)}\\ \\mathrm{V}`,
    notes: r.matched ? ['opampNote'] : ['opampNote', 'unmatchedNote'],
  });
}

function instrumentationStage(values: Values): KitOk {
  const v = vOf(values);
  const res = resOf(values);
  const r = instrumentation(
    res('rif', 'instrumentR'),
    res('rig', 'instrumentRg'),
    res('rio1', 'outputStageIn'),
    res('rio2', 'outputStageFeedback'),
  );
  const vd = v('v2', 'voltage2') - v('v1');
  const vout = r.gain * vd;
  return ok({
    rows: [
      { key: 'inputStageGain', value: fmt(r.first) },
      { key: 'outputStageGain', value: fmt(r.second) },
      { key: 'opGain', value: fmt(r.gain) },
      { key: 'outputVoltage', value: eng(vout, 'V') },
    ],
    steps: [
      { key: 'instrumentationGain', vars: { first: fmt(r.first) }, math: 'A_1 = 1 + \\frac{2R}{R_g}' },
      {
        key: 'instrumentationTotal',
        vars: { gain: fmt(r.gain) },
        math: 'A_v = \\left(1 + \\frac{2R}{R_g}\\right)\\frac{R_3}{R_2}',
      },
      { key: 'outputStep', vars: { value: eng(vout, 'V') }, math: 'V_{out} = A_v (V_2 - V_1)' },
    ],
    answer: `Gain = ${fmt(r.gain)}, Vout = ${eng(vout, 'V')} for V2 − V1 = ${eng(vd, 'V')}`,
    latex: `A_v = ${n(r.gain)},\\quad V_{out} = ${n(vout)}\\ \\mathrm{V}`,
    notes: ['opampNote'],
  });
}

function timeStage(values: Values, config: string): KitOk {
  const res = resOf(values);
  const r = res('rt', 'resistance');
  const c = positive(values, 'ct', 'capacitance', 'F');
  const hz = positive(values, 'hz', 'frequencyHz', 'Hz');
  const isInt = config === 'integrator';
  const out = isInt ? integrator(r, c, hz) : differentiator(r, c, hz);
  const freqs = logSpace(hz / 100, hz * 100, 61);
  const plot: Plot = {
    xLabel: 'f (Hz)',
    yLabel: '|A| (dB)',
    logX: true,
    series: [{ name: '|A|', x: freqs, y: freqs.map((f) => decibels(isInt ? out.unity / f : f / out.unity)) }],
  };
  return ok({
    rows: [
      { key: 'unityFrequency', value: eng(out.unity, 'Hz') },
      { key: 'gainMagnitude', value: fmt(out.magnitude) },
      { key: 'gainDb', value: `${fmt(decibels(out.magnitude))} dB` },
      { key: 'phase', value: `${isInt ? '+90' : '−90'}° (plus the inversion)` },
    ],
    steps: [
      { key: 'virtualShort' },
      {
        key: isInt ? 'integratorGain' : 'differentiatorGain',
        math: isInt ? 'A_v = -\\frac{1}{j\\omega R C}' : 'A_v = -j\\omega R C',
      },
      { key: 'unityStep', vars: { value: eng(out.unity, 'Hz') }, math: 'f_u = \\frac{1}{2\\pi R C}' },
    ],
    answer: `|Gain| = ${fmt(out.magnitude)} at ${eng(hz, 'Hz')}; unity gain at ${eng(out.unity, 'Hz')}`,
    latex: `f_u = \\frac{1}{2\\pi R C} = ${n(out.unity)}\\ \\mathrm{Hz}`,
    plot,
    notes: ['opampNote', 'practicalNote'],
  });
}

const AMPLIFIERS: Record<string, (values: Values) => KitOk> = {
  inverting: invertingStage,
  noninverting: nonInvertingStage,
  summing: summingStage,
  difference: differenceStage,
  instrumentation: instrumentationStage,
};

function amplifier(values: Values): KitOk {
  const config = configOf(values);
  return (AMPLIFIERS[config] ?? ((v: Values) => timeStage(v, config)))(values);
}

const bode = (sections: Section[], highs: boolean[], f0: number): Plot => {
  const freqs = logSpace(f0 / 100, f0 * 100, 121);
  const y = freqs.map((_, i) =>
    sections.reduce((sum, s, k) => sum + biquadResponse(s, highs[k] ?? false, [freqs[i]!])[0]!, 0),
  );
  return { xLabel: 'f (Hz)', yLabel: '|H| (dB)', logX: true, series: [{ name: '|H|', x: freqs, y }] };
};

function activeSection(values: Values): KitOk {
  const kind = values.section ?? 'skLow';
  const r1 = positive(values, 'sr1', 'sectionR1', 'Ω');
  const r2 = positive(values, 'sr2', 'sectionR2', 'Ω');
  const c1 = positive(values, 'sc1', 'sectionC1', 'F');
  const c2 = positive(values, 'sc2', 'sectionC2', 'F');
  let s: Section;
  let notes: NoteKey[];
  let steps: KitStep[];
  if (kind === 'skHigh') {
    s = sallenKeyHigh(r1, r2, c1, c2);
    notes = ['skHighNote', 'opampNote'];
    steps = [
      { key: 'skF0', math: 'f_0 = \\frac{1}{2\\pi\\sqrt{R_1R_2C_1C_2}}' },
      { key: 'skQ', math: 'Q = \\frac{\\sqrt{R_1R_2C_1C_2}}{R_1\\,(C_1 + C_2)}' },
    ];
  } else if (kind === 'mfbLow') {
    const r3 = positive(values, 'sr3', 'sectionR3', 'Ω');
    s = multipleFeedbackLow(r1, r2, r3, c1, c2);
    notes = ['mfbNote', 'opampNote'];
    steps = [
      { key: 'skF0', math: 'f_0 = \\frac{1}{2\\pi\\sqrt{R_2R_3C_1C_2}}' },
      {
        key: 'skQ',
        math: 'Q = \\frac{\\sqrt{R_2R_3C_1C_2}}{C_2\\,(R_2 + R_3 + R_2R_3/R_1)},\\quad A_0 = -\\frac{R_3}{R_1}',
      },
    ];
  } else {
    s = sallenKeyLow(r1, r2, c1, c2);
    notes = ['skLowNote', 'opampNote'];
    steps = [
      { key: 'skF0', math: 'f_0 = \\frac{1}{2\\pi\\sqrt{R_1R_2C_1C_2}}' },
      { key: 'skQ', math: 'Q = \\frac{\\sqrt{R_1R_2C_1C_2}}{C_2\\,(R_1 + R_2)}' },
    ];
  }
  const high = kind === 'skHigh';
  const response = s.q > 1 / Math.SQRT2 ? 'peaking' : 'flat';
  const rows: KitRow[] = [
    { key: 'naturalFrequency', value: eng(s.f0, 'Hz') },
    { key: 'qualityFactor', value: fmt(s.q) },
    { key: 'sectionGain', value: fmt(s.gain) },
    { key: 'responseShape', value: '', word: response },
  ];
  rows.push({ key: 'cutoff3db', value: eng(cutoff3(s, high), 'Hz') });
  steps.push({ key: 'skResult', vars: { f0: eng(s.f0, 'Hz'), q: fmt(s.q) } });
  return ok({
    rows,
    steps,
    answer: `f0 = ${eng(s.f0, 'Hz')}, Q = ${fmt(s.q)}`,
    latex: `f_0 = ${n(s.f0)}\\ \\mathrm{Hz},\\quad Q = ${n(s.q)}`,
    plot: bode([s], [high], s.f0),
    notes,
  });
}

/** The -3 dB frequency of a section, relative to its gain at DC (low-pass) or at high frequency (high-pass). */
function cutoff3(s: Section, high: boolean): number {
  const half = 1 - 1 / (2 * s.q * s.q);
  const x = Math.sqrt(half + Math.sqrt(half * half + 1));
  return high ? s.f0 / x : s.f0 * x;
}

function filterOrder(values: Values): KitOk {
  const family = (values.family ?? 'butterworth') as Family;
  const spec = {
    family,
    fp: positive(values, 'fp', 'passbandEdge', 'Hz'),
    fs: positive(values, 'fs', 'stopbandEdge', 'Hz'),
    ap: need(values, 'ap', 'passbandLoss'),
    as: need(values, 'as', 'stopbandLoss'),
  };
  const exact = exactOrder(spec);
  const count = order(spec);
  const d = design(family, count, spec.fp, spec.ap);
  const cap = positive(values, 'cap', 'designCapacitor', 'F');
  const rows: KitRow[] = [
    { key: 'exactOrder', value: fmt(exact) },
    { key: 'filterOrder', value: String(count) },
    { key: family === 'butterworth' ? 'cutoff3db' : 'rippleEdge', value: eng(d.edge, 'Hz') },
    { key: 'actualStopLoss', value: `${fmt(loss(family, count, spec.fp, spec.ap, spec.fs))} dB` },
  ];
  d.sections.forEach((s, i) => {
    const label = String(i + 1);
    if (s.real) {
      rows.push({
        key: 'realPole',
        vars: { n: label },
        value: `f₀ = ${eng(s.f0, 'Hz')}; R = ${eng(firstOrderStage(s.f0, cap), 'Ω')} with C = ${eng(cap, 'F')}`,
      });
    } else {
      const c = sallenKeyStage(s.f0, s.q, cap);
      rows.push({
        key: 'sectionRow',
        vars: { n: label },
        value: `f₀ = ${eng(s.f0, 'Hz')}, Q = ${fmt(s.q)}; R = ${eng(c.r, 'Ω')}, C1 = ${eng(c.c1, 'F')}, C2 = ${eng(c.c2, 'F')}`,
      });
    }
  });
  const freqs = logSpace(spec.fp / 10, spec.fs * 4, 121);
  const plot: Plot = {
    xLabel: 'f (Hz)',
    yLabel: '|H| (dB)',
    logX: true,
    series: [{ name: '|H|', x: freqs, y: freqs.map((f) => -loss(family, count, spec.fp, spec.ap, f)) }],
  };
  return ok({
    rows,
    steps: [
      {
        key: family === 'butterworth' ? 'butterOrder' : 'chebyOrder',
        vars: { exact: fmt(exact), n: String(count) },
        math:
          family === 'butterworth'
            ? 'n \\ge \\frac{\\log_{10}\\left(\\frac{10^{A_s/10}-1}{10^{A_p/10}-1}\\right)}{2\\log_{10}(\\omega_s/\\omega_p)}'
            : 'n \\ge \\frac{\\cosh^{-1}\\sqrt{\\frac{10^{A_s/10}-1}{10^{A_p/10}-1}}}{\\cosh^{-1}(\\omega_s/\\omega_p)}',
      },
      {
        key: 'polesStep',
        math:
          family === 'butterworth'
            ? 's_k = \\omega_c\\,e^{j\\pi(2k+n-1)/(2n)}'
            : 's_k = -\\omega_p\\sinh a\\sin\\theta_k + j\\omega_p\\cosh a\\cos\\theta_k',
      },
      { key: 'stageDesign', vars: { cap: eng(cap, 'F') }, math: 'C_1 = 4Q^2C_2,\\quad R = \\frac{1}{4\\pi f_0 Q C_2}' },
    ],
    answer: `${family === 'butterworth' ? 'Butterworth' : 'Chebyshev'} low-pass, order ${count} (exactly ${fmt(exact)} needed)`,
    latex: `n = ${count}`,
    plot,
    notes: family === 'butterworth' ? ['orderNote', 'opampNote'] : ['orderNote', 'chebyNote', 'opampNote'],
  });
}

function passiveFilter(values: Values): KitOk {
  const r = positive(values, 'pr', 'resistance', 'Ω');
  const c = positive(values, 'pc', 'capacitance', 'F');
  if ((values.kind ?? 'rcpass') === 'rcpass') {
    const fc = rcCutoff(r, c);
    const freqs = logSpace(fc / 100, fc * 100, 81);
    return ok({
      rows: [
        { key: 'cutoff3db', value: eng(fc, 'Hz') },
        { key: 'timeConstant', value: eng(r * c, 's') },
        { key: 'rolloff', value: '−20 dB per decade' },
      ],
      steps: [
        { key: 'rcCutoffStep', vars: { value: eng(fc, 'Hz') }, math: 'f_c = \\frac{1}{2\\pi R C}' },
        { key: 'rcResponse', math: '|H(f)| = \\frac{1}{\\sqrt{1 + (f/f_c)^2}}' },
      ],
      answer: `RC low-pass cutoff f_c = ${eng(fc, 'Hz')}`,
      latex: `f_c = \\frac{1}{2\\pi R C} = ${n(fc)}\\ \\mathrm{Hz}`,
      plot: {
        xLabel: 'f (Hz)',
        yLabel: '|H| (dB)',
        logX: true,
        series: [{ name: '|H|', x: freqs, y: freqs.map((f) => decibels(1 / Math.hypot(1, f / fc))) }],
      },
      notes: ['rcNote'],
    });
  }
  const l = positive(values, 'pl', 'inductance', 'H');
  const s = seriesRlc(r, l, c);
  const freqs = logSpace(s.f0 / 20, s.f0 * 20, 161);
  const resp = (f: number) => {
    const x = f / s.f0;
    return decibels(1 / Math.hypot(1, s.q * (x - 1 / x)));
  };
  return ok({
    rows: [
      { key: 'resonantHz', value: eng(s.f0, 'Hz') },
      { key: 'qualityFactor', value: fmt(s.q) },
      { key: 'bandwidth', value: eng(s.bandwidth, 'Hz') },
      { key: 'characteristicZ', value: eng(s.z0, 'Ω') },
    ],
    steps: [
      { key: 'rlcResonance', vars: { value: eng(s.f0, 'Hz') }, math: 'f_0 = \\frac{1}{2\\pi\\sqrt{LC}}' },
      { key: 'rlcQ', vars: { q: fmt(s.q) }, math: 'Q = \\frac{1}{R}\\sqrt{\\frac{L}{C}},\\quad BW = \\frac{f_0}{Q}' },
    ],
    answer: `Series RLC band-pass: f0 = ${eng(s.f0, 'Hz')}, Q = ${fmt(s.q)}, bandwidth ${eng(s.bandwidth, 'Hz')}`,
    latex: `f_0 = ${n(s.f0)}\\ \\mathrm{Hz},\\quad Q = ${n(s.q)}`,
    plot: { xLabel: 'f (Hz)', yLabel: '|H| (dB)', logX: true, series: [{ name: '|H|', x: freqs, y: freqs.map(resp) }] },
    notes: ['rlcNote'],
  });
}

const MODE: Record<string, (values: Values) => KitOk> = {
  amplifier,
  sallen: activeSection,
  order: filterOrder,
  passive: passiveFilter,
};

export const spec: ToolSpec = {
  id: 'opamps',
  fields: FIELDS,
  run: (values) => (MODE[modeOf(values)] ?? amplifier)(values),
};
