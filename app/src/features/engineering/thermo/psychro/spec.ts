// The psychrometrics tool's form: one moist-air state from two known properties, or an air-conditioning process.
// Temperatures arrive in K and leave for the engine in °C; relative humidity arrives in percent.
import { choice, num, optionalNum, pick, q, type FieldSpec, type ToolSpec, type Values } from '../common/spec';
import { solveProcess, solveState, type Known, type ProcessInput } from './engine';
import { pressureAt } from './moist';

const C = { SI: '°C' } as const;
const K = 273.15;

const temp = (id: string, label: Parameters<typeof q>[1], kelvin: number): FieldSpec => ({
  ...q(id, label, 'T', kelvin),
  unit: C,
});

const PRESSURE: readonly FieldSpec[] = [
  pick('pFrom', 'pressureFrom', [
    ['pressure', 'byPressure'],
    ['altitude', 'byAltitude'],
  ]),
];

const pressureFields = (values: Values): FieldSpec[] =>
  values.pFrom === 'altitude' ? [q('z', 'altitude', 'length', 0)] : [q('p', 'pressure', 'p', 101.325)];

const KNOWN: Record<Known, readonly FieldSpec[]> = {
  tPhi: [temp('t', 'dryBulb', K + 25), q('phi', 'relHumidity', 'percent', 50)],
  tTwb: [temp('t', 'dryBulb', K + 25), temp('twb', 'wetBulb', K + 18)],
  tOmega: [temp('t', 'dryBulb', K + 25), q('omega', 'humidityRatio', 'none', 0.01)],
  tTdp: [temp('t', 'dryBulb', K + 25), temp('tdp', 'dewPointT', K + 14)],
  tH: [temp('t', 'dryBulb', K + 25), q('h', 'moistEnthalpy', 'e', 50)],
  twbPhi: [temp('twb', 'wetBulb', K + 18), q('phi', 'relHumidity', 'percent', 50)],
  tdpPhi: [temp('tdp', 'dewPointT', K + 14), q('phi', 'relHumidity', 'percent', 50)],
  hPhi: [q('h', 'moistEnthalpy', 'e', 50), q('phi', 'relHumidity', 'percent', 50)],
  hOmega: [q('h', 'moistEnthalpy', 'e', 50), q('omega', 'humidityRatio', 'none', 0.01)],
};

type Process = ProcessInput['process'];

const PROCESS: Record<Process, readonly FieldSpec[]> = {
  sensible: [temp('t2', 'dryBulb2', K + 35), q('m1', 'dryAirFlow', 'mdot', null, true)],
  dehumidify: [
    temp('t2', 'coilExit', K + 12),
    q('phi2', 'relHumidity2', 'percent', 100),
    q('m1', 'dryAirFlow', 'mdot', null, true),
  ],
  evaporative: [q('phi2', 'relHumidity2', 'percent', 90), q('m1', 'dryAirFlow', 'mdot', null, true)],
  mixing: [
    q('m1', 'dryAir1', 'mdot', 1),
    temp('t2', 'dryBulb2', K + 15),
    q('phi2', 'relHumidity2', 'percent', 40),
    q('m2', 'dryAir2', 'mdot', 2),
  ],
};

const pressureOf = (values: Values): number =>
  values.pFrom === 'altitude' ? pressureAt(num(values, 'z')) : num(values, 'p');

const celsius = (values: Values, id: string): number | undefined => {
  const kelvin = optionalNum(values, id);
  return kelvin === null ? undefined : kelvin - K;
};

const fraction = (values: Values, id: string): number | undefined => {
  const percent = optionalNum(values, id);
  return percent === null ? undefined : percent / 100;
};

export const spec: ToolSpec = {
  modes: [
    {
      id: 'air',
      label: 'airState',
      fields: (values) => [
        ...PRESSURE,
        ...pressureFields(values),
        pick('known', 'pair', [
          ['tPhi', 'tPhi'],
          ['tTwb', 'tTwb'],
          ['tOmega', 'tOmega'],
          ['tTdp', 'tTdp'],
          ['tH', 'tH'],
          ['twbPhi', 'twbPhi'],
          ['tdpPhi', 'tdpPhi'],
          ['hPhi', 'hPhi'],
          ['hOmega', 'hOmega'],
        ]),
        ...(KNOWN[choice<Known>(values, 'known', 'tPhi')] ?? KNOWN.tPhi),
      ],
    },
    {
      id: 'process',
      label: 'airProcess',
      fields: (values) => [
        ...PRESSURE,
        ...pressureFields(values),
        pick('process', 'process', [
          ['sensible', 'sensible'],
          ['dehumidify', 'dehumidify'],
          ['evaporative', 'evaporative'],
          ['mixing', 'mixing'],
        ]),
        temp('t1', 'dryBulb1', K + 30),
        q('phi1', 'relHumidity1', 'percent', 60),
        ...(PROCESS[choice<Process>(values, 'process', 'sensible')] ?? PROCESS.sensible),
      ],
    },
  ],
  solve(mode, values) {
    const p = pressureOf(values);
    if (mode === 'process')
      return solveProcess({
        process: choice<Process>(values, 'process', 'sensible'),
        p,
        t1: num(values, 't1') - K,
        phi1: num(values, 'phi1') / 100,
        t2: celsius(values, 't2'),
        phi2: fraction(values, 'phi2'),
        m1: optionalNum(values, 'm1') ?? undefined,
        m2: optionalNum(values, 'm2') ?? undefined,
      });
    return solveState({
      known: choice<Known>(values, 'known', 'tPhi'),
      p,
      t: celsius(values, 't'),
      phi: fraction(values, 'phi'),
      twb: celsius(values, 'twb'),
      omega: optionalNum(values, 'omega') ?? undefined,
      tdp: celsius(values, 'tdp'),
      h: optionalNum(values, 'h') ?? undefined,
    });
  },
};
