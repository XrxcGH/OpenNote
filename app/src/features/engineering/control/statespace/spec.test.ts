// The state-space tool through the window's path: the plan's answers as the student sees them, and each impossible
// input marked on the field that holds it.
import '../text';
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

describe('the state-space tool', () => {
  it('places −2 ± 2i on the double integrator with K = [8, 4]', () => {
    const r = rows({ mode: 'place' });
    expect(r.k).toBe('[8, 4]');
    expect(r.nbar).toBe('8');
  });

  it('gives the LQR gain [1, 1.73205] and P for Q = I, R = 1', () => {
    const r = rows({ mode: 'lqr' });
    expect(r.k).toBe('[1, 1.73205]');
    expect(r.p).toBe('[1.73205, 1; 1, 1.73205]');
  });

  it('gives the observer gain L = [10; 25] for poles −5, −5', () => {
    expect(rows({ mode: 'observer' }).l).toBe('[10; 25]');
  });

  it('adds an integrator: three poles at −2 give K = [12, 6] and kᵢ = 8', () => {
    // Augmented [x₁, x₂, z]: det(sI − Aa + BaK) = s³ + k₂s² + k₁s − k₃ = (s + 2)³ = s³ + 6s² + 12s + 8.
    const r = rows({ mode: 'place', integral: 'integral', poles: '-2, -2, -2' });
    expect(r.kx).toBe('[12, 6]');
    expect(r.ki).toBe('8');
  });

  it('reports ranks, the transfer function, and the canonical form', () => {
    const r = rows({ mode: 'analyze', a: '0 1\n-4 -0.8', b: '0\n1', c: '1 0' });
    expect(r.ctrbRank).toBe('2 / 2');
    expect(r.obsvRank).toBe('2 / 2');
    expect(r.canonical).toBe('[0, 1; −4, −0.8]');
    const u = rows({ mode: 'analyze', a: '-1 0\n0 -2', b: '1\n0', c: '1 1' });
    expect(u.ctrbRank).toBe('1 / 2');
  });

  it('marks impossible input on its field', () => {
    expect(problem({ poles: '-1' })).toBe('poles: polesCount');
    expect(problem({ poles: '-1 + 2i, -3' })).toBe('poles: polesConjugate');
    expect(problem({ a: '-1 0\n0 -2', b: '1\n0', poles: '-1, -2' })).toBe('b: uncontrollable');
    expect(problem({ a: '0 1 2\n0 0' })).toBe('a: matrixRagged');
    expect(problem({ a: '0 1 2\n0 0 1' })).toBe('a: notSquare');
    expect(problem({ b: '1' })).toBe('b: bRows');
    expect(problem({ d: '1 2' })).toBe('d: dShape');
    expect(problem({ b: '0 1\n1 0' })).toBe('b: singleInput');
    expect(problem({ mode: 'observer', x0: '1' })).toBe('x0: x0Length');
    expect(problem({ mode: 'lqr', r: '0' })).toBe('r: rPositive');
    expect(problem({ mode: 'lqr', r: '-1' })).toBe('r: rPositive');
    expect(problem({ mode: 'lqr', q: '1 2\n0 1' })).toBe('q: qSymmetric');
    expect(problem({ mode: 'lqr', q: '-1 0\n0 1' })).toBe('q: qNegative');
  });

  it('handles huge and tiny scales without losing the gain', () => {
    // Scaling time by 1000 scales the gains by 1000² and 1000.
    const r = rows({ poles: '-2000 ± 2000i' });
    expect(r.k).toBe('[8e6, 4000]');
  });
});
