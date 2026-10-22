// Analyze on a smart table: statistics, regression, and matrix tools read the selected cells and add their answer
// below the table as a new table, a chart, or a display equation.

import { expect, test } from '../fixtures';
import { fillSales, openSmart } from './smart';

async function selectSales(page: import('@playwright/test').Page): Promise<void> {
  await page.locator('table tr').nth(1).locator('td').nth(1).click();
  await page
    .locator('table tr')
    .nth(3)
    .locator('td')
    .nth(1)
    .click({ modifiers: ['Shift'] });
}

async function analyze(page: import('@playwright/test').Page, ...path: string[]): Promise<void> {
  await page.getByRole('button', { name: 'Data' }).click();
  await page.getByRole('menuitem', { name: 'Analyze' }).click();
  for (const name of path) await page.getByRole('menuitem', { name }).click();
}

test('adds summary statistics of the selection as a table', async ({ page }) => {
  await openSmart(page);
  await fillSales(page);
  await selectSales(page);
  await analyze(page, 'Statistics', 'Summary statistics');
  await expect(page.getByRole('cell', { name: 'Median' })).toBeVisible();
});

test('adds a box plot chart', async ({ page }) => {
  await openSmart(page);
  await fillSales(page);
  await selectSales(page);
  await analyze(page, 'Statistics', 'Box plot with summary');
  await expect(page.getByRole('img', { name: /^Box plot/ }).locator('svg')).toBeVisible();
});

test('writes a fit as a display equation', async ({ page }) => {
  await openSmart(page);
  await fillSales(page);
  await selectSales(page);
  await analyze(page, 'Insert as an equation', 'Linear fit');
  await expect(page.getByText(/r\^\{2\}|r²/).first()).toBeAttached();
});
