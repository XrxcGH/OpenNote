// The pipe form end to end, checked against an independent Colebrook iteration and the closed relations between modes.
import { describe, expect, it } from 'vitest';
import { firstTexts, runTool } from '../kit/read';
import { pipesSpec } from './spec';

const solve = (texts: Record<string, string>, system: 'si' | 'us' = 'si') => {
  const run = runTool(pipesSpec, { ...firstTexts(pipesSpec), ...texts }, system);
  if (!run.ok) throw new Error(JSON.stringify(run.error?.detail ?? run.fields.map((f) => f.field)));
  return run.outcome;
};
const row = (o: ReturnType<typeof solve>, id: string) => {
  const value = o.rows.find((r) => r.id === id)?.value;
  return typeof value === 'object' ? value.v : (value as number);
};

/** Colebrook by plain fixed-point iteration on 1/sqrt(f). */
function colebrook(re: number, rel: number): number {
  let x = 7;
  for (let i = 0; i < 200; i++) x = -2 * Math.log10(rel / 3.7 + 2.51 / (re * (1 / x)));
  return 1 / (x * x);
}

describe('pipe form', () => {
  it('5 L/s through 50 mm steel pipe: head loss equals (f L/D + K) V^2 / 2g', () => {
    const o = solve({});
    const area = (Math.PI * 0.05 ** 2) / 4;
    const v = 0.005 / area;
    const re = (998 * v * 0.05) / 1e-3;
    const f = colebrook(re, 0.046e-3 / 0.05);
    const hl = (((f * 100) / 0.05 + 2) * (v * v)) / (2 * 9.80665);
    expect(row(o, 'velocity')).toBeCloseTo(v, 12);
    expect(row(o, 'reynolds')).toBeCloseTo(re, 6);
    expect(row(o, 'friction')).toBeCloseTo(f, 8);
    expect(row(o, 'headLoss')).toBeCloseTo(hl, 7);
    expect(row(o, 'pressureDrop')).toBeCloseTo(998 * 9.80665 * hl, 4);
  });
  it('the flow mode returns the flow that produces the head loss of the first mode', () => {
    const hl = row(solve({}), 'headLoss');
    const back = solve({ mode: 'flow', headLossIn: `${hl} m` });
    expect(row(back, 'flow')).toBeCloseTo(0.005, 9);
  });
  it('the diameter mode returns the diameter', () => {
    const hl = row(solve({ diameter: '65 mm' }), 'headLoss');
    const d = solve({ mode: 'diameter', headLossIn: `${hl} m` });
    expect(row(d, 'diameter')).toBeCloseTo(0.065, 8);
  });
  it('laminar flow uses f = 64/Re', () => {
    const o = solve({ viscosity: '500 mPa·s', flowRate: '0.2 L/s' });
    expect(row(o, 'friction')).toBeCloseTo(64 / row(o, 'reynolds'), 12);
  });
  it('the pump operating point is where the pump parabola meets the system curve', () => {
    const o = solve({ mode: 'pump' });
    const qOp = row(o, 'flow');
    const head = row(o, 'head');
    // The three points 0/30, 5 L/s/26, 10 L/s/18 lie on H = 30 - 400 Q - 80000 Q^2.
    expect(head).toBeCloseTo(30 - 400 * qOp - 80000 * qOp * qOp, 6);
    const sys = solve({ flowRate: `${qOp * 1000} L/s` });
    expect(8 + row(sys, 'headLoss')).toBeCloseTo(head, 5);
  });
  it('series losses add and parallel flows add', () => {
    const s = solve({ mode: 'series', flowRate: '5 L/s' });
    const a = solve({ flowRate: '5 L/s' });
    const b = solve({ diameter: '40 mm', length: '60 m', sumK: '1', flowRate: '5 L/s' });
    expect(row(s, 'headLoss')).toBeCloseTo(row(a, 'headLoss') + row(b, 'headLoss'), 9);
    const p = solve({ mode: 'parallel', flowRate: '10 L/s' });
    const flows = p.tables![0].rows.map((r) => (r[1] as { v: number }).v);
    expect(flows[0] + flows[1]).toBeCloseTo(0.01, 9);
  });
  it('the network settles with balanced loops and unchanged junction flows', () => {
    const o = solve({ mode: 'network' });
    expect(row(o, 'loopResidual')).toBeLessThan(1e-6);
    const flows = o.tables![0].rows.map((r) => (r[1] as { v: number }).v);
    expect(flows[0]).toBeCloseTo(flows[1], 9);
    expect(flows[2]).toBeCloseTo(flows[3], 9);
    expect(flows[0] + flows[2]).toBeCloseTo(0.03, 9);
  });
  it('explains impossible input', () => {
    const run = (t: Record<string, string>) => runTool(pipesSpec, { ...firstTexts(pipesSpec), ...t }, 'si');
    expect(run({ diameter: '0 mm' }).ok).toBe(false);
    expect(run({ roughness: '10 mm' }).ok).toBe(false);
    expect(run({ mode: 'flow', headLossIn: '-3 m' }).ok).toBe(false);
    expect(run({ mode: 'pump', pumpCurve: '0, 30\n5, 26' }).ok).toBe(false);
    expect(run({ mode: 'pump', staticHead: '80 m' }).ok).toBe(false);
    expect(run({ mode: 'series', pipes: '50 mm, 100 m' }).ok).toBe(false);
    expect(run({ mode: 'network', loops: '1 9' }).ok).toBe(false);
    expect(run({ diameter: '5 kg' }).ok).toBe(false);
  });
});
