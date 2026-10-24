// The first- and second-order circuits tool: the form, and the answer built from the engine.
import type { ToolSpec } from '../spec';
import { eng, fmt, need, ok, positive } from '../shared';
import type { KitOk, KitRow, KitStep, Values } from '../shared';
import { firstOrder, firstPeak, sample, secondOrder } from './engine';
import type { SecondOrder } from './engine';

/** "+ 3" or "- 3" for writing a term after another. */
const sign = (value: number): string => `${value < 0 ? '-' : '+'} ${fmt(Math.abs(value)).replace('−', '')}`;
const num = (value: number): string => fmt(value).replace('−', '-');

const PLOT = (name: string, unit: string) => ({ xLabel: 't (s)', yLabel: `${name} (${unit})` });

/** The response of a series RC or RL circuit: one time constant. */
function firstOrderTool(values: Values, circuit: string, r: number, source: number): KitOk {
  const rc = circuit === 'rc';
  const tau = rc ? r * positive(values, 'c', 'capacitance', 'F') : positive(values, 'l', 'inductance', 'H') / r;
  const x0 = rc ? need(values, 'v0', 'initialVoltage', 'V') : need(values, 'i0', 'initialCurrent', 'A');
  const xf = rc ? source : source / r;
  const response = firstOrder(tau, x0, xf);
  const name = rc ? 'v_C' : 'i_L';
  const unit = rc ? 'V' : 'A';
  const formula = `${name}(t) = ${num(xf)} ${sign(x0 - xf)}\\,e^{-t/${num(tau)}}\\ \\mathrm{${unit}}`;
  const steps: KitStep[] = [
    {
      key: rc ? 'rcTau' : 'rlTau',
      math: rc ? `\\tau = RC = ${num(tau)}\\,\\mathrm{s}` : `\\tau = L/R = ${num(tau)}\\,\\mathrm{s}`,
    },
    { key: 'firstOrder', math: 'x(t) = x_f + (x_0 - x_f)\\,e^{-t/\\tau}' },
    {
      key: 'firstOrderResult',
      vars: { final: eng(xf, unit), initial: eng(x0, unit), tau: eng(tau, 's') },
      math: formula,
    },
  ];
  const rows: KitRow[] = [
    { key: 'tau', value: eng(tau, 's') },
    { key: 'initialValue', value: eng(x0, unit) },
    { key: 'finalValue', value: eng(xf, unit) },
    { key: 'expression', value: `${name}(t) = ${fmt(xf)} ${sign(x0 - xf)} e^(−t/${fmt(tau)}) ${unit}` },
  ];
  return ok({
    rows,
    steps,
    answer: `τ = ${eng(tau, 's')}; ${name}(t) = ${fmt(xf)} ${sign(x0 - xf)} e^(−t/τ) ${unit}`,
    latex: `\\tau = ${num(tau)}\\,\\mathrm{s},\\quad ${formula}`,
    plot: { ...PLOT(name, unit), series: [{ name, ...sample(response.at, 5 * tau) }] },
    notes: ['idealParts', 'seriesStep'],
  });
}

/** The step, the case, and the general solution for one damping case, as steps, LaTeX, and text. */
function describeCase(r: SecondOrder, source: number, name: string, unit: string) {
  const end = `\\ \\mathrm{${unit}}`;
  const head = `${name}(t) = ${num(source)}`;
  if (r.damping === 'underdamped') {
    const wd = num(r.omegaD);
    const decay = `e^{-${num(r.alpha)}t}`;
    return {
      steps: [
        {
          key: 'caseUnder',
          vars: { value: eng(r.omegaD, 'rad/s') },
          math: '\\omega_d = \\sqrt{\\omega_0^2 - \\alpha^2}',
        },
        { key: 'generalUnder' },
      ] as KitStep[],
      latex: `${head} + ${decay}\\left(${num(r.a)}\\cos ${wd}t ${sign(r.b)}\\sin ${wd}t\\right)${end}`,
      text:
        `${name}(t) = ${fmt(source)} + e^(−${fmt(r.alpha)}t) ` +
        `(${fmt(r.a)} cos ${fmt(r.omegaD)}t ${sign(r.b)} sin ${fmt(r.omegaD)}t) ${unit}`,
    };
  }
  if (r.damping === 'overdamped') {
    return {
      steps: [
        { key: 'caseOver', vars: { s1: eng(r.s1, '1/s'), s2: eng(r.s2, '1/s') } },
        { key: 'generalOver' },
      ] as KitStep[],
      latex: `${head} ${sign(r.a)}e^{${num(r.s1)}t} ${sign(r.b)}e^{${num(r.s2)}t}${end}`,
      text: `${name}(t) = ${fmt(source)} ${sign(r.a)} e^(${fmt(r.s1)}t) ${sign(r.b)} e^(${fmt(r.s2)}t) ${unit}`,
    };
  }
  return {
    steps: [{ key: 'caseCritical', vars: { s1: eng(r.s1, '1/s') } }, { key: 'generalCritical' }] as KitStep[],
    latex: `${head} + (${num(r.a)} ${sign(r.b)}t)e^{-${num(r.alpha)}t}${end}`,
    text: `${name}(t) = ${fmt(source)} + (${fmt(r.a)} ${sign(r.b)} t) e^(−${fmt(r.alpha)}t) ${unit}`,
  };
}

/** The rows of the result: the parameters, the roots or frequency, the damping, and any overshoot. */
function secondOrderRows(r: SecondOrder, source: number, unit: string, text: string): KitRow[] {
  const rows: KitRow[] = [
    { key: 'alpha', value: eng(r.alpha, '1/s') },
    { key: 'omega0', value: eng(r.omega0, 'rad/s') },
  ];
  if (r.damping === 'underdamped') rows.push({ key: 'omegaD', value: eng(r.omegaD, 'rad/s') });
  else rows.push({ key: 's1', value: eng(r.s1, '1/s') }, { key: 's2', value: eng(r.s2, '1/s') });
  rows.push({ key: 'damping', value: '', word: r.damping }, { key: 'finalValue', value: eng(source, unit) });
  const peak = firstPeak(r);
  if (peak) {
    rows.push({ key: 'peakValue', value: eng(peak.value, unit) }, { key: 'peakTime', value: eng(peak.time, 's') });
    if (source !== r.x0) {
      rows.push({ key: 'overshoot', value: `${fmt(((peak.value - source) / Math.abs(source - r.x0)) * 100)} %` });
    }
  }
  rows.push({ key: 'expression', value: text });
  return rows;
}

/** A series or parallel RLC circuit: α and ω₀, the damping case, and the response. */
function secondOrderTool(values: Values, series: boolean, r: number, source: number): KitOk {
  const l = positive(values, 'l', 'inductance', 'H');
  const c = positive(values, 'c', 'capacitance', 'F');
  const v0 = need(values, 'v0', 'initialVoltage', 'V');
  const i0 = need(values, 'i0', 'initialCurrent', 'A');
  const alpha = series ? r / (2 * l) : 1 / (2 * r * c);
  const omega0 = 1 / Math.sqrt(l * c);
  // Series: the unknown is the capacitor voltage, whose slope at 0 is i(0)/C. Parallel: the inductor current,
  // whose slope at 0 is v(0)/L.
  const response = secondOrder(alpha, omega0, series ? v0 : i0, series ? i0 / c : v0 / l, source);
  const name = series ? 'v_C' : 'i_L';
  const unit = series ? 'V' : 'A';
  const described = describeCase(response, source, name, unit);
  const peak = firstPeak(response);
  const steps: KitStep[] = [
    {
      key: series ? 'alphaSeries' : 'alphaParallel',
      vars: { value: eng(alpha, '1/s') },
      math: series ? '\\alpha = \\frac{R}{2L}' : '\\alpha = \\frac{1}{2RC}',
    },
    { key: 'omega0', vars: { value: eng(omega0, 'rad/s') }, math: '\\omega_0 = \\frac{1}{\\sqrt{LC}}' },
    ...described.steps,
    { key: 'constants', vars: { a: fmt(response.a), b: fmt(response.b) }, math: described.latex },
  ];
  if (peak) steps.push({ key: 'peak', vars: { time: eng(peak.time, 's'), value: eng(peak.value, unit) } });
  const slowest = response.damping === 'overdamped' ? Math.abs(response.s1) : alpha || omega0;
  const horizon = Math.max(6 / slowest, peak ? 2 * peak.time : 0);
  const summary = `α = ${eng(alpha, '1/s')}, ω₀ = ${eng(omega0, 'rad/s')}, ${response.damping}`;
  return ok({
    rows: secondOrderRows(response, source, unit, described.text),
    steps,
    answer: peak ? `${summary}; peak ${eng(peak.value, unit)} at ${eng(peak.time, 's')}` : summary,
    latex: described.latex,
    plot: { ...PLOT(name, unit), series: [{ name, ...sample(response.at, horizon) }] },
    notes: ['idealParts', 'seriesStep'],
  });
}

export const spec: ToolSpec = {
  id: 'transients',
  fields: [
    {
      id: 'circuit',
      label: 'circuit',
      initial: 'seriesRlc',
      kind: 'select',
      options: [
        { value: 'rc', label: 'rc' },
        { value: 'rl', label: 'rl' },
        { value: 'seriesRlc', label: 'seriesRlc' },
        { value: 'parallelRlc', label: 'parallelRlc' },
      ],
    },
    { id: 'r', label: 'resistance', initial: '100', unit: 'Ω' },
    { id: 'l', label: 'inductance', initial: '0.1', unit: 'H', when: (v) => v.circuit !== 'rc' },
    { id: 'c', label: 'capacitance', initial: '10u', unit: 'F', when: (v) => v.circuit !== 'rl' },
    { id: 'vs', label: 'stepVolts', initial: '10', unit: 'V', when: (v) => v.circuit !== 'parallelRlc' },
    { id: 'is', label: 'stepAmps', initial: '1', unit: 'A', when: (v) => v.circuit === 'parallelRlc' },
    { id: 'v0', label: 'initialVoltage', initial: '0', unit: 'V', when: (v) => v.circuit !== 'rl' },
    { id: 'i0', label: 'initialCurrent', initial: '0', unit: 'A', when: (v) => v.circuit !== 'rc' },
  ],
  run(values) {
    const circuit = values.circuit ?? 'seriesRlc';
    const r = positive(values, 'r', 'resistance', 'Ω');
    const parallel = circuit === 'parallelRlc';
    const source = parallel ? need(values, 'is', 'stepAmps', 'A') : need(values, 'vs', 'stepVolts', 'V');
    if (circuit === 'rc' || circuit === 'rl') return firstOrderTool(values, circuit, r, source);
    return secondOrderTool(values, !parallel, r, source);
  },
};
