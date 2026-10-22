// The science helpers: scientific constants, Insert LaTeX, and significant figures open from the palette as dialogs
// and put their results into the page that is open.

import { expect, test } from '../fixtures';
import { openSmart, runCommand } from './smart';

test('inserts a constant and its value into the page', async ({ page }) => {
  await openSmart(page);
  const text = page.getByRole('textbox', { name: 'Text' }).first();
  await text.click();
  await runCommand(page, 'Insert a scientific constant');
  const dialog = page.getByRole('dialog', { name: 'Scientific constants' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('textbox', { name: 'Search constants' }).fill('boltzmann');
  await dialog.getByRole('button', { name: 'Insert the symbol and value of Boltzmann constant' }).click();
  await expect(text).toContainText('kB = 1.380649×10⁻²³ J K⁻¹');
});

test('shows a live LaTeX preview and inserts the equation', async ({ page }) => {
  await openSmart(page);
  await page.getByRole('textbox', { name: 'Text' }).first().click();
  await runCommand(page, 'Insert LaTeX');
  const dialog = page.getByRole('dialog', { name: 'Insert LaTeX' });
  await dialog.getByRole('button', { name: 'Fraction' }).click();
  await page.keyboard.type('a');
  await expect(dialog.locator('.katex')).toBeVisible();
  await dialog.getByRole('button', { name: 'Insert equation' }).click();
  await expect(page.locator('[data-math-inline], .katex').first()).toBeVisible();
});

test('rounds by the significant-figures rules and names the rule', async ({ page }) => {
  await openSmart(page);
  await runCommand(page, 'Open the significant-figures helper');
  const dialog = page.getByRole('dialog', { name: 'Significant figures' });
  await dialog.getByRole('textbox', { name: 'Calculate with significant figures' }).fill('2.50 * 3.1');
  await expect(dialog.getByText('7.8', { exact: true })).toBeVisible();
  await expect(dialog.getByText(/Multiplying and dividing/)).toBeVisible();
});

test('answers in the calculator by significant figures when the switch is on', async ({ page }) => {
  await openSmart(page);
  await runCommand(page, 'Open calculator');
  await page.getByRole('switch', { name: 'Significant figures' }).click();
  await page.getByRole('textbox', { name: 'Expression' }).fill('2.50 * 3.1');
  await page.keyboard.press('Enter');
  await expect(page.locator('#calc-result')).toHaveText('= 7.8');
});
