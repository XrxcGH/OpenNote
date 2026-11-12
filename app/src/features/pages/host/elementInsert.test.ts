/* eslint-disable opennote/feature-boundaries -- This test uses the page feature harness. */
// @vitest-environment jsdom
// An element from the library shows on the shown page. Its picture loads. Bug A2-A13-3.
import { afterEach, expect, it, vi } from 'vitest';
import { assetTable } from '../../page';
import { textPageFixture } from '../../page/test/fixtures';
import { cleanupPages, renderPage } from '../../page/test/harness';
import type { ElementEntry } from '../elements';
import { insertEntry } from './elementActions';

afterEach(cleanupPages);

// A 1 by 1 pixel PNG.
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const entry: ElementEntry = {
  id: '01k6f0000000000000000e0001',
  name: 'Sample',
  folder: '',
  created: '2026-10-01T09:00:00.000Z',
  element: {
    width: 200,
    height: 120,
    strokes: [],
    blocks: [
      { type: 'text', markdown: 'Element words', frame: { x: 0, y: 0, w: 100 } },
      { type: 'image', asset: 'pic', alt: 'A picture', decorative: false, frame: { x: 0, y: 60, w: 50, h: 50 } },
    ],
    assets: { pic: { name: 'pic.png', mime: 'image/png', width: 1, height: 1, data: PNG } },
  },
};

it('shows the inserted blocks, and the image has its asset', async () => {
  const page = await renderPage({ fixture: textPageFixture('First line.') });
  // jsdom makes no object URLs.
  vi.spyOn(page.page, 'assetUrl').mockReturnValue('blob:element-test');
  expect(await insertEntry(entry)).toBe(true);
  const blocks = page.mounted.layer.blocks();
  expect(blocks).toHaveLength(3);
  const image = blocks.find((block) => block.type === 'image')!;
  expect(page.mounted.layer.view(image.id)).not.toBeNull();
  expect(assetTable(page.page).get(String(image.data.asset))).not.toBeNull();
  const text = blocks.find((block) => block.type === 'text' && block.data.markdown === 'Element words');
  expect(text).toBeDefined();
});
