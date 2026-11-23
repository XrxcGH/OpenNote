// A long table opens without parsing cells of plain words and numbers (editor/markdown parseCell). The shortcut must
// give what the Markdown parser gives: the same text, no marks, as a paragraph block of the same line shows.
import { describe, expect, it } from 'vitest';
import { parseCell, parseTextBlock } from '../../../../editor/markdown';

const PLAIN = ['Item 12', '12', '0', '-3.5', '1,000', '1,000.25', '2026', 'abc DEF 9', 'Qty'];
const MARKED = ['a **b**', 'x_y_', '`c`', 'see www.example.com', 'a  b', '$x$', '(c)', 'a -- b', 'R&D'];

const inline = (markdown: string) => JSON.stringify(parseTextBlock(markdown).firstChild?.content.toJSON() ?? null);
const cell = (markdown: string) => JSON.stringify(parseCell(markdown).content.toJSON() ?? null);

describe('plain cells', () => {
  it.each(PLAIN)('parses %j as the Markdown parser does', (markdown) => {
    expect(cell(markdown)).toBe(inline(markdown));
    expect(parseCell(markdown).textContent).toBe(markdown);
  });

  it.each(MARKED)('leaves %j to the Markdown parser', (markdown) => {
    expect(cell(markdown)).toBe(inline(markdown));
  });
});
