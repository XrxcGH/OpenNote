// The words the meaning index, Related pages, and Ask your notes show never carry Markdown's escapes or marks.

import { describe, expect, it } from 'vitest';
import { plainMarkdown } from './pageText';
import { readableMarkdown } from '../../../services/search/text';

describe('plain words from Markdown', () => {
  it('drops escapes, hard breaks, and callout markers', () => {
    expect(plainMarkdown(String.raw`Due \#todo and \#urgent, a \*star\*`)).toBe('Due #todo and #urgent, a *star*');
    expect(plainMarkdown('Hello Bob,\\' + '\nthe wombatphrase')).toBe('Hello Bob,\nthe wombatphrase');
    expect(plainMarkdown('> [!note] Callout\n> Hello')).toBe('Callout\nHello');
  });

  it('reads the words around a match the same way', () => {
    expect(readableMarkdown(String.raw`and \#urgent.`)).toBe('and #urgent.');
    expect(readableMarkdown('> [!tip] Hello Bob,\\' + '\nthe')).toBe('> Hello Bob,\nthe');
  });
});
