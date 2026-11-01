// The digital control tool through the window's path: the answers it reports for the plan's cases.
import '../text';
import { describe, expect, it } from 'vitest';
import { runTool } from '../ui/read';
import { firstTexts } from '../ui/spec';
import { spec } from './spec';

const rows = (texts: Record<string, string>) => {
  const r = runTool(spec, { ...firstTexts(spec), ...texts }, 'si');
  if (!r.ok) throw new Error(JSON.stringify(r));
  return Object.fromEntries(r.outcome.rows.map((row) => [row.id, String(row.value)]));
};

describe('the digital control tool', () => {
  it('discretizes 1/(s + 1) at T = 0.1 s: ZOH 0.095163/(z − 0.904837), Tustin 0.047619(z + 1)/(z − 0.904762)', () => {
    expect(rows({ gs: '1/(s + 1)', period: '0.1', method: 'zoh' }).hz).toBe('(0.0951626)/(z − 0.904837)');
    expect(rows({ gs: '1/(s + 1)', period: '0.1', method: 'tustin' }).hz).toBe('(0.047619z + 0.047619)/(z − 0.904762)');
  });

  it('finds z² − 1.2z + 0.5 stable with pole magnitudes 0.707107', () => {
    expect(rows({ mode: 'jury', poly: 'z^2 - 1.2z + 0.5' }).stable).toBe('✓');
    const a = rows({ mode: 'analyze', hz: '1/(z^2 - 1.2z + 0.5)' });
    expect(a.magnitudes).toBe('0.707107, 0.707107');
    expect(a.stable).toBe('✓');
  });

  it('reads a period in milliseconds and refuses a zero period', () => {
    expect(rows({ gs: '1/(s + 1)', period: '100 ms', method: 'zoh' }).hz).toBe('(0.0951626)/(z − 0.904837)');
    const bad = runTool(spec, { ...firstTexts(spec), period: '0' }, 'si');
    expect(!bad.ok && bad.fields[0]).toMatchObject({
      field: 'period',
      problem: { key: 'kitControl.errors.periodPositive' },
    });
    const unit = runTool(spec, { ...firstTexts(spec), period: '3 kg' }, 'si');
    expect(!unit.ok && unit.fields[0].problem.key).toBe('kitControl.errors.unit');
  });

  it('finds 70 Hz sampled at 100 Hz appears at 30 Hz', () => {
    expect(rows({ mode: 'alias', signal: '70', rate: '100' }).apparent).toBe('30 Hz');
  });
});
