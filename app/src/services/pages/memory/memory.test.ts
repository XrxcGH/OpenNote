import { afterEach, describe, expect, it, vi } from 'vitest';
import { CONTRACT_PAGE, describePageService } from '../contract';
import { keyBetween } from './apply';
import type { OpenPage, PageJson } from '../types';
import { imageSize } from './imageSize';
import { createMemoryPageService } from '.';
import type { MemoryPageServiceOptions } from '.';

describePageService('memory', () => Promise.resolve(createMemoryPageService([{ page: CONTRACT_PAGE }])));

const [FIRST, SECOND] = CONTRACT_PAGE.blocks.map((block) => block.id);
const typing = { kind: 'typing' as const, target: FIRST };

async function openContract(options: MemoryPageServiceOptions = {}) {
  const service = createMemoryPageService([{ page: CONTRACT_PAGE }], options);
  return { service, page: await service.open(CONTRACT_PAGE.id, { viewport: null }) };
}

async function undoCount(send: (page: OpenPage) => Promise<void>) {
  const { page } = await openContract();
  await send(page);
  let steps = 0;
  while (await page.undo()) steps++;
  return steps;
}

describe('typing steps in memory, by the core rules', () => {
  afterEach(() => void vi.useRealTimers());

  it('closes a typing step after a 1 second pause, after 10 seconds, and after 100 characters', async () => {
    vi.useFakeTimers();
    const type = (page: OpenPage, markdown: string) =>
      page.send({ edits: [{ edit: 'setText', block: FIRST, markdown }], coalesce: typing });
    expect(
      await undoCount(async (page) => {
        await type(page, 'Hello a');
        vi.advanceTimersByTime(999);
        await type(page, 'Hello ab');
        vi.advanceTimersByTime(1000);
        await type(page, 'Hello abc');
      }),
    ).toBe(2);
    expect(
      await undoCount(async (page) => {
        let text = 'Hello';
        for (let i = 0; i < 13; i++) {
          text += 'x';
          await type(page, text);
          vi.advanceTimersByTime(900);
        }
      }),
    ).toBe(2);
    expect(
      await undoCount(async (page) => {
        await type(page, `Hello${'x'.repeat(100)}`);
        await type(page, `Hello${'x'.repeat(101)}`);
      }),
    ).toBe(2);
  });

  it('joins backspacing and forward deleting, but not a switch between typing and deleting', async () => {
    const type = (page: OpenPage, markdown: string) =>
      page.send({ edits: [{ edit: 'setText', block: FIRST, markdown }], coalesce: typing });
    expect(
      await undoCount(async (page) => {
        await type(page, 'Hell');
        await type(page, 'Hel');
        await type(page, 'He');
      }),
    ).toBe(1);
    expect(
      await undoCount(async (page) => {
        await type(page, 'Hell');
        await type(page, 'Hello');
      }),
    ).toBe(2);
  });
});

describe('other undo steps in memory', () => {
  afterEach(() => void vi.useRealTimers());

  it('joins moves of one gesture always, and slider changes less than 1 second apart', async () => {
    vi.useFakeTimers();
    const move = (page: OpenPage, x: number, kind: 'drag' | 'slider') =>
      page.send({ edits: [{ edit: 'moveBlock', block: FIRST, frame: { x, y: 0 } }], coalesce: { kind, target: 'g1' } });
    expect(
      await undoCount(async (page) => {
        await move(page, 1, 'drag');
        vi.advanceTimersByTime(5000);
        await move(page, 2, 'drag');
      }),
    ).toBe(1);
    expect(
      await undoCount(async (page) => {
        await move(page, 1, 'slider');
        vi.advanceTimersByTime(1500);
        await move(page, 2, 'slider');
      }),
    ).toBe(2);
  });

  it('lets keep-below moves ride in a typing step without splitting it', async () => {
    const steps = await undoCount(async (page) => {
      for (const markdown of ['Hello!', 'Hello!!']) {
        await page.send({
          edits: [
            { edit: 'setText', block: FIRST, markdown },
            { edit: 'moveBlock', block: SECOND, frame: { x: 0, y: markdown.length } },
          ],
          coalesce: typing,
        });
      }
    });
    expect(steps).toBe(1);
  });

  it('records no step for a batch that changes nothing', async () => {
    const { page } = await openContract();
    const ack = await page.send({ edits: [{ edit: 'setText', block: FIRST, markdown: 'Hello' }] });
    expect(ack.canUndo).toBe(false);
  });
});

describe('the memory page service', () => {
  it('records what each page was sent', async () => {
    const service = createMemoryPageService([{ page: CONTRACT_PAGE }]);
    const page = await service.open(CONTRACT_PAGE.id, { viewport: null });
    const batch = { edits: [{ edit: 'setPage' as const, title: 'Renamed' }] };
    await page.send(batch);
    expect(service.sent(CONTRACT_PAGE.id)).toEqual([batch]);
  });

  it('creates missing pages when asked to, and rejects them otherwise', async () => {
    const empty = { ...CONTRACT_PAGE, blocks: [] };
    const service = createMemoryPageService([], { missing: () => empty });
    expect((await service.open('p2', { viewport: null })).initial.id).toBe('p2');
    await expect(createMemoryPageService([]).open('p2', { viewport: null })).rejects.toMatchObject({
      code: 'notFound',
    });
  });

  it('sends frames to the other clients of a page', async () => {
    const service = createMemoryPageService([{ page: CONTRACT_PAGE }]);
    const [one, two] = await Promise.all([1, 2].map(() => service.open(CONTRACT_PAGE.id, { viewport: null })));
    const frames: string[] = [];
    two.onFrame((frame) => frames.push(...frame.blocks.map((block) => String(block.data.markdown))));
    await one.send({ edits: [{ edit: 'setText', block: CONTRACT_PAGE.blocks[0].id, markdown: 'Changed' }] });
    expect(frames).toEqual(['Changed']);
  });

  it('makes order keys between any two keys', () => {
    for (const [a, b] of [
      [null, null],
      ['a', null],
      [null, 'a'],
      ['a', 'b'],
      ['a', 'a1'],
      ['az', 'b'],
    ] as const) {
      const key = keyBetween(a, b);
      if (a !== null) expect(key > a).toBe(true);
      if (b !== null) expect(key < b).toBe(true);
    }
  });

  it('reads PNG and JPEG sizes from their headers', () => {
    const png = new Uint8Array(24);
    png.set([0x89, 0x50, 0x4e, 0x47]);
    new DataView(png.buffer).setUint32(16, 640);
    new DataView(png.buffer).setUint32(20, 480);
    expect(imageSize(png)).toEqual({ width: 640, height: 480 });
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0, 17, 8, 0, 200, 1, 44, 3, 0, 0, 0, 0]);
    expect(imageSize(jpeg)).toEqual({ width: 300, height: 200 });
    expect(imageSize(new Uint8Array([1, 2, 3]))).toEqual({});
  });
});

describe('read-only pages, changes on disk, and versions in memory', () => {
  it('refuses edits, undo, and redo on a read-only page, and tells its clients when that changes', async () => {
    const info = { reason: 'The page file is damaged.', action: 'makeEditable' as const };
    const { service, page } = await openContract({ readOnly: { [CONTRACT_PAGE.id]: info } });
    expect(page.readOnly).toEqual(info);
    await expect(page.send({ edits: [{ edit: 'setPage', title: 'x' }] })).rejects.toMatchObject({ code: 'readOnly' });
    await expect(page.undo()).rejects.toMatchObject({ code: 'readOnly' });
    const seen: unknown[] = [];
    page.onReadOnly((next) => seen.push(next));
    service.setReadOnly(CONTRACT_PAGE.id, null);
    expect(seen).toEqual([null]);
    await page.send({ edits: [{ edit: 'setPage', title: 'x' }] });
  });

  it('tells clients when the page changed on disk', async () => {
    const { service, page } = await openContract();
    const seen: unknown[] = [];
    page.onExternal((change) => seen.push(change));
    const next: PageJson = { ...CONTRACT_PAGE, title: 'Changed elsewhere' };
    service.changeOnDisk(CONTRACT_PAGE.id, next);
    expect(seen).toEqual([{ action: 'reloaded' }]);
    expect((await service.open(CONTRACT_PAGE.id, { viewport: null })).initial.title).toBe('Changed elsewhere');
  });

  it('takes setText only when it says it has no splices', async () => {
    const { page } = await openContract({ supportsSplice: false });
    expect(page.supportsSplice).toBe(false);
    await expect(
      page.send({ edits: [{ edit: 'spliceText', block: FIRST, at: 0, del: '', ins: 'x' }] }),
    ).rejects.toMatchObject({ code: 'invalid' });
  });

  it('restores a version as a copy, and a whole version as one undo step', async () => {
    const { service, page } = await openContract();
    const [first] = await page.history.list();
    await page.send({ edits: [{ edit: 'setText', block: FIRST, markdown: 'Changed' }] });
    const copy = await page.history.restore(first.revision, true);
    expect(copy.asCopy).toBe(true);
    const opened = await service.open(copy.page, { viewport: null });
    expect(opened.initial.blocks[0].data.markdown).toBe('Hello');
    await page.history.restore(first.revision, false);
    expect((await service.open(CONTRACT_PAGE.id, { viewport: null })).initial.blocks[0].data.markdown).toBe('Hello');
    const undone = await page.undo();
    expect(undone?.blocks[0].data.markdown).toBe('Changed');
  });

  it('reports order keys for moved blocks too', async () => {
    const { page } = await openContract();
    const ack = await page.send({ edits: [{ edit: 'moveBlock', block: FIRST, after: SECOND }] });
    expect(ack.orderKeys[FIRST] > CONTRACT_PAGE.blocks[1].order).toBe(true);
  });
});
