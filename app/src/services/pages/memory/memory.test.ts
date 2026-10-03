import { describe, expect, it } from 'vitest';
import { CONTRACT_PAGE, describePageService } from '../contract';
import { keyBetween } from './apply';
import { imageSize } from './imageSize';
import { createMemoryPageService } from '.';

describePageService('memory', () => Promise.resolve(createMemoryPageService([{ page: CONTRACT_PAGE }])));

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
