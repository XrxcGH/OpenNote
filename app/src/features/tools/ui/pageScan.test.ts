// @vitest-environment jsdom
// Upcoming from all notebooks: the scan asks the search index for the blocks with open checkboxes and tags, reads the
// dates in them, keeps the open page's own reading, and forgets pages that no longer have dates. A build with no index
// reads nothing. Checking an item off writes into its page.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SearchClient, TaggedBlock } from '../../../services/search/types';
import type { UpcomingItem } from '../upcoming';
import { setPageItemDone } from './pageCheckOff';
import { readingOf, scanAllPages } from './pageScan';
import { pageItemsStore, replacePageItems } from './upcomingStores';

const NOW = Date.UTC(2026, 9, 7, 12, 0);
const context = { now: NOW, timeZone: 'UTC' };

const block = (page: string, id: string, markdown: string): TaggedBlock => ({
  page,
  title: `Page ${page}`,
  notebook: 'nb',
  section: 'sec',
  modified: NOW,
  block: id,
  markdown,
  ids: [],
  tags: {},
  checked: [],
});

const client = (blocks: TaggedBlock[]): SearchClient =>
  ({ extras: { taggedBlocks: async () => blocks } }) as unknown as SearchClient;

beforeEach(() => {
  localStorage.clear();
  pageItemsStore.set({});
});
afterEach(() => pageItemsStore.set({}));

describe('reading the blocks the index hands over', () => {
  it('lists the dated lines of each page, and leaves out pages with none', () => {
    const reading = readingOf(
      [
        block('a', 'b1', '- [ ] Read chapter 4 by Friday\n- [ ] No date here'),
        block('b', 'b2', '- [ ] Nothing dated'),
        block('c', 'b3', 'Plan #todo lab report 2026-10-20'),
      ],
      context,
    );
    expect(Object.keys(reading).sort()).toEqual(['a', 'c']);
    expect(reading.a.items.map((item) => item.title)).toEqual(['Read chapter 4']);
    expect(reading.a.items[0].page).toMatchObject({ id: 'a', block: 'b1', line: 0, task: true });
    expect(reading.c.items[0].page?.task).toBe(false);
  });
});

describe('the scan', () => {
  it('fills Upcoming from every notebook and keeps it in step as pages change', async () => {
    const first = await scanAllPages(client([block('a', 'b1', '- [ ] Read by Friday')]), [], NOW);
    expect(first).toBe(1);
    expect(Object.keys(pageItemsStore.get())).toEqual(['a']);
    // The task was finished and the page no longer lists it, so it goes.
    await scanAllPages(client([]), [], NOW);
    expect(pageItemsStore.get()).toEqual({});
  });

  it('leaves the open page to the editor, which reads it as it changes', async () => {
    replacePageItems({
      open: {
        title: 'Open',
        items: [{ id: 'page:open:b:0', title: 'Fresh', due: null, done: false } as UpcomingItem],
      },
    });
    await scanAllPages(client([block('open', 'b', '- [ ] Stale by Friday')]), ['open'], NOW);
    expect(pageItemsStore.get().open.items[0].title).toBe('Fresh');
  });

  it('reads nothing when the build has no index to ask', async () => {
    expect(await scanAllPages(null, [], NOW)).toBeNull();
    expect(await scanAllPages({} as SearchClient, [], NOW)).toBeNull();
  });
});

describe('checking a page item off', () => {
  function pageWith(markdown: string) {
    const sent: { edits: { markdown: string }[] }[] = [];
    const pages = {
      open: async () => ({
        initial: { blocks: [{ id: 'b1', type: 'text', data: { markdown } }] },
        send: async (batch: { edits: { markdown: string }[] }) => void sent.push(batch),
        close: async () => undefined,
      }),
    };
    return { pages: pages as never, sent };
  }
  const item = (extra: Partial<UpcomingItem> = {}): UpcomingItem => ({
    id: 'page:a:b1:1',
    title: 'Read',
    due: { date: { year: 2026, month: 10, day: 9 }, time: null },
    done: false,
    page: { id: 'a', title: 'Page a', block: 'b1', line: 1, task: true },
    ...extra,
  });

  it('writes the check into the page and marks the item done', async () => {
    const { pages, sent } = pageWith('# Plan\n- [ ] Read by Friday');
    pageItemsStore.set({ a: { title: 'Page a', items: [item()] } });
    expect(await setPageItemDone(item(), true, pages, NOW)).toBe('done');
    expect(sent[0].edits[0].markdown).toBe('# Plan\n- [x] Read by Friday');
    expect(pageItemsStore.get().a.items[0].done).toBe(true);
  });

  it('leaves the page alone when the line is not as Upcoming last saw it', async () => {
    const { pages, sent } = pageWith('# Plan\n- [x] Read by Friday');
    expect(await setPageItemDone(item(), true, pages, NOW)).toBe('moved');
    expect(sent).toEqual([]);
  });

  it('does not touch a tagged line that has no box', async () => {
    const { pages, sent } = pageWith('# Plan\nRead #todo Friday');
    const tagged = item({ page: { id: 'a', title: 'Page a', block: 'b1', line: 1, task: false } });
    expect(await setPageItemDone(tagged, true, pages, NOW)).toBe('moved');
    expect(sent).toEqual([]);
  });

  it('says so when the page cannot be opened', async () => {
    const broken = {
      open: vi.fn(async () => {
        throw new Error('locked');
      }),
    };
    expect(await setPageItemDone(item(), true, broken as never, NOW)).toBe('failed');
  });
});
