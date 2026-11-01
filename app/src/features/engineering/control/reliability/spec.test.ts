// The reliability tool through the window's path: the answers it reports for the plan's cases.
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

describe('the reliability tool', () => {
  it('gives 0.729 in series, 0.99 in parallel, and 0.972 for 2 out of 3', () => {
    expect(rows({ diagram: 'series(0.9, 0.9, 0.9)', time: '' }).reliability).toBe('0.729');
    expect(rows({ diagram: 'parallel(0.9, 0.9)', time: '' }).reliability).toBe('0.99');
    expect(rows({ diagram: 'kofn(2, 0.9, 0.9, 0.9)', time: '' }).reliability).toBe('0.972');
  });

  it('gives the Weibull reliability R(500) = 0.778801 for β = 2, η = 1000 h', () => {
    expect(rows({ mode: 'life', model: 'weibull', shape: '2', scale: '1000', time: '500' }).reliability).toBe(
      '0.778801',
    );
  });

  it('gives the chart constants for n = 5', () => {
    const k = rows({ mode: 'constants', size: '5' });
    expect([k.d2, k.d3, k.A2, k.D3, k.D4, k.c4]).toEqual([
      '2.32593',
      '0.864082',
      '0.576819',
      '0',
      '2.1145',
      '0.939986',
    ]);
  });

  it('gives Cp 1.6667 and Cpk 1.3333, Pa 0.73577, EOQ 223.61, and safety stock 32.90', () => {
    const c = rows({ mode: 'capability' });
    expect([c.cp, c.cpk]).toEqual(['1.66667', '1.33333']);
    expect(rows({ mode: 'sampling', sample: '50', accept: '1', defective: '0.02' }).pa).toBe('0.735771');
    const inv = rows({ mode: 'inventory', service: '95', dailySd: '10', leadDays: '4', dailyMean: '' });
    expect(inv.eoq).toBe('223.607');
    expect(inv.safety).toBe('32.8971');
  });

  it('marks the field that is wrong', () => {
    const bad = runTool(spec, { ...firstTexts(spec), diagram: 'series(0.9, 1.2)' }, 'si');
    expect(!bad.ok && bad.fields[0]).toMatchObject({
      field: 'diagram',
      problem: { key: 'kitControl.errors.reliabilityRange' },
    });
    const order = runTool(spec, { ...firstTexts(spec), mode: 'capability', usl: '9', lsl: '10' }, 'si');
    expect(!order.ok && order.fields[0].field).toBe('usl');
  });
});
