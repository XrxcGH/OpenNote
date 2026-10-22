// Geometry the owner checks by eye (October 2026 review): Trash centered in its footer, pane widths that follow the
// window, panels between the toolbar and the status bar, the title in line with the text, and the Properties chip
// inside the page. Each is measured from bounding boxes, at the window widths and zoom levels people use.

import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import { runCommand } from './smart';

const WIDTHS = [1280, 1600, 2000] as const;

async function openMembranes(page: Page, width: number, fixture = 'smart') {
  await page.setViewportSize({ width, height: 900 });
  await page.goto(`/?fixture=${fixture}`);
  await page.getByRole('tree', { name: 'Notebooks' }).getByRole('treeitem', { name: 'Lectures' }).click();
  await page.getByRole('tree', { name: 'Pages' }).getByRole('treeitem', { name: 'Membranes' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Membranes' })).toBeVisible();
}

const rect = (page: Page, selector: string) =>
  page
    .locator(selector)
    .first()
    .evaluate((element) => element.getBoundingClientRect().toJSON() as DOMRect);

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

/** The left edges of the title's text and of the first line of body text, in CSS px. */
const textEdges = (page: Page) =>
  page.evaluate(() => {
    const left = (element: Element | null) => {
      if (!element) return Number.NaN;
      const range = document.createRange();
      range.selectNodeContents(element);
      return range.getClientRects()[0]?.left ?? Number.NaN;
    };
    return {
      title: left(document.querySelector('[data-page-title]')),
      text: left(document.querySelector('[contenteditable] p, [data-block-id] p')),
    };
  });

/** Page zoom in percent: the title's drawn height against its layout height. */
const pageZoom = (page: Page) =>
  page.evaluate(() => {
    const title = document.querySelector<HTMLElement>('[data-page-title]')!;
    return Math.round((title.getBoundingClientRect().height / title.offsetHeight) * 100);
  });

test.describe('the page title lines up with the text', () => {
  // Backgrounds are picked from the View tab, whose Background button shows in the bar at 2000.
  const papers: [width: number, mode: string, background: string | null][] = [
    [1280, 'Infinite canvas', null],
    [1280, 'Document flow', null],
    [1280, 'Pages with breaks', null],
    [2000, 'Infinite canvas', null],
    [2000, 'Document flow', 'Plain'],
    [2000, 'Document flow', 'Dot grid'],
    [2000, 'Document flow', 'Lined, college'],
    [2000, 'Pages with breaks', 'Plain'],
    [2000, 'Pages with breaks', 'Grid, 5 mm'],
  ];
  {
    for (const [width, mode, background] of papers) {
      test(`${mode}${background ? `, ${background}` : ''} at ${width}, 100% and 150%`, async ({ page }) => {
        await openMembranes(page, width, 'sampler');
        if (mode !== 'Infinite canvas') await runCommand(page, 'Document flow');
        if (mode === 'Pages with breaks') await runCommand(page, 'Pages with breaks');
        if (background) {
          await page.getByRole('tab', { name: 'View' }).click();
          await page.getByRole('toolbar').getByRole('button', { name: 'Background' }).click();
          await page.getByRole('menuitemradio', { name: background }).click();
        }
        await expect
          .poll(async () => Math.abs((await textEdges(page)).title - (await textEdges(page)).text))
          .toBeLessThanOrEqual(1);
        await page.locator('[contenteditable] p').first().click();
        await page.keyboard.press('Control+Alt+0');
        for (let step = 0; step < 6 && (await pageZoom(page)) < 150; step++)
          await page.keyboard.press('Control+Alt+Equal');
        expect(await pageZoom(page)).toBeGreaterThanOrEqual(150);
        await expect
          .poll(async () => Math.abs((await textEdges(page)).title - (await textEdges(page)).text))
          .toBeLessThanOrEqual(1);
      });
    }
  }
});
