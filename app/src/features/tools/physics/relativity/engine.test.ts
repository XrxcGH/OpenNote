// The special relativity tool against its validation cases (first principles) and independent working.
import { describe, expect, it } from 'vitest';
import { C, M_E, MEV } from '../kit/constants';
import { specProblems } from '../kit/checkSpec';
import { problem, runMode, value } from '../kit/run';
import { addVelocities, dopplerFactor, gammaMinusOne, interval, lorentzBoost, lorentzFactor, particle } from './engine';
import { RELATIVITY } from './spec';

const R = 'kitPhysics.relativity.r.';

describe('special relativity', () => {
  it('has every message and solves every calculation from its starting numbers', () => {
    expect(specProblems(RELATIVITY)).toEqual([]);
  });

  it('beta 0.6 gives gamma 1.25', () => {
    expect(Math.abs(lorentzFactor(0.6) - 1.25)).toBeLessThan(1e-12);
    const out = runMode(RELATIVITY, 'factor', { beta: '0.6', tau: '1', L0: '1' });
    expect(value(out, `${R}gamma`)).toBeCloseTo(1.25, 12);
    expect(value(out, `${R}dilated`)).toBeCloseTo(1.25, 12);
    expect(value(out, `${R}contracted`)).toBeCloseTo(0.8, 12);
    expect(value(out, `${R}rapidity`)).toBeCloseTo(Math.log(2), 12);
    // The same speed typed in m/s.
    const fromSpeed = runMode(RELATIVITY, 'factor', { given: 'speed', v: String(0.6 * C) });
    expect(value(fromSpeed, `${R}gamma`)).toBeCloseTo(1.25, 12);
  });

  it('0.6c plus 0.6c is 0.88235c', () => {
    expect(Math.abs(addVelocities(0.6, 0.6) - 0.88235)).toBeLessThan(1e-5);
    expect(addVelocities(0.6, 0.6)).toBeCloseTo(1.2 / 1.36, 14);
    // Light stays at c, and opposite speeds cancel.
    expect(addVelocities(1, 0.5)).toBe(1);
    expect(addVelocities(0.5, -0.5)).toBe(0);
  });

  it('event t 2 s, x 1 light-second, boost 0.6c: t′ 1.75 s, x′ −0.25 light-seconds', () => {
    const out = lorentzBoost(2, C, 0.6, C);
    expect(Math.abs(out.t - 1.75)).toBeLessThan(1e-9);
    expect(Math.abs(out.x / C + 0.25)).toBeLessThan(1e-9);
    const shown = runMode(RELATIVITY, 'events', {});
    expect(value(shown, `${R}tPrime`)).toBeCloseTo(1.75, 9);
    expect(value(shown, `${R}xPrime`) / C).toBeCloseTo(-0.25, 9);
    // The interval is the same in both frames: (2c)² − c² = 3c², timelike, proper time √3 s.
    expect(value(shown, `${R}properTime`)).toBeCloseTo(Math.sqrt(3), 12);
    const again = interval(out.t, out.x, C);
    expect(again.s2 / (C * C)).toBeCloseTo(3, 9);
    expect(interval(1, C, C).kind).toBe('lightlike');
    expect(interval(1, 2 * C, C).kind).toBe('spacelike');
  });

  it('an electron with 1 MeV of kinetic energy has gamma 2.95695 and beta 0.94108', () => {
    const rest = M_E * C * C;
    const p = particle(rest, { ke: MEV });
    expect(Math.abs(p.gamma - 2.95695)).toBeLessThan(1e-5);
    expect(Math.abs(p.beta - 0.94108)).toBeLessThan(1e-5);
    // Independently: gamma = 1 + K / mc², beta = sqrt(1 − 1/gamma²), pc = sqrt(E² − (mc²)²).
    const gamma = 1 + MEV / rest;
    expect(p.gamma).toBeCloseTo(gamma, 12);
    expect(p.beta).toBeCloseTo(Math.sqrt(1 - 1 / gamma ** 2), 12);
    expect(p.pc / MEV).toBeCloseTo(Math.sqrt((gamma * rest) ** 2 - rest ** 2) / MEV, 9);
    const out = runMode(RELATIVITY, 'energy', { K: '1' });
    expect(value(out, `${R}gamma`)).toBeCloseTo(gamma, 12);
    // From the momentum back to the same kinetic energy, and from beta.
    expect(particle(rest, { pc: p.pc }).kinetic / MEV).toBeCloseTo(1, 12);
    expect(particle(rest, { beta: p.beta }).kinetic / MEV).toBeCloseTo(1, 9);
  });

  it('stays accurate at small speeds and near c', () => {
    // At beta 1e-8, K is ½ m v² to many digits, where 1/sqrt(1 − beta²) − 1 would round to 0.
    const beta = 1e-8;
    expect(gammaMinusOne(beta) / (0.5 * beta * beta)).toBeCloseTo(1, 12);
    const p = particle(1, { beta });
    expect(p.kinetic / (0.5 * beta * beta)).toBeCloseTo(1, 12);
    // Near c: 1 − beta = 1e-12 gives gamma = 1 / sqrt(2e-12) to 4 digits or better.
    expect(lorentzFactor(1 - 1e-12) * Math.sqrt(2e-12 - 1e-24)).toBeCloseTo(1, 4);
  });

  it('a receding source at beta 0.6 has frequency factor 0.5', () => {
    expect(Math.abs(dopplerFactor(0.6, true) - 0.5)).toBeLessThan(1e-12);
    expect(dopplerFactor(0.6, false)).toBeCloseTo(2, 12);
    const out = runMode(RELATIVITY, 'doppler', { f0: '100' });
    expect(value(out, `${R}observed`)).toBeCloseTo(50, 10);
    expect(value(out, `${R}redshift`)).toBeCloseTo(1, 12);
  });

  it('mass and energy: 1 g is 8.98755×10¹³ J', () => {
    const out = runMode(RELATIVITY, 'rest', { m: '1' });
    expect(value(out, `${R}restEnergy`)).toBeCloseTo(1e-3 * C * C, 0);
  });

  it('stops with a message at or past the speed of light and for impossible masses', () => {
    expect(problem(runMode(RELATIVITY, 'factor', { beta: '1' }))).toBe('kitPhysics.relativity.errors.speed');
    expect(problem(runMode(RELATIVITY, 'factor', { beta: '1.2' }))).toBe('kitPhysics.errors.range');
    expect(problem(runMode(RELATIVITY, 'factor', { given: 'speed', v: '3e8' }))).toBe(
      'kitPhysics.relativity.errors.speed',
    );
    expect(problem(runMode(RELATIVITY, 'velocity', { v: '1' }))).toBe('kitPhysics.relativity.errors.lightFrame');
    expect(problem(runMode(RELATIVITY, 'energy', { particle: 'custom', m: '0' }))).toBe('kitPhysics.errors.positive');
    expect(problem(runMode(RELATIVITY, 'energy', { K: '-1' }))).toBe('kitPhysics.errors.nonNegative');
    expect(problem(runMode(RELATIVITY, 'doppler', { beta: '1' }))).toBe('kitPhysics.relativity.errors.speed');
    expect(problem(runMode(RELATIVITY, 'events', { x: 'x' }))).toBe('kitPhysics.errors.notNumber');
  });

  it('works the same in US customary units', () => {
    const out = runMode(RELATIVITY, 'events', { x: String(C / 0.3048) }, { unit: { x: 'ft' }, system: 'US' });
    expect(value(out, `${R}tPrime`)).toBeCloseTo(1.75, 9);
  });
});
