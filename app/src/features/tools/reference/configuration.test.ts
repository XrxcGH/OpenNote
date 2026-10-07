// Electron configurations follow the Madelung rule, the known exceptions are corrected, and every configuration
// adds up to the element's number of electrons. Groups and periods follow the table's layout.
import { describe, expect, it } from 'vitest';
import { configurationOf, groupNumberOf, periodOf } from './configuration';
import { ELEMENTS } from './data';

const CORES: Record<string, number> = { He: 2, Ne: 10, Ar: 18, Kr: 36, Xe: 54, Rn: 86 };
const SUPERSCRIPT = '⁰¹²³⁴⁵⁶⁷⁸⁹';

/** The electrons a written configuration holds: the core's, plus every superscript count. */
function electronsIn(configuration: string): number {
  let total = 0;
  for (const part of configuration.split(' ')) {
    const core = /^\[(\w+)\]$/.exec(part);
    if (core) total += CORES[core[1]];
    else total += Number([...part.replace(/^\d[spdf]/, '')].map((digit) => SUPERSCRIPT.indexOf(digit)).join(''));
  }
  return total;
}

describe('electron configurations', () => {
  it('write the common elements the textbook way', () => {
    expect(configurationOf(1)).toBe('1s¹');
    expect(configurationOf(2)).toBe('1s²');
    expect(configurationOf(3)).toBe('[He] 2s¹');
    expect(configurationOf(10)).toBe('[He] 2s² 2p⁶');
    expect(configurationOf(26)).toBe('[Ar] 3d⁶ 4s²');
    expect(configurationOf(32)).toBe('[Ar] 3d¹⁰ 4s² 4p²');
    expect(configurationOf(36)).toBe('[Ar] 3d¹⁰ 4s² 4p⁶');
    expect(configurationOf(37)).toBe('[Kr] 5s¹');
  });

  it('correct the ground states that break the filling order', () => {
    expect(configurationOf(24)).toBe('[Ar] 3d⁵ 4s¹');
    expect(configurationOf(29)).toBe('[Ar] 3d¹⁰ 4s¹');
    expect(configurationOf(46)).toBe('[Kr] 4d¹⁰');
    expect(configurationOf(57)).toBe('[Xe] 5d¹ 6s²');
    expect(configurationOf(58)).toBe('[Xe] 4f¹ 5d¹ 6s²');
    expect(configurationOf(64)).toBe('[Xe] 4f⁷ 5d¹ 6s²');
    expect(configurationOf(79)).toBe('[Xe] 4f¹⁴ 5d¹⁰ 6s¹');
    expect(configurationOf(92)).toBe('[Rn] 5f³ 6d¹ 7s²');
    expect(configurationOf(103)).toBe('[Rn] 5f¹⁴ 7s² 7p¹');
    expect(configurationOf(118)).toBe('[Rn] 5f¹⁴ 6d¹⁰ 7s² 7p⁶');
  });

  it('hold exactly as many electrons as the element has', () => {
    for (const element of ELEMENTS) {
      expect(electronsIn(element.configuration), element.symbol).toBe(element.number);
    }
  });
});

describe('groups and periods', () => {
  it('number the columns and rows of the table', () => {
    expect([1, 2, 3, 5, 10, 11, 13, 18].map(groupNumberOf)).toEqual([1, 18, 1, 13, 18, 1, 13, 18]);
    expect([19, 26, 30, 31, 36, 37, 54].map(groupNumberOf)).toEqual([1, 8, 12, 13, 18, 1, 18]);
    expect([55, 56, 71, 72, 79, 86].map(groupNumberOf)).toEqual([1, 2, 3, 4, 11, 18]);
    expect([87, 88, 103, 104, 118].map(groupNumberOf)).toEqual([1, 2, 3, 4, 18]);
    expect([periodOf(1), periodOf(2), periodOf(3), periodOf(18), periodOf(55), periodOf(118)]).toEqual([
      1, 1, 2, 3, 6, 7,
    ]);
  });

  it('leave the f-block between the groups with no number', () => {
    for (const number of [57, 60, 70, 89, 95, 102]) expect(groupNumberOf(number), String(number)).toBeNull();
  });

  it('give every element a period and, except the f-block, a group in each period', () => {
    for (const element of ELEMENTS) {
      expect(element.period).toBeGreaterThanOrEqual(1);
      if (element.groupNumber !== null) expect(element.groupNumber).toBeLessThanOrEqual(18);
    }
    expect(ELEMENTS[25]).toMatchObject({ symbol: 'Fe', period: 4, groupNumber: 8, configuration: '[Ar] 3d⁶ 4s²' });
  });
});
