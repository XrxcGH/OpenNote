// The unit system toggle and the first state of a tool in US units.
import { describe, expect, it } from 'vitest';
import { SPECS } from '../specs';
import { convertTexts, firstState, firstTexts, firstUnits, readFields } from './read';

describe('the first state of a tool', () => {
  it('opens with the same 50 mm cutter diameter when the kit last used US units', async () => {
    const spec = await SPECS.machining!();
    const first = firstState(spec, 'us');
    expect(first.units.d).toBe('in');
    const read = readFields(spec, first.texts, first.units);
    expect(read.ok).toBe(true);
    expect(read.values.d).toBeCloseTo(50, 9);
    // 150 m/min is 492.126 ft/min, not 150 ft/min.
    expect(read.values.v).toBeCloseTo(150, 9);
  });
  it('is the plain defaults in SI', async () => {
    const spec = await SPECS.machining!();
    expect(firstState(spec, 'si')).toEqual({ texts: firstTexts(spec), units: firstUnits(spec, 'si') });
  });
});

describe('switching units', () => {
  it('SI to US to SI returns the typed 50 mm to the 11th decimal (it was 49.9999 with six figures)', async () => {
    const spec = await SPECS.machining!();
    const si = { texts: firstTexts(spec), units: firstUnits(spec, 'si') };
    const us = convertTexts(spec, si.texts, si.units, 'us');
    const back = convertTexts(spec, us.texts, us.units, 'si');
    expect(Number(back.texts.d)).toBeCloseTo(50, 11);
    expect(Number(back.texts.v)).toBeCloseTo(150, 11);
  });
});
