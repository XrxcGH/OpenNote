import { describe, expect, it } from 'vitest';
import { parseTextBlock } from '../../../editor/markdown';
import { headingsOfDoc, topLevel } from './headings';

describe('table of contents', () => {
  const doc = parseTextBlock('Intro\n\n## Cells\n\ntext\n\n### **Nucleus** and more\n\n> ## Quoted\n\n## Cells again');

  it('lists headings in order with their levels and plain text', () => {
    const headings = headingsOfDoc(doc);
    expect(headings.map((h) => [h.level, h.text])).toEqual([
      [2, 'Cells'],
      [3, 'Nucleus and more'],
      [2, 'Quoted'],
      [2, 'Cells again'],
    ]);
    expect(headings.map((h) => h.index)).toEqual([0, 1, 2, 3]);
  });

  it('points at the heading node', () => {
    for (const heading of headingsOfDoc(doc)) {
      expect(doc.nodeAt(heading.pos)?.type.name).toBe('heading');
    }
  });

  it('starts the outline at the least level', () => {
    expect(topLevel(headingsOfDoc(doc))).toBe(2);
    expect(topLevel([])).toBe(6);
  });
});
