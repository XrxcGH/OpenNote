import { describe, expect, it } from 'vitest';
import { CivilError } from '../core/types';
import {
  captureZone,
  damSeepage,
  darcy,
  dupuit,
  fitJacob,
  fitTheis,
  flowNet,
  hantushW,
  layered,
  ogataBanks,
  retardation,
  superpose,
  theis,
  thiem,
  threeWells,
} from './engine';

const within = (actual: number, expected: number, tol: number) =>
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tol);

describe('groundwater and wells', () => {
  it('gives Theis drawdown and the Cooper-Jacob line at u = 0.01', () => {
    // r 10 m, S 1e-4, t 250 s make u = 100 × 1e-4 / (4 × 0.001 × 250) = 0.01.
    const result = theis(0.01, 0.001, 1e-4, 10, 250);
    within(result.u, 0.01, 1e-15);
    within(result.W, 4.03793, 1e-5);
    within(result.s, 3.21328, 1e-5);
    within(result.jacob, 3.20534, 1e-5);
  });

  it('gives the Hantush leaky well function', () => {
    within(hantushW(0.01, 0.1), 3.81502, 1e-5);
    within(hantushW(0.01, 0), 4.037929576538114, 1e-12);
    expect(() => hantushW(0, 0.1)).toThrow(CivilError);
  });

  it('gives Darcy flux and seepage velocity', () => {
    const flow = darcy(1e-4, 0.01, 0.3, 2);
    within(flow.q, 1e-6, 1e-9);
    within(flow.v, 3.333e-6, 1e-9);
    within(flow.Q!, 2e-6, 1e-15);
    expect(() => darcy(1e-4, 0.01, 0, null)).toThrow(CivilError);
  });

  it('gives a 1D transport breakthrough with both Ogata-Banks terms', () => {
    within(ogataBanks(10, 1, 1, 10), 0.585289, 1e-6);
    // Retardation divides the velocity and dispersion, so R = 2 at 20 d matches R = 1 at 10 d.
    within(ogataBanks(10, 1, 1, 20, 2), ogataBanks(10, 1, 1, 10), 1e-12);
    expect(ogataBanks(10, 1, 1, 10, 1, 0.1)).toBeLessThan(0.585289);
    expect(() => ogataBanks(10, 1, 1, 10, 0.5)).toThrow(CivilError);
  });

  it('gives flow-net seepage and retardation', () => {
    within(flowNet(1e-5, 10, 4, 12, null).q, 3.333e-5, 1e-4 * 3.333e-5 + 1e-9);
    within(flowNet(1e-5, 10, 4, 12, 2).exit!, 10 / 12 / 2, 1e-12);
    within(retardation(1.6, 0.5, 0.3), 3.667, 1e-3);
    expect(() => flowNet(1e-5, 10, 0, 12, null)).toThrow(CivilError);
  });
});

describe('groundwater analysis', () => {
  it('finds the gradient and flow direction from 3 wells', () => {
    // h = 100 - 0.01 x: water flows toward +x, which is east (azimuth 90°).
    const plane = threeWells([
      [0, 0, 100],
      [100, 0, 99],
      [0, 100, 100],
    ]);
    within(plane.gradient, 0.01, 1e-12);
    within(plane.azimuth, 90, 1e-9);
    expect(() =>
      threeWells([
        [0, 0, 1],
        [1, 1, 2],
        [2, 2, 3],
      ]),
    ).toThrow(CivilError);
  });

  it('averages layered conductivity along and across the layers', () => {
    const result = layered([
      [1, 1e-3],
      [1, 1e-5],
    ]);
    within(result.kh, 5.05e-4, 1e-15);
    within(result.kv, 2 / (1 / 1e-3 + 1 / 1e-5), 1e-18);
  });

  it('gives steady drawdown by Thiem and Dupuit', () => {
    within(thiem(0.01, 0.001, 1000, 10), (0.01 / (2 * Math.PI * 0.001)) * Math.log(100), 1e-12);
    const unconfined = dupuit(0.01, 1e-4, 20, 500, 0.5);
    within(unconfined.h ** 2, 400 - (0.01 / (Math.PI * 1e-4)) * Math.log(1000), 1e-9);
    expect(() => dupuit(1, 1e-6, 5, 500, 0.5)).toThrow(CivilError);
    expect(() => thiem(0.01, 0.001, 5, 10)).toThrow(CivilError);
  });

  it('recovers T and S from synthetic pumping-test data', () => {
    const [Q, r, T, S] = [0.01, 30, 2e-3, 3e-4];
    const times = [60, 120, 300, 600, 1200, 3000, 6000, 12000, 30000];
    const data = times.map((t) => [t, theis(Q, T, S, r, t).s]);
    const fit = fitTheis(data, Q, r);
    within(fit.T / T, 1, 1e-6);
    within(fit.S / S, 1, 1e-6);
    // Late data, where u is small, give Cooper-Jacob values close to the true ones.
    const late = fitJacob(data.slice(5), Q, r);
    within(late.T / T, 1, 0.03);
    within(late.S / S, 1, 0.1);
  });

  it('superposes wells and image wells', () => {
    const aquifer = { T: 0.001, S: 1e-4, t: 250 };
    const single = superpose([[10, 0, 0.01]], [0, 0], aquifer, 'none');
    within(single.total, 3.21328, 1e-5);
    // A constant-head line at x = 0 holds the drawdown there at 0.
    const recharge = superpose([[10, 0, 0.01]], [0, 5], aquifer, 'recharge');
    within(recharge.total, 0, 1e-12);
    const barrier = superpose([[10, 0, 0.01]], [0, 0], aquifer, 'barrier');
    within(barrier.total, 2 * 3.21328, 2e-5);
  });

  it('sizes a capture zone', () => {
    const zone = captureZone(0.01, 10, 1e-4, 0.005);
    within(zone.far, 0.01 / (10 * 5e-7), 1e-9);
    within(zone.atWell, zone.far / 2, 1e-9);
    within(zone.stagnation, zone.far / (2 * Math.PI), 1e-9);
  });

  it('solves seepage under a dam with matching inflow and outflow', () => {
    const grid = damSeepage({ k: 1e-5, H: 10, B: 20, D: 10, side: 20 });
    within(grid.headAtCenter, 5, 1e-6);
    within(grid.inflow / grid.q, 1, 0.02);
    expect(grid.uplift[0]![1]).toBeGreaterThan(grid.uplift[grid.uplift.length - 1]![1]);
    expect(grid.exitGradient).toBeGreaterThan(0);
  });
});
