import { describe, expect, it } from 'vitest';
import { embedLines, embedQuote, expandEmbedText } from './expand';
import type { EmbedLoader } from './expand';

const load: EmbedLoader = async (ref) =>
  ref.title === 'Cells'
    ? { title: 'Cells', markdown: ref.element ? 'Only this paragraph' : '# Cells\n\nThe unit of life.' }
    : null;

describe('embedded text in exports', () => {
  it('finds embed lines outside code fences', () => {
    const lines = embedLines('Intro\n![[Cells]]\n```\n![[Cells]]\n```\n![[Other#Part]]');
    expect(lines.map((line) => [line.index, line.ref.title])).toEqual([
      [1, 'Cells'],
      [5, 'Other'],
    ]);
  });

  it('quotes the embedded text under the page title', () => {
    expect(embedQuote({ title: 'Cells', markdown: 'Line one\n\nLine two' })).toBe(
      '> **Cells**\n>\n> Line one\n>\n> Line two',
    );
  });

  it('replaces each embed line with its text, and leaves lines it cannot read alone', async () => {
    const out = await expandEmbedText('Before\n\n![[Cells#^abcdef12]]\n\n![[Missing]]\n\nAfter', load);
    expect(out).toBe('Before\n\n> **Cells**\n>\n> Only this paragraph\n\n![[Missing]]\n\nAfter');
  });

  it('leaves an embed inside an embedded page as the line it is', async () => {
    const nested: EmbedLoader = async () => ({ title: 'A', markdown: '![[B]]' });
    expect(await expandEmbedText('![[A]]', nested)).toBe('> **A**\n>\n> ![[B]]');
  });
});
