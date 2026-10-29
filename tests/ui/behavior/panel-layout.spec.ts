// The layout of tool windows and page panes in narrow windows (layout audit, October 2026). Floating windows stay
// inside the window and clear of the page's scroll bar. A window's scrolling part reaches its bottom edge, with no band
// of padding cutting its last row. The Reading order and Contents panes leave the page a readable column.

import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import { openSmart } from './smart';

async function openMembranes(page: Page, width: number, height: number) {
  await openSmart(page);
  await page.setViewportSize({ width, height });
  await expect(page.getByRole('heading', { level: 1, name: 'Membranes' })).toBeVisible();
  await expect(page.locator('[contenteditable=true] p').first()).toBeVisible();
}

/** Runs a command from the palette. A tool window's own fields are comboboxes too, so this finds the palette by its placeholder. */
async function palette(page: Page, name: string) {
  const input = page.getByPlaceholder('Type a command or a page name');
  await expect(async () => {
    if (!(await input.isVisible())) await page.keyboard.press('Control+k');
    await expect(input).toBeFocused({ timeout: 2000 });
  }).toPass({ timeout: 20_000 });
  await input.fill(name);
  await page.getByRole('option', { name }).first().click();
}

test('two floating tool windows stay inside an 820 px window, the newer one in front', async ({ page }) => {
  await openMembranes(page, 820, 620);
  await palette(page, 'Open the reference tables');
  await palette(page, 'Open calculator');
  const reference = page.getByRole('dialog', { name: 'Reference tables' });
  const calculator = page.getByRole('dialog', { name: 'Calculator' });
  await expect(calculator).toBeVisible();
  for (const window of [reference, calculator]) {
    const box = (await window.boundingBox())!;
    expect(box.x, 'clear of the left edge').toBeGreaterThanOrEqual(8);
    expect(box.x + box.width, 'clear of the right edge').toBeLessThanOrEqual(820 - 8);
  }
  // The older window's title stays in reach, and pressing it brings the window to the front.
  await reference.getByRole('heading', { name: 'Reference tables' }).first().click();
  const front = await page.evaluate(() => {
    const z = (tool: string) => Number(getComputedStyle(document.querySelector(`[data-tool=${tool}]`)!).zIndex);
    return z('reference') > z('calculator');
  });
  expect(front).toBe(true);
});

test('a floating window keeps 8 px clear of the page scroll bar', async ({ page }) => {
  await openMembranes(page, 1280, 800);
  await palette(page, 'Open the reference tables');
  const window = (await page.getByRole('dialog', { name: 'Reference tables' }).boundingBox())!;
  const track = await page.evaluate(() => {
    const scroller =
      document.querySelector<HTMLElement>('[data-scope=page][class*=viewport]') ?? document.querySelector('main')!;
    return scroller.getBoundingClientRect().left + scroller.clientLeft + scroller.clientWidth;
  });
  expect(window.x + window.width).toBeLessThanOrEqual(track - 8 + 0.5);
});

test('the Reference tables scroll to the window bottom edge, with no band of padding under them', async ({ page }) => {
  await openMembranes(page, 1280, 800);
  await palette(page, 'Open the reference tables');
  const gap = await page.evaluate(() => {
    const window = document.querySelector('[data-tool=reference]')!;
    const panel = window.querySelector('[role=tabpanel]')!;
    return window.getBoundingClientRect().bottom - panel.getBoundingClientRect().bottom;
  });
  // Only the window's 1 px border lies under the part that scrolls.
  expect(gap).toBeLessThanOrEqual(1.5);
});

test('a short tool window is as tall as its content', async ({ page }) => {
  await openMembranes(page, 1280, 800);
  await palette(page, 'Open upcoming');
  const sizes = await page.evaluate(() => {
    const body = document.querySelector('[data-tool=upcoming]')!.lastElementChild!;
    return { scroll: body.scrollHeight, client: body.clientHeight };
  });
  expect(sizes.scroll).toBeLessThanOrEqual(sizes.client);
  const box = (await page.getByRole('dialog', { name: 'Upcoming' }).boundingBox())!;
  expect(box.y + box.height).toBeLessThan(760);
});

for (const [width, height] of [
  [1280, 800],
  [820, 620],
] as const) {
  test(`Reading order and Contents leave the page a readable column at ${width}`, async ({ page }) => {
    await openMembranes(page, width, height);
    // Both commands act on the page, so the caret goes into its text first.
    const text = page.locator('[contenteditable=true] p').first();
    await text.click();
    await palette(page, 'Reading order');
    await expect(page.getByRole('complementary', { name: 'Reading order' })).toBeVisible();
    await text.click();
    await palette(page, 'Show or hide the table of contents');
    await expect(page.getByRole('navigation', { name: 'Table of contents' })).toBeVisible();
    const column = await page.evaluate(() => {
      const scroller =
        document.querySelector<HTMLElement>('[data-scope=page][class*=viewport]') ?? document.querySelector('main')!;
      return scroller.getBoundingClientRect().width;
    });
    expect(column).toBeGreaterThanOrEqual(width >= 1280 ? 420 : 360);
    // Every button of the Reading order pane is inside the window.
    for (const name of ['Move up', 'Move down', 'Close reading order']) {
      const box = (await page.getByRole('button', { name }).boundingBox())!;
      expect(box.y + box.height, name).toBeLessThanOrEqual(height);
    }
  });
}
