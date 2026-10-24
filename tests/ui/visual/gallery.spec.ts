// The component gallery's pictures: every entry in each theme, at the mouse density and at the touch density.
// Like the screenshot matrix, an entry without a baseline is skipped until the update-screenshots workflow has
// taken it, so adding an entry never blocks a pull request on a missing image.

import { existsSync } from 'node:fs';
import { expect, test } from '../fixtures';
import { skipWithoutBaseline } from '../matrix';

const themes = ['light', 'dark'] as const;
const densities = ['mouse', 'touch'] as const;

for (const theme of themes) {
  for (const density of densities) {
    test(`gallery, ${theme} theme, ${density} density`, async ({ page }, testInfo) => {
      await page.goto(`/gallery.html?theme=${theme}&density=${density}`);
      const entries = await page.evaluate(() => window.__OPENNOTE_GALLERY__ ?? []);
      test.skip(entries.length === 0, 'No gallery entries yet.');
      let shown = 0;
      for (const entry of entries) {
        const name = `${entry.id}.${theme}.${density}.png`;
        if (skipWithoutBaseline(testInfo.config.updateSnapshots, existsSync(testInfo.snapshotPath(name)))) continue;
        await page.goto(`/gallery.html?entry=${entry.id}&theme=${theme}&density=${density}`);
        await expect(page.locator('[data-gallery-entry]')).toHaveScreenshot(name);
        shown += 1;
      }
      test.skip(shown === 0, 'No baselines yet. Run the update-screenshots workflow to take them.');
    });
  }
}
