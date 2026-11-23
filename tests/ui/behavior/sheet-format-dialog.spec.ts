// The Format Cells dialog, cell styles, the format painter, and the table looks gallery in the real page. A custom
// code previews the sample, a broken code says where it breaks, a border edge toggle survives OK, a style applies to
// cells, and the painter copies one cell's format to another.

import type { Page } from '@playwright/test';
import { expectNoAxeViolations } from '../axe';
import { expect, test } from '../fixtures';
import { openSmart, setCell } from './smart';

const cell = (page: Page, row: number, column: number) =>
  page.locator('table tr').nth(row).locator('td, th').nth(column);
const bar = (page: Page) => page.getByRole('toolbar', { name: 'Cell format' });
const dialog = (page: Page, name: string) => page.getByRole('dialog', { name });

/** Selects whole cells: a click in the first, a Shift-click in the last. */
async function selectCells(page: Page, from: [number, number], to: [number, number]): Promise<void> {
  await cell(page, ...from).click();
  await cell(page, ...to).click({ modifiers: ['Shift'] });
  await expect(bar(page)).toBeVisible();
}

async function openFormat(page: Page): Promise<void> {
  await bar(page).getByRole('button', { name: 'Format cells' }).click();
  await expect(dialog(page, 'Format cells')).toBeVisible();
}

const tab = (page: Page, name: string) => dialog(page, 'Format cells').getByRole('tab', { name });

test('a custom code 0.00"x" on 2 previews 2.00x', async ({ page }) => {
  await openSmart(page);
  await setCell(page, 1, 1, '2');
  await selectCells(page, [1, 1], [1, 1]);
  await openFormat(page);
  await dialog(page, 'Format cells').getByLabel('Category').selectOption('custom');
  await dialog(page, 'Format cells').getByLabel('Format code').fill('0.00"x"');
  await expect(page.getByTestId('number-sample')).toHaveText('2.00x');
});

test('an unbalanced quote shows the error position and keeps OK waiting', async ({ page }) => {
  await openSmart(page);
  await setCell(page, 1, 1, '2');
  await selectCells(page, [1, 1], [1, 1]);
  await openFormat(page);
  const box = dialog(page, 'Format cells');
  await box.getByLabel('Category').selectOption('custom');
  await box.getByLabel('Format code').fill('0.00"x');
  await expect(box.getByRole('alert')).toHaveText('A quote is not closed at position 5.');
  await expect(box.getByRole('button', { name: 'OK' })).toHaveAttribute('aria-disabled', 'true');
});

test('the diagonal-down border toggle is kept after OK', async ({ page }) => {
  await openSmart(page);
  await selectCells(page, [1, 1], [1, 1]);
  await openFormat(page);
  await tab(page, 'Border').click();
  const diagonal = dialog(page, 'Format cells').getByRole('button', { name: 'Diagonal down border' });
  await diagonal.click();
  await expect(diagonal).toHaveAttribute('aria-pressed', 'true');
  await dialog(page, 'Format cells').getByRole('button', { name: 'OK' }).click();
  await expect(dialog(page, 'Format cells')).toBeHidden();
  await selectCells(page, [1, 1], [1, 1]);
  await openFormat(page);
  await tab(page, 'Border').click();
  await expect(dialog(page, 'Format cells').getByRole('button', { name: 'Diagonal down border' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});

test('the dialog tabs move with the arrow keys and have no axe violations', async ({ page }) => {
  await openSmart(page);
  await selectCells(page, [1, 1], [2, 2]);
  await openFormat(page);
  await tab(page, 'Number').focus();
  await page.keyboard.press('ArrowRight');
  await expect(tab(page, 'Alignment')).toHaveAttribute('aria-selected', 'true');
  await expectNoAxeViolations(page, { include: '[role="dialog"]' });
  await page.keyboard.press('Escape');
  await expect(dialog(page, 'Format cells')).toBeHidden();
});

test('a style applies to the selected cells and the painter copies it to another cell', async ({ page }) => {
  await openSmart(page);
  await selectCells(page, [1, 1], [1, 1]);
  await bar(page).getByRole('button', { name: 'Cell styles' }).click();
  const styles = dialog(page, 'Cell styles');
  await styles.getByRole('button', { name: 'Good', exact: true }).click();
  await styles.getByRole('button', { name: 'Apply' }).click();
  await expect(styles).toBeHidden();
  // Paint B2's format onto C3 with the format painter.
  await selectCells(page, [1, 1], [1, 1]);
  await bar(page).getByRole('button', { name: 'Format painter' }).click();
  await cell(page, 2, 2).click();
  await selectCells(page, [2, 2], [2, 2]);
  await openFormat(page);
  await tab(page, 'Fill').click();
  await expect(dialog(page, 'Format cells').getByLabel('Fill type')).toHaveValue('solid');
  await page.keyboard.press('Escape');
  await selectCells(page, [3, 2], [3, 2]);
  await openFormat(page);
  await tab(page, 'Fill').click();
  await expect(dialog(page, 'Format cells').getByLabel('Fill type')).toHaveValue('none');
});

test('the looks gallery lists 21 looks and applies one', async ({ page }) => {
  await openSmart(page);
  await selectCells(page, [1, 1], [1, 1]);
  await bar(page).getByRole('button', { name: 'Format as table' }).click();
  const gallery = dialog(page, 'Format as table');
  // 21 looks and "No look".
  await expect(gallery.getByRole('list', { name: 'Table looks' }).getByRole('button')).toHaveCount(22);
  await gallery.getByRole('button', { name: 'Medium indigo' }).click();
  await gallery.getByLabel('Banded rows').check();
  await gallery.getByRole('button', { name: 'Apply' }).click();
  await expect(gallery).toBeHidden();
  await expect(page.getByText('Table look Medium indigo applied.')).toBeAttached();
});
