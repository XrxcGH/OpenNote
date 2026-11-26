// What a screen reader hears in Grid mode (DESIGN.md section 17). The expected sentences are the plan's.
import { describe, expect, it } from 'vitest';
import { cellAnnouncement, formulaWords, rangeAnnouncement } from './announce';

describe('cell announcements', () => {
  it('reads the address, header, value, and formula', () => {
    const said = cellAnnouncement({ address: 'C4', header: 'Total', shown: '10', formula: '=B4*2' });
    expect(said).toBe('C4, Total, 10, formula equals B4 times 2');
  });

  it('leaves out what a cell does not have', () => {
    expect(cellAnnouncement({ address: 'C4', header: 'Total', shown: '10', formula: null })).toBe('C4, Total, 10');
    expect(cellAnnouncement({ address: 'C4', header: null, shown: '', formula: null })).toBe('C4, blank');
    expect(cellAnnouncement({ address: 'C4', header: ' ', shown: '3', formula: '=1+2' })).toBe(
      'C4, 3, formula equals 1 plus 2',
    );
    expect(cellAnnouncement({ address: 'C', header: 'Total', shown: 'Total', formula: null, isHeader: true })).toBe(
      'Column C header, Total',
    );
  });

  it('reads a range', () => {
    expect(rangeAnnouncement('B2', 'C3', 4)).toBe('B2 through C3 selected, 4 cells');
  });
});

describe('formulas as words', () => {
  it('reads every operator, the longest first, and leaves quoted text alone', () => {
    expect(formulaWords('=SUM(B2:B4)/2')).toBe('equals SUM(B2 through B4) divided by 2');
    expect(formulaWords('=A1<=3')).toBe('equals A1 is less than or equal to 3');
    expect(formulaWords('=A1<>B1')).toBe('equals A1 is not equal to B1');
    expect(formulaWords('=A1&" + "&B1')).toBe('equals A1 joined with " + " joined with B1');
    expect(formulaWords('=-A1^2%')).toBe('equals minus A1 to the power of 2 percent');
  });
});
