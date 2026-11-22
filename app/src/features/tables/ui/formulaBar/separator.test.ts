// The formula bar in a region whose argument separator is ";" (where the decimal mark is a comma).
import { describe, expect, it, vi } from 'vitest';
import { EN_US } from '../../engine/locale';
import { hintAt } from './complete';
import { callArgs } from './explain';
import { canPick, cycleAnchor } from './refs';

vi.mock('../../smart/locale', () => ({ appLocale: () => ({ ...EN_US, decimal: ',', group: '.', list: ';' }) }));

describe('the formula bar with ";" between arguments', () => {
  it('moves the argument hint past ";"', () => {
    const text = '=VLOOKUP(9;';
    expect(hintAt(text, text.length)).toMatchObject({ name: 'VLOOKUP', arg: 1 });
  });

  it('picks a reference after ";" and cycles its dollar signs', () => {
    expect(canPick('=SUM(A1;', 8)).toBe(true);
    expect(cycleAnchor('=SUM(1;B2)', 8)?.text).toBe('=SUM(1;$B$2)');
  });

  it('splits a call into its arguments at ";", not at a decimal comma', () => {
    expect(callArgs('VLOOKUP(1,5; A1:B3; 2)', 0, 22)).toEqual(['1,5', 'A1:B3', '2']);
  });
});
