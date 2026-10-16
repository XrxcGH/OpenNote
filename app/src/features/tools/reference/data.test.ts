// The reference tables hold what they promise: 118 elements in order, the constants the calculator knows, and the
// metric prefixes and Greek letters.
import { describe, expect, it } from 'vitest';
import { ELEMENTS, GREEK, PHYSICAL_CONSTANTS, PREFIXES, groupOf, matches } from './data';

describe('the reference tables', () => {
  it('list 118 elements in order with a family each', () => {
    expect(ELEMENTS).toHaveLength(118);
    ELEMENTS.forEach((element, index) => {
      expect(element.number).toBe(index + 1);
      expect(element.mass).toBeGreaterThan(0);
    });
    expect(ELEMENTS[25]).toMatchObject({ symbol: 'Fe', name: 'Iron', group: 'transition' });
    expect(groupOf(2)).toBe('noble');
    expect(groupOf(57)).toBe('lanthanide');
    expect(groupOf(92)).toBe('actinide');
    expect(groupOf(11)).toBe('alkali');
  });
  it('name the physical constants', () => {
    const light = PHYSICAL_CONSTANTS.find((constant) => constant.symbol === 'c');
    expect(light).toMatchObject({ value: 299792458, unit: 'm/s' });
    expect(PHYSICAL_CONSTANTS.length).toBeGreaterThan(10);
  });
  it('cover the metric prefixes and the Greek alphabet', () => {
    expect(PREFIXES.find((prefix) => prefix.symbol === 'k')?.power).toBe(3);
    expect(PREFIXES.find((prefix) => prefix.symbol === 'µ')?.power).toBe(-6);
    expect(GREEK).toHaveLength(24);
  });
  it('search by every word', () => {
    expect(matches('Iron Fe 26', 'fe iron')).toBe(true);
    expect(matches('Iron Fe 26', 'gold')).toBe(false);
  });
});
