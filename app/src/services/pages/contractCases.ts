// The page service contract's cases (ARCHITECTURE.md section 10.1; owner: WP2), with no test framework, so the
// same cases run in Vitest against the memory service (contract.ts) and inside the real app against Phase 3's
// core (tests/e2e/page/page.contract.spec.ts). Each case gets a fresh service that holds CONTRACT_PAGE.
import { PageServiceError } from './types';
import type { AppliedFrame, BlockJson, OpenPage, PageJson, PageService } from './types';

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

const FIRST = CONTRACT_PAGE.blocks[0].id;
const SECOND = CONTRACT_PAGE.blocks[1].id;
const THIRD = '01k6c0ntract0000000000000c';
const FOURTH = '01k6c0ntract0000000000000d';

export interface ContractCase {
  name: string;
  run(make: () => Promise<PageService>): Promise<void>;
}

/** Thrown when a case fails; the message says what was expected. */
export class ContractFailure extends Error {}

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new ContractFailure(message);
}

function equal(actual: unknown, expected: unknown, what: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  check(a === e, `${what}: expected ${e}, got ${a}`);
}

async function rejects(promise: Promise<unknown>, code: string, what: string): Promise<PageServiceError> {
  try {
    await promise;
  } catch (error) {
    const found = error as Partial<PageServiceError>;
    check(found.code === code, `${what}: expected the error ${code}, got ${found.code ?? String(error)}`);
    return error as PageServiceError;
  }
  throw new ContractFailure(`${what}: expected the error ${code}, but it succeeded`);
}

const block = (page: PageJson | AppliedFrame, id: string) => page.blocks.find((candidate) => candidate.id === id);
const markdownOf = (page: PageJson | AppliedFrame, id: string) => block(page, id)?.data.markdown;

async function reopen(service: PageService): Promise<PageJson> {
  const again = await service.open(CONTRACT_PAGE.id, { viewport: null });
  await again.close();
  return again.initial;
}

async function opened(make: () => Promise<PageService>): Promise<{ service: PageService; page: OpenPage }> {
  const service = await make();
  return { service, page: await service.open(CONTRACT_PAGE.id, { viewport: null }) };
}

const typing = (target: string) => ({ kind: 'typing' as const, target });

export const CONTRACT_CASES: readonly ContractCase[] = [
  {
    name: 'opens a page with its blocks in order and nothing to undo',
    async run(make) {
      const { page } = await opened(make);
      equal(
        page.initial.blocks.map((b) => b.id),
        [FIRST, SECOND],
        'the blocks',
      );
      equal(markdownOf(page.initial, FIRST), 'Hello', 'the first block');
      equal(page.readOnly, null, 'read-only');
      check(typeof page.client === 'string' && page.client !== '', 'the page names its client');
      equal(await page.undo(), null, 'undo with nothing to undo');
      await page.close();
    },
  },
  {
    name: 'applies text edits that another open of the page sees',
    async run(make) {
      const { service, page } = await opened(make);
      await page.send({ edits: [{ edit: 'setText', block: FIRST, markdown: 'Hello there' }] });
      if (page.supportsSplice) {
        await page.send({ edits: [{ edit: 'spliceText', block: FIRST, at: 5, del: ' there', ins: ', world' }] });
      }
      equal(markdownOf(await reopen(service), FIRST), page.supportsSplice ? 'Hello, world' : 'Hello there', 'text');
      await page.close();
    },
  },
  {
    name: 'counts splice offsets in UTF-8 bytes, across emoji and CJK',
    async run(make) {
      const { service, page } = await opened(make);
      if (!page.supportsSplice) return page.close();
      await page.send({ edits: [{ edit: 'setText', block: FIRST, markdown: '日本 😀 end' }] });
      // 日本 is 6 bytes, the space 1, the emoji 4, and the space 1: "end" starts at byte 12.
      await page.send({ edits: [{ edit: 'spliceText', block: FIRST, at: 12, del: 'end', ins: '終わり' }] });
      equal(markdownOf(await reopen(service), FIRST), '日本 😀 終わり', 'text');
      await page.close();
    },
  },
  {
    name: 'rejects a splice whose deleted text is not there, and changes nothing',
    async run(make) {
      const { service, page } = await opened(make);
      if (!page.supportsSplice) return page.close();
      const error = await rejects(
        page.send({ edits: [{ edit: 'spliceText', block: FIRST, at: 0, del: 'Nope', ins: 'x' }] }),
        'precondition',
        'a stale splice',
      );
      check(error.resync, 'a stale splice asks for a resync');
      equal(markdownOf(await reopen(service), FIRST), 'Hello', 'text');
      await page.close();
    },
  },
  {
    name: 'applies a batch whole or not at all',
    async run(make) {
      const { service, page } = await opened(make);
      await rejects(
        page.send({
          edits: [
            { edit: 'setText', block: FIRST, markdown: 'Changed' },
            { edit: 'deleteBlocks', blocks: ['01k6c0ntract00000000000zzz'] },
          ],
        }),
        'notFound',
        'a batch with a missing block',
      );
      equal(markdownOf(await reopen(service), FIRST), 'Hello', 'text');
      await page.close();
    },
  },
  {
    name: 'inserts blocks after, before, and at the end, and reports their order keys',
    async run(make) {
      const { service, page } = await opened(make);
      const middle = { id: THIRD, type: 'text', data: { markdown: 'Middle' } };
      const first = { id: FOURTH, type: 'text', data: { markdown: 'First' } };
      const ack = await page.send({
        edits: [
          { edit: 'insertBlock', block: middle, after: FIRST },
          { edit: 'insertBlock', block: first, before: FIRST },
        ],
      });
      check(typeof ack.orderKeys[THIRD] === 'string' && ack.orderKeys[THIRD] !== '', 'an order key for the insert');
      check(ack.orderKeys[FOURTH] < ack.orderKeys[THIRD], 'order keys sort in page order');
      equal(
        (await reopen(service)).blocks.map((b) => b.id),
        [FOURTH, FIRST, THIRD, SECOND],
        'the blocks',
      );
      await rejects(page.send({ edits: [{ edit: 'insertBlock', block: middle }] }), 'invalid', 'a repeated ID');
      await page.close();
    },
  },
  {
    name: 'moves blocks among the others and sets and removes frames',
    async run(make) {
      const { service, page } = await opened(make);
      await page.send({
        edits: [{ edit: 'moveBlock', block: FIRST, after: SECOND, frame: { x: 10, y: 20, w: 300 } }],
      });
      let held = await reopen(service);
      equal(
        held.blocks.map((b) => b.id),
        [SECOND, FIRST],
        'the order',
      );
      equal(block(held, FIRST)?.frame, { x: 10, y: 20, w: 300 }, 'the frame');
      await page.send({ edits: [{ edit: 'moveBlock', block: FIRST, frame: null }] });
      held = await reopen(service);
      equal(block(held, FIRST)?.frame, undefined, 'the frame after removing it');
      await page.close();
    },
  },
  {
    name: 'patches data, locks, and refuses what a lock forbids',
    async run(make) {
      const { service, page } = await opened(make);
      await page.send({ edits: [{ edit: 'patchBlock', block: FIRST, lock: 'position' }] });
      await rejects(page.send({ edits: [{ edit: 'moveBlock', block: FIRST, after: SECOND }] }), 'locked', 'a move');
      await page.send({ edits: [{ edit: 'setText', block: FIRST, markdown: 'Still typable' }] });
      await page.send({ edits: [{ edit: 'patchBlock', block: FIRST, lock: 'all' }] });
      await rejects(
        page.send({ edits: [{ edit: 'setText', block: FIRST, markdown: 'No' }] }),
        'locked',
        'typing in a locked block',
      );
      await page.send({ edits: [{ edit: 'patchBlock', block: FIRST, lock: null }] });
      const held = await reopen(service);
      equal(block(held, FIRST)?.lock, undefined, 'the lock after unlocking');
      equal(markdownOf(held, FIRST), 'Still typable', 'text');
      await page.close();
    },
  },
  {
    name: 'sets the title and view, and drops deleted blocks from the reading order',
    async run(make) {
      const { service, page } = await opened(make);
      await page.send({ edits: [{ edit: 'setPage', title: 'Renamed', view: { readingOrder: [SECOND, FIRST] } }] });
      await page.send({ edits: [{ edit: 'deleteBlocks', blocks: [SECOND] }] });
      const held = await reopen(service);
      equal(held.title, 'Renamed', 'the title');
      equal(held.view.readingOrder, [FIRST], 'the reading order');
      equal(
        held.blocks.map((b) => b.id),
        [FIRST],
        'the blocks',
      );
      await page.close();
    },
  },
  {
    name: 'groups typing that continues in one block into one undo step, and redoes it',
    async run(make) {
      const { page } = await opened(make);
      const ui = (anchor: number) => ({ kind: 'text' as const, block: FIRST, anchor, head: anchor });
      await page.send({
        edits: [{ edit: 'setText', block: FIRST, markdown: 'Hello!' }],
        coalesce: typing(FIRST),
        ui: { before: ui(6), after: ui(7) },
      });
      const ack = await page.send({
        edits: [{ edit: 'setText', block: FIRST, markdown: 'Hello!!' }],
        coalesce: typing(FIRST),
        ui: { before: ui(7), after: ui(8) },
      });
      check(ack.canUndo && !ack.canRedo, 'the answer says what can be undone');
      const undone = await page.undo();
      equal(undone && markdownOf(undone, FIRST), 'Hello', 'the text after one undo');
      equal(undone?.ui?.before, ui(6), 'the selection before the step');
      check(undone && !undone.canUndo && undone.canRedo, 'the frame says what can be undone and redone');
      const redone = await page.redo();
      equal(redone && markdownOf(redone, FIRST), 'Hello!!', 'the text after redo');
      equal(redone?.ui?.after, ui(8), 'the selection after the step');
      equal(await page.redo(), null, 'a second redo');
      await page.close();
    },
  },
  {
    name: 'keeps typing in separate steps when it jumps, changes block, or isn’t typing',
    async run(make) {
      const { page } = await opened(make);
      await page.send({ edits: [{ edit: 'setText', block: FIRST, markdown: 'Hello!' }], coalesce: typing(FIRST) });
      await page.send({ edits: [{ edit: 'setText', block: FIRST, markdown: '>Hello!' }], coalesce: typing(FIRST) });
      await page.send({ edits: [{ edit: 'setText', block: SECOND, markdown: 'Two!' }], coalesce: typing(SECOND) });
      await page.send({ edits: [{ edit: 'setText', block: SECOND, markdown: '**Two!**' }] });
      const texts: unknown[] = [];
      for (let i = 0; i < 4; i++) {
        const frame = await page.undo();
        texts.push(frame?.blocks.map((b) => b.data.markdown));
      }
      equal(texts, [['Two!'], ['Two'], ['Hello!'], ['Hello']], 'what each undo restored');
      await page.close();
    },
  },
  {
    name: 'brings deleted blocks back on undo, and removes inserted ones',
    async run(make) {
      const { page } = await opened(make);
      await page.send({ edits: [{ edit: 'deleteBlocks', blocks: [SECOND] }] });
      const back = await page.undo();
      equal(
        back?.blocks.map((b) => b.id),
        [SECOND],
        'the blocks undo put back',
      );
      equal(back && markdownOf(back, SECOND), 'Two', 'the text it put back');
      await page.send({
        edits: [{ edit: 'insertBlock', block: { id: THIRD, type: 'text', data: { markdown: 'x' } } }],
      });
      const gone = await page.undo();
      equal(gone?.removed, [THIRD], 'the blocks undo removed');
      await page.close();
    },
  },
  {
    name: 'puts page fields back on undo',
    async run(make) {
      const { page } = await opened(make);
      await page.send({ edits: [{ edit: 'setPage', title: 'Renamed' }] });
      const frame = await page.undo();
      equal(frame?.page?.title, 'Contract', 'the title undo put back');
      equal(frame?.blocks, [], 'the blocks it changed');
      await page.close();
    },
  },
  {
    name: 'sends other opens of the page a frame for each change',
    async run(make) {
      const { service, page } = await opened(make);
      const other = await service.open(CONTRACT_PAGE.id, { viewport: null });
      const seen: unknown[] = [];
      const stop = other.onFrame((frame) => seen.push(frame.blocks.map((b) => b.data.markdown)));
      await page.send({ edits: [{ edit: 'setText', block: FIRST, markdown: 'Changed' }] });
      for (let i = 0; i < 50 && seen.length === 0; i++) await new Promise((resolve) => setTimeout(resolve, 20));
      stop();
      if (seen.length > 0) equal(seen, [['Changed']], 'the frames the other open saw');
      await Promise.all([page.close(), other.close()]);
    },
  },
  {
    name: 'refuses to undo a change that another open of the page changed since',
    async run(make) {
      const { service, page } = await opened(make);
      const other = await service.open(CONTRACT_PAGE.id, { viewport: null });
      await page.send({ edits: [{ edit: 'setText', block: FIRST, markdown: 'Mine' }] });
      await other.send({ edits: [{ edit: 'setText', block: FIRST, markdown: 'Theirs' }] });
      await rejects(page.undo(), 'precondition', 'an undo of a changed block');
      equal(markdownOf(await reopen(service), FIRST), 'Theirs', 'text');
      await Promise.all([page.close(), other.close()]);
    },
  },
  {
    name: 'lists, opens, and names versions when the service keeps history',
    async run(make) {
      const { page } = await opened(make);
      await page.send({ edits: [{ edit: 'setText', block: FIRST, markdown: 'Saved' }] });
      await page.saveNow();
      let versions;
      try {
        versions = await page.history.list();
      } catch (error) {
        if ((error as Partial<PageServiceError>).code === 'notImplemented') return page.close();
        throw error;
      }
      check(versions.length > 0, 'a version after saving');
      const version = await page.history.open(versions[0].revision);
      equal(markdownOf(version, FIRST), 'Saved', 'the newest version');
      await page.history.name(versions[0].revision, 'Before the exam', true);
      const named = (await page.history.list()).find((v) => v.revision === versions[0].revision);
      equal([named?.name, named?.keep], ['Before the exam', true], 'the named version');
      await page.send({ edits: [{ edit: 'setText', block: FIRST, markdown: 'Later' }] });
      const frame = await page.history.restoreBlocks(versions[0].revision, [FIRST]);
      equal(markdownOf(frame, FIRST), 'Saved', 'the restored block');
      const undone = await page.undo();
      equal(undone && markdownOf(undone, FIRST), 'Later', 'the text after undoing the restore');
      await page.close();
    },
  },
];
