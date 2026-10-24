// The systems tool through the window's path: the plan's answers as shown, units, and problems on their fields.
import { describe, expect, it } from 'vitest';
import { runTool } from '../ui/read';
import { firstTexts } from '../ui/spec';
import { spec } from './spec';

const run = (texts: Record<string, string>, system: 'si' | 'us' = 'si') =>
  runTool(spec, { ...firstTexts(spec), ...texts }, system);
const rows = (texts: Record<string, string>, system: 'si' | 'us' = 'si') => {
  const r = run(texts, system);
  if (!r.ok) throw new Error(JSON.stringify(r));
  return Object.fromEntries(r.outcome.rows.map((row) => [row.id, String(row.value)]));
};
const problem = (texts: Record<string, string>) => {
  const r = run(texts);
  if (r.ok) throw new Error('expected a problem');
  return r.fields.map((f) => `${f.field}: ${f.problem.key.split('.').pop()}`).join('; ') || r.error?.key;
};

describe('the systems tool', () => {
  it('reads the specifications of 4/(s² + 2s + 4)', () => {
    const r = rows({});
    expect(r.overshoot).toBe('16.3034%');
    expect(r.tPeak).toBe('1.8138 s');
    expect(r.peak).toBe('1.16303');
    expect(r.settling).toMatch(/^4\.03\d* s$/);
    expect(r.rise).toMatch(/^0\.818\d* s$/);
    expect([r.zeta, r.wn]).toEqual(['0.5', '2 rad/s']);
  });

  it('reduces unity feedback of 10/(s(s + 1)) and finds its errors', () => {
    expect(rows({ mode: 'blocks' }).tf).toBe('(10)/(s² + s + 10)');
    const e = rows({ mode: 'error', g: '10/(s (s + 1))' });
    expect([e.type, e.kv, e.errStep, e.errRamp, e.errParabola]).toEqual(['1', '10', '0', '0.1', '∞']);
  });

  it('builds a mass, spring, and damper in SI and in US units', () => {
    expect(rows({ mode: 'model', model: 'msd', mass: '2', damping: '3', stiffness: '5' }).tf).toBe(
      '(0.5)/(s² + 1.5s + 2.5)',
    );
    // 1 slug = 14.5939 kg, 1 lbf·s/ft = 14.5939 N·s/m, and 1 lbf/ft = 14.5939 N/m, so the poles do not move.
    const us = rows({ mode: 'model', model: 'msd', mass: '1', damping: '0.8', stiffness: '4' }, 'us');
    expect(us.poles).toBe(rows({ mode: 'model', model: 'msd', mass: '1', damping: '0.8', stiffness: '4' }).poles);
  });

  it('fits the built-in measured step', () => {
    const r = rows({ mode: 'identify' });
    expect(Number(r.gain)).toBeCloseTo(2, 2);
    expect(Number(r.tau.split(' ')[0])).toBeCloseTo(1.5, 1);
    expect(Number(r.theta.split(' ')[0])).toBeCloseTo(1, 1);
  });

  it('marks impossible input on its field', () => {
    expect(problem({ g: 's^2/(s + 1)' })).toBe('g: improper');
    expect(problem({ input: 'custom', u: 'sin(' })).toBe('u: inputExpr');
    expect(problem({ mode: 'model', model: 'msd', mass: '0' })).toBe('mass: paramPositiveModel');
    expect(problem({ mode: 'model', model: 'msd', damping: '-1' })).toBe('damping: paramNotNegative');
    expect(problem({ mode: 'blocks', diagram: 'series(1/(s + 1)' })).toBe('diagram: blocksSyntax');
    expect(problem({ mode: 'identify', du: '0' })).toBe('du: stepSize');
    expect(problem({ mode: 'identify', data: '0 0\n1 1' })).toBe('data: dataFew');
  });
});

describe('zeros, poles and gain, and A, B, C, D input', () => {
  it('builds 4/(s² + 2s + 4) from poles −1 ± √3 i and gain 4: overshoot 16.303%', () => {
    const r = runTool(
      spec,
      { ...firstTexts(spec), mode: 'zpk', zeros: '', poles: '-1 ± 1.7320508075688772i', gain: '4' },
      'si',
    );
    if (!r.ok) throw new Error(JSON.stringify(r));
    const row = Object.fromEntries(r.outcome.rows.map((x) => [x.id, String(x.value)]));
    expect(Math.abs(Number(row.overshoot.replace('%', '')) - 16.303)).toBeLessThan(5e-3);
    expect(r.outcome.steps[0].key).toBe('sys.fromZpk');
  });

  it('builds the same system from A = [0 1; −4 −2], B = [0; 4], C = [1 0]', () => {
    const r = runTool(spec, { ...firstTexts(spec), mode: 'abcd', a: '0 1\n-4 -2', b: '0\n4', c: '1 0', d: '' }, 'si');
    if (!r.ok) throw new Error(JSON.stringify(r));
    const row = Object.fromEntries(r.outcome.rows.map((x) => [x.id, String(x.value)]));
    expect(Math.abs(Number(row.overshoot.replace('%', '')) - 16.303)).toBeLessThan(5e-3);
    expect(r.outcome.steps[0].key).toBe('sys.fromSs');
  });

  it('rejects an unpaired complex pole and a two-input B', () => {
    const a = runTool(spec, { ...firstTexts(spec), mode: 'zpk', poles: '-1 + 2i', gain: '1' }, 'si');
    expect(a.ok).toBe(false);
    const b = runTool(spec, { ...firstTexts(spec), mode: 'abcd', a: '0 1\n-4 -2', b: '0 1\n4 0', c: '1 0' }, 'si');
    expect(b.ok).toBe(false);
  });
});
