// The Markov tool through the window's path: the answers it reports for the plan's cases.
import '../text';
import { describe, expect, it } from 'vitest';
import { runTool } from '../ui/read';
import { firstTexts } from '../ui/spec';
import { spec } from './spec';

const run = (texts: Record<string, string>) => {
  const r = runTool(spec, { ...firstTexts(spec), ...texts }, 'si');
  if (!r.ok) throw new Error(JSON.stringify(r));
  return Object.fromEntries(r.outcome.rows.map((row) => [row.id, row.value]));
};

describe('the Markov chains and queues tool', () => {
  it('gives the stationary distribution (5/6, 1/6)', () => {
    expect(run({ matrix: '0.9 0.1\n0.5 0.5' }).stationary).toBe('π(1) = 5/6, π(2) = 1/6');
  });

  it("reports the fair gambler's ruin: reach 10 from 3 with chance 3/10 in 21 rounds", () => {
    const rows = run({ mode: 'ruin', target: '10', start: '3', p: '1/2' });
    expect(rows.reach).toBe('3/10');
    expect(rows.ruin).toBe('7/10');
    expect(rows.duration).toBe('21');
  });

  it('reports the M/M/1 queue at ρ = 0.8: L = 4, Lq = 3.2, W = 5/μ', () => {
    const rows = run({ mode: 'queue', lambda: '8', mu: '10', servers: '1' });
    expect(rows.l).toBe('4');
    expect(rows.lq).toBe('3.2');
    expect(rows.w).toBe('0.5');
  });

  it('marks the field that is wrong', () => {
    const r = runTool(spec, { ...firstTexts(spec), mode: 'ruin', target: '10', start: '12' }, 'si');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.fields[0]).toMatchObject({ field: 'start', problem: { key: 'kitControl.errors.ruinStart' } });
    const bad = runTool(spec, { ...firstTexts(spec), matrix: '0.9 0.2\n0.5 0.5' }, 'si');
    expect(!bad.ok && bad.fields[0].problem.key).toBe('kitControl.errors.rowSumOne');
    const queue = runTool(spec, { ...firstTexts(spec), mode: 'queue', lambda: '10', mu: '10' }, 'si');
    expect(!queue.ok && queue.error?.key).toBe('kitControl.errors.queueUnstable');
  });
});
