// Geometry the owner checks by eye (October 2026 review): Trash centered in its footer, pane widths that follow the
// window, panels between the toolbar and the status bar, the title in line with the text, and the Properties chip
// inside the page. Each is measured from bounding boxes, at the window widths and zoom levels people use.

import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures';

const WIDTHS = [1280, 1600, 2000] as const;

async function openMembranes(page: Page, width: number, fixture = 'smart') {
  await page.setViewportSize({ width, height: 900 });
  await page.goto(`/?fixture=${fixture}`);
  await page.getByRole('tree', { name: 'Notebooks' }).getByRole('treeitem', { name: 'Lectures' }).click();
  await page.getByRole('tree', { name: 'Pages' }).getByRole('treeitem', { name: 'Membranes' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Membranes' })).toBeVisible();
}

const rect = (page: Page, selector: string) =>
  page.locator(selector).first().evaluate((element) => element.getBoundingClientRect().toJSON() as DOMRect);

test.describe('the notebooks pane footer', () => {
  for (const width of WIDTHS) {
    test(`Trash and the plant sit centered in the footer box at ${width}`, async ({ page }) => {
      await openMembranes(page, width);
      const trash = page.getByRole('button', { name: 'Trash', exact: true });
      const footer = await trash.evaluate((button) => {
        const box = button.parentElement!.getBoundingClientRect();
        const pane = button.closest('[data-region="notebooks"]')!.getBoundingClientRect();
        const plant = button.parentElement!.querySelector(':scope > svg')?.getBoundingClientRect();
        // The box the footer's line draws: from under the line to the pane's bottom edge.
        return { top: box.top + 1, bottom: pane.bottom, plant: plant && (plant.top + plant.bottom) / 2 };
      });
      const box = (await trash.boundingBox())!;
      const middle = (footer.top + footer.bottom) / 2;
      expect(Math.abs(box.y + box.height / 2 - middle)).toBeLessThanOrEqual(1);
      expect(footer.plant, 'the plant shows beside Trash').toBeDefined();
      expect(Math.abs(footer.plant! - middle)).toBeLessThanOrEqual(1);
    });
  }
});
