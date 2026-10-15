import { describe, expect, it } from 'vitest';
import {
  addHighlight,
  changeHighlight,
  groupHighlights,
  highlightsMarkdown,
  highlightsOf,
  linesOf,
  quoteMarkdown,
  wordsText,
} from './highlights';
import type { FoundHighlight } from './highlights';
import type { StoredWord } from './model';

const words: StoredWord[] = [
  [0.1, 0.1, 0.1, 0.02, 'Water'],
  [0.21, 0.1, 0.1, 0.02, 'moves'],
  [0.1, 0.13, 0.1, 0.02, 'by'],
  [0.21, 0.13, 0.15, 0.02, 'osmosis.'],
];

describe('PDF highlights', () => {
  it('adds a highlight over a run of words with their text', () => {
    const added = addHighlight({ data: {} }, words, { from: 3, to: 1 }, 'moss');
    expect(added?.highlight).toMatchObject({ color: 'moss', from: 1, to: 3, text: 'moves by osmosis.' });
    const block = { data: added?.patch ?? {} };
    expect(highlightsOf(block)).toHaveLength(1);
  });

  it('draws one box for each line it covers', () => {
    const lines = linesOf(words, 0, 3);
    expect(lines).toHaveLength(2);
    expect(lines[0][0]).toBeCloseTo(0.1);
    expect(lines[0][2]).toBeCloseTo(0.21, 2);
    expect(lines[1][1]).toBeCloseTo(0.13);
  });

  it('changes a color and removes a highlight', () => {
    const first = addHighlight({ data: {} }, words, { from: 0, to: 0 }, 'candle');
    const block = { data: first?.patch ?? {} };
    const id = highlightsOf(block)[0].id;
    expect(highlightsOf({ data: changeHighlight(block, id, 'dusk') })[0].color).toBe('dusk');
    expect(highlightsOf({ data: changeHighlight(block, id, null) })).toEqual([]);
  });

  it('ignores highlights that are not well formed', () => {
    const data = { highlights: [{ id: 'a', color: 'neon', from: 0, to: 1, text: '' }, { id: 'b' }, 4] };
    expect(highlightsOf({ data })).toEqual([]);
  });

  it('quotes a highlight with a link back to its spot', () => {
    const markdown = quoteMarkdown(
      { id: 'h', color: 'candle', from: 0, to: 1, text: 'Water  moves' },
      { file: 'bio.pdf', page: 4, pages: 9 },
      'pageid01',
      'blockid01',
    );
    expect(markdown).toBe('> Water moves\n>\n> [Page 4 of bio.pdf](opennote://page/pageid01/blockid01)');
    expect(wordsText(words, 2, 3)).toBe('by osmosis.');
  });

  it('lists highlights by color, then by page, and writes them as Markdown', () => {
    const at = (color: FoundHighlight['color'], page: number, text: string): FoundHighlight => ({
      id: text,
      color,
      from: 0,
      to: 0,
      text,
      file: 'bio.pdf',
      page,
      node: 'pageid01',
      block: 'blockid01',
    });
    const found = [at('moss', 3, 'late'), at('candle', 9, 'nine'), at('moss', 1, 'early')];
    const groups = groupHighlights(found);
    expect(groups.map((g) => g.color)).toEqual(['candle', 'moss']);
    expect(groups[1].items.map((h) => h.text)).toEqual(['early', 'late']);
    const markdown = highlightsMarkdown('Highlights in bio.pdf', found);
    expect(markdown.startsWith('# Highlights in bio.pdf\n\n## Yellow\n\n> nine')).toBe(true);
    expect(markdown).toContain('## Green\n\n> early\n>\n> [Page 1 of bio.pdf](opennote://page/pageid01/blockid01)');
  });
});
