import { describe, expect, it } from 'vitest';
import { CivilError } from '../core/types';
import {
  alkalinity,
  alphas,
  basin,
  bod,
  bufferIntensity,
  chickWatson,
  closedPh,
  fitBod,
  headloss,
  mix,
  openPh,
  osmotic,
  oxygenSaturation,
  rateAt,
  scaling,
  seriesFlux,
  softening,
  stokes,
  streeterPhelps,
  timeForLogs,
  totalCarbonate,
} from './engine';

const within = (actual: number, expected: number, tol: number) =>
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tol);
const K = { pK1: 6.35, pK2: 10.33, pKw: 14 };

describe('water quality', () => {
  it('gives BOD5 and the rate at 25 °C', () => {
    within(bod(200, 0.23, 5), 136.673, 1e-3);
    within(rateAt(0.23, 1.047, 25), 0.289375, 1e-6);
    expect(() => rateAt(0, 1.047, 25)).toThrow(CivilError);
  });

  it('fits ultimate BOD from data by Thomas and by least squares', () => {
    const data = [1, 2, 3, 5, 7, 10].map((t) => [t, bod(200, 0.23, t)]);
    const curve = fitBod(data, 'curve');
    within(curve.L0, 200, 1e-6);
    within(curve.k, 0.23, 1e-9);
    // The Thomas line approximates the curve for small k t, so it is checked on the first 5 days.
    const thomas = fitBod(data.slice(0, 4), 'thomas');
    within(thomas.L0 / 200, 1, 0.02);
    within(thomas.k / 0.23, 1, 0.04);
    expect(() => fitBod([[1, 10]], 'curve')).toThrow(CivilError);
  });

  it('gives oxygen saturation in fresh water at 20 °C and 1 atm', () => {
    const sat = oxygenSaturation(20, 0, 1);
    within(sat.value, 9.09243, 1e-4);
    within(sat.value, sat.fresh, 1e-12);
    expect(oxygenSaturation(20, 35, 1).value).toBeLessThan(sat.value);
    expect(oxygenSaturation(20, 0, 0.8).value).toBeLessThan(sat.value);
    expect(() => oxygenSaturation(60, 0, 1)).toThrow(CivilError);
  });

  it('gives the Streeter-Phelps critical point', () => {
    const sag = streeterPhelps(0.3, 0.6, 20, 2);
    within(sag.tc, 1.95929, 1e-5);
    within(sag.Dc, 5.55556, 1e-5);
    within(sag.deficit(sag.tc), sag.Dc, 1e-9);
    // Equal rates use the limit form; the deficit peaks where its slope is 0.
    const equal = streeterPhelps(0.4, 0.4, 20, 2);
    within(equal.tc, (1 - 2 / 20) / 0.4, 1e-12);
    within(equal.Dc, equal.deficit(equal.tc), 1e-12);
  });

  it('mixes streams by flow', () => {
    const result = mix([
      [2, 10, 8],
      [1, 40, 5],
    ]);
    within(result.total, 3, 1e-12);
    within(result.mixed[0]!, 20, 1e-12);
    within(result.mixed[1]!, 7, 1e-12);
    expect(() => mix([[1, 2]])).toThrow(CivilError);
  });
});

describe('water chemistry and treatment', () => {
  it('gives the bicarbonate fraction and the Langelier index', () => {
    within(alphas(7, 6.35, 10.33).a1, 0.816767, 1e-5);
    const index = scaling(500, 25, 200, 150, 7.8);
    within(index.lsi, 0.32181, 1e-5);
    within(index.rsi, 2 * index.pHs - 7.8, 1e-12);
  });

  it('solves the closed and open carbonate systems both ways', () => {
    const CT = 2e-3;
    const alk = alkalinity(8.3, CT, K);
    within(closedPh(CT, alk, K), 8.3, 1e-9);
    within(totalCarbonate(8.3, alk, K), CT, 1e-15);
    expect(bufferIntensity(6.35, CT, K)).toBeGreaterThan(bufferIntensity(8.3, CT, K));
    // Pure water open to air (alkalinity 0) is near pH 5.6.
    within(openPh(10 ** -3.4, 10 ** -1.47, 0, K).pH, 5.6, 0.05);
  });

  it('gives hardness and lime-soda doses', () => {
    const dose = softening({ Ca: 80, Mg: 24.3, alk: 150, co2: 10, excess: 1.25 });
    within(dose.caH, (80 / 20.04) * 50.04, 1e-9);
    within(dose.total, dose.caH + dose.mgH, 1e-9);
    within(dose.noncarbonate, dose.total - 150, 1e-9);
    within(dose.limeMeq, 10 / 50.04 + 150 / 50.04 + 24.3 / 12.15 + 1.25, 1e-12);
  });

  it('gives Stokes settling and basin removal', () => {
    const quartz = stokes(50e-6, 2650, 998.2, 1.002e-3);
    within(quartz.v, 0.00224532, 1e-6);
    expect(quartz.Re).toBeLessThan(1);
    expect(() => stokes(50e-6, 900, 998.2, 1.002e-3)).toThrow(CivilError);
    const tank = basin(0.5, 500, 3, 0.0005);
    within(tank.v0, 0.001, 1e-15);
    within(tank.removal, 0.5, 1e-12);
    within(tank.td, 3000, 1e-9);
  });

  it('gives clean-bed headloss, with Ergun above Carman-Kozeny at higher rates', () => {
    const bed = { L: 0.6, d: 0.5e-3, eps: 0.4, phi: 0.85, v: 10 / 3600, rho: 998.2, mu: 1.002e-3 };
    const carman = headloss('carman', bed);
    // Worked by hand: 180 mu (1 - e)^2 v L = 1.0822e-4 over rho g e^3 (phi d)^2 = 1.1316e-4, so h = 0.956 m.
    within(carman.h, 0.9563, 0.001);
    expect(headloss('ergun', { ...bed, v: 0.01 }).h).toBeGreaterThan(0);
    expect(() => headloss('carman', { ...bed, eps: 1 })).toThrow(CivilError);
  });

  it('gives Chick-Watson inactivation, osmotic pressure, and membrane flux', () => {
    const kill = chickWatson(1, 30, 0.2, 1);
    within(kill.logs, 6 / Math.LN10, 1e-12);
    within(timeForLogs(kill.logs, 1, 0.2, 1), 30, 1e-12);
    within(osmotic(2, 0.6, 25), 29.7475, 1e-4);
    within(seriesFlux(2e5, 0, 1e-3, 1e12, 1e12).J, 1e-4, 1e-15);
    expect(() => seriesFlux(1e5, 2e5, 1e-3, 1e12, 0)).toThrow(CivilError);
  });
});
