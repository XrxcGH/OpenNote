// The random processes tool through the window's path: the plan's answers as shown, and problems on their fields.
import { describe, expect, it } from 'vitest';
import { runTool } from '../ui/read';
import { firstTexts } from '../ui/spec';
import { spec } from './spec';

const run = (texts: Record<string, string>) => runTool(spec, { ...firstTexts(spec), ...texts }, 'si');
const rows = (texts: Record<string, string>) => {
  const r = run(texts);
  if (!r.ok) throw new Error(JSON.stringify(r));
  return Object.fromEntries(r.outcome.rows.map((row) => [row.id, String(row.value)]));
};
const problem = (texts: Record<string, string>) => {
  const r = run(texts);
  if (r.ok) throw new Error('expected a problem');
  return r.fields.map((f) => `${f.field}: ${f.problem.key.split('.').pop()}`).join('; ') || r.error?.key;
};

describe('the random processes tool', () => {
  it('gives the stationary variance 0.25 for dX = −2X dt + dW', () => {
    const r = rows({ mode: 'sde' });
    expect(r.p).toBe('[0.25]');
    expect(r.outputVariance).toBe('0.25');
    expect(Math.abs(Number(r.sampleEnd) - 0.25)).toBeLessThan(0.05);
  });

  it('shows no steady covariance for Brownian motion, and variance t', () => {
    const r = rows({ mode: 'sde', a: '0' });
    expect(r.p).toBe('—');
    expect(r.theoryEnd).toBe('5');
  });

  it('gives the filtered-noise variance both ways', () => {
    const r = rows({ mode: 'psd' });
    expect(r.variance).toBe('0.25');
    expect(r.integrated).toBe('0.25');
  });

  it('gives the random-walk Kalman filter P⁻ = 1.61803, K = 0.618034', () => {
    const r = rows({ mode: 'kalman' });
    expect(r.prior).toBe('[1.61803]');
    expect(r.gain).toBe('[0.618034]');
    expect(r.posterior).toBe('[0.618034]');
  });

  it('marks impossible input on its field', () => {
    expect(problem({ w: '-1' })).toBe('w: notCovariance');
    expect(problem({ x0: '0, 0' })).toBe('x0: x0Length');
    expect(problem({ paths: '1' })).toBe('paths: pathsRange');
    expect(problem({ span: '0' })).toBe('span: spanPositive');
    expect(problem({ mode: 'psd', g: '(s + 1)/(s + 2)' })).toBe('g: psdProper');
    expect(problem({ mode: 'psd', s0: '-1' })).toBe('s0: intensityPositive');
    expect(problem({ mode: 'kalman', rk: '0' })).toBe('rk: rCovariance');
    expect(problem({ mode: 'kalman', p0: '1 0\n0 1' })).toBe('p0: p0Shape');
    expect(problem({ mode: 'kalman', p0: '-1' })).toBe('p0: p0Covariance');
    expect(problem({ mode: 'kalman', h: '1 0' })).toBe('h: hCols');
    expect(problem({ mode: 'kalman', samples: '1' })).toBe('samples: kalmanSamples');
  });
});
