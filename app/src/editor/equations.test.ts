import { describe, expect, it } from 'vitest';
import {
  equationSources,
  freeLabel,
  labelOf,
  numberEquations,
  numberMarkdown,
  refKey,
  stripLabels,
  withLabel,
} from './equations';

describe('labels', () => {
  it('reads, adds, and removes a label', () => {
    expect(labelOf('x^2 \\label{eq:pyth}')).toBe('eq:pyth');
    expect(labelOf('x^2')).toBeNull();
    expect(withLabel('x^2 \\label{old}', 'new')).toBe('x^2 \\label{new}');
    expect(stripLabels('a=b \\label{k}')).toBe('a=b');
  });
  it('finds the first free label', () => {
    expect(freeLabel(new Set(['eq-1', 'eq-2', 'eq-4']))).toBe('eq-3');
  });
  it('reads a reference', () => {
    expect(refKey('\\eqref{a-1}')).toBe('a-1');
    expect(refKey('x+1')).toBeNull();
  });
});

describe('numbering', () => {
  it('numbers labeled equations in order and flags repeats', () => {
    const n = numberEquations(['a \\label{x}', 'b', 'c \\label{y}', 'd \\label{x}']);
    expect(n.numbers).toEqual([1, null, 2, null]);
    expect(n.byKey.get('y')).toBe(2);
    expect(n.duplicates).toEqual([3]);
  });
  it('renumbers when equations move', () => {
    const a = numberEquations(['p \\label{p}', 'q \\label{q}']);
    const b = numberEquations(['q \\label{q}', 'p \\label{p}']);
    expect(a.byKey.get('q')).toBe(2);
    expect(b.byKey.get('q')).toBe(1);
  });
});

describe('export text', () => {
  const page = ['Intro, see $\\eqref{b}$ and $\\eqref{zz}$.', '$$\na=1 \\label{a}\n$$\n\n$$\nb=2 \\label{b}\n$$'];
  it('tags equations and resolves references across blocks', () => {
    const [one, two] = numberMarkdown(page);
    expect(one).toBe('Intro, see (2) and (??).');
    expect(two).toBe('$$\na=1 \\tag{1}\n$$\n\n$$\nb=2 \\tag{2}\n$$');
  });
  it('leaves code and unlabeled text alone', () => {
    const text = '```\n$$\nx \\label{a}\n$$\n```\n`$\\eqref{a}$`';
    expect(numberMarkdown([text])).toEqual([text]);
    expect(numberMarkdown(['plain'])).toEqual(['plain']);
  });
  it('lists display equations', () => {
    expect(equationSources(page[1])).toEqual(['a=1 \\label{a}', 'b=2 \\label{b}']);
  });
});
