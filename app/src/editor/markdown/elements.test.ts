import { describe, expect, it } from 'vitest';
import { applyElementData, countElements, extractElementData } from './elements';
import { parseTextBlock } from './parse';
import { serializeTextBlock } from './serialize';

const MARKDOWN = [
  '# Title',
  '',
  'A paragraph.',
  '',
  '- first item',
  '',
  '  a second paragraph in the item',
  '',
  '  - nested item',
  '',
  '> quoted paragraph',
  '',
  '```',
  'code',
  '```',
  '',
  '---',
].join('\n');

/** Eight elements: heading, paragraph, list item, its second paragraph, nested item, quote, code, and break. */
const IDS = Array.from({ length: 8 }, (_, i) => `01m3sabc3${i}0rfa24eeh6j4ky4`);

function counter(): () => string {
  let n = 0;
  return () => `01m3new${String(n++).padStart(19, '0')}`;
}

describe('text elements', () => {
  it('counts headings, paragraphs, list items, code, and breaks, but not quotes or a list item lead', () => {
    expect(countElements(parseTextBlock(MARKDOWN))).toBe(IDS.length);
  });

  it('gives each element its ID, tags, style, and checked state, in document order', () => {
    const doc = applyElementData(parseTextBlock(MARKDOWN), {
      ids: IDS,
      tags: { [IDS[1]]: ['todo', 'exam/unit-3'] },
      styles: { [IDS[0]]: 'title' },
      checked: [IDS[1]],
    });
    const found: { type: string; id: string | null }[] = [];
    doc.descendants((node) => {
      if (node.attrs.id) found.push({ type: node.type.name, id: node.attrs.id as string | null });
    });
    expect(found.map((entry) => entry.type)).toEqual([
      'heading',
      'paragraph',
      'listItem',
      'paragraph',
      'listItem',
      'paragraph',
      'codeBlock',
      'horizontalRule',
    ]);
    expect(found.map((entry) => entry.id)).toEqual(IDS);
  });

  it('round-trips the data, and never changes the Markdown', () => {
    const data = {
      ids: IDS,
      tags: { [IDS[1]]: ['todo'], [IDS[0]]: ['a', 'b'] },
      styles: { [IDS[2]]: 'quote' },
      checked: [IDS[1], IDS[0]],
    };
    const doc = applyElementData(parseTextBlock(MARKDOWN), data);
    expect(serializeTextBlock(doc)).toBe(MARKDOWN);
    const again = extractElementData(doc, counter());
    expect(again.data.ids).toEqual(IDS);
    expect(again.data.tags).toEqual({ [IDS[0]]: ['a', 'b'], [IDS[1]]: ['todo'] });
    expect(again.data.styles).toEqual({ [IDS[2]]: 'quote' });
    expect(again.data.checked).toEqual([IDS[0], IDS[1]]);
  });

  it('adds IDs for elements that have none, and replaces a repeated ID', () => {
    const doc = applyElementData(parseTextBlock('one\n\ntwo\n\nthree'), { ids: ['a', 'a'] });
    const { data } = extractElementData(doc, counter());
    expect(data.ids[0]).toBe('a');
    expect(new Set(data.ids).size).toBe(3);
    expect(data.ids[1]).not.toBe('a');
  });

  it('ignores extra IDs and keeps the remaining elements without one', () => {
    const doc = applyElementData(parseTextBlock('one\n\ntwo'), { ids: ['a', 'b', 'c'], tags: { c: ['x'] } });
    const ids: (string | null)[] = [];
    doc.forEach((node) => ids.push(node.attrs.id as string | null));
    expect(ids).toEqual(['a', 'b']);
    expect(extractElementData(doc, counter()).data.tags).toEqual({});
    const short = applyElementData(parseTextBlock('one\n\ntwo'), { ids: ['a'] });
    expect(short.lastChild?.attrs.id).toBeNull();
  });
});
