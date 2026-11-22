// The formula bar of a table. It completes functions and hints their arguments. A click on the grid adds a reference
// in its color, and F4 cycles the "$" marks. An error cell explains itself in plain words. The Name manager defines a
// page name that another table's formula reads.

import type { Locator, Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import { openSmart } from './smart';

const table = (page: Page, which = 0): Locator => page.locator('table').nth(which);
const cell = (page: Page, row: number, column: number, which = 0): Locator =>
  table(page, which).locator('tr').nth(row).locator('td, th').nth(column);
const bar = (page: Page) => page.locator('[data-formula-bar]:visible');
const entry = (page: Page) => page.getByRole('textbox', { name: 'Contents of the active cell' });

/** Puts the caret in a cell's text, which makes it the active cell, and waits for the formula bar. */
async function activate(page: Page, row: number, column: number, which = 0): Promise<void> {
  await expect(async () => {
    await cell(page, row, column, which).locator('p').first().click();
    await expect(bar(page)).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 20_000 });
}

/** Types a formula into the active cell through the bar, and enters it. */
async function enterInBar(page: Page, text: string): Promise<void> {
  await entry(page).click();
  await page.keyboard.press('Control+a');
  await page.keyboard.type(text);
  await page.keyboard.press('Enter');
}

test.beforeEach(async ({ page }) => {
  await openSmart(page, 'formulaTables');
  // The table extras load with the table's editor; the keys number the cells once they are in.
  await expect(cell(page, 0, 0)).toHaveAttribute('aria-rowindex', '1', { timeout: 20_000 });
});

test('lists VLOOKUP first for =VLO, inserts it with Tab, and bolds the argument the caret is on', async ({ page }) => {
  await activate(page, 1, 3);
  await entry(page).click();
  await page.keyboard.type('=VLO');
  const options = page.getByRole('listbox', { name: 'Suggestions' }).getByRole('option');
  await expect(options.first()).toContainText('VLOOKUP');
  await page.keyboard.press('Tab');
  await expect(entry(page)).toHaveValue('=VLOOKUP(');
  const current = bar(page).locator('[data-current-arg]');
  await expect(current).toHaveText('lookup_value');
  await page.keyboard.type('9,');
  await expect(current).toHaveText('table_array');
});

test('adds C3 with a click while =A1+ is typed, and outlines C3 in the second reference color', async ({ page }) => {
  await activate(page, 1, 3);
  await entry(page).click();
  await page.keyboard.type('=A1+');
  await cell(page, 3, 2).click();
  await expect(entry(page)).toHaveValue('=A1+C3');
  await expect(entry(page)).toBeFocused();
  await expect(cell(page, 3, 2)).toHaveAttribute('data-formula-ref', '2');
  await expect(cell(page, 1, 0)).toHaveAttribute('data-formula-ref', '1');
});

test('cycles B2 through $B$2, B$2, $B2, and back to B2 with F4', async ({ page }) => {
  await activate(page, 1, 3);
  await entry(page).click();
  await page.keyboard.type('=B2');
  const seen: string[] = [];
  for (let i = 0; i < 4; i += 1) {
    await page.keyboard.press('F4');
    seen.push(await entry(page).inputValue());
  }
  expect(seen).toEqual(['=$B$2', '=B$2', '=$B2', '=B2']);
});

test('explains a VLOOKUP that finds nothing by naming 9 and A1:B3', async ({ page }) => {
  await activate(page, 1, 3);
  await enterInBar(page, '=VLOOKUP(9,A1:B3,2,FALSE)');
  await expect(cell(page, 1, 3)).toHaveAttribute('data-error', 'NA', { timeout: 10_000 });
  await activate(page, 1, 3);
  await bar(page).getByRole('button', { name: 'Why does this cell show #N/A?' }).click();
  const words = page.locator('[data-formula-explain]');
  await expect(words).toContainText('9');
  await expect(words).toContainText('A1:B3');
});

test('defines TaxRate = 0.0825 for the page, and =100*TaxRate in the other table shows 8.25', async ({ page }) => {
  await activate(page, 1, 0);
  await bar(page).getByRole('button', { name: 'Name manager' }).click();
  const dialog = page.getByRole('dialog', { name: 'Name manager' });
  await dialog.getByLabel('Name', { exact: true }).fill('TaxRate');
  await dialog.getByLabel('Refers to').fill('0.0825');
  await dialog.getByLabel('Scope').selectOption('page');
  await dialog.getByRole('button', { name: 'Define' }).click();
  await expect(dialog.getByRole('table', { name: 'Defined names' })).toContainText('TaxRate');
  await dialog.getByRole('button', { name: 'Close' }).last().click();
  await activate(page, 1, 1, 1);
  await enterInBar(page, '=100*TaxRate');
  await expect(cell(page, 1, 1, 1)).toHaveAttribute('data-shown', '8.25', { timeout: 10_000 });
});

test('opens Insert function with Shift+F3 from a cell, not only from the bar', async ({ page }) => {
  await activate(page, 1, 3);
  const before = await cell(page, 1, 3).innerText();
  await page.keyboard.press('Shift+F3');
  await expect(page.getByRole('dialog', { name: 'Insert function' })).toBeVisible();
  // The text program's Change case did not run on the cell.
  await expect(cell(page, 1, 3)).toHaveText(before);
});

test('outlines only the outer edges of a range in forced colors', async ({ page }) => {
  await page.emulateMedia({ forcedColors: 'active' });
  await activate(page, 1, 3);
  await entry(page).click();
  await page.keyboard.type('=A1:B2');
  await expect(cell(page, 1, 0)).toHaveAttribute('data-formula-ref', '1');
  const edges = (row: number, column: number) =>
    cell(page, row, column).evaluate((el) => {
      const style = getComputedStyle(el, '::after');
      return { left: style.borderLeftColor, right: style.borderRightColor };
    });
  const corner = await edges(1, 0);
  // A1's left edge is the range's outer edge; its right edge is inside the range and stays hidden.
  expect(corner.right).toBe('rgba(0, 0, 0, 0)');
  expect(corner.left).not.toBe('rgba(0, 0, 0, 0)');
});
