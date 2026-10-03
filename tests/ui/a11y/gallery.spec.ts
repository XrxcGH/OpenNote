// Axe on every gallery entry, in both themes and at both densities. Unlike the pictures, this needs no baselines,
// so a new entry is checked for accessibility from the day it is added.

import { expectNoAxeViolations } from '../axe';
import { expect, test } from '../fixtures';

const themes = ['light', 'dark'] as const;
const densities = ['mouse', 'touch'] as const;

for (const theme of themes) {
  for (const density of densities) {
    test(`gallery entries have no axe violations, ${theme} theme, ${density} density`, async ({ page }) => {
      await page.goto(`/gallery.html?theme=${theme}&density=${density}`);
      const entries = await page.evaluate(() => window.__OPENNOTE_GALLERY__ ?? []);
      expect(entries.length, 'the gallery lists its entries').toBeGreaterThan(0);
      for (const entry of entries) {
        await page.goto(`/gallery.html?entry=${entry.id}&theme=${theme}&density=${density}`);
        await page.locator('[data-gallery-entry]').waitFor();
        await expectNoAxeViolations(page, { include: '[data-gallery-entry]' });
      }
    });
  }
}
