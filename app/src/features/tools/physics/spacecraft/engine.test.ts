// The spacecraft sizing and link budgets tool against its validation cases (first principles) and independent
// working. Masses give back their mass ratios; a brute-force search checks optimal staging; the SMAD textbook's worked
// numbers check power and torques; and link budgets are redone in linear power ratios.
import { describe, expect, it } from 'vitest';
import { C, G0, K_B, SIGMA } from '../kit/constants';
import { specProblems } from '../kit/checkSpec';
import { problem, runMode, value } from '../kit/run';
import type { Outcome } from '../kit/types';
import {
  EARTH_DIPOLE,
  MU_EARTH,
  R_EARTH,
  disturbances,
  equilibrium,
  freeSpaceLoss,
  linkBudget,
  optimalStaging,
  powerBudget,
  rfidRange,
  sphereViewFactor,
  staging,
} from './engine';
import { SPACECRAFT } from './spec';

const R = 'kitPhysics.spacecraft.r.';
const D2R = Math.PI / 180;
const rel = (got: number, want: number) => Math.abs(got - want) / Math.abs(want);
const word = (out: Outcome) => (out.ok ? out.rows.find((row) => row.word)?.word : null);

describe('spacecraft: propulsion', () => {
  it('has every message and solves every calculation from its starting numbers', () => {
    expect(specProblems(SPACECRAFT)).toEqual([]);
  });

  it('two stages of Isp 300 s, structural coefficient 0.1, payload ratio 0.2: n = 4, total 8156.9 m/s', () => {
    const out = staging(
      [
        { isp: 300, epsilon: 0.1, lambda: 0.2 },
        { isp: 300, epsilon: 0.1, lambda: 0.2 },
      ],
      1000,
    );
    expect(out[0].n).toBeCloseTo(4, 14);
    const total = out[0].dv + out[1].dv;
    expect(rel(total, 8156.9)).toBeLessThan(1e-5);
    expect(total).toBeCloseTo(2 * 300 * G0 * Math.log(4), 9);
    // The masses give back the mass ratio: lift-off over burnout of stage 1.
    const gross = out[0].gross ?? NaN;
    expect(gross / (gross - (out[0].propellant ?? NaN))).toBeCloseTo(4, 12);
    expect(gross).toBeCloseTo(36_000, 9);
    expect(value(runMode(SPACECRAFT, 'staging', {}), `${R}totalDv`)).toBeCloseTo(total, 9);
  });

  it('optimal staging is no heavier than any split a brute-force search finds', () => {
    const stages = [
      { isp: 300, epsilon: 0.1 },
      { isp: 350, epsilon: 0.12 },
    ];
    const dv = 8000;
    const out = optimalStaging(stages, dv, 1000);
    expect(out.stages[0].dv + out.stages[1].dv).toBeCloseTo(dv, 6);
    // Gross mass for a split: the top stage first, then the bottom.
    const grossFor = (dv1: number) => {
      const n = [Math.exp(dv1 / (300 * G0)), Math.exp((dv - dv1) / (350 * G0))];
      let above = 1000;
      for (let i = 1; i >= 0; i--) {
        if (n[i] * stages[i].epsilon >= 1) return Infinity;
        above += ((n[i] - 1) / (1 - n[i] * stages[i].epsilon)) * above;
      }
      return above;
    };
    let best = Infinity;
    for (let dv1 = 1; dv1 < dv; dv1 += 1) best = Math.min(best, grossFor(dv1));
    expect(out.gross).toBeLessThanOrEqual(best * (1 + 1e-9));
    expect(rel(out.gross, best)).toBeLessThan(1e-6);
    // Identical stages split the delta-v evenly.
    const twin = optimalStaging([stages[0], stages[0]], 6000, 1);
    expect(twin.stages[0].dv).toBeCloseTo(3000, 6);
  });

  it('says what is wrong with an impossible delta-v, coefficient, or mass', () => {
    expect(problem(runMode(SPACECRAFT, 'optimal', { dv: '20' }))).toBe('kitPhysics.spacecraft.errors.tooMuch');
    expect(problem(runMode(SPACECRAFT, 'staging', { stages: '300 1.2 0.2' }))).toBe(
      'kitPhysics.spacecraft.errors.epsilon',
    );
    expect(problem(runMode(SPACECRAFT, 'staging', { stages: '300 0.1' }))).toBe('kitPhysics.errors.rowCount');
    expect(problem(runMode(SPACECRAFT, 'rocket', { mf: '1200' }))).toBe('kitPhysics.spacecraft.errors.massOrder');
    expect(problem(runMode(SPACECRAFT, 'budget', { masses: '-5' }))).toBe(
      'kitPhysics.spacecraft.errors.negativeBudget',
    );
  });

  it('the rocket equation runs both ways, and the budget adds its margins', () => {
    const dv = value(runMode(SPACECRAFT, 'rocket', {}), `${R}dv`);
    expect(dv).toBeCloseTo(300 * G0 * Math.log(2.5), 9);
    const back = runMode(SPACECRAFT, 'rocket', { find: 'propellant', dry: '400', dv: String(dv) });
    expect(value(back, `${R}propellant`)).toBeCloseTo(600, 9);
    const budget = runMode(SPACECRAFT, 'budget', {});
    expect(value(budget, `${R}dryMargin`)).toBeCloseTo(330, 9);
    expect(value(budget, `${R}dvMargin`)).toBeCloseTo(385, 9);
    expect(value(budget, `${R}propellant`)).toBeCloseTo(330 * (Math.exp(385 / (300 * G0)) - 1), 9);
  });
});

describe('spacecraft: power and thermal', () => {
  it('reproduces the Wertz and Larson worked array: 236 W, 143 and 118 W/m², about 2.0 m²', () => {
    const out = powerBudget({
      dayLoad: 110,
      eclipseLoad: 110,
      period: 100 * 60,
      eclipse: 35 * 60,
      xDay: 0.8,
      xEclipse: 0.6,
      cellEfficiency: 0.148,
      inherent: 0.77,
      incidence: 23.5 * D2R,
      degradation: 0.0375,
      years: 5,
      flux: 1367,
      depth: 0.4,
      batteryEfficiency: 0.9,
    });
    expect(out.array).toBeCloseTo((110 * 35) / 0.6 / 65 + 110 / 0.8, 9);
    expect(Math.round(out.array)).toBe(236);
    expect(Math.round(out.bol)).toBe(143);
    expect(Math.round(out.eol)).toBe(118);
    expect(out.area).toBeCloseTo(2.0, 1);
    expect(out.capacity / 3600).toBeCloseTo((110 * 35) / 60 / 0.36, 9);
    expect(problem(runMode(SPACECRAFT, 'power', { eclipse: '120' }))).toBe('kitPhysics.spacecraft.errors.eclipse');
  });

  it('an isothermal sphere at 1 AU with alpha / epsilon = 1 sits at 278.32 K', () => {
    const T = value(runMode(SPACECRAFT, 'thermal', {}), `${R}temperature`);
    expect(rel(T, 278.32)).toBeLessThan(1e-4);
    expect(T).toBeCloseTo((1361 / (4 * SIGMA)) ** 0.25, 10);
    // Area cancels; a plate radiating from both sides runs 2^(1/4) hotter; at 4 AU it runs half as hot.
    expect(value(runMode(SPACECRAFT, 'thermal', { area: '7' }), `${R}temperature`)).toBeCloseTo(T, 10);
    expect(value(runMode(SPACECRAFT, 'thermal', { shape: 'plateBoth' }), `${R}temperature`)).toBeCloseTo(
      T * 2 ** 0.25,
      10,
    );
    expect(value(runMode(SPACECRAFT, 'thermal', { au: '4' }), `${R}temperature`)).toBeCloseTo(T / 2, 10);
  });

  it('Earth’s infrared and albedo warm the sphere by the view-factor terms', () => {
    const F = sphereViewFactor(R_EARTH, R_EARTH + 700e3);
    expect(F).toBeCloseTo((1 - Math.sqrt(1 - (6378.137 / 7078.137) ** 2)) / 2, 14);
    const out = equilibrium({
      alpha: 0.6,
      epsilon: 0.6,
      flux: 1361,
      ratio: 0.25,
      area: 1,
      internal: 0,
      planetIr: 237 * F,
      albedo: 0.3 * 1361 * F,
    });
    const want = ((0.6 * 1361 * 0.25 + 0.6 * 237 * F + 0.6 * 0.3 * 1361 * F) / (0.6 * SIGMA)) ** 0.25;
    expect(out.T).toBeCloseTo(want, 10);
    expect(value(runMode(SPACECRAFT, 'thermal', { altitude: '700' }), `${R}temperature`)).toBeCloseTo(want, 10);
  });
});

describe('spacecraft: attitude and links', () => {
  it('disturbance torques at 700 km match their formulas (and the Wertz and Larson 1.8×10⁻⁶ N·m gravity gradient)', () => {
    const out = runMode(SPACECRAFT, 'attitude', {});
    const r = R_EARTH + 700e3;
    const gravity = ((3 * MU_EARTH) / (2 * r ** 3)) * 30 * Math.sin(2 * D2R);
    expect(value(out, `${R}gravity`)).toBeCloseTo(gravity, 18);
    expect(gravity).toBeCloseTo(1.8e-6, 7);
    expect(value(out, `${R}magnetic`)).toBeCloseTo((2 * EARTH_DIPOLE) / r ** 3, 16);
    expect(value(out, `${R}solar`)).toBeCloseTo((1361 / C) * 2 * 1.6 * 0.3, 16);
    const v2 = MU_EARTH / r;
    expect(value(out, `${R}drag`)).toBeCloseTo(0.5 * 1e-13 * 2.2 * 2 * v2 * 0.2, 16);
    const d = disturbances({
      r,
      iy: 0,
      iz: 0,
      theta: 0,
      solarArea: 0,
      reflectance: 0,
      sunAngle: 0,
      solarArm: 0,
      flux: 0,
      density: 0,
      dragCoefficient: 0,
      dragArea: 0,
      dragArm: 0,
      dipole: 0,
      magneticFactor: 1,
    });
    expect(d.total).toBe(0);
    expect(d.period).toBeCloseTo(2 * Math.PI * Math.sqrt(r ** 3 / MU_EARTH), 9);
  });

  it('free-space loss at 2.2 GHz over 1000 km is 159.30 dB', () => {
    expect(Math.abs(freeSpaceLoss(1e6, 2.2e9) - 159.3)).toBeLessThan(1e-2);
    expect(freeSpaceLoss(1e6, 2.2e9)).toBeCloseTo(20 * Math.log10((4 * Math.PI * 1e6 * 2.2e9) / C), 12);
  });

  it('the link budget agrees with the same link in linear power ratios', () => {
    const input = {
      frequency: 8.4e9,
      power: 20,
      txGain: 30,
      txLoss: 1.5,
      distance: 4e7,
      otherLoss: 3,
      rxGain: 55,
      noiseTemperature: 150,
      rate: 1e7,
      required: 4.2,
    };
    const out = linkBudget(input);
    const lin = (decibels: number) => 10 ** (decibels / 10);
    const pr =
      ((input.power * lin(input.txGain)) / lin(input.txLoss)) *
      (C / input.frequency / (4 * Math.PI * input.distance)) ** 2;
    const ebn0 = (pr * lin(input.rxGain)) / lin(input.otherLoss) / input.rate / (K_B * input.noiseTemperature);
    expect(out.ebn0).toBeCloseTo(10 * Math.log10(ebn0), 10);
    expect(out.margin).toBeCloseTo(out.ebn0 - 4.2, 12);
    expect(word(runMode(SPACECRAFT, 'link', { distance: '1e6' }))).toBe('kitPhysics.spacecraft.kind.fails');
  });

  it('RFID at 915 MHz, EIRP 36 dBm, tag 2.15 dBi, sensitivity -18 dBm: forward range 16.737 m', () => {
    const out = rfidRange({ frequency: 915e6, eirp: 36, tagGain: 2.15, tagSensitivity: -18, loss: 0 });
    expect(rel(out.forward, 16.737)).toBeLessThan(1e-4);
    // Friis in watts: P_tag = EIRP G (lambda / 4 pi r)².
    const lambda = C / 915e6;
    const r = (lambda / (4 * Math.PI)) * Math.sqrt((10 ** 0.6 * 10 ** 0.215) / 10 ** -4.8);
    expect(out.forward).toBeCloseTo(r, 10);
    expect(value(runMode(SPACECRAFT, 'rfid', {}), `${R}readRange`)).toBeCloseTo(r, 10);
    // With the reverse link the read range is the shorter one, and it scales with the fourth root of the budget.
    const both = rfidRange({
      frequency: 915e6,
      eirp: 36,
      tagGain: 2.15,
      tagSensitivity: -18,
      loss: 0,
      readerGain: 6,
      readerSensitivity: -70,
      backscatterLoss: 5,
    });
    expect(both.reverse).toBeCloseTo((lambda / (4 * Math.PI)) * 10 ** ((36 + 4.3 + 6 - 5 + 70) / 40), 10);
    expect(both.range).toBe(Math.min(both.forward, both.reverse ?? Infinity));
  });
});
