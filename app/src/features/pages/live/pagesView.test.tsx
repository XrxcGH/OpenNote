/* eslint-disable opennote/feature-boundaries -- This test mounts the real page assembly with the page feature's harness. */
// The paginated view on a real page assembly, in a real browser: switching the mode saves one view change, the sheets
// appear, and no line of text lands in the gap between two sheets or in a sheet's margin.
import { afterEach, describe, expect, it } from 'vitest';
import { pageFixtures } from '../../page/test/fixtures';
import { cleanupPages, renderPage } from '../../page/test/harness';
import type { PageHarness } from '../../page/test/harness';
import { pageLayout, readView } from '../layout';
import { attachPagesView } from './controller';
import { shownPagesView } from './shown';

let detach: (() => void) | null = null;

async function paginated(): Promise<{ harness: PageHarness; layout: ReturnType<typeof pageLayout> }> {
  const harness = await renderPage({ fixture: pageFixtures.sampler });
  detach = attachPagesView(harness.mounted);
  shownPagesView.get()?.setLayout('flow');
  shownPagesView.get()?.setMode('paginated');
  const layout = pageLayout(readView(harness.mounted.layout.view()).view);
  await new Promise((done) => setTimeout(done, 400));
  return { harness, layout };
}

afterEach(async () => {
  detach?.();
  detach = null;
  await cleanupPages();
});

/** The top and bottom of every line of text in the page, in page units. */
function lineBoxes(harness: PageHarness): { top: number; bottom: number }[] {
  const world = harness.mounted.viewport.world.getBoundingClientRect();
  const zoom = harness.mounted.viewport.camera().zoom;
  const boxes: { top: number; bottom: number }[] = [];
  for (const root of harness.mounted.viewport.world.querySelectorAll('[data-block]')) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.textContent?.trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      for (const rect of range.getClientRects()) {
        if (rect.width === 0) continue;
        boxes.push({ top: (rect.top - world.top) / zoom, bottom: (rect.bottom - world.top) / zoom });
      }
    }
  }
  return boxes;
}

describe('the paginated view', () => {
  it('saves one view change for the switch and shows the sheets', async () => {
    const { harness, layout } = await paginated();
    expect(layout.paginated).toBe(true);
    const state = shownPagesView.get()?.state();
    expect(state?.mode).toBe('paginated');
    expect(state?.sheets).toBeGreaterThan(1);
    const sent = harness.sent().flatMap((batch) => batch.edits);
    const views = sent.filter((edit) => edit.edit === 'setPage' && edit.view?.mode === 'paginated');
    expect(views).toHaveLength(1);
  });

  it('keeps every line out of the gap between sheets and out of the margins', async () => {
    const { harness, layout } = await paginated();
    const { sheet } = layout;
    const [top, , bottom] = sheet.margins;
    const lines = lineBoxes(harness).filter((line) => line.top > top - 1);
    expect(lines.length).toBeGreaterThan(20);
    for (const line of lines) {
      const k = Math.floor((line.top + 1) / sheet.height);
      const into = line.top - k * sheet.height;
      const out = (k + 1) * sheet.height - line.bottom;
      expect(into, `a line at ${line.top} starts in the top margin of sheet ${k + 1}`).toBeGreaterThanOrEqual(top - 1);
      // A line may reach down to the bottom margin, never into it, unless it is the one tall piece.
      expect(out, `a line at ${line.top} ends in the bottom margin of sheet ${k + 1}`).toBeGreaterThanOrEqual(
        bottom - 8,
      );
    }
  });

  it('takes the spacers away when the person goes back to the infinite canvas', async () => {
    const { harness } = await paginated();
    shownPagesView.get()?.setMode('infinite');
    await new Promise((done) => setTimeout(done, 300));
    const world = harness.mounted.viewport.world;
    expect(world.querySelectorAll('[data-pg-push], [data-pg-spacer]')).toHaveLength(0);
    for (const wrapper of world.querySelectorAll<HTMLElement>('[data-block-id]')) {
      expect(wrapper.style.marginBlockStart).toBe('');
    }
    expect(shownPagesView.get()?.state().mode).toBe('infinite');
  });
});
