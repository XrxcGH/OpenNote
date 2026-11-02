import { describe, expect, it } from 'vitest';
import type { PageJson } from '../../services/pages/types';
import { createMemorySearch } from '../../services/search/memory';
import type { PageId } from '../../services/search/types';
import { createWebSearchExtras, placesOf } from './searchExtras';

const tree = JSON.stringify({
  folder: '',
  notebooks: [
    {
      id: 'nb',
      kind: 'notebook',
      title: 'Biology',
      children: [
        {
          id: 'sec',
          kind: 'section',
          title: 'Lectures',
          children: [
            { id: 'p1', kind: 'page', title: 'Mitosis' },
            { id: 'p2', kind: 'page', title: 'Meiosis' },
            { id: 'p3', kind: 'page', title: 'Alone' },
          ],
        },
      ],
    },
  ],
});

const page = (id: string, title: string, markdown: string, data: object = {}) =>
  ({
    id,
    title,
    created: '2026-09-01T00:00:00Z',
    modified: '2026-09-02T00:00:00Z',
    tags: [],
    view: {},
    blocks: [{ id: `${id}-b`, type: 'text', data: { markdown, ...data } }],
    assets: {},
  }) as unknown as PageJson;

const pages: Record<string, PageJson> = {
  p1: page('p1', 'Mitosis', 'The steps of mitosis.'),
  p2: page('p2', 'Meiosis', 'Compare with [[Mitosis]].', { tags: { l1: ['todo'] }, ids: ['l1'] }),
};

async function extras() {
  const held = (id: PageId) => pages[id] ?? null;
  const search = createMemorySearch({ held });
  const titles = { p1: 'Mitosis', p2: 'Meiosis', p3: 'Alone' };
  await search.sync(
    Object.entries(titles).map(([id, title]) => ({ page: id as PageId, title })),
    true,
  );
  return createWebSearchExtras(search, held, async () => tree);
}

describe('web search extras', () => {
  it('places each page in its notebook and section', () => {
    expect(placesOf(tree).map((p) => [p.page, p.notebook, p.section])).toEqual([
      ['p1', 'nb', 'sec'],
      ['p2', 'nb', 'sec'],
      ['p3', 'nb', 'sec'],
    ]);
  });

  it('draws the links between pages, and lists the pages with none', async () => {
    const graph = await (await extras()).linkGraph('nb');
    expect(graph.pages).toHaveLength(3);
    expect(graph.edges).toEqual([{ from: 'p2', to: 'p1', count: 1, ambiguous: false }]);
    expect(graph.orphans).toEqual(['p3']);
  });

  it('finds tagged lines and gives a page its line tags', async () => {
    const found = await (await extras()).taggedBlocks({ kind: 'section', id: 'sec' });
    expect(found.map((b) => [b.page, b.tags])).toEqual([['p2', { l1: ['todo'] }]]);
    const facts = await (await extras()).pageFacts(null);
    expect(facts.find((f) => f.page === 'p2')?.tags).toEqual(['todo']);
  });
});
