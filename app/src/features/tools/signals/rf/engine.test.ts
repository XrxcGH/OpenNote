// Transmission lines and RF. The plan's validation cases come first with their independent expected values (hand
// calculations); edge cases and physical cross-checks follow.
import { describe, expect, it } from 'vitest';
import { SignalError } from '../shared/errors';
import { cabs, cadd, cdiv, cx, type Complex } from '../shared/num';
import {
  OPEN_LOAD,
  inputImpedance,
  lSection,
  lineParameters,
  quarterWave,
  readLoad,
  reflection,
  singleStub,
  smithGrid,
} from './lines';
import {
  cascade,
  convertDb,
  friisLink,
  friisNoise,
  fromAbcd,
  noiseFigure,
  noiseTemperature,
  radar,
  readComplex,
  stability,
  toAbcd,
  type Matrix2,
} from './twoport';

const near = (actual: number, expected: number, relative: number) =>
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(relative * Math.abs(expected));
const nearZ = (actual: Complex, expected: Complex, tolerance = 1e-9) => {
  expect(Math.abs(actual.re - expected.re)).toBeLessThan(tolerance);
  expect(Math.abs(actual.im - expected.im)).toBeLessThan(tolerance);
};
const errorKey = (run: () => unknown) => {
  try {
    run();
  } catch (error) {
    return error instanceof SignalError ? error.key : 'other';
  }
  return 'none';
};

describe('reflection and line impedance', () => {
  it('gives Γ = 0.4 + j0.2, VSWR 2.61803, and return loss 6.9897 dB for 100 + j50 on 50 Ω', () => {
    const r = reflection(cx(100, 50), 50);
    nearZ(r.gamma, cx(0.4, 0.2), 1e-12);
    expect(Math.abs(r.magnitude - 0.447214)).toBeLessThan(1e-6);
    expect(Math.abs(r.vswr - 2.61803)).toBeLessThan(1e-5);
    expect(Math.abs(r.returnLossDb - 6.9897)).toBeLessThan(1e-4);
  });

  it('turns 100 Ω into 40 − j30 Ω through an eighth-wave 50 Ω line', () => {
    nearZ(inputImpedance(cx(100), 50, 0.125).zin, cx(40, -30), 1e-6);
  });

  it('repeats every half wavelength without loss, and loss pulls the input toward Z0', () => {
    nearZ(inputImpedance(cx(100, 50), 50, 0.5).zin, cx(100, 50), 1e-9);
    const lossy = inputImpedance(cx(0), 50, 20, 3).zin;
    expect(cabs(cdiv(cadd(lossy, cx(-50)), cadd(lossy, cx(50))))).toBeLessThan(1e-6);
  });

  it('gives a matched load no reflection and a short a full one', () => {
    expect(reflection(cx(50), 50).returnLossDb).toBe(Infinity);
    expect(reflection(cx(0), 50).vswr).toBe(Infinity);
    expect(errorKey(() => reflection(cx(-1, 0), 50))).toBe('negativeResistance');
    expect(errorKey(() => reflection(cx(10), 0))).toBe('impedance');
    expect(errorKey(() => inputImpedance(cx(10), 50, -1))).toBe('lineLength');
  });

  it('takes an open load: Γ = 1, Zin = −j Z0 cot βl without loss, and Z0 tanh αl at a lossy quarter wave', () => {
    expect(readLoad(' Open ', () => cx(0))).toBe(OPEN_LOAD);
    const open = reflection(OPEN_LOAD, 50);
    nearZ(open.gamma, cx(1), 1e-15);
    expect(open.vswr).toBe(Infinity);
    expect(open.returnLossDb).toBeCloseTo(0, 12);
    // cot(36°) = 1.37638192, so a 0.1 λ open stub on 50 Ω is −j68.8190960 Ω; an eighth wave is −j50 Ω.
    nearZ(inputImpedance(OPEN_LOAD, 50, 0.1).zin, cx(0, -68.8190960236), 1e-8);
    nearZ(inputImpedance(OPEN_LOAD, 50, 0.125).zin, cx(0, -50), 1e-9);
    // A lossless quarter-wave open is a short; with 3 dB/λ it is Z0 tanh(0.75 dB → 0.0863469 Np) = 4.30665 Ω,
    // and the round trip of 1.5 dB leaves |Γin| = 10^(−1.5/20) = 0.841395.
    expect(cabs(inputImpedance(OPEN_LOAD, 50, 0.25).zin)).toBeLessThan(1e-9);
    const lossy = inputImpedance(OPEN_LOAD, 50, 0.25, 3);
    nearZ(lossy.zin, cx(4.306649202, 0), 1e-6);
    near(cabs(lossy.gammaIn), 0.8413951416, 1e-9);
    // A zero-length open stays open.
    expect(inputImpedance(OPEN_LOAD, 50, 0).zin.re).toBe(Infinity);
    // Matching networks still need a finite load.
    expect(errorKey(() => lSection(OPEN_LOAD, 50, 1e8))).toBe('loadImpedance');
  });

  it('keeps every Smith chart grid point inside the unit circle', () => {
    const grid = smithGrid();
    for (let i = 0; i < grid.x.length; i += 1) {
      if (Number.isNaN(grid.x[i]!)) continue;
      expect(Math.hypot(grid.x[i]!, grid.y[i]!)).toBeLessThanOrEqual(1 + 1e-9);
    }
  });
});

describe('matching', () => {
  it('matches 50 to 200 Ω at 100 MHz with a series 137.832 nH and a shunt 13.7832 pF (low pass)', () => {
    const lowPass = lSection(cx(200), 50, 100e6).solutions.find(
      (s) => s.series.kind === 'seriesL' && s.shunt.kind === 'shuntC',
    )!;
    near(lowPass.series.value, 137.832e-9, 1e-5);
    near(lowPass.shunt.value, 13.7832e-12, 1e-5);
  });

  it('makes every L-section solution present Z0 at the source', () => {
    const zl = cx(25, -40);
    const { solutions } = lSection(zl, 50, 1e9);
    expect(solutions.length).toBeGreaterThanOrEqual(2);
    for (const s of solutions) {
      const series = cx(0, s.series.reactance);
      const shunt = cx(0, s.shunt.reactance);
      const zin =
        s.nextToLoad === 'shunt'
          ? cadd(series, cdiv(cx(1), cadd(shunt, cdiv(cx(1), zl))))
          : cdiv(cx(1), cadd(shunt, cdiv(cx(1), cadd(series, zl))));
      nearZ(zin, cx(50), 1e-6);
    }
  });

  it('places single stubs so the line and stub together give Y0', () => {
    const zl = cx(60, -80);
    for (const end of ['open', 'short'] as const) {
      const { solutions } = singleStub(zl, 50, 'shunt', end);
      expect(solutions.length).toBe(2);
      for (const s of solutions) {
        const yLine = cdiv(cx(1), inputImpedance(zl, 50, s.d).zin);
        const stubLoad = end === 'open' ? cx(1e12) : cx(0);
        const yStub = cdiv(cx(1), inputImpedance(stubLoad, 50, s.length).zin);
        nearZ(cadd(yLine, yStub), cx(1 / 50), 1e-6);
      }
    }
    const series = singleStub(zl, 50, 'series', 'short').solutions[0]!;
    const zStub = inputImpedance(cx(0), 50, series.length).zin;
    nearZ(cadd(inputImpedance(zl, 50, series.d).zin, zStub), cx(50), 1e-5);
  });

  it('gives a 70.7107 Ω quarter-wave transformer between 50 and 100 Ω and a 50.1105 Ω coax at εr 2.25, D/d 3.5', () => {
    expect(Math.abs(quarterWave(100, 50).z1 - 70.7107)).toBeLessThan(1e-4);
    expect(Math.abs(lineParameters('coax', 3.5, 2.25).z0 - 50.1105)).toBeLessThan(1e-4);
    expect(errorKey(() => quarterWave(-5, 50))).toBe('realLoad');
  });

  it('gives a microstrip at W/h 2 on εr 4.4 an effective permittivity of 3.34254 and Z0 of 48.8881 Ω', () => {
    const line = lineParameters('microstrip', 2, 4.4);
    near(line.effectivePermittivity, 3.34254, 1e-5);
    near(line.z0, 48.8881, 1e-5);
    // A narrow strip has a higher impedance; the two closed forms meet near W/h = 1.
    expect(lineParameters('microstrip', 0.5, 4.4).z0).toBeGreaterThan(line.z0);
    near(lineParameters('microstrip', 0.9999, 4.4).z0, lineParameters('microstrip', 1, 4.4).z0, 0.01);
    expect(errorKey(() => lineParameters('coax', 0.5, 2))).toBe('lineRatio');
    expect(errorKey(() => lineParameters('coax', 3, 0.5))).toBe('permittivity');
  });
});

describe('two-ports', () => {
  it('reads complex numbers in rectangular and polar form', () => {
    nearZ(readComplex('40-j30'), cx(40, -30));
    nearZ(readComplex('0.5+0.2j'), cx(0.5, 0.2));
    nearZ(readComplex('−3j'), cx(0, -3));
    nearZ(readComplex('j'), cx(0, 1));
    nearZ(readComplex('1e-3+2e+1j'), cx(0.001, 20));
    nearZ(readComplex('2∠90'), cx(0, 2), 1e-12);
    expect(errorKey(() => readComplex('4x'))).toBe('notComplex');
    expect(errorKey(() => readComplex(''))).toBe('notComplex');
  });

  it('gives a 50 Ω series resistor S11 = 1/3 and S21 = 2/3, and no Z matrix', () => {
    const abcd: Matrix2 = [cx(1), cx(50), cx(0), cx(1)];
    const s = fromAbcd('S', abcd, 50)!;
    nearZ(s[0], cx(1 / 3));
    nearZ(s[2], cx(2 / 3));
    expect(fromAbcd('Z', abcd, 50)).toBeNull();
    const back = toAbcd('S', s, 50);
    abcd.forEach((value, i) => nearZ(back[i]!, value));
  });

  it('converts Z to Y and back through ABCD', () => {
    const z: Matrix2 = [cx(30, 5), cx(10), cx(10), cx(40, -8)];
    const y = fromAbcd('Y', toAbcd('Z', z, 50), 50)!;
    const again = fromAbcd('Z', toAbcd('Y', y, 50), 50)!;
    z.forEach((value, i) => nearZ(again[i]!, value));
  });

  it('cascades two eighth-wave lines into a quarter-wave line', () => {
    const t = Math.PI / 4;
    const eighth: Matrix2 = [cx(Math.cos(t)), cx(0, 50 * Math.sin(t)), cx(0, Math.sin(t) / 50), cx(Math.cos(t))];
    const quarter = cascade([eighth, eighth]);
    nearZ(quarter[0], cx(0));
    nearZ(quarter[1], cx(0, 50));
  });

  it('finds a matched 6 dB attenuator unconditionally stable with a gain of −6.0206 dB', () => {
    const result = stability([cx(0), cx(0.5), cx(0.5), cx(0)]);
    expect(result.k).toBeCloseTo(2.125, 12);
    expect(result.unconditional).toBe(true);
    expect(result.gainDb).toBeCloseTo(10 * Math.log10(0.25), 9);
    expect(errorKey(() => stability([cx(0), cx(0), cx(0.5), cx(0)]))).toBe('unilateral');
  });
});

describe('noise, links, and decibels', () => {
  it('cascades 20 dB with NF 2 dB and 10 dB with NF 6 dB to NF 2.08093 dB', () => {
    const result = friisNoise([
      { gainDb: 20, noiseFigureDb: 2 },
      { gainDb: 10, noiseFigureDb: 6 },
    ]);
    expect(Math.abs(result.noiseFigureDb - 2.08093)).toBeLessThan(1e-5);
    expect(result.gainDb).toBeCloseTo(30, 12);
  });

  it('converts noise figure and temperature both ways (3 dB is about 290 K)', () => {
    expect(noiseTemperature(10 * Math.log10(2))).toBeCloseTo(290, 9);
    expect(noiseFigure(290)).toBeCloseTo(10 * Math.log10(2), 12);
    expect(errorKey(() => noiseFigure(-1))).toBe('temperature');
  });

  it('gives 80.052 dB of free-space loss over 100 m at 2.4 GHz', () => {
    // 20 log₁₀ d + 20 log₁₀ f − 147.5522 (the constant is 20 log₁₀(c/4π)).
    const expected = 20 * Math.log10(100) + 20 * Math.log10(2.4e9) - 147.5522;
    expect(Math.abs(friisLink(20, 0, 0, 2.4e9, 100).pathLossDb - expected)).toBeLessThan(1e-3);
    expect(errorKey(() => friisLink(20, 0, 0, 2.4e9, 0))).toBe('distance');
  });

  it('receives exactly the smallest detectable power at the radar’s largest range', () => {
    const first = radar(1000, 30, 10e9, 1, 1000, -90);
    expect(radar(1000, 30, 10e9, 1, first.maxRange, -90).receivedDbm).toBeCloseTo(-90, 9);
  });

  it('turns 0 dBm into 1 mW and about 107 dBµV in 50 Ω, and 1 Np into 8.6859 dB', () => {
    const level = convertDb(0, 'dBm')!;
    expect(level.W).toBeCloseTo(1e-3, 15);
    expect(level.dBuV).toBeCloseTo(106.9897, 4);
    expect(convertDb(1, 'Np')!.dB).toBeCloseTo(8.685889638, 9);
    expect(convertDb(2, 'ratioPower')!.dB).toBeCloseTo(3.0103, 4);
    expect(errorKey(() => convertDb(-1, 'W'))).toBe('positiveRatio');
  });
});
