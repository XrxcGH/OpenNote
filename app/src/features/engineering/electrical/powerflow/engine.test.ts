import { describe, expect, it } from 'vitest';
import { cAbs, cAdd, cConj, cMul, cPolar, toDegrees } from '../shared';
import { initialValues, runTool } from '../spec';
import {
  admittanceMatrix,
  dcFlow,
  economicDispatch,
  gaussSeidel,
  lineFlows,
  newtonRaphson,
  parseNetwork,
  parseUnits,
} from './engine';
import { spec } from './tool';

const close = (a: number, b: number, rel: number) => expect(Math.abs(a - b)).toBeLessThanOrEqual(rel * Math.abs(b));

const TWO = 'slack 1 1.0 0\nline 1 2 0 0.1\nload 2 1.0 0.5';
const THREE = [
  'slack 1 1.02 0',
  'gen 2 0.4 1.01',
  'line 1 2 0.02 0.08 0.02',
  'line 1 3 0.01 0.05',
  'line 2 3 0.015 0.06',
  'load 2 0.2 0.1',
  'load 3 0.8 0.3',
].join('\n');

describe('reading the network', () => {
  it('builds the buses and types them', () => {
    const net = parseNetwork(THREE);
    expect(net.buses.map((b) => b.type)).toEqual(['slack', 'pv', 'pq']);
    expect(net.lines).toHaveLength(3);
    expect(net.buses[2]!.pl).toBeCloseTo(0.8, 12);
  });
  it('names the line of a mistake', () => {
    expect(() => parseNetwork('slack 1 1.0\nline 1 2 0 x')).toThrow(/pfNumber|key/);
    try {
      parseNetwork('slack 1 1.0\nline 1 2 0 x');
    } catch (error) {
      expect((error as { vars: Record<string, string> }).vars.line).toBe('2');
    }
    expect(() => parseNetwork('line 1 2 0 0.1')).toThrow();
    expect(() => parseNetwork('slack 1 1\nslack 2 1\nline 1 2 0 0.1')).toThrow();
    expect(() => parseNetwork('slack 1 1\nline 1 1 0 0.1')).toThrow();
    expect(() => parseNetwork('slack 1 1\nbogus 1')).toThrow();
    expect(() => parseNetwork('slack 1 1\nline 1 2 0 0')).toThrow();
  });
  it('the admittance matrix of one line is the 2 by 2 matrix of 1/z', () => {
    const y = admittanceMatrix(parseNetwork(TWO));
    expect(y[0]![0]!.im).toBeCloseTo(-10, 12);
    expect(y[0]![1]!.im).toBeCloseTo(10, 12);
    expect(y[1]![0]!.im).toBeCloseTo(10, 12);
  });
});

describe('Newton-Raphson load flow', () => {
  it('slack 1.0 pu, line j0.1, load 1 + j0.5: |V2| = 0.94122 and -6.0989 degrees', () => {
    const r = newtonRaphson(parseNetwork(TWO));
    close(r.v[1]!, 0.94122, 1e-4);
    close(toDegrees(r.theta[1]!), -6.0989, 1e-4);
    // The closed-form answer: V2 sin(theta) = -P X and V2^2 - V2 cos(theta) = Q X.
    const a = (1 + Math.sqrt(1 - 4 * 0.06)) / 2;
    close(r.v[1]!, Math.hypot(a, 0.1), 1e-10);
    close(toDegrees(r.theta[1]!), -toDegrees(Math.atan2(0.1, a)), 1e-9);
    expect(r.iterations).toBeLessThan(8);
  });
  it('the powers at every bus agree with S = V conj(Y V), written separately', () => {
    const net = parseNetwork(THREE);
    const r = newtonRaphson(net);
    const y = admittanceMatrix(net);
    const volt = r.v.map((m, i) => cPolar(m, r.theta[i]!));
    for (let i = 0; i < 3; i++) {
      let sum = { re: 0, im: 0 };
      for (let k = 0; k < 3; k++) sum = cAdd(sum, cMul(y[i]![k]!, volt[k]!));
      const s = cMul(volt[i]!, cConj(sum));
      close(s.re + 1, r.p[i]! + 1, 1e-9);
      close(s.im + 1, r.q[i]! + 1, 1e-9);
    }
    // The PV bus keeps its voltage and the loads are met.
    close(r.v[1]!, 1.01, 1e-12);
    close(r.p[2]!, -0.8, 1e-8);
    close(r.q[2]!, -0.3, 1e-8);
    close(r.p[1]!, 0.4 - 0.2, 1e-8);
  });
  it('the line losses add up to the power injected at all buses', () => {
    const net = parseNetwork(THREE);
    const r = newtonRaphson(net);
    const flows = lineFlows(net, r);
    const loss = flows.reduce((s, f) => s + f.loss.re, 0);
    close(
      loss,
      r.p.reduce((s, x) => s + x, 0),
      1e-8,
    );
    expect(loss).toBeGreaterThan(0);
    for (const f of flows) expect(cAbs(f.sFrom)).toBeGreaterThan(0);
  });
  it('Gauss-Seidel finds the same answer', () => {
    const net = parseNetwork(THREE);
    const a = newtonRaphson(net);
    const b = gaussSeidel(net);
    a.v.forEach((v, i) => {
      close(b.v[i]!, v, 1e-6);
      expect(Math.abs(b.theta[i]! - a.theta[i]!)).toBeLessThan(1e-6);
    });
    expect(b.iterations).toBeGreaterThan(a.iterations);
  });
  it('refuses a bus with no line to it, a load far past the limit, and a missing line set', () => {
    expect(() => newtonRaphson(parseNetwork('slack 1 1\nline 1 2 0 0.1\nload 3 1 0.1\nload 2 0.1 0'))).toThrow();
    expect(() => newtonRaphson(parseNetwork('slack 1 1.0 0\nline 1 2 0 0.1\nload 2 20 10'))).toThrow();
  });
});

describe('DC power flow', () => {
  it('a symmetrical triangle sends two-thirds directly and one-third the long way', () => {
    const net = parseNetwork('slack 1 1\nline 1 2 0 0.1\nline 1 3 0 0.1\nline 2 3 0 0.1\nload 3 0.6 0');
    const d = dcFlow(net);
    close(d.flows[1]!, 0.4, 1e-12);
    close(d.flows[0]!, 0.2, 1e-12);
    close(d.flows[2]!, 0.2, 1e-12);
    close(d.slackPower, 0.6, 1e-12);
    close(d.theta[2]!, -0.04, 1e-12);
  });
});

describe('economic dispatch', () => {
  const units = parseUnits('unit 0.004 5 0 0 400\nunit 0.006 4 0 0 400');
  it('C1 = 0.004P^2 + 5P, C2 = 0.006P^2 + 4P, 500 MW: 250 and 250 at 7 per MWh', () => {
    const d = economicDispatch(units, 500);
    close(d.p[0]!, 250, 1e-9);
    close(d.p[1]!, 250, 1e-9);
    close(d.lambda, 7, 1e-9);
    close(d.cost, 0.004 * 62500 + 1250 + 0.006 * 62500 + 1000, 1e-12);
  });
  it('equal incremental cost holds for units off their limits', () => {
    const d = economicDispatch(units, 321);
    close(2 * 0.004 * d.p[0]! + 5, 2 * 0.006 * d.p[1]! + 4, 1e-8);
    close(d.p[0]! + d.p[1]!, 321, 1e-9);
  });
  it('holds a unit at its limit and raises lambda for the rest', () => {
    const limited = parseUnits('unit 0.004 5 0 0 400\nunit 0.006 4 0 0 200');
    const d = economicDispatch(limited, 500);
    close(d.p[1]!, 200, 1e-9);
    close(d.p[0]!, 300, 1e-9);
    expect(d.limit).toEqual([null, 'max']);
    close(d.lambda, 2 * 0.004 * 300 + 5, 1e-9);
  });
  it('a flat-cost unit takes the remainder', () => {
    const flat = parseUnits('unit 0.004 5 0 0 400\nunit 0 7 0 0 400');
    const d = economicDispatch(flat, 500);
    close(d.p[0]! + d.p[1]!, 500, 1e-9);
    close(d.lambda, 7, 1e-6);
  });
  it('refuses a demand the units cannot meet, a concave cost, and bad limits', () => {
    expect(() => economicDispatch(units, 900)).toThrow();
    expect(() => economicDispatch(units, -1)).toThrow();
    expect(() => parseUnits('unit -0.1 5 0 0 400')).toThrow();
    expect(() => parseUnits('unit 0.1 5 0 100 50')).toThrow();
    expect(() => parseUnits('')).toThrow();
  });
});

describe('the power flow tool form', () => {
  it('answers each calculation and names a problem', () => {
    const base = initialValues(spec);
    for (const mode of ['newton', 'gauss', 'dc', 'dispatch'])
      expect(runTool(spec, { ...base, mode }).ok, mode).toBe(true);
    expect(runTool(spec, { ...base, mode: 'newton', network: 'slack 1 1\nline 1 2 0 x' }).ok).toBe(false);
    expect(runTool(spec, { ...base, mode: 'dispatch', demand: '99999' }).ok).toBe(false);
  });
});
