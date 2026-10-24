// The devices tool's form. The fields follow the device and the fluid, and so do their first values: a steam
// turbine starts at 3 MPa and 400 °C, an air compressor at 300 K and 100 kPa.
import { choice, num, optionalNum, pick, q, type FieldSpec, type ToolSpec, type Values } from '../common/spec';
import type { GasId, GasModel } from '../idealgas/gas';
import { GAS_FIELD, modelField } from '../idealgas/spec';
import { solveDevice, type Device, type ExitSpec, type StateSpec } from './engine';
import type { FluidId } from './fluids';

const C = { SI: '°C' } as const;
type Initial = Record<string, number | string>;

const FIRST_FLUID: Record<Device, FluidId> = {
  turbine: 'water',
  compressor: 'gas',
  pump: 'water',
  nozzle: 'gas',
  diffuser: 'gas',
  throttle: 'water',
  exchanger: 'water',
  mixing: 'water',
  reservoirs: 'water',
};

/** First values for a device and fluid; anything missing falls back to BASE. */
const FIRST: Partial<Record<`${Device}.${FluidId}`, Initial>> = {
  'turbine.water': { T1: 673.15, p1: 3000, p2: 10, eta: 85 },
  'turbine.gas': { T1: 1400, p1: 1500, p2: 100, eta: 88 },
  'turbine.r134a': { T1: 333.15, p1: 1200, p2: 400, eta: 80 },
  'compressor.gas': { T1: 300, p1: 100, p2: 800, eta: 80 },
  'compressor.r134a': { known: 'px', p1: 140, x1: 1, p2: 800, eta: 85 },
  'compressor.water': { T1: 423.15, p1: 100, p2: 500, eta: 80 },
  'pump.water': { known: 'px', p1: 10, x1: 0, p2: 3000, eta: 85 },
  'pump.r134a': { known: 'px', p1: 800, x1: 0, p2: 1600, eta: 85 },
  'nozzle.gas': { T1: 600, p1: 500, V1: 0, p2: 100, eta: 100 },
  'nozzle.water': { T1: 673.15, p1: 3000, V1: 40, p2: 1000, eta: 95 },
  'diffuser.gas': { T1: 250, p1: 80, V1: 250, V2: 20, p2: 100 },
  'throttle.water': { known: 'px', p1: 1000, x1: 0, p2: 100 },
  'throttle.r134a': { known: 'px', p1: 800, x1: 0, p2: 140 },
  'throttle.gas': { T1: 300, p1: 500, p2: 100 },
  'exchanger.water': { known: 'px', p1: 20, x1: 0.95, exitKnown: 'x', x2: 0, TB1: 288.15, pB1: 300, TB2: 298.15 },
  'exchanger.gas': { T1: 800, p1: 110, T2: 450, TB1: 300, pB1: 120, TB2: 600 },
  'mixing.water': { T1: 473.15, p1: 200, TB1: 293.15, pB1: 200, p2: 200, m: 1, mB: 2 },
};

const BASE: Initial = {
  known: 'Tp',
  T1: 300,
  p1: 100,
  x1: 1,
  p2: 200,
  eta: 85,
  m: 1,
  V1: 100,
  V2: 10,
  exitKnown: 'T',
  T2: 320,
  x2: 0,
  knownB: 'Tp',
  TB1: 288.15,
  pB1: 300,
  xB1: 0,
  exitKnownB: 'T',
  TB2: 298.15,
  xB2: 1,
  mB: 1,
};

const temp = (id: string, label: Parameters<typeof q>[1], initial: number, celsius: boolean): FieldSpec => ({
  ...q(id, label, 'T', initial),
  ...(celsius ? { unit: C } : {}),
});

function stateFields(prefix: '' | 'B', first: Initial, saturable: boolean, values: Values): FieldSpec[] {
  const knownId = `known${prefix}`;
  const known = saturable ? choice(values, knownId, String(first[knownId])) : 'Tp';
  const T = `T${prefix}1`;
  const p = `p${prefix}1`;
  const x = `x${prefix}1`;
  const b = prefix === 'B';
  return [
    ...(saturable
      ? [
          pick(
            knownId,
            b ? 'knownB' : 'known',
            [
              ['Tp', 'pairTp'],
              ['px', 'pairPx'],
            ],
            String(first[knownId]),
          ),
        ]
      : []),
    ...(known === 'px'
      ? [
          q(p, b ? 'inletPB' : 'inletPA', 'p', Number(first[p])),
          q(x, b ? 'inletXB' : 'inletXA', 'none', Number(first[x])),
        ]
      : [
          temp(T, b ? 'inletTB' : 'inletTA', Number(first[T]), saturable),
          q(p, b ? 'inletPB' : 'inletPA', 'p', Number(first[p])),
        ]),
  ];
}

function exitFields(prefix: '' | 'B', first: Initial, saturable: boolean, values: Values): FieldSpec[] {
  const knownId = `exitKnown${prefix}`;
  const known = saturable ? choice(values, knownId, String(first[knownId])) : 'T';
  const b = prefix === 'B';
  return [
    ...(saturable
      ? [
          pick(
            knownId,
            b ? 'exitKnownB' : 'exitKnown',
            [
              ['T', 'exitByT'],
              ['x', 'exitByX'],
            ],
            String(first[knownId]),
          ),
        ]
      : []),
    known === 'x'
      ? q(`x${prefix}2`, b ? 'exitXB' : 'exitXA', 'none', Number(first[`x${prefix}2`]))
      : temp(`T${prefix}2`, b ? 'exitTB' : 'exitTA', Number(first[`T${prefix}2`]), saturable),
  ];
}

const DEVICE_FIELD = pick('device', 'device', [
  ['turbine', 'turbine'],
  ['compressor', 'compressor'],
  ['pump', 'pump'],
  ['nozzle', 'nozzle'],
  ['diffuser', 'diffuser'],
  ['throttle', 'throttle'],
  ['exchanger', 'exchanger'],
  ['mixing', 'mixingChamber'],
  ['reservoirs', 'reservoirs'],
]);

function deviceFields(device: Device, first: Initial, saturable: boolean, values: Values): FieldSpec[] {
  const p2 = q('p2', 'exitPressure', 'p', Number(first.p2));
  const eta = q('eta', 'efficiency', 'percent', Number(first.eta));
  const flow = q('m', 'massFlowOptional', 'mdot', null, true);
  switch (device) {
    case 'turbine':
    case 'compressor':
    case 'pump':
      return [p2, eta, flow];
    case 'nozzle':
      return [q('V1', 'inletSpeed', 'speed', Number(first.V1)), p2, eta, flow];
    case 'diffuser':
      return [
        q('V1', 'inletSpeed', 'speed', Number(first.V1)),
        q('V2', 'exitSpeed', 'speed', Number(first.V2)),
        p2,
        flow,
      ];
    case 'throttle':
      return [p2, flow];
    case 'exchanger':
      return [
        q('m', 'massFlowA', 'mdot', Number(first.m)),
        ...exitFields('', first, saturable, values),
        ...stateFields('B', first, saturable, values),
        ...exitFields('B', first, saturable, values),
      ];
    default:
      return [
        q('m', 'massFlowA', 'mdot', Number(first.m)),
        ...stateFields('B', first, saturable, values),
        q('mB', 'massFlowB', 'mdot', Number(first.mB)),
        q('p2', 'exitPressure', 'p', Number(first.p2)),
        q('qLoss', 'heatLoss', 'power', null, true),
      ];
  }
}

const DEAD: readonly FieldSpec[] = [{ ...q('T0', 'deadT', 'T', 298.15), unit: C }, q('p0', 'deadP', 'p', 100)];

export const spec: ToolSpec = {
  modes: [
    {
      id: 'device',
      label: 'device',
      fields: (values) => {
        const device = choice<Device>(values, 'device', 'turbine');
        if (device === 'reservoirs')
          return [
            DEVICE_FIELD,
            q('Q', 'heatRate', 'power', 100),
            q('TH', 'hotT', 'T', 500),
            q('TL', 'coldT', 'T', 300),
            { ...DEAD[0], initial: 300 },
          ];
        const fluidField = pick(
          'fluid',
          'fluid',
          [
            ['water', 'fluidWater'],
            ['r134a', 'fluidR134a'],
            ['gas', 'fluidGas'],
          ],
          FIRST_FLUID[device],
        );
        const fluid = choice<FluidId>(values, 'fluid', FIRST_FLUID[device]);
        const first = { ...BASE, ...FIRST[`${device}.${fluid}`] };
        const saturable = fluid !== 'gas';
        return [
          DEVICE_FIELD,
          fluidField,
          ...(fluid === 'gas' ? [GAS_FIELD, modelField(choice<GasId>(values, 'gas', 'air'))] : []),
          ...stateFields('', first, saturable, values),
          ...deviceFields(device, first, saturable, values),
          ...DEAD,
        ];
      },
    },
  ],
  solve(_mode, values) {
    const get = (id: string) => optionalNum(values, id) ?? undefined;
    const device = choice<Device>(values, 'device', 'turbine');
    const state = (prefix: '' | 'B'): StateSpec => ({
      known: choice<'Tp' | 'px'>(values, `known${prefix}`, 'Tp'),
      p: num(values, `p${prefix}1`),
      T: get(`T${prefix}1`),
      x: get(`x${prefix}1`),
    });
    const exit = (prefix: '' | 'B'): ExitSpec => ({
      known: choice<'T' | 'x'>(values, `exitKnown${prefix}`, 'T'),
      T: get(`T${prefix}2`),
      x: get(`x${prefix}2`),
    });
    const eta = get('eta');
    if (device === 'reservoirs')
      return solveDevice({
        device,
        fluid: 'water',
        inlet: { known: 'Tp', p: 100 },
        Q: get('Q'),
        TH: get('TH'),
        TL: get('TL'),
        T0: num(values, 'T0'),
        p0: 100,
      });
    const twoStreams = device === 'exchanger' || device === 'mixing';
    return solveDevice({
      device,
      fluid: choice<FluidId>(values, 'fluid', FIRST_FLUID[device]),
      gas: choice<GasId>(values, 'gas', 'air'),
      model: choice<GasModel>(values, 'model', 'variable'),
      inlet: state(''),
      p2: get('p2'),
      eta: eta === undefined ? undefined : eta / 100,
      m: get('m'),
      V1: get('V1'),
      V2: get('V2'),
      exit: exit(''),
      inletB: twoStreams ? state('B') : undefined,
      exitB: exit('B'),
      mB: get('mB'),
      qLoss: get('qLoss'),
      T0: num(values, 'T0'),
      p0: num(values, 'p0'),
    });
  },
};
