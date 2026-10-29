import { describe, expect, it } from 'vitest';
import { compareValues, displayValue, fieldNamed, readFields, viewPatch } from './model';
import type { Field } from './model';

const view = {
  layout: 'flow',
  properties: {
    fields: [
      { id: 'a', name: 'Status', type: 'choice', value: 'Open', options: ['Open', 'Done'] },
      { id: 'b', name: 'Rating', type: 'number', value: 4 },
      { id: 'c', name: 'Due', type: 'date', value: '2026-10-09' },
      { id: 'd', name: 'Reviewed', type: 'checkbox', value: true },
      { id: 'e', name: 'Course', type: 'page', value: 'page1', label: 'Bio 201' },
      { id: 'x', name: 'Bad', type: 'colour', value: 1 },
      'junk',
    ],
  },
};

describe('page properties', () => {
  it('reads the fields it understands and skips the rest', () => {
    const fields = readFields(view);
    expect(fields.map((field) => field.name)).toEqual(['Status', 'Rating', 'Due', 'Reviewed', 'Course']);
    expect(fields[0].options).toEqual(['Open', 'Done']);
    expect(readFields(undefined)).toEqual([]);
    expect(readFields({ properties: 'no' })).toEqual([]);
  });

  it('writes a patch that stores or removes the fields', () => {
    expect(viewPatch(readFields(view))).toEqual({ properties: { fields: readFields(view) } });
    expect(viewPatch([])).toEqual({ properties: null });
  });

  it('shows values as words', () => {
    const fields = readFields(view);
    const words = { yes: 'Yes', no: 'No' };
    expect(fields.map((field) => displayValue(field, words))).toEqual(['Open', '4', '2026-10-09', 'Yes', 'Bio 201']);
  });

  it('sorts numbers as numbers and puts empty values last', () => {
    const two: Field = { id: '1', name: 'n', type: 'number', value: 2 };
    const ten: Field = { id: '2', name: 'n', type: 'number', value: 10 };
    const none: Field = { id: '3', name: 'n', type: 'number', value: null };
    expect(compareValues(two, ten)).toBeLessThan(0);
    expect(compareValues(none, ten)).toBeGreaterThan(0);
    expect(compareValues(undefined, undefined)).toBe(0);
  });

  it('finds a field by name, ignoring case', () => {
    expect(fieldNamed(readFields(view), ' status ')?.id).toBe('a');
  });
});
