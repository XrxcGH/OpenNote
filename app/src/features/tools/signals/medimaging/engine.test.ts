// Medical imaging physics. The plan's validation cases come first with their independent expected values (hand
// calculations); the Bloch simulation is checked against the closed-form relaxation curves.
import { describe, expect, it } from 'vitest';
import { SignalError } from '../shared/errors';
import {
  beerLambert,
  bloch,
  doppler,
  hounsfield,
  inverseSquare,
  kSpace,
  larmor,
  mriSignal,
  suv,
  tofPosition,
  ultrasound,
  velocityFromShift,
  windowLevel,
} from './engine';

const close = (actual: number, expected: number, tolerance: number) =>
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tolerance);
const errorKey = (run: () => unknown) => {
  try {
    run();
  } catch (error) {
    return error instanceof SignalError ? error.key : 'other';
  }
  return 'none';
};
const tissue = { t1: 900, t2: 100, pd: 1 };

describe('MRI', () => {
  it('gives 63.86622 MHz for hydrogen at 1.5 T', () => {
    close(larmor(1.5).mhz, 63.86622, 1e-5);
  });

  it('gives a spin-echo signal of 0.348981 at TR 500, TE 20 and an inversion null at 623.832 ms for T1 900 ms', () => {
    const result = mriSignal('spinEcho', tissue, 500, 20, 0, 90);
    close(result.signal, 0.348981, 1e-6);
    close(result.nullTi, 623.832, 1e-3);
    // At the null the long-TR inversion recovery signal vanishes.
    close(mriSignal('inversionRecovery', tissue, 1e9, 0, result.nullTi, 90).signal, 0, 1e-12);
  });

  it('peaks the gradient-echo signal at the Ernst angle', () => {
    const { ernst } = mriSignal('gradientEcho', tissue, 50, 5, 0, 30);
    const at = (flip: number) => mriSignal('gradientEcho', tissue, 50, 5, 0, flip).signal;
    expect(at(ernst)).toBeGreaterThan(at(ernst - 2));
    expect(at(ernst)).toBeGreaterThan(at(ernst + 2));
  });

  it('follows 1 − e^(−t/T1) and e^(−t/T2) after a 90° pulse', () => {
    const run = bloch(900, 100, [{ at: 0, flip: 90 }], 400);
    // The first sample is the vector just after the pulse: all of it tipped into the transverse plane.
    close(run.mxy[0]!, 1, 1e-9);
    close(run.mz[0]!, 0, 1e-9);
    for (const i of [100, 200, 400]) {
      close(run.mz[i]!, 1 - Math.exp(-run.t[i]! / 900), 1e-6);
      close(run.mxy[i]!, Math.exp(-run.t[i]! / 100), 1e-6);
    }
  });

  it('refocuses a spread of isochromats into an echo at TE after a 90°–180° pair', () => {
    const run = bloch(
      900,
      100,
      [
        { at: 0, flip: 90 },
        { at: 20, flip: 180 },
      ],
      60,
      200,
      41,
    );
    const at = (ms: number) => run.mxy[Math.round((ms / 60) * 400)]!;
    expect(at(40)).toBeGreaterThan(5 * at(20));
    close(at(40), Math.exp(-40 / 100), 0.02);
  });

  it('rebuilds the phantom from full k-space and blurs it from the center alone', () => {
    const full = kSpace(64, 'full', 1);
    let worst = 0;
    full.image.forEach((v, i) => (worst = Math.max(worst, Math.abs(v - full.rebuilt[i]!))));
    expect(worst).toBeLessThan(1e-9);
    const center = kSpace(64, 'center', 0.25);
    expect(center.kept).toBeLessThan(0.1);
    expect(errorKey(() => kSpace(50, 'full', 1))).toBe('kSize');
  });

  it('refuses T2 longer than T1 and a zero field', () => {
    expect(errorKey(() => bloch(100, 900, [], 10))).toBe('t2AboveT1');
    expect(errorKey(() => larmor(0))).toBe('positive');
  });
});

describe('CT and X-ray', () => {
  it('gives 105.263 HU for μ 0.21 cm⁻¹ with water at 0.19 cm⁻¹', () => {
    close(hounsfield(0.21, 0.19).hu, 105.263, 1e-3);
    expect(hounsfield(0.19, 0.19).hu).toBe(0);
    expect(hounsfield(0, 0.19).hu).toBe(-1000);
  });

  it('maps a window: the level is mid-gray and the edges are black and white', () => {
    expect(windowLevel(40, 80, 40)).toBeCloseTo(0.5, 12);
    expect(windowLevel(-100, 80, 40)).toBe(0);
    expect(windowLevel(500, 80, 40)).toBe(1);
  });

  it('halves the beam at one half-value layer and quarters it at twice the distance', () => {
    const { hvl } = beerLambert(0.5, 1);
    close(beerLambert(0.5, hvl).transmitted, 0.5, 1e-12);
    expect(inverseSquare(100, 1, 2)).toBeCloseTo(25, 12);
  });
});

describe('ultrasound and PET', () => {
  it('reflects 0.428102 of the intensity from tissue to bone and puts a 65 µs echo at 5.005 cm', () => {
    const result = ultrasound(1.63, 7.8, 65, 1540, 0.5, 5);
    close(result.reflection, 0.428102, 1e-6);
    close(result.depthCm, 5.005, 1e-9);
    close(result.lossDb, 2 * 0.5 * 5 * 5.005, 1e-9);
  });

  it('gives a 1623.38 Hz Doppler shift at 5 MHz, 0.5 m/s, 60°, and the velocity back', () => {
    const { shift } = doppler(5, 0.5, 60, 1540);
    close(shift, 1623.38, 1e-2);
    close(velocityFromShift(shift, 5, 60, 1540), 0.5, 1e-12);
    expect(errorKey(() => velocityFromShift(100, 5, 90, 1540))).toBe('dopplerAngle');
  });

  it('gives an SUV of 0.945946 for 5 kBq/mL after 370 MBq in 70 kg', () => {
    const result = suv(5, 370, 70, 60, 109.77);
    close(result.value, 0.945946, 1e-6);
    // One half-life halves the dose, so the decay-corrected SUV doubles.
    close(suv(5, 370, 70, 109.77, 109.77).corrected, 2 * 0.945946, 1e-5);
    // 500 ps of time-of-flight difference is 7.5 cm along the line.
    close(tofPosition(500), 0.0749481, 1e-6);
  });
});
