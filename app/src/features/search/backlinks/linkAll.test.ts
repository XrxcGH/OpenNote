import { describe, expect, it } from 'vitest';
import { createMemoryPageService } from '../../../services/pages/memory';
import type { PageJson } from '../../../services/pages/types';
import type { Mention, SearchClient, UnlinkedMention } from '../../../services/search/types';
import { undoPageChanges } from '../changeSet';
import { applyLinkAll, planLinkAll } from './linkAll';

const stamp = '2026-09-30T10:00:00.000Z';
const page = (id: string, markdown: string): PageJson => ({
  id,
  title: id,
  created: stamp,
  modified: stamp,
  tags: [],
  view: {},
  assets: {},
  blocks: [{ id: `${id}1`, type: 'text', order: '0', created: stamp, modified: stamp, data: { markdown } }],
});

/** A search client that finds the word "Plan" and links the places picked. */
const search = {
  async findMentions(markdown: string): Promise<Mention[]> {
    const out: Mention[] = [];
    for (const m of markdown.matchAll(/Plan/g)) {
      const at = m.index ?? 0;
      out.push({
        range: { start: at, end: at + 4 },
        text: 'Plan',
        before: markdown.slice(0, at),
        after: markdown.slice(at + 4),
      } as Mention);
    }
    return out;
  },
  async linkMentions(markdown: string, _title: string, target: string, which?: number[]) {
    let index = -1;
    let count = 0;
    const out = markdown.replace(/Plan/g, (word) => {
      index += 1;
      if (which && !which.includes(index)) return word;
      count += 1;
      return `[[${target}|${word}]]`;
    });
    return { markdown: out, count };
  },
} as unknown as SearchClient;

const mention = (source: string): UnlinkedMention =>
  ({ source, sourceTitle: source, count: 2, blocks: [{ block: `${source}1`, count: 2, context: null }] }) as never;

describe('Link all', () => {
  it('lists each place, links only the chosen ones as one batch a page, and undoes them together', async () => {
    const service = createMemoryPageService([
      { page: page('a', 'Plan one and Plan two') },
      { page: page('b', 'The Plan') },
    ]);
    const items = await planLinkAll(service, search, [mention('a'), mention('b')], 'Plan');
    expect(items.map((item) => item.id)).toEqual(['a:a1:0', 'a:a1:1', 'b:b1:0']);
    const chosen = items.filter((item) => item.id !== 'a:a1:1');
    const done = await applyLinkAll(service, search, chosen, { page: 'p', title: 'Plan' });
    expect(done).toMatchObject({ count: 2, pages: 2 });
    expect(service.held('a')?.blocks[0].data.markdown).toBe('[[p|Plan]] one and Plan two');
    expect(service.held('b')?.blocks[0].data.markdown).toBe('The [[p|Plan]]');
    expect(service.sent('a')).toHaveLength(1);
    expect(await undoPageChanges(service, done.changes)).toBe(2);
    expect(service.held('a')?.blocks[0].data.markdown).toBe('Plan one and Plan two');
    expect(service.held('b')?.blocks[0].data.markdown).toBe('The Plan');
  });
});
