import { describe, expect, it } from 'vitest';
import { indentAt } from './indent';

describe('indentAt', () => {
  it('puts spaces at the caret', () => {
    expect(indentAt('ab', 1, 1, false, 4)).toEqual({ text: 'a    b', start: 5, end: 5 });
  });

  it('indents every line of a selection', () => {
    expect(indentAt('x\ny\nz', 0, 3, false, 2)).toEqual({ text: '  x\n  y\nz', start: 2, end: 7 });
  });

  it('outdents up to one unit of spaces', () => {
    expect(indentAt('    a\n  b', 6, 9, true, 4)).toEqual({ text: '    a\nb', start: 6, end: 7 });
    expect(indentAt('      x', 7, 7, true, 4)).toEqual({ text: '  x', start: 3, end: 3 });
  });
});
