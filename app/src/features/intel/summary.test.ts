// Summaries: the page's blocks are joined so each ends a sentence, each picked sentence is linked back to its block,
// and a feature that is off is offered, not run.
import { describe, expect, it, vi } from 'vitest';
import { createFakeIntelTransport, createIntelClient } from '../../services/intel';
import { blockAt, joinBlocks, summarizeBlocks } from './summary';
import type { PageText } from './summary';

function blocks(...texts: string[]): { blocks: PageText[]; revealed: number[] } {
  const revealed: number[] = [];
  return { revealed, blocks: texts.map((text, index) => ({ text, reveal: () => void revealed.push(index) })) };
}

const clientOver = (transport: ReturnType<typeof createFakeIntelTransport>) => () =>
  Promise.resolve(createIntelClient(transport));

describe('joinBlocks', () => {
  it('puts a line break between blocks and notes where each starts', () => {
    expect(joinBlocks(blocks('First block', 'Second block', 'Third').blocks)).toEqual({
      text: 'First block\nSecond block\nThird',
      starts: [0, 12, 25],
    });
  });

  it('finds the block a position belongs to', () => {
    expect(blockAt([0, 12, 25], 0)).toBe(0);
    expect(blockAt([0, 12, 25], 12)).toBe(1);
    expect(blockAt([0, 12, 25], 30)).toBe(2);
  });
});

describe('summarizeBlocks', () => {
  const page = () =>
    blocks('Cells make energy.', 'The mitochondria is the powerhouse of the cell.', 'Plants also use chloroplasts.');

  it('links each sentence to the block it came from', async () => {
    const transport = createFakeIntelTransport({ settings: { summaries: true } });
    const { blocks: parts, revealed } = page();
    const summary = await summarizeBlocks(parts, {
      client: clientOver(transport),
      ensureOn: () => Promise.resolve(true),
      maxSentences: 2,
    });
    expect(summary?.sentences.map((sentence) => sentence.text)).toEqual([
      'Cells make energy.',
      'The mitochondria is the powerhouse of the cell.',
    ]);
    expect(summary?.total).toBe(3);
    summary?.sentences[1].reveal?.();
    expect(revealed).toEqual([1]);
  });

  it('returns keywords from the page', async () => {
    const transport = createFakeIntelTransport({ settings: { summaries: true } });
    const summary = await summarizeBlocks(page().blocks, {
      client: clientOver(transport),
      ensureOn: () => Promise.resolve(true),
    });
    expect(summary?.keywords.length).toBeGreaterThan(0);
  });

  it('has nothing to summarize on a page with no words, and does not ask', async () => {
    const transport = createFakeIntelTransport();
    const ensureOn = vi.fn(() => Promise.resolve(true));
    const summary = await summarizeBlocks(blocks('', '  ').blocks, { client: clientOver(transport), ensureOn });
    expect(summary).toEqual({ sentences: [], keywords: [], total: 0 });
    expect(ensureOn).not.toHaveBeenCalled();
    expect(transport.calls).toEqual([]);
  });

  it('runs nothing when the person says not now', async () => {
    const transport = createFakeIntelTransport();
    const summary = await summarizeBlocks(page().blocks, {
      client: clientOver(transport),
      ensureOn: () => Promise.resolve(false),
    });
    expect(summary).toBeNull();
    expect(transport.calls).toEqual([]);
  });

  it('gives null, and does not throw, when the call fails', async () => {
    const transport = createFakeIntelTransport();
    const ensureOn = vi.fn(() => Promise.resolve(true));
    const summary = await summarizeBlocks(page().blocks, { client: clientOver(transport), ensureOn });
    expect(ensureOn).toHaveBeenCalled();
    expect(summary).toBeNull();
  });
});
