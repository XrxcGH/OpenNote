import { describe, expect, it } from 'vitest';
import { CalcError } from '../numeric';
import {
  colebrook,
  diameterFromFlow,
  evalPoly,
  flowFromHeadLoss,
  friction,
  hardyCross,
  haaland,
  headLossFromFlow,
  operatingPoint,
  parallelSplit,
  pipeSystemCurve,
  seriesLoss,
  swameeJain,
} from './engine';

const rel = (a: number, b: number) => Math.abs(a - b) / Math.abs(b);
const water = { density: 1000, viscosity: 1.004e-3 };
const pipe = { diameter: 0.1, length: 100, roughness: 4.5e-5, sumK: 0 };

// independent Colebrook by fixed-point iteration on 1/sqrt(f)
function colebrookFixed(re: number, rr: number): number {
  let x = 7;
  for (let i = 0; i < 200; i++) x = -2 * Math.log10(rr / 3.7 + (2.51 * x) / re);
  return 1 / (x * x);
}

describe('friction factor', () => {
  it('Colebrook at Re 1e5, e/D 0.0002 with Haaland and Swamee-Jain for comparison', () => {
    expect(Math.abs(colebrook(1e5, 2e-4) - 0.019005)).toBeLessThan(1e-5);
    expect(Math.abs(haaland(1e5, 2e-4) - 0.018735)).toBeLessThan(1e-5);
    expect(Math.abs(swameeJain(1e5, 2e-4) - 0.018995)).toBeLessThan(1e-5);
  });
  it('matches the fixed-point solution across the Moody chart', () => {
    for (const re of [4e3, 2e4, 1e5, 1e6, 1e7, 1e8])
      for (const rr of [0, 1e-5, 1e-3, 0.01, 0.05])
        expect(rel(colebrook(re, rr), colebrookFixed(re, rr))).toBeLessThan(1e-9);
  });
  it('laminar flow uses 64/Re and flags the transitional band', () => {
    expect(friction(1000, 0.01)).toMatchObject({ f: 0.064, regime: 'laminar' });
    expect(friction(3000, 0.001).regime).toBe('transitional');
    expect(friction(1e5, 0.001).regime).toBe('turbulent');
  });
  it('rejects nonsense', () => {
    expect(() => friction(0, 0)).toThrow(CalcError);
    expect(() => friction(1e5, -1)).toThrow(CalcError);
    expect(() => colebrook(1e5, 0.2)).toThrow(CalcError);
  });
});

describe('the three pipe problems', () => {
  it('type 1: Q = 0.01 m3/s in a 100 m long pipe', () => {
    const r = headLossFromFlow(water, pipe, 0.01, 9.81);
    expect(rel(r.velocity, 1.2732)).toBeLessThan(1e-4);
    expect(rel(r.re, 126817)).toBeLessThan(1e-4);
    expect(rel(r.f, 0.019511)).toBeLessThan(1e-4);
    expect(rel(r.headLoss, 1.6122)).toBeLessThan(1e-4);
    expect(rel(r.pressureDrop, 15820)).toBeLessThan(3e-4);
    // independent evaluation of the Darcy-Weisbach equation
    const V = 0.01 / (Math.PI * 0.05 ** 2);
    const f = colebrookFixed((1000 * V * 0.1) / 1.004e-3, 4.5e-4);
    expect(rel(r.headLoss, (f * 100 * V * V) / (0.1 * 2 * 9.81))).toBeLessThan(1e-9);
  });
  it('type 2: find Q for 5 m of head loss', () => {
    const r = flowFromHeadLoss(water, pipe, 5, 9.81);
    expect(rel(r.q, 0.018176)).toBeLessThan(1e-4);
    expect(rel(r.velocity, 2.3143)).toBeLessThan(1e-4);
    expect(rel(headLossFromFlow(water, pipe, r.q, 9.81).headLoss, 5)).toBeLessThan(1e-9);
  });
  it('type 3: find D for Q = 0.01 and 3 m of head loss', () => {
    const r = diameterFromFlow(water, { length: 100, roughness: 4.5e-5, sumK: 0 }, 0.01, 3, 9.81);
    expect(rel(r.diameter, 0.088313)).toBeLessThan(1e-4);
  });
  it('minor losses add K V^2/2g', () => {
    const a = headLossFromFlow(water, pipe, 0.01, 9.81);
    const b = headLossFromFlow(water, { ...pipe, sumK: 4.5 }, 0.01, 9.81);
    expect(b.headLoss - a.headLoss).toBeCloseTo((4.5 * a.velocity ** 2) / (2 * 9.81), 12);
  });
  it('laminar oil follows Hagen-Poiseuille', () => {
    const oil = { density: 900, viscosity: 0.2 };
    const p = { diameter: 0.02, length: 10, roughness: 0, sumK: 0 };
    const r = headLossFromFlow(oil, p, 1e-4, 9.81);
    expect(r.regime).toBe('laminar');
    expect(rel(r.pressureDrop, (128 * 0.2 * 10 * 1e-4) / (Math.PI * 0.02 ** 4))).toBeLessThan(1e-9);
  });
  it('zero flow gives zero loss, and impossible inputs fail clearly', () => {
    expect(headLossFromFlow(water, pipe, 0).headLoss).toBe(0);
    expect(() => headLossFromFlow(water, pipe, -1)).toThrow(CalcError);
    expect(() => headLossFromFlow(water, { ...pipe, diameter: 0 }, 1)).toThrow(CalcError);
    expect(() => headLossFromFlow({ density: 1000, viscosity: 0 }, pipe, 1)).toThrow(CalcError);
    expect(() => flowFromHeadLoss(water, pipe, 0)).toThrow(CalcError);
    expect(() => diameterFromFlow(water, { length: 1e6, roughness: 0, sumK: 0 }, 100, 0.001)).toThrow(CalcError);
    expect(() => headLossFromFlow(water, { ...pipe, roughness: 0.02 }, 0.01)).toThrow(/tenth/);
  });
  it('a very large flow stays finite', () => {
    const r = headLossFromFlow(water, pipe, 1e3);
    expect(Number.isFinite(r.headLoss)).toBe(true);
  });
});

describe('pumps and networks', () => {
  it('pump H = 50 - 2000 Q^2 against system 10 + 8000 Q^2', () => {
    const r = operatingPoint(
      (q) => evalPoly([50, 0, -2000], q),
      (q) => evalPoly([10, 0, 8000], q),
      1,
    );
    expect(rel(r.q, Math.sqrt(0.004))).toBeLessThan(1e-12);
    expect(rel(r.q, 0.063246)).toBeLessThan(1e-5);
    expect(rel(r.head, 42)).toBeLessThan(1e-6);
  });
  it('pump against a real pipe system satisfies both curves', () => {
    const sys = pipeSystemCurve(water, pipe, 5, 9.81);
    const pump = (q: number) => 40 - 3000 * q * q;
    const r = operatingPoint(pump, sys, 0.1);
    expect(Math.abs(pump(r.q) - sys(r.q))).toBeLessThan(1e-9);
  });
  it('a pump too weak for the static head and a search limit that is too small', () => {
    expect(() =>
      operatingPoint(
        () => 5,
        () => 10,
        1,
      ),
    ).toThrow(/cannot lift/);
    expect(() =>
      operatingPoint(
        (q) => 50 - q,
        () => 10,
        1,
      ),
    ).toThrow(CalcError);
  });
  it('series pipes add and parallel pipes share the head loss', () => {
    const s = seriesLoss(water, [pipe, { ...pipe, diameter: 0.15 }], 0.02, 9.81);
    expect(s.headLoss).toBeCloseTo(s.parts[0]!.headLoss + s.parts[1]!.headLoss, 12);
    const par = parallelSplit(water, [pipe, { ...pipe, diameter: 0.15, length: 200 }], 0.05, 9.81);
    expect(par.flows[0]! + par.flows[1]!).toBeCloseTo(0.05, 9);
    expect(par.parts[0]!.headLoss).toBeCloseTo(par.parts[1]!.headLoss, 8);
    expect(() => parallelSplit(water, [pipe], 1)).toThrow(CalcError);
  });
  it('Hardy Cross on two parallel branches agrees with the direct parallel split', () => {
    const branches = [pipe, { ...pipe, diameter: 0.15, length: 200 }];
    const direct = parallelSplit(water, branches, 0.05, 9.81);
    const hc = hardyCross({
      fluid: water,
      pipes: branches,
      loops: [
        [
          { pipe: 0, sign: 1 },
          { pipe: 1, sign: -1 },
        ],
      ],
      flows: [0.03, 0.02],
      g: 9.81,
      tol: 1e-12,
    });
    expect(rel(hc.flows[0]!, direct.flows[0]!)).toBeLessThan(1e-6);
    expect(rel(hc.flows[1]!, direct.flows[1]!)).toBeLessThan(1e-6);
    expect(Math.abs(hc.loopResidual[0]!)).toBeLessThan(1e-6);
  });
  it('Hardy Cross rejects bad setups', () => {
    expect(() => hardyCross({ fluid: water, pipes: [pipe], loops: [], flows: [1] })).toThrow(CalcError);
    expect(() => hardyCross({ fluid: water, pipes: [pipe], loops: [[{ pipe: 0, sign: 1 }]], flows: [] })).toThrow(
      CalcError,
    );
  });
});

describe('targets inside the laminar-to-turbulent jump (Re 2300)', () => {
  // water, smooth pipe D 20 mm, L 10 m: hand-written head loss on each side of Re = 2300
  const thin = { diameter: 0.02, length: 10, roughness: 0, sumK: 0 };
  const vAt = (re: number, d: number) => (re * water.viscosity) / (water.density * d);
  const headAt = (f: number, v: number, d = thin.diameter) => (f * thin.length * v * v) / (d * 2 * 9.80665);
  const below = headAt(64 / 2300, vAt(2300, thin.diameter));
  const above = headAt(colebrookFixed(2300, 0), vAt(2300, thin.diameter));
  const middle = (below + above) / 2;

  it('the jump is real: the head loss rises by more than a quarter across Re 2300', () => {
    expect(above / below).toBeGreaterThan(1.25);
  });
  it('flow from head loss refuses a target in the jump instead of returning a flow that misses it', () => {
    expect(() => flowFromHeadLoss(water, thin, middle)).toThrow(/jump/);
  });
  it('flow from head loss still solves targets on each side to 1e-6, with the head loss reproduced', () => {
    for (const target of [below * 0.9, above * 1.1]) {
      const s = flowFromHeadLoss(water, thin, target);
      expect(rel(headAt(s.f, s.velocity), target)).toBeLessThan(1e-6);
      expect(rel(s.headLoss, target)).toBeLessThan(1e-6);
    }
  });
  it('diameter from flow refuses a target in the jump', () => {
    const q = 1e-4;
    const dStar = (4 * water.density * q) / (Math.PI * water.viscosity * 2300);
    const pipeD = { length: 10, roughness: 0, sumK: 0 };
    const lo = headAt(64 / 2300, vAt(2300, dStar), dStar);
    const hi = headAt(colebrookFixed(2300, 0), vAt(2300, dStar), dStar);
    // a larger diameter has lower Re, so lower Re (laminar) belongs to the larger diameter and the smaller head loss
    expect(() => diameterFromFlow(water, pipeD, q, (lo + hi) / 2).diameter).toThrow(/jump/);
    const ok = diameterFromFlow(water, pipeD, q, hi * 1.2);
    expect(rel(ok.headLoss, hi * 1.2)).toBeLessThan(1e-6);
  });
  it('the pump operating point refuses a crossing inside the jump', () => {
    expect(() => operatingPoint(() => middle, pipeSystemCurve(water, thin, 0), 1e-3)).toThrow(/jump/);
  });
  it('parallel branches refuse a split that lands in the jump', () => {
    const qStar = (Math.PI * thin.diameter ** 2 * vAt(2300, thin.diameter)) / 4;
    expect(() => parallelSplit(water, [thin, thin], 2 * qStar)).toThrow(/jump/);
  });
});
