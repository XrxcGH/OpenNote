// A tool popped out into a window of its own (?tool=...). The page never scrolls, so the tool's own box must: a kit
// taller than the window keeps its results, plots, and Insert button in reach.

import { expect, test } from '../fixtures';

for (const tool of ['kit-mind', 'kit-solids']) {
  for (const [width, height] of [
    [560, 720],
    [375, 812],
  ] as const) {
    test(`a popped-out ${tool} at ${width}x${height} scrolls its Insert button into view`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.goto(`/?tool=${tool}`, { waitUntil: 'domcontentloaded' });
      const main = page.locator('main');
      const insert = main.getByRole('button', { name: /^Insert/ }).last();
      await expect(insert).toBeAttached({ timeout: 20_000 });
      // The kit is taller than the window, so its last part starts below the fold and only scrolling can reach it.
      const sizes = await main.evaluate((box) => ({ scroll: box.scrollHeight, client: box.clientHeight }));
      expect(sizes.client).toBeLessThanOrEqual(height);
      expect(sizes.scroll).toBeGreaterThan(height);
      await insert.scrollIntoViewIfNeeded();
      await expect(insert).toBeInViewport();
      // The wheel reaches the very end: the scroll stops at scrollHeight - clientHeight, with the last part in view.
      await page.mouse.move(width / 2, height / 2);
      await expect(async () => {
        await page.mouse.wheel(0, 4000);
        expect(await main.evaluate((box) => box.scrollTop)).toBeGreaterThanOrEqual(sizes.scroll - sizes.client - 1);
      }).toPass({ timeout: 10_000 });
      const last = main.locator(':scope > *').last();
      const box = (await last.boundingBox())!;
      expect(box.y + box.height).toBeLessThanOrEqual(height);
    });
  }
}
