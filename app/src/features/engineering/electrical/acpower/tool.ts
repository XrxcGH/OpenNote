// The AC power tool: single-phase power, power factor correction, balanced three-phase loads, and per unit.
import type { Field, ToolSpec } from '../spec';
import { eng, fmt, need, nonNegative, ok, positive } from '../shared';
import type { KitOk, KitRow, KitStep, Values } from '../shared';
import { changeBase, correction, fromPowerFactor, perUnitBase, threePhase } from './engine';
import type { Connection, Lag } from './engine';

const MODES = ['power', 'correction', 'threephase', 'perunit', 'rebase'] as const;
const modeOf = (v: Values): string => v.mode ?? 'correction';
const only =
  (...modes: string[]) =>
  (v: Values) =>
    modes.includes(modeOf(v));

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
  choice('mode', 'acMode', 'correction', MODES),
  { id: 'p', label: 'realPower', initial: '10k', unit: 'W', when: only('power', 'correction') },
  { id: 'pf', label: 'powerFactor', initial: '0.8', when: only('power', 'correction') },
  choice('lag', 'lagKind', 'lagging', ['lagging', 'leading'], only('power')),
  { id: 'pf2', label: 'targetPowerFactor', initial: '0.95', when: only('correction') },
  { id: 'v', label: 'voltage', initial: '240', unit: 'V', when: only('power', 'correction') },
  { id: 'hz', label: 'frequency', initial: '60', unit: 'Hz', when: only('correction') },
  { id: 'vl', label: 'lineVoltage', initial: '480', unit: 'V', when: only('threephase') },
  { id: 'zmag', label: 'impedance', initial: '10', unit: 'Ω', when: only('threephase') },
  { id: 'zang', label: 'impedanceAngle', initial: '30', when: only('threephase') },
  choice('conn', 'connection', 'wye', ['wye', 'delta'], only('threephase')),
  { id: 'sb', label: 'baseApparent', initial: '100M', unit: 'VA', when: only('perunit', 'rebase') },
  { id: 'vb', label: 'baseVoltage', initial: '138k', unit: 'V', when: only('perunit', 'rebase') },
  { id: 'ohms', label: 'impedanceOhms', initial: '50', unit: 'Ω', when: only('perunit') },
  { id: 'zpu', label: 'impedancePu', initial: '0.1', when: only('rebase') },
  { id: 'sb2', label: 'newBaseApparent', initial: '500M', unit: 'VA', when: only('rebase') },
  { id: 'vb2', label: 'newBaseVoltage', initial: '132k', unit: 'V', when: only('rebase') },
];

function singlePhase(values: Values): KitOk {
  const p = need(values, 'p', 'realPower', 'W');
  const lag = (values.lag ?? 'lagging') as Lag;
  const v = positive(values, 'v', 'voltage', 'V');
  const load = fromPowerFactor(p, need(values, 'pf', 'powerFactor'), lag);
  const current = load.s / v;
  const rows: KitRow[] = [
    { key: 'realPower', value: eng(load.p, 'W') },
    { key: 'reactivePower', value: eng(load.q, 'var') },
    { key: 'apparentPower', value: eng(load.s, 'VA') },
    { key: 'powerFactor', value: `${fmt(load.pf)} ${lag}` },
    { key: 'phaseAngle', value: `${fmt(load.angle)}°` },
    { key: 'current', value: eng(current, 'A') },
  ];
  const steps: KitStep[] = [
    {
      key: 'triangle',
      math: 'S = \\frac{P}{\\mathrm{pf}},\\quad Q = P\\tan\\varphi,\\quad \\varphi = \\cos^{-1}(\\mathrm{pf})',
    },
    { key: 'triangleResult', vars: { s: eng(load.s, 'VA'), q: eng(load.q, 'var') } },
    { key: 'currentFromS', vars: { value: eng(current, 'A') }, math: 'I = \\frac{S}{V}' },
  ];
  return ok({
    rows,
    steps,
    answer: `P = ${eng(load.p, 'W')}, Q = ${eng(load.q, 'var')}, S = ${eng(load.s, 'VA')}, I = ${eng(current, 'A')}`,
    latex: `S = ${fmt(load.p)} ${load.q < 0 ? '-' : '+'} j${fmt(Math.abs(load.q))}\\ \\mathrm{VA}`,
    plot: {
      xLabel: 'P (W)',
      yLabel: 'Q (var)',
      series: [{ name: 'S', x: [0, load.p, load.p, 0], y: [0, 0, load.q, 0] }],
    },
    notes: ['acNote'],
  });
}

function correct(values: Values): KitOk {
  const p = positive(values, 'p', 'realPower', 'W');
  const v = positive(values, 'v', 'voltage', 'V');
  const hz = positive(values, 'hz', 'frequency', 'Hz');
  const pf1 = need(values, 'pf', 'powerFactor');
  const pf2 = need(values, 'pf2', 'targetPowerFactor');
  const r = correction(p, pf1, pf2, v, hz);
  const rows: KitRow[] = [
    { key: 'reactivePower', value: eng(r.q1, 'var') },
    { key: 'reactiveAfter', value: eng(r.q2, 'var') },
    { key: 'qc', value: eng(r.qc, 'var') },
    { key: 'capacitance', value: eng(r.c, 'F') },
    { key: 'currentBefore', value: eng(r.i1, 'A') },
    { key: 'currentAfter', value: eng(r.i2, 'A') },
  ];
  const steps: KitStep[] = [
    { key: 'corrQ', vars: { q1: eng(r.q1, 'var'), q2: eng(r.q2, 'var') }, math: 'Q = P\\tan\\varphi' },
    { key: 'corrQc', vars: { value: eng(r.qc, 'var') }, math: 'Q_c = P\\,(\\tan\\varphi_1 - \\tan\\varphi_2)' },
    {
      key: 'corrC',
      vars: { value: eng(r.c, 'F') },
      math: 'C = \\frac{Q_c}{\\omega V^2} = \\frac{Q_c}{2\\pi f V^2}',
    },
    { key: 'corrCurrent', vars: { before: eng(r.i1, 'A'), after: eng(r.i2, 'A') } },
  ];
  return ok({
    rows,
    steps,
    answer: `Qc = ${eng(r.qc, 'var')}, C = ${eng(r.c, 'F')} to raise the power factor from ${fmt(pf1)} to ${fmt(pf2)}`,
    latex: `Q_c = ${fmt(r.qc)}\\ \\mathrm{var},\\quad C = ${fmt(r.c)}\\ \\mathrm{F}`,
    plot: {
      xLabel: 'P (W)',
      yLabel: 'Q (var)',
      series: [
        { name: 'before', x: [0, p, p, 0], y: [0, 0, r.q1, 0] },
        { name: 'after', x: [0, p, p, 0], y: [0, 0, r.q2, 0] },
      ],
    },
    notes: ['acNote', 'correctionNote'],
  });
}

function balanced(values: Values): KitOk {
  const conn = (values.conn ?? 'wye') as Connection;
  const vl = positive(values, 'vl', 'lineVoltage', 'V');
  const zmag = positive(values, 'zmag', 'impedance', 'Ω');
  const angle = need(values, 'zang', 'impedanceAngle');
  const r = threePhase(vl, zmag, angle, conn);
  const rows: KitRow[] = [
    { key: 'phaseVoltage', value: eng(r.vPhase, 'V') },
    { key: 'phaseCurrent', value: eng(r.iPhase, 'A') },
    { key: 'lineCurrent', value: eng(r.iLine, 'A') },
    { key: 'totalReal', value: eng(r.s.re, 'W') },
    { key: 'totalReactive', value: eng(r.s.im, 'var') },
    { key: 'totalApparent', value: eng(Math.hypot(r.s.re, r.s.im), 'VA') },
    { key: 'powerFactor', value: fmt(r.pf) },
  ];
  const wye = conn === 'wye';
  const steps: KitStep[] = [
    {
      key: wye ? 'wyeRelations' : 'deltaRelations',
      vars: { vph: eng(r.vPhase, 'V') },
      math: wye
        ? 'V_\\phi = \\frac{V_L}{\\sqrt{3}},\\quad I_L = I_\\phi'
        : 'V_\\phi = V_L,\\quad I_L = \\sqrt{3}\\,I_\\phi',
    },
    {
      key: 'phaseCurrentStep',
      vars: { iph: eng(r.iPhase, 'A'), il: eng(r.iLine, 'A') },
      math: 'I_\\phi = \\frac{V_\\phi}{|Z|}',
    },
    {
      key: 'threePhasePower',
      vars: { p: eng(r.s.re, 'W'), q: eng(r.s.im, 'var') },
      math: 'S = 3\\,V_\\phi I_\\phi^{*} = \\sqrt{3}\\,V_L I_L\\,\\angle\\theta',
    },
  ];
  return ok({
    rows,
    steps,
    answer: `${conn}: V_ph = ${eng(r.vPhase, 'V')}, I_line = ${eng(r.iLine, 'A')}, P = ${eng(r.s.re, 'W')}`,
    latex: `P = ${fmt(r.s.re)}\\ \\mathrm{W},\\quad I_L = ${fmt(r.iLine)}\\ \\mathrm{A}`,
    notes: ['acNote', 'threePhaseNote'],
  });
}

function perUnit(values: Values): KitOk {
  const sb = positive(values, 'sb', 'baseApparent', 'VA');
  const vb = positive(values, 'vb', 'baseVoltage', 'V');
  const ohms = nonNegative(values, 'ohms', 'impedanceOhms', 'Ω');
  const r = perUnitBase(sb, vb, ohms);
  const rows: KitRow[] = [
    { key: 'zBase', value: eng(r.zBase, 'Ω') },
    { key: 'iBase', value: eng(r.iBase, 'A') },
    { key: 'zPu', value: `${fmt(r.zPu)} pu` },
  ];
  const steps: KitStep[] = [
    {
      key: 'puBase',
      vars: { z: eng(r.zBase, 'Ω'), i: eng(r.iBase, 'A') },
      math: 'Z_b = \\frac{V_b^2}{S_b},\\quad I_b = \\frac{S_b}{\\sqrt{3}\\,V_b}',
    },
    { key: 'puValue', vars: { value: fmt(r.zPu) }, math: 'Z_\\mathrm{pu} = \\frac{Z}{Z_b}' },
  ];
  return ok({
    rows,
    steps,
    answer: `Z_base = ${eng(r.zBase, 'Ω')}; ${eng(ohms, 'Ω')} = ${fmt(r.zPu)} pu`,
    latex: `Z_b = ${fmt(r.zBase)}\\ \\Omega,\\quad Z_\\mathrm{pu} = ${fmt(r.zPu)}`,
    notes: ['perUnitNote'],
  });
}

function rebase(values: Values): KitOk {
  const sb = positive(values, 'sb', 'baseApparent', 'VA');
  const vb = positive(values, 'vb', 'baseVoltage', 'V');
  const sb2 = positive(values, 'sb2', 'newBaseApparent', 'VA');
  const vb2 = positive(values, 'vb2', 'newBaseVoltage', 'V');
  const zpu = need(values, 'zpu', 'impedancePu');
  const next = changeBase(zpu, sb, vb, sb2, vb2);
  const rows: KitRow[] = [
    { key: 'zPuOld', value: `${fmt(zpu)} pu` },
    { key: 'zPuNew', value: `${fmt(next)} pu` },
    { key: 'zOhms', value: eng(zpu * ((vb * vb) / sb), 'Ω') },
  ];
  const steps: KitStep[] = [
    {
      key: 'puRebase',
      vars: { value: fmt(next) },
      math:
        'Z_\\mathrm{new} = Z_\\mathrm{old}\\,\\frac{S_\\mathrm{new}}{S_\\mathrm{old}}' +
        '\\left(\\frac{V_\\mathrm{old}}{V_\\mathrm{new}}\\right)^2',
    },
  ];
  return ok({
    rows,
    steps,
    answer: `${fmt(zpu)} pu on the old base = ${fmt(next)} pu on the new base`,
    latex: `Z_\\mathrm{new} = ${fmt(next)}\\ \\mathrm{pu}`,
    notes: ['perUnitNote'],
  });
}

const MODE: Record<string, (values: Values) => KitOk> = {
  power: singlePhase,
  correction: correct,
  threephase: balanced,
  perunit: perUnit,
  rebase,
};

export const spec: ToolSpec = {
  id: 'acpower',
  fields: FIELDS,
  run: (values) => (MODE[modeOf(values)] ?? correct)(values),
};
