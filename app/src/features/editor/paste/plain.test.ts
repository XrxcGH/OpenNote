// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { shape } from '../shape';
import markdownSample from './fixtures/markdown.txt?raw';
import pdfSample from './fixtures/pdf.txt?raw';
import { joinBrokenLines, looksHardWrapped } from './pdf';
import { looksLikeMarkdown, parsePastedMarkdown } from './plain';
import { sanitizePaste } from './sanitize';

const newId = (() => {
  let n = 0;
  return () => `id${n++}`;
})();

describe('plain text paste', () => {
  it('makes a paragraph of each line', () => {
    const result = sanitizePaste({ text: 'one\r\ntwo\n\nthree' }, { newId });
    expect(result.source).toBe('plain');
    expect(result.pieces.map((piece) => (piece.kind === 'text' ? shape(piece.doc) : 'table'))).toEqual([
      'doc(paragraph("one"), paragraph("two"), paragraph("three"))',
    ]);
  });

  it('keeps a web address that stands alone as text', () => {
    expect(looksLikeMarkdown('https://example.com/a_b_c')).toBe(false);
    expect(looksLikeMarkdown('plain words with a - dash')).toBe(false);
  });
});

describe('Markdown paste', () => {
  it('recognizes headings, lists, quotes, fences, links, and strong pairs', () => {
    for (const text of [
      '# Title',
      'a\n- item',
      '1. one',
      '> quote',
      '```\ncode\n```',
      'see [x](https://y.z)',
      'a **b** c',
    ]) {
      expect(looksLikeMarkdown(text), text).toBe(true);
    }
  });

  it('parses blocks and turns a GFM table into a table piece between the text pieces', () => {
    const result = sanitizePaste({ text: markdownSample }, { newId });
    expect(result.source).toBe('markdown');
    const [before, table, after] = result.pieces;
    expect(shape((before as { doc: Parameters<typeof shape>[0] }).doc)).toBe(
      'doc(heading[level=1]("Field notes"), paragraph("Saw ", bold("three"), " birds near the ", linkhttps://example.com/pond("pond"), "."), ' +
        'bulletList(listItem[checked=false](paragraph("Log the sightings")), listItem[checked=true](paragraph("Charge the camera"))))',
    );
    expect(table.kind).toBe('table');
    expect(table.kind === 'table' && table.data.header).toBe(true);
    expect(
      table.kind === 'table' && table.data.rows.map((row) => Object.values(row.cells).map((cell) => cell.markdown)),
    ).toEqual([
      ['Bird', 'Count'],
      ['Heron', '1'],
      ['Duck', '2'],
    ]);
    expect(shape((after as { doc: Parameters<typeof shape>[0] }).doc)).toBe(
      'doc(blockquote(paragraph("Quiet morning.")), codeBlock[language=js]("console.log(\'birds\');"))',
    );
  });

  it('gives fresh IDs to the rows and columns of a table', () => {
    const [table] = parsePastedMarkdown('| a | b |\n|---|---|\n| 1 | 2 |', newId);
    const ids =
      table.kind === 'table' ? [...table.data.columns.map((c) => c.id), ...table.data.rows.map((r) => r.id)] : [];
    expect(new Set(ids).size).toBe(4);
  });
});

describe('text from a PDF', () => {
  it('is hard-wrapped when the lines are about as long as each other and do not end their sentences', () => {
    expect(looksHardWrapped(pdfSample)).toBe(true);
    expect(looksHardWrapped('Short line.\nAnother one.\nAnd a third.')).toBe(false);
    expect(looksHardWrapped('A single long line that has no breaks in it at all, however long it runs on.')).toBe(
      false,
    );
  });

  it('joins the lines of a paragraph and removes a hyphen that split a word', () => {
    const joined = joinBrokenLines(pdfSample);
    expect(joined).toBe(
      'Photosynthesis converts light energy into chemical energy that the cell can store. In the light reactions, ' +
        'pigments in the thylakoid membranes absorb photons and pass the energy along a chain of carriers. The carbon ' +
        'fixation cycle then uses that energy to build sugars from carbon dioxide, which the plant stores as starch ' +
        'or exports to the growing tissues of the shoot.',
    );
  });

  it('keeps blank lines and list items as paragraph breaks, and keeps a real hyphen before a capital', () => {
    const text = [
      'The first paragraph of the report runs on for a while and',
      'ends its line here without a full stop, then the well-',
      'Known result appears and the paragraph carries on a bit',
      '',
      'The second paragraph starts here and is also broken at the',
      '- item one of a list after the paragraph',
      '- item two of the list after the paragraph, which is long',
    ].join('\n');
    expect(joinBrokenLines(text)?.split('\n\n')).toEqual([
      'The first paragraph of the report runs on for a while and ends its line here without a full stop, ' +
        'then the well- Known result appears and the paragraph carries on a bit',
      'The second paragraph starts here and is also broken at the',
      '- item one of a list after the paragraph',
      '- item two of the list after the paragraph, which is long',
    ]);
  });

  it('is offered as a separate step, and the raw paste stays as it came', () => {
    const result = sanitizePaste({ text: pdfSample }, { newId });
    expect(result.joinedText).toContain('chemical energy that');
    expect(result.pieces.length).toBe(1);
  });
});
