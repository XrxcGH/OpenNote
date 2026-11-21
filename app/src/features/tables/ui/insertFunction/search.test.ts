import { describe, expect, it } from 'vitest';
import { insertCall, searchFunctions } from './search';

describe('Insert function', () => {
  it('finds functions by name first, then by the words of their description', () => {
    const byName = searchFunctions('vlook').map((f) => f.name);
    expect(byName[0]).toBe('VLOOKUP');
    const byWords = searchFunctions('first column').map((f) => f.name);
    expect(byWords).toContain('VLOOKUP');
    expect(searchFunctions('zzzz')).toEqual([]);
  });

  it('lists one family in alphabetical order', () => {
    const lookup = searchFunctions('', 'lookup');
    expect(lookup.every((f) => f.family === 'lookup')).toBe(true);
    const names = lookup.map((f) => f.name);
    expect(names).toEqual([...names].sort());
  });

  it('inserts the call at the caret, with "=" in an empty cell', () => {
    expect(insertCall('', 0, 'SUM')).toEqual({ text: '=SUM(', caret: 5 });
    expect(insertCall('=1+', 3, 'ABS')).toEqual({ text: '=1+ABS(', caret: 7 });
  });
});
