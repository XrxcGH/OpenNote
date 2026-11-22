import { describe, expect, it } from 'vitest';
import { pageFixture } from './fixtures';

interface Data {
  markdown: string;
  ids: string[];
  paras: Record<string, { tabs?: unknown[]; border?: unknown; list?: { id: string } }>;
  lists: Record<string, { levels: { format: string }[] }>;
}

describe('the formatted twenty-page note fixture', () => {
  const data = pageFixture('twentyPageFormatted').page.blocks[0].data as unknown as Data;
  const paragraphs = data.markdown.split('\n\n').filter((piece) => !/^(#|- |1\. )/.test(piece));

  it('puts a font, size, and color on 30 percent of its paragraphs', () => {
    const formatted = paragraphs.filter((piece) => piece.startsWith('<span data-font="Georgia">'));
    expect(formatted.length / paragraphs.length).toBeCloseTo(0.3, 1);
    expect(formatted[0]).toContain('data-size="12"');
    expect(formatted[0]).toContain('data-color="indigo"');
  });

  it('has 50 paragraphs with tab stops, 10 formatted lists, and 20 bordered paragraphs', () => {
    const entries = Object.values(data.paras);
    expect(entries.filter((entry) => entry.tabs).length).toBe(50);
    expect(entries.filter((entry) => entry.border).length).toBe(20);
    expect(Object.keys(data.lists)).toHaveLength(10);
    expect(new Set(entries.filter((entry) => entry.list).map((entry) => entry.list!.id)).size).toBe(10);
  });

  it('names one ID for each element, so paras apply to the right paragraphs', () => {
    const items = data.markdown
      .split('\n\n')
      .flatMap((piece) => (/^(- |1\. )/.test(piece) ? piece.split('\n') : [piece]));
    expect(data.ids).toHaveLength(items.length);
    expect(new Set(data.ids).size).toBe(data.ids.length);
    for (const id of Object.keys(data.paras)) expect(data.ids).toContain(id);
  });
});
