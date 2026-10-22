import { describe, expect, it } from 'vitest';
import { cardOfLine } from './inline';

describe('inline cards', () => {
  it('makes a cloze card from braces the editor stored escaped', () => {
    const typed = String.raw`The \{\{sun}} is a \{\{star}}.`;
    expect(cardOfLine(typed)).toEqual({ kind: 'cloze', front: 'The {{sun}} is a {{star}}.', back: '' });
  });
  it('still reads plain braces and Q :: A lines', () => {
    expect(cardOfLine('Water boils at {{100}} degrees')).toMatchObject({ kind: 'cloze' });
    expect(cardOfLine('Q :: A')).toEqual({ kind: 'basic', front: 'Q', back: 'A' });
  });
});
