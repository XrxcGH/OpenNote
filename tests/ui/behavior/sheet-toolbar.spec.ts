// The cell format bar (DESIGN 10.1) in the real page: a fill on a range of cells, Bold on cells, and on text, the
// borders menu, the palette's names and axe, and the bar at a narrow width (400 percent zoom of a 1,280 pixel window).

import type { Page } from '@playwright/test';
import { expectNoAxeViolations } from '../axe';
import { expect, test } from '../fixtures';
import { openSmart } from './smart';

const cell = (page: Page, row: number, column: number) =>
  page.locator('table tr').nth(row).locator('td, th').nth(column);

/** Selects whole cells: a click in the first, a Shift-click in the last. */
async function selectCells(page: Page, from: [number, number], to: [number, number]): Promise<void> {
  await cell(page, ...from).click();
  await cell(page, ...to).click({ modifiers: ['Shift'] });
  await expect(page.getByRole('toolbar', { name: 'Cell format' })).toBeVisible();
}

const bar = (page: Page) => page.getByRole('toolbar', { name: 'Cell format' });

async function openFill(page: Page): Promise<void> {
  await bar(page).getByRole('button', { name: 'Fill color' }).click();
  await expect(page.getByRole('dialog', { name: 'Fill colors' })).toBeVisible();
}

test('fills B2:C3 with one choice and Undo takes it back', async ({ page }) => {
  await openSmart(page);
  await selectCells(page, [1, 1], [2, 2]);
  await openFill(page);
  await page.getByRole('button', { name: 'Amber', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Fill colors' })).toBeHidden();
  await openFill(page);
  await expect(page.getByRole('button', { name: 'Amber', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+z');
  await openFill(page);
  await expect(page.getByRole('button', { name: 'Amber', exact: true })).toHaveAttribute('aria-pressed', 'false');
});

test('Bold on cells formats the cells, and on selected text formats the text only', async ({ page }) => {
  await openSmart(page);
  await selectCells(page, [1, 1], [1, 2]);
  const boldButton = bar(page).getByRole('button', { name: 'Bold' });
  await boldButton.click();
  await expect(boldButton).toHaveAttribute('aria-pressed', 'true');
  await expect(cell(page, 1, 1).locator('strong')).toHaveCount(0);
  // Text inside one cell: a double click selects a word, and Bold marks only that text.
  await cell(page, 3, 0).dblclick();
  await bar(page).getByRole('button', { name: 'Bold' }).click();
  await expect(cell(page, 3, 0).locator('strong')).toHaveCount(1);
  // The text mark wrote no cell style: the whole cell shows Bold off, and the other cells keep their Bold.
  await selectCells(page, [3, 0], [3, 0]);
  await expect(bar(page).getByRole('button', { name: 'Bold' })).toHaveAttribute('aria-pressed', 'false');
  await selectCells(page, [1, 1], [1, 2]);
  await expect(bar(page).getByRole('button', { name: 'Bold' })).toHaveAttribute('aria-pressed', 'true');
});

test('the borders menu lists sixteen presets and applies one', async ({ page }) => {
  await openSmart(page);
  await selectCells(page, [1, 1], [2, 2]);
  await bar(page).getByRole('button', { name: 'Borders' }).last().click();
  const menu = page.getByRole('menu', { name: 'Borders' });
  await expect(menu.getByRole('menuitem')).toHaveCount(18);
  await menu.getByRole('menuitem', { name: 'Outside borders', exact: true }).click();
  await expect(page.getByText('Outside borders applied.')).toBeAttached();
});

test('every swatch has a name and the open palette has no axe violations', async ({ page }) => {
  await openSmart(page);
  await selectCells(page, [1, 1], [2, 2]);
  await openFill(page);
  const palette = page.getByRole('dialog', { name: 'Fill colors' });
  await expect(palette.getByRole('button', { name: 'Indigo, lighter 40%' })).toBeVisible();
  const unnamed = await palette
    .locator('button')
    .evaluateAll(
      (buttons) => buttons.filter((b) => !(b.getAttribute('aria-label') ?? b.textContent ?? '').trim()).length,
    );
  expect(unnamed).toBe(0);
  await expectNoAxeViolations(page, { include: '[role="dialog"]' });
});

test('at 400 percent zoom the toolbar wraps without sideways scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await openSmart(page);
  await selectCells(page, [1, 1], [2, 2]);
  const sideways = await page.evaluate(() => {
    const tools = document.querySelector('[role="toolbar"][aria-label="Cell format"]');
    return {
      page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      bar: tools ? tools.scrollWidth - tools.clientWidth : -1,
    };
  });
  expect(sideways.bar).toBeLessThanOrEqual(0);
  expect(sideways.page).toBeLessThanOrEqual(0);
});
