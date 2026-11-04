import { describe, expect, it } from 'vitest';
import { initialValues, switchSystem } from './spec';
import type { ToolSpec } from './spec';

const spec = {
  id: 'nozzle',
  fields: [
    { id: 'pb', kind: 'quantity', qty: 'pressure', initial: '84300' },
    { id: 'p0', kind: 'quantity', qty: 'pressure', initial: '100000' },
    { id: 'name', kind: 'text', initial: 'x' },
  ],
  run: () => ({ rows: [], steps: [] }),
} as unknown as ToolSpec;

describe('switching between SI and US customary in the aerospace window', () => {
  it('converts the pressure and says the same thing in the other system', () => {
    const us = switchSystem(spec, initialValues(spec, 'si'), 'us');
    // 100 000 Pa / 47.880259 Pa per lbf/ft2 = 2088.54 lbf/ft2.
    expect(Number(us.p0)).toBeCloseTo(2088.54, 2);
    expect(us['p0@unit']).toBe('lbf/ft²');
  });

  it('returns exactly the typed numbers when switched back (0.843 pb/p0 was 0.843002)', () => {
    const si = initialValues(spec, 'si');
    const back = switchSystem(spec, switchSystem(spec, si, 'us'), 'si');
    expect(back.pb).toBe('84300');
    expect(back.p0).toBe('100000');
    expect(Number(back.pb) / Number(back.p0)).toBe(0.843);
  });
});
