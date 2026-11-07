// Spreadsheet keys in a table (ADR 0063). Grid mode moves an active cell. Typing replaces a cell, and Esc puts it
// back. Enter finishes and moves down. Ctrl+D fills with references moved, and Ctrl+; enters today's date. A screen
// reader hears each cell, and Ctrl+K stays the palette. A table set to document keys keeps today's Enter.

import type { Locator, Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import { fillSales, openSmart, setCell } from './smart';

const cell = (page: Page, row: number, column: number): Locator =>
  page.locator('table tr').nth(row).locator('td, th').nth(column);

/** Grid mode on a cell: a click into its text, then Esc. */
async function gridAt(page: Page, row: number, column: number): Promise<void> {
  await cell(page, row, column).click();
  await page.keyboard.press('Escape');
  await expect(cell(page, row, column)).toHaveAttribute('aria-selected', 'true');
}

const selected = (page: Page) => page.locator('table [aria-selected="true"]');
/** The polite live region that says `text`. The announcer keeps two, and fills them in turn. */
const said = (page: Page, text: string) => page.locator('[aria-live="polite"]').filter({ hasText: text });

test.beforeEach(async ({ page }) => {
  await openSmart(page);
  // The keys load with the table's editor; every cell has its row number once they are in.
  await expect(cell(page, 0, 0)).toHaveAttribute('aria-rowindex', '1');
  await fillSales(page);
});

test('jumps to the edges of the data and selects to the first cell', async ({ page }) => {
  await gridAt(page, 1, 0);
  await page.keyboard.press('Control+ArrowDown');
  await expect(selected(page)).toHaveCount(1);
  await expect(cell(page, 3, 0)).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Control+ArrowRight');
  await expect(cell(page, 3, 2)).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Control+Shift+Home');
  await expect(selected(page)).toHaveCount(12);
});

test('types over a cell, puts it back with Esc, and finishes an F2 entry with Enter', async ({ page }) => {
  await gridAt(page, 1, 1);
  await page.keyboard.type('7');
  await expect(cell(page, 1, 1)).toHaveText('7');
  await page.keyboard.press('Escape');
  await expect(cell(page, 1, 1)).toHaveText('120');
  await page.keyboard.press('F2');
  await page.keyboard.type('5');
  await page.keyboard.press('Enter');
  await expect(cell(page, 1, 1)).toHaveText('1205');
  await expect(cell(page, 2, 1)).toHaveAttribute('aria-selected', 'true');
});

test('starts a new line with Alt+Enter, and with Enter once the table uses document keys', async ({ page }) => {
  const breaks = (at: Locator) => at.locator('br:not(.ProseMirror-trailingBreak)');
  await cell(page, 1, 0).click();
  await page.keyboard.press('End');
  await page.keyboard.press('Alt+Enter');
  await expect(breaks(cell(page, 1, 0))).toHaveCount(1);
  // The smart table's View list is a combobox too, so open the palette by its key and wait for its field.
  await page.keyboard.press('Control+k');
  await expect(page.getByRole('combobox').first()).toBeFocused();
  await page.keyboard.type('Use document keys');
  await page.getByRole('option', { name: 'Use document keys in this table' }).first().click();
  await cell(page, 3, 0).click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await expect(breaks(cell(page, 3, 0))).toHaveCount(1);
  await expect(selected(page)).toHaveCount(0);
});

test('fills a formula down with Ctrl+D and enters today’s date with Ctrl+;', async ({ page }) => {
  await gridAt(page, 2, 2);
  await page.keyboard.press('Shift+ArrowDown');
  await page.keyboard.press('Control+d');
  await expect(cell(page, 3, 2)).toContainText('=B3*0.6');
  await gridAt(page, 3, 1);
  await page.keyboard.press('Control+;');
  await page.keyboard.press('Enter');
  const today = await page.evaluate(() => {
    const now = new Date();
    return `${now.getMonth() + 1}/${now.getDate()}/${now.getFullYear()}`;
  });
  await expect(cell(page, 3, 1)).toHaveText(today);
});

test('tells a screen reader the address, header, value, and formula', async ({ page }) => {
  await setCell(page, 0, 2, 'Total');
  await setCell(page, 3, 1, '5');
  await setCell(page, 3, 2, '=B3*2');
  await gridAt(page, 2, 2);
  await page.keyboard.press('ArrowDown');
  await expect(said(page, 'C3, Total, 10, formula equals B3 times 2')).toHaveCount(1);
});

test('keeps Ctrl+K as the command palette in Grid mode', async ({ page }) => {
  await gridAt(page, 1, 0);
  await page.keyboard.press('Shift+ArrowRight');
  await page.keyboard.press('Control+k');
  await expect(page.getByRole('combobox').first()).toBeFocused();
});
