// The chemistry windows on the web platform: the commands open them from the palette, the calculator balances an
// equation, and the structure window puts a molecule on the page as separate, editable ink lines.
import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import { heldStrokes, inkPixels, openPage } from '../ink';

async function command(page: Page, text: string, option: RegExp): Promise<void> {
  await page.keyboard.press('Control+KeyK');
  const box = page.getByRole('combobox', { name: 'Search commands and pages' });
  await box.pressSequentially(text, { delay: 10 });
  await page.getByRole('option', { name: option }).first().click();
}

test('opens the chemistry calculators from the palette and balances an equation', async ({ page }) => {
  await openPage(page);
  await command(page, 'chemistry calc', /^Open the chemistry calculators/);
  const dialog = page.getByRole('dialog', { name: 'Chemistry calculators' });
  await expect(dialog.locator('[data-chem-answer]')).toContainText('C3H8 + 5O2 → 3CO2 + 4H2O');
  await dialog.getByRole('tab', { name: 'Stoichiometry' }).click();
  await dialog.getByLabel('Mass of N2 (g)').fill('10');
  await dialog.getByLabel('Mass of H2 (g)').fill('10');
  await expect(dialog.locator('[data-chem-answer]')).toContainText('Limiting reagent: N2');
  await expect(dialog.locator('[data-chem-answer]')).toContainText('NH3: 12.16 g');
});

test('draws a structure on the page as one line for each bond', async ({ page }) => {
  await openPage(page);
  await command(page, 'chemical structure', /^Open the chemical structure drawer/);
  const dialog = page.getByRole('dialog', { name: 'Chemical structures' });
  await dialog.getByLabel('Structure as SMILES text').fill('c1ccccc1');
  await expect(dialog.getByRole('img', { name: /Skeletal formula/ })).toBeVisible();
  const before = await inkPixels(page);
  await dialog.getByRole('button', { name: 'Put on page as ink' }).click();
  // Benzene: six ring bonds and three inner double-bond lines.
  await expect.poll(async () => (await heldStrokes(page)).length).toBe(9);
  expect(await inkPixels(page)).toBeGreaterThan(before + 100);
});

test('reads steam at 100 degrees from the property tables', async ({ page }) => {
  await openPage(page);
  await command(page, 'steam gas materials', /^Open the steam, gas, and materials tables/);
  const dialog = page.getByRole('dialog', { name: 'Property tables' });
  await expect(dialog).toContainText('100 °C · 101.42 kPa');
  await dialog.getByRole('tab', { name: 'Materials' }).click();
  await dialog.getByLabel('Search').fill('titanium');
  await expect(dialog.getByRole('row')).toHaveCount(2);
});
