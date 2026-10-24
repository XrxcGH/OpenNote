import { describe, expect, it } from 'vitest';
import type { PageJson } from '../../../services/pages/types';
import { pageText, sectionText } from './sectionText';

const block = (id: string, type: string, markdown: string) =>
  ({ id, type, data: { markdown } }) as unknown as PageJson['blocks'][number];

describe('pageText', () => {
  it('joins the text blocks and leaves the other blocks out', () => {
    const text = pageText({
      blocks: [block('a', 'text', '# Cells'), block('b', 'image', 'x'), block('c', 'text', ' Cells are small. ')],
    });
    expect(text).toBe('# Cells\n\nCells are small.');
  });
});

describe('sectionText', () => {
  const pages: Record<string, PageJson['blocks']> = {
    p1: [block('a', 'text', 'First page text')],
    p2: [block('b', 'text', 'Second page text')],
  };
  const notes = {
    listChildren: async () =>
      [
        { id: 'p1', kind: 'page' },
        { id: 'locked', kind: 'page' },
        { id: 'g', kind: 'sectionGroup' },
        { id: 'p2', kind: 'page' },
      ] as never,
  };
  const service = {
    open: async (id: string) => {
      if (!pages[id]) throw new Error('locked');
      return { initial: { blocks: pages[id] }, close: async () => undefined } as never;
    },
  };

  it('reads each page, skips one that cannot be opened, and counts both', async () => {
    const words = await sectionText(notes as never, service as never, { id: 's' as never });
    expect(words.text).toBe('First page text\n\nSecond page text');
    expect([words.read, words.skipped]).toEqual([2, 1]);
  });
});
