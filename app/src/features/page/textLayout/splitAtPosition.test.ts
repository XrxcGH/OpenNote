// Insert page break splits the text at the caret (R-BRK-3, G5): the paragraph is cut where the caret is.
import { describe, expect, it } from 'vitest';
import { marked } from '../../../editor/commands/testing';
import { splitAtPosition } from '../tables/insert';

describe('splitAtPosition', () => {
  it('cuts a paragraph at the caret', () => {
    const { head, tail } = splitAtPosition(marked('OneTwo[]Three\n\nFour').state);
    expect(head).toBe('OneTwo');
    expect(tail).toBe('Three\n\nFour');
  });

  it('cuts after a paragraph when the caret is at its end', () => {
    const { head, tail } = splitAtPosition(marked('One[]\n\nTwo').state);
    expect(head).toBe('One');
    expect(tail).toBe('Two');
  });

  it('drops an empty paragraph with the caret', () => {
    const { head, tail } = splitAtPosition(marked('One\n\n[]\n\nTwo').state);
    expect(head).toBe('One');
    expect(tail).toBe('Two');
  });
});
