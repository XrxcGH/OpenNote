import { describe, expect, it } from 'vitest';
import { tableSchema } from '../schema/schema';
import {
  createMarkdownCache,
  diffMarkdown,
  parseCell,
  parseInWorker,
  parseTextBlock,
  reparseRange,
  serializeCell,
  serializeTextBlock,
  utf8Offset,
} from '.';

const cache = createMarkdownCache();
const grin = '\u{1F600}';
const beam = '\u{1F601}';

describe('the Markdown API', () => {
  it('round-trips a text block', () => {
    const markdown = '# Title\n\n- one\n- two\n\n> quote';
    expect(serializeTextBlock(parseTextBlock(markdown), cache)).toBe(markdown);
  });

  it('parses a cell into one table paragraph and writes it back', () => {
    const cell = parseCell('a **b** `c`');
    expect(cell.type).toBe(tableSchema.nodes.paragraph);
    expect(serializeCell(cell, cache)).toBe('a **b** `c`');
    expect(serializeCell(parseCell('two\nlines'), cache)).toBe('two lines');
  });

  it('finds the one splice between two strings, never inside a surrogate pair', () => {
    expect(diffMarkdown('abc', 'abc')).toBeNull();
    expect(diffMarkdown('hello world', 'hello brave world')).toEqual({ at: 6, del: '', ins: 'brave ' });
    expect(diffMarkdown(`a${grin}b`, `a${beam}b`)).toEqual({ at: 1, del: grin, ins: beam });
  });

  it('converts UTF-16 indexes to UTF-8 offsets', () => {
    const text = `aé${grin}b`;
    expect(utf8Offset(text, 0)).toBe(0);
    expect(utf8Offset(text, 2)).toBe(3);
    expect(utf8Offset(text, 4)).toBe(7);
  });

  it('asks for a full parse and parses through the worker API', async () => {
    const doc = parseTextBlock('one');
    expect(reparseRange(doc, 'one', 'two', cache)).toBe('full');
    expect(serializeTextBlock(await parseInWorker('two'), cache)).toBe('two');
  });
});
