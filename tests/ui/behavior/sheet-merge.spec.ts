// Merged cells in the production build (ADR 0064): Merge cells asks before it removes text, keeps the top-left text, and
// Undo brings the removed text back in one step. Merge across makes one merge per row, Split cell takes a merge apart,
// and the arrow keys treat a merged cell as one cell.

import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import { openSmart, runCommand, setCell } from './smart';

const cellAt = (page: Page, row: number, column: number) =>
  page.locator('table tr').nth(row).locator('td, th').nth(column);

/** Empties one cell of the table. */
async function clearCell(page: Page, row: number, column: number): Promise<void> {
  // The table redraws once after an edit is saved, which can swallow a click, so the steps repeat until the cell is empty.
  await expect(async () => {
    await cellAt(page, row, column).click();
    await page.keyboard.press('End');
    await page.keyboard.press('Shift+Home');
    await page.keyboard.press('Backspace');
    await expect(cellAt(page, row, column)).toHaveText('', { timeout: 1000 });
  }).toPass({ timeout: 10_000 });
}

/** Says yes to the warning that a merge removes text. */
async function confirmMerge(page: Page): Promise<void> {
  await page.getByRole('dialog', { name: 'Merge these cells?' }).getByRole('button', { name: 'Merge' }).click();
}

/** Selects the cells between two cells of the table by dragging, as a person does. */
async function dragSelect(page: Page, from: [number, number], to: [number, number]): Promise<void> {
  // A table that redraws after an edit can swallow the first drag, so the drag repeats until the last cell is selected.
  await expect(async () => {
    const first = await cellAt(page, from[0], from[1]).boundingBox();
    const last = await cellAt(page, to[0], to[1]).boundingBox();
    if (!first || !last) throw new Error('cells are not shown');
    await page.mouse.move(first.x + first.width / 2, first.y + first.height / 2);
    await page.mouse.down();
    await page.mouse.move(last.x + last.width / 2, last.y + last.height / 2, { steps: 6 });
    await page.mouse.up();
    await expect(cellAt(page, to[0], to[1])).toHaveAttribute('aria-selected', 'true', { timeout: 1000 });
  }).toPass({ timeout: 10_000 });
}

test('merges B2:C3 after a warning, keeps B2, and Undo restores C3', async ({ page }) => {
  await openSmart(page);
  await setCell(page, 1, 1, 'keep');
  await setCell(page, 2, 2, 'lost');
  await clearCell(page, 1, 2);
  await clearCell(page, 2, 1);
  await dragSelect(page, [1, 1], [2, 2]);
  await runCommand(page, 'Merge cells');
  const dialog = page.getByRole('dialog', { name: 'Merge these cells?' });
  await expect(dialog).toContainText('1 value goes');
  await dialog.getByRole('button', { name: 'Merge' }).click();
  const merged = page.locator('table td[colspan="2"][rowspan="2"]');
  await expect(merged).toHaveText('keep');
  await expect(page.locator('table')).not.toContainText('lost');
  await page.keyboard.press('Control+z');
  await expect(page.locator('table td[colspan="2"]')).toHaveCount(0);
  await expect(page.locator('table')).toContainText('lost');
});

test('declining the warning leaves the table as it was', async ({ page }) => {
  await openSmart(page);
  await setCell(page, 1, 1, 'keep');
  await setCell(page, 2, 2, 'lost');
  await dragSelect(page, [1, 1], [2, 2]);
  await runCommand(page, 'Merge cells');
  const dialog = page.getByRole('dialog', { name: 'Merge these cells?' });
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.locator('table td[colspan="2"]')).toHaveCount(0);
  await expect(page.locator('table')).toContainText('lost');
});

test('merges across, then splits a merged cell back into cells', async ({ page }) => {
  await openSmart(page);
  await dragSelect(page, [1, 0], [2, 2]);
  await runCommand(page, 'Merge across');
  await confirmMerge(page);
  await expect(page.locator('table td[colspan="3"]')).toHaveCount(2);
  await cellAt(page, 1, 0).click();
  await page.keyboard.press('Control+k');
  await page.keyboard.type('Unmerge cells');
  await expect(page.getByRole('option').first()).toHaveText('Unmerge cells');
  await page.keyboard.press('Enter');
  await expect(page.locator('table td[colspan="3"]')).toHaveCount(1);
});

test('an arrow key crosses a merged cell as one cell', async ({ page }) => {
  await openSmart(page);
  await setCell(page, 3, 2, 'after');
  await dragSelect(page, [1, 1], [2, 2]);
  await runCommand(page, 'Merge cells');
  await confirmMerge(page);
  // From A2, Right enters the merge on B2, and Down from there leaves it for B4.
  await cellAt(page, 1, 0).click();
  await page.keyboard.press('Escape');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await page.keyboard.type('below');
  await expect(cellAt(page, 3, 1)).toContainText('below');
});

test('a merge in the first row survives an edit and a later merge', async ({ page }) => {
  await openSmart(page);
  await dragSelect(page, [0, 0], [0, 2]);
  await runCommand(page, 'Merge across');
  const dialog = page.getByRole('dialog', { name: 'Merge these cells?' });
  if (await dialog.isVisible({ timeout: 1500 }).catch(() => false)) await confirmMerge(page);
  await expect(page.locator('table [colspan="3"]')).toHaveCount(1);
  await setCell(page, 3, 2, 'edit');
  await dragSelect(page, [2, 0], [2, 1]);
  await runCommand(page, 'Merge cells');
  if (await dialog.isVisible({ timeout: 1500 }).catch(() => false)) await confirmMerge(page);
  await expect(page.locator('table [colspan="2"]')).toHaveCount(1);
  await expect(page.locator('table [colspan="3"]')).toHaveCount(1);
});
