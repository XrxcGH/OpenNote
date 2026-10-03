// Phase 5's text geometry in a real browser: plain text, line boxes, offsets, and words, alike for static and
// mounted blocks, in page units, and layout listeners after an edit.
import { afterEach, describe, expect, it } from 'vitest';
import { initFlags } from '../../../app/flags';
import { createMemoryPageService } from '../../../services/pages/memory';
import { mountPage } from '../mount';
import type { MountedPage } from '../mount';
import { textPageFixture } from '../test/fixtures';
import { onBlockLayout, textGeometry } from './index';

const shown: { mounted: MountedPage; container: HTMLElement }[] = [];

afterEach(async () => {
  for (const { mounted, container } of shown.splice(0)) {
    await mounted.destroy();
    container.remove();
  }
});

const TEXT = 'Chlorophyll absorbs red and blue light and reflects green light back to our eyes every day';

async function open(): Promise<{ mounted: MountedPage; block: string }> {
  initFlags('dev', { 'page.editor': true });
  const fixture = textPageFixture(TEXT);
  const block = fixture.page.blocks[0]!;
  block.frame = { x: 100, y: 200, w: 200 };
  const service = createMemoryPageService([fixture]);
  const page = await service.open(fixture.page.id, { viewport: null });
  const container = document.body.appendChild(document.createElement('div'));
  Object.assign(container.style, { position: 'fixed', left: '0', top: '0', width: '800px', height: '600px' });
  const mounted = mountPage(container, page, { classNames: { viewport: '', world: '', underlay: '' } });
  mounted.viewport.setZoom(2, { x: 0, y: 0 });
  shown.push({ mounted, container });
  return { mounted, block: block.id };
}

describe('text geometry', () => {
  it('gives the same plain text and boxes for static and mounted blocks, in page units', async () => {
    const { mounted, block } = await open();
    const text = textGeometry.plainText(block);
    const boxes = textGeometry.lineBoxes(block);
    expect(text).toBe(TEXT);
    expect(boxes.length).toBeGreaterThan(2);
    for (const box of boxes) {
      expect(box.x).toBeGreaterThanOrEqual(99);
      // A line may end in a space that hangs a few units past the box.
      expect(box.x + box.w).toBeLessThanOrEqual(306);
    }
    expect(boxes[0]!.y).toBeGreaterThanOrEqual(199);
    mounted.pool.mount(block, null, 'target');
    expect(textGeometry.plainText(block)).toBe(text);
    expect(textGeometry.lineBoxes(block)).toEqual(boxes);
  });

  it('finds the rectangle of an offset and the word under a point', async () => {
    const { block } = await open();
    const at = TEXT.indexOf('absorbs') + 2;
    const rect = textGeometry.rectForOffset(block, at)!;
    expect(rect.y).toBeGreaterThanOrEqual(199);
    const word = textGeometry.rangeAt(block, { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 });
    expect(word && TEXT.slice(word.from, word.to)).toBe('absorbs');
  });

  it('tells layout listeners after an edit changes the block', async () => {
    const { mounted, block } = await open();
    let calls = 0;
    const stop = onBlockLayout(block, () => (calls += 1));
    const editor = mounted.pool.mount(block, { kind: 'end' }, 'target')!;
    editor.commands.insertContent('!');
    expect(calls).toBeGreaterThan(0);
    stop();
  });
});
