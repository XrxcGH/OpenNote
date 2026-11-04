// The master theorem answer line says the whole growth, with the power of log p, not "gains a log factor".
import { describe, expect, it } from 'vitest';
import { loadTool } from '../kit';

async function answer(values: Record<string, string>): Promise<string> {
  const spec = await loadTool('discrete');
  const outcome = spec.modes.find((mode) => mode.id === 'master')!.solve(values);
  if (!outcome.ok) throw new Error(outcome.message);
  return outcome.answer;
}

describe('the master theorem', () => {
  it('case 2 gives n^k log^(p+1) n (merge sort is n log n, and p = 2 makes it n log^3 n)', async () => {
    expect(await answer({ a: '2', b: '2', k: '1', logPower: '0' })).toContain('Θ(n log n)');
    expect(await answer({ a: '2', b: '2', k: '1', logPower: '2' })).toContain('Θ(n log^3 n)');
    expect(await answer({ a: '4', b: '2', k: '2', logPower: '1' })).toContain('Θ(n^2 log^2 n)');
  });

  it('case 3 gives f(n), with its log power', async () => {
    // a = 2, b = 2: n^(log_2 2) = n, below f(n) = n^2 log n, so the top level dominates.
    expect(await answer({ a: '2', b: '2', k: '2', logPower: '1' })).toContain('Θ(n^2 log n)');
    expect(await answer({ a: '1', b: '2', k: '1', logPower: '0' })).toContain('Θ(n)');
  });

  it('case 1 gives n^(log_b a)', async () => {
    // T(n) = 8 T(n/2) + n^2: log_2 8 = 3.
    expect(await answer({ a: '8', b: '2', k: '2', logPower: '0' })).toContain('Θ(n^3)');
  });
});
