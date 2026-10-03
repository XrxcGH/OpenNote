// The page service contract suite (ARCHITECTURE.md section 10.1; owner after WP0: WP2). Every PageService runs it:
// the memory service in Vitest, and the Tauri adapter against the real core in one end-to-end spec. Import this
// file only from tests.
//
// `make` must return a fresh service that holds CONTRACT_PAGE, and may hold other pages.
import { describe, expect, it } from 'vitest';
import type { BlockJson, PageJson, PageService } from './types';

const AT = '2026-10-01T09:00:00.000Z';

function textBlock(id: string, order: string, markdown: string): BlockJson {
  return { id, type: 'text', order, created: AT, modified: AT, data: { markdown } };
}

/** One page with two text blocks. */
export const CONTRACT_PAGE: PageJson = {
  id: '01k6c0ntract0000000000000p',
  title: 'Contract',
  created: AT,
  modified: AT,
  tags: [],
  view: {},
  blocks: [
    textBlock('01k6c0ntract0000000000000a', 'a0', 'Hello'),
    textBlock('01k6c0ntract0000000000000b', 'a1', 'Two'),
  ],
  assets: {},
};

const [FIRST, SECOND] = CONTRACT_PAGE.blocks.map((block) => block.id);

const markdownOf = (page: PageJson, id: string) => page.blocks.find((block) => block.id === id)?.data.markdown;

export function describePageService(name: string, make: () => Promise<PageService>): void {
  describe(`${name}: the page service contract`, () => {
    it('opens a page with its blocks in order', async () => {
      const page = await (await make()).open(CONTRACT_PAGE.id, { viewport: null });
      expect(page.initial.blocks.map((block) => block.id)).toEqual([FIRST, SECOND]);
      expect(markdownOf(page.initial, FIRST)).toBe('Hello');
      await page.close();
    });

    it('applies text edits that another open of the page sees', async () => {
      const service = await make();
      const page = await service.open(CONTRACT_PAGE.id, { viewport: null });
      await page.send({ edits: [{ edit: 'setText', block: FIRST, markdown: 'Hello there' }] });
      if (page.supportsSplice) {
        await page.send({ edits: [{ edit: 'spliceText', block: FIRST, at: 5, del: ' there', ins: ', world' }] });
      }
      const again = await service.open(CONTRACT_PAGE.id, { viewport: null });
      expect(markdownOf(again.initial, FIRST)).toBe(page.supportsSplice ? 'Hello, world' : 'Hello there');
      await Promise.all([page.close(), again.close()]);
    });

    it('rejects a splice whose deleted text is not there, and changes nothing', async () => {
      const page = await (await make()).open(CONTRACT_PAGE.id, { viewport: null });
      if (!page.supportsSplice) return;
      await expect(
        page.send({ edits: [{ edit: 'spliceText', block: FIRST, at: 0, del: 'Nope', ins: 'x' }] }),
      ).rejects.toMatchObject({ code: 'precondition', resync: true });
      await page.close();
    });

    it('inserts blocks between others and reports their order keys', async () => {
      const service = await make();
      const page = await service.open(CONTRACT_PAGE.id, { viewport: null });
      const block = { id: '01k6c0ntract0000000000000c', type: 'text', data: { markdown: 'Middle' } };
      const ack = await page.send({ edits: [{ edit: 'insertBlock', block, after: FIRST }] });
      expect(typeof ack.orderKeys[block.id]).toBe('string');
      const again = await service.open(CONTRACT_PAGE.id, { viewport: null });
      expect(again.initial.blocks.map((b) => b.id)).toEqual([FIRST, block.id, SECOND]);
    });

    it('groups typing in one block into one undo step and redoes it', async () => {
      const page = await (await make()).open(CONTRACT_PAGE.id, { viewport: null });
      const typing = { kind: 'typing' as const, target: FIRST };
      await page.send({ edits: [{ edit: 'setText', block: FIRST, markdown: 'Hello!' }], coalesce: typing });
      await page.send({ edits: [{ edit: 'setText', block: FIRST, markdown: 'Hello!!' }], coalesce: typing });
      const undone = await page.undo();
      expect(undone?.blocks.find((block) => block.id === FIRST)?.data.markdown).toBe('Hello');
      expect(undone?.canRedo).toBe(true);
      const redone = await page.redo();
      expect(redone?.blocks.find((block) => block.id === FIRST)?.data.markdown).toBe('Hello!!');
      expect(await page.redo()).toBeNull();
    });

    it('deletes blocks and brings them back on undo', async () => {
      const page = await (await make()).open(CONTRACT_PAGE.id, { viewport: null });
      await page.send({ edits: [{ edit: 'deleteBlocks', blocks: [SECOND] }] });
      const frame = await page.undo();
      expect(frame?.blocks.map((block) => block.id)).toEqual([SECOND]);
    });
  });
}
