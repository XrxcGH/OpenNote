// Shared steps for the smart tables, math, grapher, and tool window specs: open the sampler page, which has a table, a
// code block, and display math, and fill table cells the way a person does.
import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';

/** A page of text and a small table (?fixture=smart), open and ready. */
export async function openSmart(page: Page): Promise<void> {
  await page.goto('/?fixture=smart');
  await page.getByRole('tree', { name: 'Notebooks' }).getByRole('treeitem', { name: 'Lectures' }).click();
  await page.getByRole('tree', { name: 'Pages' }).getByRole('treeitem', { name: 'Membranes' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Membranes' })).toBeVisible();
}

/** Types into one cell of the page's table, replacing what was there. */
export async function setCell(page: Page, row: number, column: number, text: string): Promise<void> {
  const cell = page.locator('table tr').nth(row).locator('td, th').nth(column);
  await cell.click();
  await page.keyboard.press('End');
  await page.keyboard.press('Shift+Home');
  await page.keyboard.type(text);
}

/** A table of months and numbers, in place of the table's first cells. */
export async function fillSales(page: Page): Promise<void> {
  const rows = [
    ['Month', 'Sales', 'Cost'],
    ['Jan', '120', '80'],
    ['Feb', '150', '=B2*0.6'],
    ['Mar', '90', '70'],
  ];
  for (const [r, row] of rows.entries()) for (const [c, text] of row.entries()) await setCell(page, r, c, text);
  await page.locator('table tr').first().locator('th').first().click();
}

/** Puts the caret on a new empty line at the end of the page's text box. */
export async function newLine(page: Page): Promise<void> {
  const box = page.getByRole('textbox', { name: 'Text' }).first();
  await box.click();
  await expect(box).toHaveAttribute('contenteditable', 'true');
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
}

/** Runs a command from the palette by its name. */
export async function runCommand(page: Page, name: string): Promise<void> {
  await page.keyboard.press('Control+k');
  await page.keyboard.type(name);
  await page.getByRole('option', { name }).first().click();
}
