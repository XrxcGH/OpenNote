import { describe, expect, it } from 'vitest';
import { CivilError } from '../core/types';
import {
  averageEndArea,
  bottleneck,
  capacity,
  gravity,
  horizontalCurve,
  leveling,
  logit,
  massDiagram,
  minRadius,
  misclosure,
  mmc,
  polygonArea,
  prismoidal,
  readMatrix,
  shockwave,
  site,
  speedAt,
  stoppingSight,
  transit,
  traverse,
  verticalCurve,
  webster,
  websterDelay,
} from './engine';

const within = (actual: number, expected: number, tol: number) =>
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tol);
const key = (run: () => unknown): string => {
  try {
    run();
  } catch (error) {
    if (error instanceof CivilError) return error.key;
    throw error;
  }
  throw new Error('expected a CivilError');
};

describe('traffic', () => {
  it('gives the plan Greenshields capacity and shockwave', () => {
    const c = capacity('greenshields', 100, 150);
    within(c.q, 3750, 1e-9);
    within(c.k, 75, 1e-12);
    within(shockwave(1500, 20, 2000, 80), 8.33333, 1e-5);
  });

  it('puts the other models at their capacity peaks', () => {
    for (const model of ['greenberg', 'underwood'] as const) {
      const c = capacity(model, 60, 120);
      const q = (k: number) => k * speedAt(model, 60, 120, k);
      within(q(c.k), c.q, 1e-9);
      expect(q(c.k * 1.01)).toBeLessThan(c.q);
      expect(q(c.k * 0.99)).toBeLessThan(c.q);
    }
  });

  it('gives a bottleneck queue by hand', () => {
    // 1800 veh/h arrive; an incident drops 3600 to 1200 for 0.5 h.
    const b = bottleneck(1800, 3600, 1200, 0.5);
    within(b.queueMax, 300, 1e-9);
    within(b.clear, 0.5 + 300 / 1800, 1e-12);
    within(b.delay, (300 * (0.5 + 1 / 6)) / 2, 1e-9);
  });

  it('gives M/M/1 and M/M/c by the closed forms', () => {
    const one = mmc(8, 10, 1);
    within(one.Lq, 0.8 ** 2 / 0.2, 1e-12);
    within(one.W, 1 / (10 - 8), 1e-12);
    const two = mmc(15, 10, 2);
    // Erlang C for a = 1.5, c = 2: P0 = 1/7, P(wait) = 9/14.
    within(two.P0, 1 / 7, 1e-12);
    within(two.Pwait, 9 / 14, 1e-12);
    expect(key(() => mmc(12, 10, 1))).toBe('transport.errors.overCapacity');
  });
});

describe('signals and geometry', () => {
  it('gives the plan Webster cycle', () => {
    within(webster([0.3, 0.3], 12).C, 57.5, 1e-9);
    const d = websterDelay(600, 1800, 25, 60);
    // g/C = 0.4167 and x = 0.8: uniform 60 x 0.5833^2 / (2 x 0.6667) = 15.31 s,
    // random 0.64 / (2 x 0.1667 x 0.2) = 9.60 s, total 0.9 x 24.91 = 22.42 s.
    within(d.uniform, 15.31, 0.01);
    within(d.random, 9.6, 0.01);
    within(d.total, 22.42, 0.01);
    expect(key(() => webster([0.5, 0.6], 12))).toBe('transport.errors.oversaturated');
  });

  it('gives the plan sight distance, radius, and crest curve', () => {
    within(stoppingSight(100, 2.5, 3.4), 184.206, 1e-3);
    within(minRadius(100, 0.08, 0.12), 393.701, 1e-3);
    within(verticalCurve('crest', 4, 184.206, 1.08, 0.6).L, 206.274, 1e-3);
  });

  it('gives curve elements that close', () => {
    const c = horizontalCurve(300, 40, 1500);
    within(c.PT - c.PC, c.L, 1e-12);
    within(c.LC, 2 * c.T * Math.cos((20 * Math.PI) / 180), 1e-9);
  });
});

describe('demand', () => {
  it('gives the plan logit shares', () => {
    const p = logit([-1, -1.5, -2.5]);
    within(p[0]!, 0.546549, 1e-6);
    within(p[1]!, 0.331499, 1e-6);
    within(p[2]!, 0.121952, 1e-6);
  });

  it('balances a gravity model to its productions and attractions', () => {
    const r = gravity([100, 200, 300], [300, 200, 100], readMatrix('5 10 15; 10 5 10; 15 10 5'), 2);
    r.T.forEach((row, i) =>
      within(
        row.reduce((s, v) => s + v, 0),
        [100, 200, 300][i]!,
        1e-6,
      ),
    );
    [300, 200, 100].forEach((a, j) =>
      within(
        r.T.reduce((s, row) => s + row[j]!, 0),
        a,
        1e-6,
      ),
    );
    expect(key(() => readMatrix('1 2; 3'))).toBe('transport.errors.matrix');
  });

  it('sizes a transit fleet', () => {
    expect(transit(90, 10, 60).fleet).toBe(9);
    expect(transit(95, 10, 60).fleet).toBe(10);
  });
});

describe('surveying and earthwork', () => {
  it('gives the plan misclosure and precision', () => {
    const m = misclosure(0.12, -0.09, 1000);
    within(m.linear, 0.15, 1e-12);
    within(m.precision, 6666.67, 0.01);
  });

  it('closes a square traverse and gives its area', () => {
    const t = traverse([
      { length: 100.05, azimuth: 0 },
      { length: 100, azimuth: 90 },
      { length: 100, azimuth: 180 },
      { length: 100, azimuth: 270 },
    ]);
    within(t.linear, 0.05, 1e-9);
    // About a trapezoid with north sides of 100.0375 and 100.0125 m, 100 m apart; the east-west legs also take a
    // 0.0125 m share of the latitude correction, which shifts the area by well under 0.001 m².
    within(t.area, (100 * (100.0375 + 100.0125)) / 2, 1e-3);
    within(
      polygonArea([
        [0, 0],
        [4, 0],
        [4, 3],
      ]),
      6,
      1e-12,
    );
  });

  it('spreads a leveling misclosure', () => {
    const l = leveling(
      [
        [1.5, 0.5],
        [1.2, 2.21],
      ],
      100,
      100,
    );
    within(l.misclose, -0.01, 1e-12);
    within(l.adjusted[1]!, 100, 1e-12);
  });

  it('gives the plan volumes and floor-area ratio', () => {
    within(averageEndArea(20, 30, 50), 1250, 1e-12);
    within(prismoidal(20, 24.5, 30, 50), 1233.33, 0.01);
    const s = site({
      lot: 10000,
      floor: 30000,
      footprint: 5000,
      units: 0,
      parking: 0,
      width: 50,
      depth: 200,
      front: 5,
      side: 3,
      rear: 5,
      height: 20,
      street: 20,
    });
    within(s.FAR, 3, 1e-12);
  });

  it('builds a mass diagram with shrinkage', () => {
    const m = massDiagram(
      [
        [0, 10],
        [20, 10],
        [40, -10],
      ],
      0.9,
    );
    within(m.points[1]![1], 200, 1e-12);
    within(m.net, 200, 1e-12);
  });
});
