// Steady-flow devices against the published validation values, then against hand calculations: closed energy
// and entropy balances, steam and refrigerant devices, and the problems the second law rules out.
import '../text';
import { describe, expect, it } from 'vitest';
import { ThermoError, type ThermoResult } from '../common/types';
import { fromPX, fromTP } from '../steam/water';
import { solveDevice, type DeviceInput } from './engine';
import { spec } from './spec';
import { fieldsOf } from '../ui/formState';

const rel = (a: number, b: number) => Math.abs(a / b - 1);
const row = (result: ThermoResult, key: string, tag?: string): number => {
  const found = result.rows.find((one) => one.key === key && (tag === undefined || one.tag === tag));
  if (!found) throw new Error(`no row ${key}`);
  return found.value;
};
const code = (input: DeviceInput): string => {
  try {
    solveDevice(input);
  } catch (error) {
    return error instanceof ThermoError ? error.code : 'other';
  }
  return 'none';
};

const air: DeviceInput = {
  device: 'compressor',
  fluid: 'gas',
  gas: 'air',
  model: 'cold',
  inlet: { known: 'Tp', T: 300, p: 100 },
  p2: 800,
  eta: 0.8,
  T0: 298.15,
  p0: 100,
};

describe('devices: validation cases', () => {
  it('cold-air compressor 300 K, 100 to 800 kPa, efficiency 0.80', () => {
    const result = solveDevice(air);
    expect(rel(row(result, 'T2s'), 543.43)).toBeLessThan(1e-4);
    expect(rel(row(result, 'wsIsentropic'), 244.65)).toBeLessThan(1e-4);
    expect(rel(row(result, 'wIn'), 305.81)).toBeLessThan(1e-4);
    expect(rel(row(result, 'temperature', '2'), 604.29)).toBeLessThan(1e-4);
  });

  it('cold-air turbine 1000 K, 1 MPa to 100 kPa, efficiency 0.90, losing 20 kJ/kg', () => {
    // By hand with cp = 1.005, k = 1.4: T2s = 1000 (0.1)^(0.4/1.4) = 517.947 K, h1 - h2 = 0.9 cp (1000 - T2s) =
    // 436.017 kJ/kg, so T2 = 566.153 K and w = 436.017 - 20 = 416.017 kJ/kg. s2 - s1 = cp ln(T2/T1) - R ln(p2/p1)
    // = 0.089435, and the heat leaving at T0 = 298.15 K adds 20/298.15: s_gen = 0.156515 kJ/(kg K).
    const turbine = { ...air, device: 'turbine' as const, inlet: { known: 'Tp' as const, T: 1000, p: 1000 }, p2: 100 };
    const result = solveDevice({ ...turbine, eta: 0.9, qOut: 20 });
    expect(rel(row(result, 'wOut'), 416.0165)).toBeLessThan(1e-5);
    expect(rel(row(result, 'temperature', '2'), 566.1527)).toBeLessThan(1e-5);
    expect(rel(row(result, 'sgen'), 0.1565153)).toBeLessThan(1e-5);
    expect(rel(row(result, 'etaII') / 100, 0.8991422)).toBeLessThan(1e-5);
    // At a 400 K boundary less entropy leaves with the heat, but the heat's exergy is lost too: eta_II is the same.
    const warm = solveDevice({ ...turbine, eta: 0.9, qOut: 20, Tb: 400 });
    expect(rel(row(warm, 'sgen'), 0.139435)).toBeLessThan(1e-5);
    expect(rel(row(warm, 'etaII') / 100, 0.8991422)).toBeLessThan(1e-5);
    // A throttle that loses heat leaves at h2 = h1 - q.
    const valve = solveDevice({ ...turbine, device: 'throttle', qOut: 20 });
    expect(rel(row(valve, 'temperature', '2'), 1000 - 20 / 1.005)).toBeLessThan(1e-9);
  });

  it('isentropic air nozzle 600 K, 500 kPa, V1 = 0, to 100 kPa', () => {
    const result = solveDevice({
      ...air,
      device: 'nozzle',
      inlet: { known: 'Tp', T: 600, p: 500 },
      p2: 100,
      eta: 1,
      V1: 0,
    });
    expect(rel(row(result, 'temperature', '2'), 378.83)).toBeLessThan(1e-4);
    expect(rel(row(result, 'V2'), 666.75)).toBeLessThan(1e-4);
  });

  it('throttling saturated liquid water from 1 MPa to 100 kPa', () => {
    const result = solveDevice({
      ...air,
      device: 'throttle',
      fluid: 'water',
      inlet: { known: 'px', p: 1000, x: 0 },
      p2: 100,
    });
    expect(Math.abs(row(result, 'quality', '2') - 0.1528)).toBeLessThan(0.002);
    expect(Math.abs(row(result, 'temperature', '2') - 273.15 - 99.61)).toBeLessThan(0.05);
  });

  it('100 kW flowing from 500 K to 300 K with T0 = 300 K', () => {
    const result = solveDevice({ ...air, device: 'reservoirs', Q: 100, TH: 500, TL: 300, T0: 300 });
    expect(rel(row(result, 'sgenRate'), 0.13333333)).toBeLessThan(1e-6);
    expect(rel(row(result, 'xdestRate'), 40)).toBeLessThan(1e-6);
  });
});

describe('devices: independent checks', () => {
  it('a steam turbine closes its balances and its exergy accounts', () => {
    const result = solveDevice({
      ...air,
      device: 'turbine',
      fluid: 'water',
      inlet: { known: 'Tp', T: 673.15, p: 3000 },
      p2: 10,
      eta: 0.85,
      m: 2,
    });
    const one = fromTP(673.15, 3000);
    const w = row(result, 'wOut');
    const h2 = row(result, 'h', '2');
    expect(one.h - h2).toBeCloseTo(w, 6);
    expect(row(result, 'powerRow')).toBeCloseTo(2 * w, 6);
    const sgen = row(result, 'sgen');
    expect(sgen).toBeCloseTo(row(result, 's', '2') - one.s, 9);
    // Turbine: η_II = w / (w + T0 s_gen) = w / (ψ1 − ψ2).
    expect(row(result, 'etaII') / 100).toBeCloseTo(w / (w + 298.15 * sgen), 9);
    expect(row(result, 'quality', '2')).toBeGreaterThan(0.8);
  });

  it('a pump raises saturated water by about v dp', () => {
    const result = solveDevice({
      ...air,
      device: 'pump',
      fluid: 'water',
      inlet: { known: 'px', p: 10, x: 0 },
      p2: 3000,
      eta: 1,
    });
    const v = fromPX(10, 0).v;
    expect(rel(row(result, 'wIn'), v * (3000 - 10))).toBeLessThan(2e-3);
  });

  it('a refrigerant compressor from saturated vapor at 140 kPa', () => {
    const result = solveDevice({
      ...air,
      device: 'compressor',
      fluid: 'r134a',
      inlet: { known: 'px', p: 140, x: 1 },
      p2: 800,
      eta: 1,
    });
    expect(row(result, 'sgen')).toBeCloseTo(0, 6);
    expect(row(result, 'wIn')).toBeGreaterThan(30);
    expect(row(result, 'wIn')).toBeLessThan(40);
  });
});

describe('devices: two streams, kinetic energy, and the form', () => {
  it('a steam condenser finds the cooling water flow from the energy balance', () => {
    const result = solveDevice({
      ...air,
      device: 'exchanger',
      fluid: 'water',
      m: 1,
      inlet: { known: 'px', p: 20, x: 0.95 },
      exit: { known: 'x', x: 0 },
      inletB: { known: 'Tp', T: 288.15, p: 300 },
      exitB: { known: 'T', T: 298.15 },
    });
    const a1 = fromPX(20, 0.95);
    const a2 = fromPX(20, 0);
    const b1 = fromTP(288.15, 300);
    const b2 = fromTP(298.15, 300);
    const Q = a1.h - a2.h;
    expect(row(result, 'qRate')).toBeCloseTo(Q, 6);
    expect(row(result, 'mCold')).toBeCloseTo(Q / (b2.h - b1.h), 6);
    expect(row(result, 'sgenRate')).toBeGreaterThan(0);
  });

  it('a mixing chamber conserves mass and energy', () => {
    const result = solveDevice({
      ...air,
      device: 'mixing',
      fluid: 'water',
      m: 1,
      mB: 2,
      inlet: { known: 'Tp', T: 473.15, p: 200 },
      inletB: { known: 'Tp', T: 293.15, p: 200 },
      p2: 200,
    });
    const h3 = (fromTP(473.15, 200).h + 2 * fromTP(293.15, 200).h) / 3;
    expect(row(result, 'h', '3')).toBeCloseTo(h3, 6);
    expect(row(result, 'm3')).toBe(3);
  });

  it('a diffuser converts kinetic energy into enthalpy', () => {
    const result = solveDevice({
      ...air,
      device: 'diffuser',
      inlet: { known: 'Tp', T: 250, p: 80 },
      V1: 250,
      V2: 20,
      p2: 100,
    });
    expect(row(result, 'temperature', '2')).toBeCloseTo(250 + (250 ** 2 - 20 ** 2) / 2000 / 1.005, 6);
  });

  it('the form settles its fields behind two choices', () => {
    const mode = spec.modes[0];
    const form = { mode: 'device', text: { device: 'compressor', fluid: 'r134a', known: 'px' }, unit: {} };
    const ids = fieldsOf(mode, form, 'SI').map((field) => field.id);
    expect(ids).toContain('x1');
    expect(ids).not.toContain('T1');
  });
});

describe('devices: problems in words', () => {
  it('rejects what the device or the second law cannot do', () => {
    expect(code({ ...air, eta: 1.2 })).toBe('efficiencyRange');
    expect(code({ ...air, eta: 0 })).toBe('efficiencyRange');
    expect(code({ ...air, p2: 50 })).toBe('compressorPressure');
    expect(code({ ...air, device: 'turbine', p2: 800 })).toBe('turbinePressure');
    expect(code({ ...air, device: 'throttle', p2: 200 })).toBe('throttlePressure');
    expect(code({ ...air, inlet: { known: 'px', p: 100, x: 1 } })).toBe('gasNoSaturation');
    expect(code({ ...air, inlet: { known: 'Tp', T: -5, p: 100 } })).toBe('notPositive');
    expect(code({ ...air, m: -1 })).toBe('notPositive');
    expect(code({ ...air, device: 'reservoirs', Q: 10, TH: 300, TL: 500 })).toBe('reservoirOrder');
    expect(code({ ...air, device: 'diffuser', inlet: { known: 'Tp', T: 250, p: 80 }, V1: 250, V2: 20, p2: 1000 })).toBe(
      'secondLaw',
    );
    expect(code({ ...air, device: 'diffuser', inlet: { known: 'Tp', T: 250, p: 80 }, V1: 20, V2: 250, p2: 90 })).toBe(
      'diffuserSpeed',
    );
  });
});
