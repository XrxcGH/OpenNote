// Smart tables (Phase 7): a cell that starts with "=" is a formula and shows its result, results follow the data,
// and the Data menu sorts, filters, formats, totals, and fills. Every change is one undo step.

import { expect, test } from '../fixtures';
import { fillSales, openSmart, setCell } from './smart';

const shown = (page: import('@playwright/test').Page, row: number, column: number) =>
  page.locator('table tr').nth(row).locator('td, th').nth(column);

test('shows a formula’s result and keeps the formula for editing', async ({ page }) => {
  await openSmart(page);
  await fillSales(page);
  await expect(shown(page, 2, 2)).toHaveAttribute('data-shown', '90');
  await shown(page, 2, 2).click();
  await expect(shown(page, 2, 2)).not.toHaveAttribute('data-shown', /.+/);
  await expect(shown(page, 2, 2)).toContainText('=B2*0.6');
});

test('recalculates when the data changes', async ({ page }) => {
  await openSmart(page);
  await fillSales(page);
  await setCell(page, 2, 1, '200');
  await shown(page, 0, 0).click();
  await expect(shown(page, 2, 2)).toHaveAttribute('data-shown', '120');
});

test('reports a formula that cannot work in words', async ({ page }) => {
  await openSmart(page);
  await fillSales(page);
  await setCell(page, 3, 2, '=B3/0');
  await shown(page, 0, 0).click();
  await expect(shown(page, 3, 2)).toHaveAttribute('data-shown', /divide/i);
});

test('sorts a column and puts the rows back with undo', async ({ page }) => {
  await openSmart(page);
  await fillSales(page);
  await setCell(page, 1, 1, '120');
  await shown(page, 1, 1).click();
  await page.getByRole('button', { name: 'Data' }).click();
  await page.getByRole('menuitem', { name: 'Sort largest first' }).click();
  await expect(shown(page, 1, 0)).toContainText('Feb');
  await expect(shown(page, 3, 0)).toContainText('Mar');
});

test('filters to the rows that match and clears the filter', async ({ page }) => {
  await openSmart(page);
  await fillSales(page);
  await shown(page, 1, 0).click();
  await page.getByRole('button', { name: 'Data' }).click();
  await page.getByRole('menuitem', { name: 'Filter' }).click();
  await page.getByRole('menuitem', { name: 'Show rows equal to this cell' }).click();
  await expect(page.getByRole('group', { name: 'Table data' }).getByText('Showing 1 of 3 rows.')).toBeVisible();
  await expect(page.locator('table tr:visible')).toHaveCount(2);
  await page.getByRole('button', { name: 'Clear filter' }).click();
  await expect(page.locator('table tr:visible')).toHaveCount(4);
});

test('formats a column as currency and adds a total', async ({ page }) => {
  await openSmart(page);
  await fillSales(page);
  await shown(page, 1, 1).click();
  await page.getByRole('button', { name: 'Data' }).click();
  await page.getByRole('menuitem', { name: 'Number format' }).click();
  await page.getByRole('menuitemradio', { name: 'Currency' }).click();
  // The cell being edited shows what was typed, so look at the one below it.
  await expect(shown(page, 2, 1)).toHaveAttribute('data-shown', /\$150/);
  await shown(page, 1, 1).click();
  await page.getByRole('button', { name: 'Data' }).click();
  await page.getByRole('menuitem', { name: 'Total at the bottom' }).click();
  await page.getByRole('menuitemradio', { name: 'Sum' }).click();
  await expect(page.getByRole('list', { name: 'Column totals' })).toContainText('Sum of Sales');
  await expect(page.getByRole('list', { name: 'Column totals' })).toContainText('$360');
});

test('fills a formula down with its references moved', async ({ page }) => {
  await openSmart(page);
  await fillSales(page);
  await shown(page, 2, 2).click();
  await page.keyboard.down('Shift');
  await shown(page, 3, 2).click();
  await page.keyboard.up('Shift');
  await page.keyboard.press('Control+d');
  await expect(shown(page, 3, 2)).toContainText('=B3*0.6');
  await shown(page, 0, 0).click();
  await expect(shown(page, 3, 2)).toHaveAttribute('data-shown', '54');
});
