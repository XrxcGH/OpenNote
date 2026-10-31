// Charts (Phase 7): a chart made from a table in two steps draws below it, follows the data as it is edited, takes
// the table's filter, and can be changed or removed. The chart is named for screen readers and carries a legend.

import { expect, test } from '../fixtures';
import { fillSales, openSmart, setCell } from './smart';

async function addChart(page: import('@playwright/test').Page, kind: string): Promise<void> {
  await page.locator('table tr').nth(1).locator('td').first().click();
  await page.getByRole('button', { name: 'Data' }).click();
  await page.getByRole('menuitem', { name: 'Insert chart' }).click();
  await page.getByRole('menuitem', { name: kind }).click();
}

test('makes a bar chart from the table, named and with a legend', async ({ page }) => {
  await openSmart(page);
  await fillSales(page);
  await addChart(page, 'Bar chart');
  const chart = page.getByRole('img', { name: /^Bar chart: Sales, Cost by Month/ });
  await expect(chart.locator('svg')).toBeVisible();
  await expect(page.getByRole('list', { name: 'Legend' })).toContainText('Sales');
  await expect(page.getByRole('list', { name: 'Legend' })).toContainText('Cost');
});

test('updates when the data is edited', async ({ page }) => {
  await openSmart(page);
  await fillSales(page);
  await addChart(page, 'Bar chart');
  const svg = page.getByRole('img', { name: /^Bar chart/ }).locator('svg');
  await expect(svg).toBeVisible();
  const before = await svg.innerHTML();
  await setCell(page, 1, 1, '300');
  await expect.poll(async () => svg.innerHTML()).not.toBe(before);
});

test('changes kind, uses patterns, and removes the chart', async ({ page }) => {
  await openSmart(page);
  await fillSales(page);
  await addChart(page, 'Bar chart');
  await page.getByRole('button', { name: 'Chart options' }).click();
  await page.getByRole('menuitemradio', { name: 'Line chart' }).click();
  await expect(page.getByRole('img', { name: /^Line chart/ })).toBeVisible();
  await page.getByRole('button', { name: 'Chart options' }).click();
  await page.getByRole('menuitemcheckbox', { name: 'Use patterns as well as colors' }).click();
  await expect(page.locator('figure pattern').first()).toBeAttached();
  await page.getByRole('button', { name: 'Remove chart' }).click();
  await expect(page.locator('figure')).toHaveCount(0);
});

test('says so when the table has no numbers to chart', async ({ page }) => {
  await openSmart(page);
  for (const row of [1, 2, 3]) for (const column of [0, 1, 2]) await setCell(page, row, column, 'word');
  await addChart(page, 'Bar chart');
  await expect(page.locator('figure')).toHaveCount(0);
});
