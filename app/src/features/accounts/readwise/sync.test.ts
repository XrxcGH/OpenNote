// Sync Readwise against a mock Readwise: the first run writes a notebook, sections, and a page for each book; the next
// run reads only what changed and updates, adds, and removes in place; the cursor and the block map survive a restart.
import { describe, expect, it } from 'vitest';
import { readwiseMock } from '../../../../../tests/mock-servers/readwise';
import type { MockBook } from '../../../../../tests/mock-servers/readwise';
import { createMemoryPageService } from '../../../services/pages/memory';
import { createMemoryNotesService } from '../../../services/notes/memory';
import { createFakeConnectors } from '../../connectors';
import { createFakeAccountsHost } from '../fakeHost';
import { STATE_NAME, syncReadwise } from './sync';
import type { ReadwiseState } from './sync';

const book = (id: number, title: string, category: string, highlights: MockBook['highlights']): MockBook => ({
  user_book_id: id,
  title,
  author: 'Ada Writer',
  category,
  readwise_url: `https://readwise.io/bookreview/${id}`,
  highlights,
});

function rig(books: MockBook[]) {
  const mock = readwiseMock(books);
  const connectors = createFakeConnectors({ connected: { readwise: '' }, respond: mock.server.respond });
  const host = createFakeAccountsHost(() => connectors.client);
  const notes = createMemoryNotesService({ seed: 'empty' });
  const pages = createMemoryPageService([], {
    missing: (id) => ({ id, title: '', created: '', modified: '', tags: [], view: {}, blocks: [], assets: {} }),
  });
  const deps = { notes, pages, host, client: connectors.client, now: () => new Date('2026-10-07T12:00:00Z') };
  return { mock, deps, host, connectors, notes, pages };
}

const textOf = (page: ReturnType<typeof createMemoryPageService>, id: string) =>
  (page.held(id)?.blocks ?? []).map((block) => String(block.data.markdown));

describe('syncReadwise', () => {
  it('writes a notebook with a section for each category and a page for each book', async () => {
    const { deps, notes, pages } = rig([
      book(1, 'The Overstory', 'books', [
        { id: 11, text: 'Trees talk.', note: 'Remember this', location: 40, updated: '2026-10-01T00:00:00Z' },
        { id: 12, text: 'Roots\nand shoots.', updated: '2026-10-01T00:00:00Z' },
      ]),
      book(2, 'A long read', 'articles', [{ id: 21, text: 'First point.', updated: '2026-10-02T00:00:00Z' }]),
    ]);
    const result = await syncReadwise(deps);
    expect(result).toMatchObject({ books: 2, added: 3, updated: 0, removed: 0 });
    const [notebook] = await notes.listNotebooks();
    expect(notebook?.title).toBe('Readwise');
    const sections = await notes.listChildren(notebook?.id ?? '');
    expect(sections.map((one) => one.title)).toEqual(['Books', 'Articles']);
    const [overstory] = await notes.listChildren(sections[0]?.id ?? '');
    expect(overstory?.title).toBe('The Overstory');
    const blocks = textOf(pages, overstory?.id ?? '');
    expect(blocks[0]).toContain('By Ada Writer');
    expect(blocks[1]).toBe('> Trees talk.\n\nNote: Remember this\n\nLocation 40');
    expect(blocks[2]).toBe('> Roots\n> and shoots.');
  });

  it('reads only what changed next time, and updates, adds, and removes in place', async () => {
    const { deps, mock, host, notes, pages } = rig([
      book(1, 'The Overstory', 'books', [
        { id: 11, text: 'Trees talk.', updated: '2026-10-01T00:00:00Z' },
        { id: 12, text: 'Roots.', updated: '2026-10-01T00:00:00Z' },
      ]),
    ]);
    await syncReadwise(deps);
    const saved = (await host.stateGet<ReadwiseState>(STATE_NAME)) as ReadwiseState;
    expect(saved.updatedAfter).toBe('2026-10-07T11:59:00.000Z');
    // The person adds a line of their own to the page, which a sync must leave alone.
    const pageId = saved.books['1']?.page ?? '';
    const open = await pages.open(pageId, { viewport: null });
    await open.send({
      edits: [{ edit: 'insertBlock', block: { id: 'mine', type: 'text', data: { markdown: 'My own thought.' } } }],
    });
    await open.close();

    const book1 = mock.state.books[0];
    if (!book1) throw new Error('no book');
    book1.highlights = [
      { id: 11, text: 'Trees talk, slowly.', updated: '2026-10-08T00:00:00Z' },
      { id: 12, text: 'Roots.', updated: '2026-10-08T00:00:00Z', is_deleted: true },
      { id: 13, text: 'Seeds.', updated: '2026-10-08T00:00:00Z' },
    ];
    mock.server.requests.length = 0;
    const result = await syncReadwise(deps);
    expect(result).toMatchObject({ books: 1, added: 1, updated: 1, removed: 1 });
    expect(mock.server.requests[0]?.query.updatedAfter).toBe('2026-10-07T11:59:00.000Z');
    expect(textOf(pages, pageId).slice(1)).toEqual(['> Trees talk, slowly.', 'My own thought.', '> Seeds.']);
    expect((await notes.listNotebooks()).length).toBe(1);
  });

  it('keeps going from where it stopped when the service stops answering', async () => {
    const { deps, mock, host, pages } = rig([
      book(1, 'One', 'books', [{ id: 1, text: 'A', updated: '2026-10-01T00:00:00Z' }]),
      book(2, 'Two', 'books', [{ id: 2, text: 'B', updated: '2026-10-01T00:00:00Z' }]),
    ]);
    // The service answers the first page and then throttles: the first book is kept, the cursor is not moved.
    const original = mock.server.respond;
    let calls = 0;
    const connectors = createFakeConnectors({
      connected: { readwise: '' },
      respond: (id, request) => (++calls > 1 ? { status: 429, contentType: null, body: '{}' } : original(id, request)),
    });
    const stopped = { ...deps, client: connectors.client };
    await expect(syncReadwise(stopped)).rejects.toThrow();
    const saved = (await host.stateGet<ReadwiseState>(STATE_NAME)) as ReadwiseState;
    expect(saved.updatedAfter).toBeNull();
    expect(Object.keys(saved.books)).toEqual(['1']);
    expect(textOf(pages, saved.books['1']?.page ?? '')).toHaveLength(2);
    // The next run reads everything again and finishes without duplicating the first book's highlight.
    const result = await syncReadwise(deps);
    expect(result).toMatchObject({ books: 2, added: 1 });
    expect(textOf(pages, saved.books['1']?.page ?? '')).toHaveLength(2);
  });
});
