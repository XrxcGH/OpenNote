// One function for each calculation of the instrumentation tool, each reading its own fields and building its answer.
import { eng, fail, fmt, need, nonNegative, ok, positive } from '../shared';
import type { KitOk, KitRow, KitStep, Values } from '../shared';
import {
  adc,
  decibels,
  decodeBands,
  nearestStandard,
  phaseFromShift,
  rtdResistance,
  rtdTemperature,
  sineLevels,
  strainBridge,
  wheatstone,
  RTD_A,
  RTD_B,
  RTD_C,
} from './engine';
import type { AmplitudeKind, BridgeKind, ESeries } from './engine';
import { THERMOCOUPLE_SOURCE, thermocoupleRange, thermocoupleTemperature, thermocoupleVoltage } from './thermocouple';
import type { ThermocoupleType } from './thermocouple';

const toC = (value: number, unit: string): number => (unit === 'F' ? ((value - 32) * 5) / 9 : value);
const fromC = (value: number, unit: string): number => (unit === 'F' ? (value * 9) / 5 + 32 : value);
const degrees = (value: number, unit: string): string => `${fmt(fromC(value, unit))} °${unit}`;
const num = (value: number): string => fmt(value, 6).replace('−', '-');
const tempUnit = (v: Values): string => (v.tunit === 'fahrenheit' ? 'F' : 'C');

export function colorCode(values: Values): KitOk {
  const code = decodeBands(values.bands ?? '');
  const text = eng(code.ohms, 'Ω');
  const rows: KitRow[] = [
    { key: 'resistance', value: `${text} ± ${fmt(code.tolerance)} %` },
    { key: 'range', value: `${eng(code.low, 'Ω')} to ${eng(code.high, 'Ω')}` },
  ];
  const steps: KitStep[] = [
    { key: 'bandsRead', vars: { count: String(code.bands) } },
    { key: 'bandsResult', vars: { value: text, tolerance: fmt(code.tolerance) } },
  ];
  return ok({ rows, steps, answer: `${text} ± ${fmt(code.tolerance)} %`, notes: ['bandsNote'] });
}

export function standardValue(values: Values): KitOk {
  const ohms = positive(values, 'ohms', 'resistanceValue', 'Ω');
  const series = (values.series ?? 'e24').toUpperCase() as ESeries;
  const nearest = nearestStandard(ohms, series);
  const error = ((nearest - ohms) / ohms) * 100;
  const rows: KitRow[] = [
    { key: 'nearest', value: `${eng(nearest, 'Ω')} (${series})` },
    { key: 'difference', value: `${fmt(error, 3)} %` },
  ];
  const steps: KitStep[] = [
    { key: 'standardNearest', vars: { series, value: eng(nearest, 'Ω'), error: fmt(error, 3) } },
  ];
  return ok({ rows, steps, answer: `${eng(ohms, 'Ω')} → ${eng(nearest, 'Ω')} (${series})`, notes: ['seriesNote'] });
}

/** A thermocouple, in either direction, with the cold junction taken into account. */
export function thermocouple(values: Values): KitOk {
  const type = (values.tctype ?? 'K') as ThermocoupleType;
  const unit = tempUnit(values);
  const [low, high] = thermocoupleRange(type);
  const range = { type, low: degrees(low, unit), high: degrees(high, unit) };
  const tref = toC(need(values, 'tref', 'coldJunction'), unit);
  const eref = thermocoupleVoltage(type, tref);
  if (eref === null) return fail('tcRange', range);
  const steps: KitStep[] = [
    {
      key: 'tcFormula',
      vars: { type },
      math: 'E_\\mathrm{meas} = E(T_\\mathrm{junction}) - E(T_\\mathrm{ref})',
    },
  ];
  const rows: KitRow[] = [];
  let answer: string;
  if (values.tcdir === 'toTemperature') {
    const measured = need(values, 'mv', 'millivolts');
    const total = measured + eref;
    const t = thermocoupleTemperature(type, total);
    if (t === null) return fail('tcVoltage', range);
    rows.push(
      { key: 'temperature', value: degrees(t, unit) },
      { key: 'coldCorrection', value: `${fmt(eref, 6)} mV` },
      { key: 'totalVoltage', value: `${fmt(total, 6)} mV` },
    );
    steps.push(
      { key: 'tcCold', vars: { tref: degrees(tref, unit), eref: fmt(eref, 6), total: fmt(total, 6) } },
      { key: 'tcInverse', vars: { type, value: degrees(t, unit) } },
    );
    answer = `Type ${type}: ${fmt(measured, 5)} mV → ${degrees(t, unit)}`;
  } else {
    const temperature = toC(need(values, 'temp', 'temperature'), unit);
    const e = thermocoupleVoltage(type, temperature);
    if (e === null) return fail('tcRange', range);
    rows.push(
      { key: 'voltage', value: `${fmt(e - eref, 6)} mV` },
      { key: 'junctionVoltage', value: `${fmt(e, 6)} mV` },
    );
    steps.push(
      {
        key: 'tcPolynomial',
        vars: { type, low: range.low, high: range.high },
        math: 'E = \\sum_{i=0}^{n} c_i\\,t^i',
      },
      { key: 'tcResult', vars: { e: fmt(e, 6), eref: fmt(eref, 6), out: fmt(e - eref, 6) } },
    );
    answer = `Type ${type} at ${degrees(temperature, unit)}: ${fmt(e - eref, 5)} mV`;
  }
  return ok({ rows, steps, answer, notes: ['tcNote'], source: THERMOCOUPLE_SOURCE });
}

export function rtd(values: Values): KitOk {
  const unit = tempUnit(values);
  const r0 = positive(values, 'r0', 'nominalResistance', 'Ω');
  const steps: KitStep[] = [
    {
      key: 'rtdFormula',
      math: `R(T) = R_0\\left(1 + AT + BT^2\\right),\\ A = ${num(RTD_A)},\\ B = ${num(RTD_B)}`,
    },
  ];
  const rows: KitRow[] = [];
  if (values.rtddir === 'toTemperature') {
    const ohms = positive(values, 'rtdohms', 'resistanceValue', 'Ω');
    const t = rtdTemperature(ohms, r0);
    rows.push({ key: 'temperature', value: degrees(t, unit) });
    steps.push({ key: 'rtdInverse', vars: { value: degrees(t, unit) } });
    const answer = `${eng(ohms, 'Ω')} → ${degrees(t, unit)}`;
    return ok({ rows, steps, answer, notes: ['rtdNote'], source: THERMOCOUPLE_SOURCE });
  }
  const t = toC(need(values, 'temp', 'temperature'), unit);
  const ohms = rtdResistance(t, r0);
  rows.push({ key: 'resistance', value: eng(ohms, 'Ω', 7) });
  if (t < 0) steps.push({ key: 'rtdBelowZero', math: `+\\,C\\,(T - 100)\\,T^3,\\ C = ${num(RTD_C)}` });
  steps.push({ key: 'rtdResult', vars: { t: degrees(t, unit), value: eng(ohms, 'Ω', 7) } });
  const answer = `Pt${fmt(r0, 4)} at ${degrees(t, unit)}: ${eng(ohms, 'Ω', 7)}`;
  return ok({ rows, steps, answer, notes: ['rtdNote'], source: THERMOCOUPLE_SOURCE });
}

function wheatstoneBridge(values: Values, vex: number): KitOk {
  const [r1, r2, r3, r4] = (['r1', 'r2', 'r3', 'r4'] as const).map((id) => positive(values, id, id, 'Ω')) as [
    number,
    number,
    number,
    number,
  ];
  const out = wheatstone(vex, r1, r2, r3, r4);
  const balanced = Math.abs(r1 * r3 - r2 * r4) <= 1e-12 * Math.abs(r1 * r3);
  const rows: KitRow[] = [
    { key: 'output', value: eng(out, 'V') },
    { key: 'balanced', value: '', word: balanced ? 'yes' : 'no' },
  ];
  const steps: KitStep[] = [
    {
      key: 'bridgeWheatstone',
      math: 'V_\\mathrm{out} = V_\\mathrm{ex}\\left(\\frac{R_2}{R_1+R_2} - \\frac{R_3}{R_3+R_4}\\right)',
    },
    { key: 'bridgeResult', vars: { value: eng(out, 'V') } },
  ];
  return ok({ rows, steps, answer: `Wheatstone bridge: ${eng(out, 'V')}`, notes: ['bridgeNote'] });
}

const STRAIN_MATH: Record<BridgeKind, string> = {
  quarter:
    '\\frac{V_\\mathrm{out}}{V_\\mathrm{ex}} = \\frac{GF\\,\\varepsilon}{4}\\cdot\\frac{1}{1 + GF\\,\\varepsilon/2}',
  half: '\\frac{V_\\mathrm{out}}{V_\\mathrm{ex}} = \\frac{GF\\,\\varepsilon}{2}',
  full: '\\frac{V_\\mathrm{out}}{V_\\mathrm{ex}} = GF\\,\\varepsilon',
};

export function bridge(values: Values): KitOk {
  const vex = need(values, 'vex', 'excitation', 'V');
  if (values.bridge === 'wheatstone') return wheatstoneBridge(values, vex);
  const kind = (values.bridge ?? 'quarter') as BridgeKind;
  const out = strainBridge(kind, need(values, 'gf', 'gaugeFactor'), need(values, 'micro', 'microstrain') * 1e-6, vex);
  const rows: KitRow[] = [{ key: 'linear', value: eng(out.linear, 'V', 5) }];
  if (kind === 'quarter') rows.push({ key: 'exact', value: eng(out.exact, 'V', 5) });
  const shown = eng(kind === 'quarter' ? out.exact : out.linear, 'V', 5);
  const steps: KitStep[] = [
    { key: 'bridgeStrain', math: STRAIN_MATH[kind] },
    { key: 'bridgeResult', vars: { value: shown } },
  ];
  return ok({ rows, steps, answer: `${kind} bridge: ${shown}`, notes: ['bridgeNote', 'strainNote'] });
}

export function signal(values: Values): KitOk {
  const kind = (values.akind ?? 'peak') as AmplitudeKind;
  const amp = positive(values, 'amp', 'amplitude', 'V');
  const hz = positive(values, 'freq', 'frequencyHz', 'Hz');
  const ratio = amp / positive(values, 'ref', 'referenceAmplitude', 'V');
  const levels = sineLevels(kind, amp);
  const db = decibels(ratio);
  const phase = phaseFromShift(need(values, 'shift', 'timeShift', 's'), hz);
  const rows: KitRow[] = [
    { key: 'peakValue', value: eng(levels.peak, 'V') },
    { key: 'peakToPeak', value: eng(levels.peakToPeak, 'V') },
    { key: 'rms', value: eng(levels.rms, 'V', 6) },
    { key: 'average', value: eng(levels.average, 'V') },
    { key: 'gain', value: `${fmt(ratio, 5)} (${fmt(db, 5)} dB)` },
    { key: 'phase', value: `${fmt(phase, 5)}°` },
    { key: 'period', value: eng(1 / hz, 's') },
  ];
  const steps: KitStep[] = [
    { key: 'sineRelations', math: 'V_\\mathrm{rms} = \\frac{V_p}{\\sqrt{2}},\\quad V_{pp} = 2V_p' },
    {
      key: 'decibel',
      vars: { ratio: fmt(ratio, 5), db: fmt(db, 5) },
      math: '\\mathrm{dB} = 20\\log_{10}\\frac{V}{V_\\mathrm{ref}}',
    },
    { key: 'phaseShift', vars: { phase: fmt(phase, 5) }, math: '\\varphi = 360^\\circ\\,f\\,\\Delta t' },
  ];
  const rmsText = eng(levels.rms, 'V', 5);
  const answer = `${eng(levels.peak, 'V')} peak = ${rmsText} rms; ${fmt(db, 5)} dB; phase ${fmt(phase, 5)}°`;
  return ok({ rows, steps, answer, notes: ['sineNote'] });
}

export function converter(values: Values): KitOk {
  const bits = need(values, 'bits', 'bits');
  const vref = positive(values, 'vref', 'referenceVoltage', 'V');
  const c = adc(bits, vref, nonNegative(values, 'vin', 'inputVoltage', 'V'));
  const rows: KitRow[] = [
    { key: 'levels', value: fmt(c.levels, 10) },
    { key: 'lsb', value: eng(c.lsb, 'V', 5) },
    { key: 'code', value: `${c.code} (0x${c.code.toString(16).toUpperCase()})` },
    { key: 'reconstructed', value: eng(c.reconstructed, 'V', 5) },
    { key: 'quantError', value: `± ${eng(c.maxError, 'V', 4)}` },
    { key: 'snr', value: `${fmt(c.snr, 5)} dB` },
  ];
  const steps: KitStep[] = [
    { key: 'adcLsb', vars: { value: eng(c.lsb, 'V', 5) }, math: '\\mathrm{LSB} = \\frac{V_\\mathrm{ref}}{2^N}' },
    {
      key: 'adcCode',
      vars: { code: String(c.code) },
      math: '\\mathrm{code} = \\operatorname{round}\\left( \\frac{V_\\mathrm{in}}{\\mathrm{LSB}} \\right)',
    },
    { key: 'adcSnr', vars: { value: fmt(c.snr, 5) }, math: '\\mathrm{SNR} = 6.02\\,N + 1.76\\ \\mathrm{dB}' },
  ];
  const answer = `${bits}-bit ADC: LSB ${eng(c.lsb, 'V', 5)}, code ${c.code}`;
  return ok({ rows, steps, answer, notes: ['adcNote'] });
}
