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

/** The command bar's bottom edge (its divider line included) and the status line's top, in CSS px. */
const chrome = (page: Page) =>
  page.evaluate(() => {
    const bar = document.querySelector('[data-region="commandBar"]')!.getBoundingClientRect();
    const status = [...document.querySelectorAll('main div')].find(
      (element) => element.children.length < 4 && /^\d+ words?/.test(element.textContent ?? ''),
    );
    return { top: bar.bottom, bottom: status?.getBoundingClientRect().top ?? window.innerHeight };
  });

/** Opens a tool from the command palette, with the caret in the page's text. */
async function openTool(page: Page, name: string) {
  await page.locator('[contenteditable=true] p').first().click();
  await page.keyboard.press('Control+k');
  await page.getByPlaceholder('Type a command or a page name').fill(name);
  await page.getByRole('option', { name }).first().click();
}

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

test.describe('panels stay between the toolbar and the status line', () => {
  for (const [width, height] of [
    [1280, 900],
    [1600, 900],
    [2000, 900],
    [1280, 600],
  ] as const) {
    for (const tool of ['Citations', 'Timers']) {
      test(`${tool} at ${width} by ${height}`, async ({ page }) => {
        await openMembranes(page, width);
        await page.setViewportSize({ width, height });
        await openTool(page, `Open ${tool.toLowerCase()}`);
        const panel = page.getByRole('dialog', { name: tool });
        await expect(panel).toBeVisible();
        const edges = await chrome(page);
        expect(edges.bottom, 'the status line shows').toBeLessThan(height);
        const box = (await panel.boundingBox())!;
        expect(box.y, 'below the command bar and its line, with a gap').toBeGreaterThanOrEqual(edges.top + 4);
        expect(box.y + box.height, 'above the status line, with a gap').toBeLessThanOrEqual(edges.bottom - 4);
        // Dragged to the top, the panel still stops below the command bar.
        await panel.getByRole('heading', { name: tool }).or(panel.locator('header').first()).first().hover();
        await page.mouse.down();
        await page.mouse.move(box.x + 40, 0, { steps: 4 });
        await page.mouse.up();
        expect((await panel.boundingBox())!.y).toBeGreaterThanOrEqual(edges.top + 4);
      });
    }
  }
});

test.describe('the Properties chip', () => {
  for (const width of WIDTHS) {
    test(`stays inside the page area and clear of a new tool window at ${width}`, async ({ page }) => {
      await openMembranes(page, width);
      const chip = page.getByRole('button', { name: /^Properties/ });
      await expect(chip).toBeVisible();
      const main = (await page.locator('main').boundingBox())!;
      const box = (await chip.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(main.x);
      expect(box.x + box.width).toBeLessThanOrEqual(main.x + main.width);
      // Clear of the page's scroll bar, with a gap.
      const contentRight = await page.evaluate(() => {
        let element = document.querySelector('[data-page-title]') as HTMLElement | null;
        while (element && getComputedStyle(element).overflowY !== 'auto') element = element.parentElement;
        return element ? element.getBoundingClientRect().left + element.clientLeft + element.clientWidth : 0;
      });
      expect(box.x + box.width).toBeLessThanOrEqual(contentRight - 8);
      await openTool(page, 'Open citations');
      await expect(page.getByRole('dialog', { name: 'Citations' })).toBeVisible();
      const hit = await page.evaluate(
        ([x, y]) => document.elementFromPoint(x, y)?.closest('button')?.textContent ?? '',
        [box.x + box.width / 2, box.y + box.height / 2],
      );
      expect(hit).toMatch(/^Properties/);
    });
  }
});

test('a tool window wider than a phone-size window stays inside it', async ({ page }) => {
  await page.setViewportSize({ width: 420, height: 800 });
  await page.goto('/?fixture=smart');
  await page.getByRole('treeitem', { name: 'Lectures' }).first().click();
  await page.getByRole('treeitem', { name: 'Membranes' }).first().click();
  await expect(page.getByRole('heading', { level: 1, name: 'Membranes' })).toBeVisible();
  await openTool(page, 'Open citations');
  const box = (await page.getByRole('dialog', { name: 'Citations' }).boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(8);
  expect(box.x + box.width).toBeLessThanOrEqual(420 - 8);
});

test('a long title wraps before the Properties chip', async ({ page }) => {
  await openMembranes(page, 1280);
  const title = page.getByRole('textbox', { name: 'Page title' });
  await title.click();
  await page.keyboard.press('Control+a');
  await page.keyboard.type('Membrane transport, signalling and the fluid mosaic model, part two');
  const chip = (await page.getByRole('button', { name: /^Properties/ }).boundingBox())!;
  const right = await page.evaluate(() => {
    const range = document.createRange();
    range.selectNodeContents(document.querySelector('[data-page-title]')!);
    return Math.max(...[...range.getClientRects()].map((rect) => rect.right));
  });
  expect(right).toBeLessThanOrEqual(chip.x - 4);
});
