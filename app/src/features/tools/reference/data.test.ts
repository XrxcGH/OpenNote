// The reference tables hold what they promise: 118 elements in order, the constants the calculator knows, and the
// metric prefixes and Greek letters.
import { describe, expect, it } from 'vitest';
import { cellOf, neighborOf } from './gridLayout';
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
  it('give every element its facts, with a value that is known where one is expected', () => {
    for (const element of ELEMENTS) {
      expect(element.isotopes, element.name).not.toBe('');
      if (element.number <= 100 && element.number !== 85 && element.number !== 87) {
        expect(element.melting ?? element.boiling, element.name).not.toBeNull();
      }
      if (element.density !== null) expect(element.density).toBeGreaterThan(0);
      if (element.melting !== null && element.boiling !== null)
        expect(element.boiling).toBeGreaterThan(element.melting);
    }
    expect(ELEMENTS[25]).toMatchObject({ density: 7.874, melting: 1811, boiling: 3134, electronegativity: 1.83 });
    expect(ELEMENTS[79]).toMatchObject({ symbol: 'Hg', melting: 234.32 });
    expect(ELEMENTS[79].melting).toBeLessThan(273.15);
    expect(ELEMENTS[9].electronegativity).toBeNull();
  });
  it('place each element in its own cell of the grid', () => {
    const cells = ELEMENTS.map((element) => cellOf(element));
    expect(new Set(cells.map((cell) => `${cell.row},${cell.col}`)).size).toBe(118);
    expect(cellOf(ELEMENTS[0])).toEqual({ row: 1, col: 1 });
    expect(cellOf(ELEMENTS[1])).toEqual({ row: 1, col: 18 });
    expect(cellOf(ELEMENTS[56])).toEqual({ row: 9, col: 3 });
    expect(cellOf(ELEMENTS[69])).toEqual({ row: 9, col: 16 });
    expect(cellOf(ELEMENTS[70])).toEqual({ row: 6, col: 3 });
    expect(cellOf(ELEMENTS[101])).toEqual({ row: 10, col: 16 });
  });
  it('move between shown elements with the arrow keys', () => {
    const [h, he, li] = ELEMENTS;
    expect(neighborOf(ELEMENTS, h, 'ArrowRight')).toBe(he);
    expect(neighborOf(ELEMENTS, h, 'ArrowDown')).toBe(li);
    expect(neighborOf(ELEMENTS, h, 'ArrowLeft')).toBe(h);
    expect(neighborOf(ELEMENTS, h, 'ArrowUp')).toBe(h);
    expect(neighborOf([h, ELEMENTS[10]], h, 'ArrowDown')).toBe(ELEMENTS[10]);
  });
});
