import { describe, expect, it } from 'vitest';
import { createMarkdownCache, parseCell, serializeCell } from '.';
import { shape } from '../shape';
import { looksLikeMarkdown, parsePastedMarkdown } from './paste';
import type { PastedPiece } from './paste';

function ids(): () => string {
  let next = 0;
  return () => `id${++next}`;
}

const tableOf = (piece: PastedPiece | undefined) => (piece?.kind === 'table' ? piece.data : null);
const docOf = (piece: PastedPiece | undefined) => (piece?.kind === 'text' ? shape(piece.doc) : null);

describe('whether pasted text looks like Markdown', () => {
  it.each([
    '# Heading',
    'intro\n- item',
    '1. first',
    '> quoted',
    '```\ncode\n```',
    'see [the docs](https://example.com)',
    'a **strong** word',
    '| a | b |\n| --- | :-: |\n| 1 | 2 |',
    'a | b\n---|---',
    '| one |\n|---|',
  ])('%j does', (text) => {
    expect(looksLikeMarkdown(text)).toBe(true);
  });

  it.each([
    'Just a sentence.',
    'https://example.com/a_b',
    'two * stars * apart',
    'a | b without a delimiter row',
    'heading\n---',
    'price: 5 - 3 = 2',
  ])('%j does not', (text) => {
    expect(looksLikeMarkdown(text)).toBe(false);
  });
});

describe('pasted Markdown', () => {
  it('splits text and tables into pieces, in order', () => {
    const pieces = parsePastedMarkdown('# Plan\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\nAfter **all**', ids());
    expect(pieces.map((piece) => piece.kind)).toEqual(['text', 'table', 'text']);
    expect(docOf(pieces[0])).toBe('doc(heading[level=1]("Plan"))');
    expect(docOf(pieces[2])).toBe('doc(paragraph("After ", bold("all")))');
  });

  it('makes table data with a header, fresh IDs, and canonical cell Markdown', () => {
    const data = tableOf(parsePastedMarkdown('| Name | *Note* |\n|---|---|\n| - x | a \\| b |\n| only |', ids())[0]);
    expect(data?.header).toBe(true);
    expect(data?.columns.map((column) => column.id)).toEqual(['id1', 'id2']);
    expect(data?.rows.map((row) => row.id)).toEqual(['id3', 'id4', 'id5']);
    const cells = data?.rows.map((row) => data.columns.map((column) => row.cells[column.id].markdown));
    expect(cells).toEqual([
      ['Name', '*Note*'],
      ['\\- x', 'a \\| b'],
      ['only', ''],
    ]);
    const cache = createMarkdownCache();
    for (const markdown of cells?.flat() ?? []) expect(serializeCell(parseCell(markdown), cache)).toBe(markdown);
  });

  it('keeps a table inside a list as one paragraph for each row', () => {
    const [piece] = parsePastedMarkdown('- item\n\n  | a | b |\n  |---|---|\n  | 1 | **2** |', ids());
    expect(docOf(piece)).toBe(
      'doc(bulletList(listItem(paragraph("item"), paragraph("a | b"), paragraph("1 | ", bold("2")))))',
    );
  });

  it('gives valid documents for any pasted text, and nothing for blank text', () => {
    expect(parsePastedMarkdown('   \n\n', ids())).toEqual([]);
    for (const text of ['|', '|---|', '| a |\n|---|\n|', '> | a |\n> |---|', '\r\n# a\r\n']) {
      for (const piece of parsePastedMarkdown(text, ids())) if (piece.kind === 'text') piece.doc.check();
    }
  });
});
