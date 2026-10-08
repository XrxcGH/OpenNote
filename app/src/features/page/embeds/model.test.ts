import { describe, expect, it } from 'vitest';
import { parseTextBlock } from '../../../editor/markdown';
import { findEmbeds, parseEmbed, pickBlocks } from './model';

describe('page embeds', () => {
  it('reads a page and a heading from an embed line', () => {
    expect(parseEmbed('![[Cell biology]]')).toEqual({ title: 'Cell biology', heading: null });
    expect(parseEmbed('  ![[Cell biology#Nucleus]] ')).toEqual({ title: 'Cell biology', heading: 'Nucleus' });
    expect(parseEmbed('![[Cell biology|the cell]]')).toEqual({ title: 'Cell biology', heading: null });
  });

  it('ignores links and text around an embed', () => {
    expect(parseEmbed('[[Cell biology]]')).toBeNull();
    expect(parseEmbed('see ![[Cell biology]]')).toBeNull();
    expect(parseEmbed('![[]]')).toBeNull();
    expect(parseEmbed('![[ ]]')).toBeNull();
  });

  it('finds embed paragraphs in a document and where their cards go', () => {
    const doc = parseTextBlock('Intro\n\n![[One]]\n\n- ![[Not here]]\n\n![[Two#Part]]');
    const found = findEmbeds(doc);
    expect(found.map((embed) => [embed.title, embed.heading])).toEqual([
      ['One', null],
      ['Two', 'Part'],
    ]);
    for (const embed of found) expect(doc.resolve(embed.end).parent).toBe(doc);
  });

  it('shows all text boxes of a page, or the one that holds the heading', () => {
    const blocks = [
      { id: 'a', type: 'text', markdown: '# Intro\n\nWords' },
      { id: 'b', type: 'image', markdown: '' },
      { id: 'c', type: 'text', markdown: '## Nucleus\n\nDetails' },
    ];
    expect(pickBlocks(blocks, null)).toEqual(['a', 'c']);
    expect(pickBlocks(blocks, ' nucleus ')).toEqual(['c']);
    expect(pickBlocks(blocks, 'Missing')).toEqual([]);
  });
});
