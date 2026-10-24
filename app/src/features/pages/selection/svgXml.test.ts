// @vitest-environment jsdom

// A selection's SVG is an XML document. A viewer that opens the saved file rejects it unless it is well-formed, and so
// does an Image that draws it for PNG. The DOMParser jsdom gives this test parses it as strict XML.

import { describe, expect, it } from 'vitest';
import { pageOf, textBlock } from '../testing/build';
import type { Lasso } from './geometry';
import { selectArea } from './select';
import { selectionSvg } from './svg';

const lasso: Lasso = [
  { x: 0, y: 0 },
  { x: 800, y: 0 },
  { x: 800, y: 600 },
  { x: 0, y: 600 },
];

/** The parse error, or null for a well-formed document. */
function xmlError(svg: string): string | null {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const error = doc.getElementsByTagName('parsererror')[0];
  return error ? (error.textContent ?? 'parse error') : null;
}

const table = {
  type: 'table',
  data: {
    header: true,
    columns: [
      { id: 'c1', width: 100 },
      { id: 'c2', width: 140 },
    ],
    rows: [
      { id: 'r1', cells: { c1: { markdown: 'Name' }, c2: { markdown: 'Value' } } },
      { id: 'r2', cells: { c1: { markdown: 'A' }, c2: { markdown: 'line\\\nbreak' } } },
    ],
  },
  frame: { x: 360, y: 20, w: 240, h: 90 },
};

/** Text with a hard break, a rule, an inline image, and characters XML forbids, a table, and an image. */
const page = pageOf(
  [
    textBlock(
      'First line\\\nsecond line\n\n---\n\nA ![leaf](asset:a1) inline\n\nBell \u0007 and \uFFFF and \uD800 end',
      {
        x: 20,
        y: 20,
        w: 300,
        h: 200,
      },
    ),
    table,
    { type: 'image', data: { asset: 'a1', alt: 'A leaf' }, frame: { x: 360, y: 200, w: 120, h: 80 } },
  ],
  { assets: { a1: { file: 'leaf.png', mime: 'image/png', name: 'leaf.png', width: 120, height: 80 } } },
);

describe('a selection as an SVG document', () => {
  const svg = selectionSvg(page, selectArea(page, lasso, { mode: 'exact' })!, {
    assetUrl: () => 'data:image/png;base64,AAAA',
    label: 'Selection',
  });

  it('is well-formed XML with a table, a hard break, a rule, and an inline image', () => {
    expect(svg).toContain('<col ');
    expect(svg).toContain('<br/>');
    expect(svg).toContain('<hr/>');
    expect(svg).toContain('<img src="data:image/png;base64,AAAA"');
    expect(xmlError(svg)).toBeNull();
    // The check itself rejects an HTML void element that does not close.
    expect(xmlError('<svg xmlns="http://www.w3.org/2000/svg"><g><br></g></svg>')).not.toBeNull();
  });

  it('leaves out the characters XML forbids', () => {
    expect(svg).toContain('Bell  and  and  end');
  });
});
