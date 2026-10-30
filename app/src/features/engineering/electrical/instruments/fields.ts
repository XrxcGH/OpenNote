// The form of the instrumentation tool: a mode, then only the fields that mode needs.
import type { Field } from '../spec';
import type { Values } from '../shared';
import { THERMOCOUPLE_TYPES } from './thermocouple';

export const MODES = ['color', 'standard', 'thermocouple', 'rtd', 'bridge', 'signal', 'adc'] as const;
export const modeOf = (v: Values): string => v.mode ?? 'color';
export const bridgeOf = (v: Values): string => v.bridge ?? 'quarter';

const only =
  (...modes: string[]) =>
  (v: Values) =>
    modes.includes(modeOf(v));
const strain = (v: Values) => modeOf(v) === 'bridge' && bridgeOf(v) !== 'wheatstone';
const wheat = (v: Values) => modeOf(v) === 'bridge' && bridgeOf(v) === 'wheatstone';
const tcTemp = (v: Values) => modeOf(v) === 'thermocouple' && v.tcdir !== 'toTemperature';
const rtdTemp = (v: Values) => modeOf(v) === 'rtd' && v.rtddir !== 'toTemperature';

const choice = (id: string, label: Field['label'], initial: string, values: readonly string[], when: Field['when']) =>
  ({
    id,
    label,
    initial,
    kind: 'select',
    options: values.map((value) => ({ value, label: value as Field['label'] })),
    when,
  }) satisfies Field;

export const FIELDS: readonly Field[] = [
  choice('mode', 'mode', 'color', MODES, undefined),
  { id: 'bands', label: 'bands', initial: 'brown black red gold', when: only('color'), hint: 'bandsHint' },
  { id: 'ohms', label: 'resistanceValue', initial: '4.7k', unit: 'Ω', when: only('standard') },
  choice('series', 'series', 'e24', ['e12', 'e24', 'e96'], only('standard')),
  {
    id: 'tctype',
    label: 'tcType',
    initial: 'K',
    kind: 'select',
    options: THERMOCOUPLE_TYPES.map((value) => ({ value, label: `type${value}` as const })),
    when: only('thermocouple'),
  },
  choice('tcdir', 'direction', 'toVoltage', ['toVoltage', 'toTemperature'], only('thermocouple')),
  choice('rtddir', 'direction', 'toResistance', ['toResistance', 'toTemperature'], only('rtd')),
  choice('tunit', 'tempUnit', 'celsius', ['celsius', 'fahrenheit'], only('thermocouple', 'rtd')),
  { id: 'temp', label: 'temperature', initial: '100', when: (v) => tcTemp(v) || rtdTemp(v) },
  { id: 'mv', label: 'millivolts', initial: '4.096', when: (v) => modeOf(v) === 'thermocouple' && !tcTemp(v) },
  { id: 'tref', label: 'coldJunction', initial: '0', when: only('thermocouple'), hint: 'coldJunctionHint' },
  { id: 'r0', label: 'nominalResistance', initial: '100', unit: 'Ω', when: only('rtd') },
  {
    id: 'rtdohms',
    label: 'resistanceValue',
    initial: '138.5055',
    unit: 'Ω',
    when: (v) => modeOf(v) === 'rtd' && !rtdTemp(v),
  },
  choice('bridge', 'bridgeKind', 'quarter', ['quarter', 'half', 'full', 'wheatstone'], only('bridge')),
  { id: 'gf', label: 'gaugeFactor', initial: '2', when: strain },
  { id: 'micro', label: 'microstrain', initial: '1000', when: strain },
  { id: 'vex', label: 'excitation', initial: '5', unit: 'V', when: only('bridge') },
  { id: 'r1', label: 'r1', initial: '1k', unit: 'Ω', when: wheat },
  { id: 'r2', label: 'r2', initial: '2k', unit: 'Ω', when: wheat },
  { id: 'r3', label: 'r3', initial: '1k', unit: 'Ω', when: wheat },
  { id: 'r4', label: 'r4', initial: '3k', unit: 'Ω', when: wheat },
  choice('akind', 'amplitudeKind', 'peak', ['peak', 'peakToPeak', 'rms'], only('signal')),
  { id: 'amp', label: 'amplitude', initial: '10', unit: 'V', when: only('signal') },
  { id: 'ref', label: 'referenceAmplitude', initial: '5', unit: 'V', when: only('signal'), hint: 'referenceHint' },
  { id: 'freq', label: 'frequencyHz', initial: '1k', unit: 'Hz', when: only('signal') },
  { id: 'shift', label: 'timeShift', initial: '0.25m', unit: 's', when: only('signal'), hint: 'shiftHint' },
  { id: 'bits', label: 'bits', initial: '12', when: only('adc') },
  { id: 'vref', label: 'referenceVoltage', initial: '3.3', unit: 'V', when: only('adc') },
  { id: 'vin', label: 'inputVoltage', initial: '1.65', unit: 'V', when: only('adc') },
];
