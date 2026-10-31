// Bench calculations against the planning pass's independent values (first principles and hand calculation), plus
// the documented errors.
import { describe, expect, it } from 'vitest';
import { LsError } from '../num/errors';
import {
  bufferResult,
  calibrationResult,
  ddct,
  dilution,
  efficiency,
  growth,
  hemocytometerResult,
  massFor,
  microscopeResult,
  moi,
  platesResult,
  rcf,
  rpmFor,
  serialResult,
} from './engine';

const value = (result: { rows: { label: string; value: number | string }[] }, label: string) =>
  result.rows.find((row) => row.label === label)?.value;

describe('solutions and dilutions', () => {
  it('weighs 7.305 g of NaCl for 250 mL of 0.5 M', () => {
    expect(massFor(0.5, 250, 58.44)).toBeCloseTo(7.305, 9);
  });

  it('dilutes a 10x stock to 500 mL of 1x with 50 mL stock and 450 mL water', () => {
    const r = dilution(10, null, 1, 500);
    expect(value(r, 'bench.r.v1')).toBeCloseTo(50, 9);
    expect(value(r, 'bench.r.diluent')).toBeCloseTo(450, 9);
  });

  it('needs exactly 1 blank and refuses to concentrate', () => {
    expect(() => dilution(10, 5, 1, 500)).toThrow(LsError);
    expect(() => dilution(1, 10, 2, null)).toThrow(LsError);
  });

  it('plans a 10-fold series in 1 mL tubes', () => {
    const r = serialResult(1000, 10, 3, 1);
    expect(value(r, 'bench.r.transfer')).toBeCloseTo(0.1, 12);
    expect(r.table?.rows[2][2]).toBeCloseTo(1, 12);
  });
});

describe('buffers', () => {
  it('splits 10 mmol of phosphate at pH 7.2 with pKa 7.21', () => {
    const r = bufferResult(7.2, 7.21, 0.1, 100, null, null);
    expect(value(r, 'bench.r.acidFraction')).toBeCloseTo(0.505756, 5);
    expect(value(r, 'bench.r.acid')).toBeCloseTo(5.0576, 4);
    expect(value(r, 'bench.r.base')).toBeCloseTo(4.9424, 4);
  });

  it('refuses stocks too dilute for the volume', () => {
    expect(() => bufferResult(7.2, 7.21, 0.1, 100, 0.05, 0.05)).toThrow(LsError);
  });
});

describe('centrifuge', () => {
  it('gives 2795 g at 5000 rpm and 10 cm, and 3343.75 rpm for 1000 g at 8 cm', () => {
    expect(rcf(5000, 10)).toBeCloseTo(2795, 9);
    expect(rpmFor(1000, 8)).toBeCloseTo(3343.75, 2);
  });
});

describe('counts', () => {
  it('counts 5.0e5 cells/mL and 1.5e8 CFU/mL', () => {
    expect(value(hemocytometerResult(100, 0, 4, 2, null), 'bench.r.cellsPerMl')).toBeCloseTo(5e5, 6);
    expect(value(platesResult(150, 0.1, 1e-5, 'cfu'), 'bench.r.cfu')).toBeCloseTo(1.5e8, 3);
  });

  it('refuses a dilution written as a factor above 1', () => {
    expect(() => platesResult(150, 0.1, 100, 'cfu')).toThrow(LsError);
  });

  it('gives 0.632121 infected at MOI 1', () => {
    expect(moi(1).infected).toBeCloseTo(0.632121, 6);
  });
});

describe('growth and qPCR', () => {
  it('fits a doubling time of 1 h to exact doubling data', () => {
    expect(growth([0, 1, 2, 3], [1, 2, 4, 8]).doubling).toBeCloseTo(1, 12);
    expect(() => growth([0, 1], [2, 1])).toThrow(LsError);
  });

  it('gives ddCt −1.5 and fold 2.82843', () => {
    const r = ddct(25, 18, 27, 18.5);
    expect(r.dd).toBeCloseTo(-1.5, 12);
    expect(r.fold).toBeCloseTo(2.82843, 5);
  });

  it('gives 100.08% efficiency for slope −3.32', () => {
    expect(100 * efficiency(-3.32)).toBeCloseTo(100.08, 2);
  });
});

describe('microscopy and calibration', () => {
  it('gives the Abbe limit 196.429 nm at 550 nm with NA 1.4', () => {
    expect(value(microscopeResult(100, 10, null, 550, 1.4), 'bench.r.abbe')).toBeCloseTo(196.429, 3);
  });

  it('gives LOD 0.132 for σ 0.002 and slope 0.05', () => {
    const r = calibrationResult(
      [
        [0, 0],
        [1, 0.05],
        [2, 0.1],
      ],
      1,
      [0.075],
      0.002,
    );
    expect(value(r, 'bench.r.lod')).toBeCloseTo(0.132, 9);
    expect(r.table?.rows[0][1]).toBeCloseTo(1.5, 9);
  });

  it('reads a quadratic curve back', () => {
    const rows = [0, 1, 2, 3, 4].map((x) => [x, 1 + 2 * x + 0.5 * x * x]);
    const r = calibrationResult(rows, 2, [1 + 2 * 2.5 + 0.5 * 6.25], null);
    expect(r.table?.rows[0][1]).toBeCloseTo(2.5, 8);
  });
});
