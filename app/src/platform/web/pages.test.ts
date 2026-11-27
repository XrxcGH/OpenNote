// @vitest-environment jsdom
// The web build's pages. The soak deletes the saved versions before it reads the heap: the memory page service keeps
// them in the page's memory, where the core keeps them on disk.
import { describe, expect, it } from 'vitest';
import { createWebPages } from './pages';

type Hooks = Record<string, () => Promise<void>>;
const hooks = () => (window as unknown as { __OPENNOTE_TEST__: Hooks }).__OPENNOTE_TEST__;

describe('the web pages', () => {
  it('delete every saved version through the pagesDeleteHistory test hook', async () => {
    const service = createWebPages('twentyPage');
    const first = await service.open('p1', { viewport: null });
    expect((await first.history.list()).length).toBe(1);
    const held = service.held('p1');
    const id = held?.blocks.find((each) => typeof each.data.markdown === 'string')?.id;
    expect(id).toBeDefined();
    await first.send({ edits: [{ edit: 'setText', block: id!, markdown: 'Changed' }] });
    await first.close();
    const second = await service.open('p1', { viewport: null });
    expect((await second.history.list()).length).toBe(2);

    await hooks().pagesDeleteHistory();
    expect(await second.history.list()).toEqual([]);
  });
});
