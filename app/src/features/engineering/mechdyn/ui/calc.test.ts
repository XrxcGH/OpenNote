import { describe, expect, it } from 'vitest';
import { readCalc } from './calc';

describe('calculation block data', () => {
  it('reads what the kit saved and keeps only text inputs', () => {
    const saved = {
      kit: 'mechdyn',
      tool: 'sdof',
      inputs: { m: '10 kg', k: 7 },
      system: 'us',
      summary: 'S',
      latex: 'L',
    };
    expect(readCalc(JSON.parse(JSON.stringify(saved)))).toEqual({ ...saved, inputs: { m: '10 kg' } });
  });

  it('refuses data that is not a calculation of a known tool', () => {
    expect(readCalc(null)).toBeNull();
    expect(readCalc({ kit: 'other', tool: 'sdof', inputs: {} })).toBeNull();
    expect(readCalc({ kit: 'mechdyn', tool: 'nope', inputs: {} })).toBeNull();
    expect(readCalc({ kit: 'mechdyn', tool: 'sdof', inputs: ['10 kg'] })).toBeNull();
    // Units other than US read as SI.
    expect(readCalc({ kit: 'mechdyn', tool: 'sdof', inputs: {}, system: 'x' })?.system).toBe('si');
  });
});
