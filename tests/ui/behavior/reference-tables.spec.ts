// The reference tables in the production build: the element grid moves with the arrow keys and shows a detail card,
// the units sheet searches, and the chemistry tab balances an equation and finds a molar mass.

import { expect, test } from '../fixtures';

async function openReference(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByText('Biology 101')).toBeVisible();
  await page.keyboard.press('Control+KeyK');
  const box = page.getByRole('combobox', { name: 'Search commands and pages' });
  await box.pressSequentially('reference tables', { delay: 10 });
  await page.getByRole('option', { name: /Open the reference tables/ }).click();
  await expect(page.getByRole('tab', { name: 'Elements' })).toBeVisible();
}

test('the element grid moves with the keyboard and shows a detail card', async ({ page }) => {
  await openReference(page);
  await page.getByRole('tab', { name: 'Elements' }).click();
  const hydrogen = page.getByRole('button', { name: /^Hydrogen, symbol H, atomic number 1/ });
  await hydrogen.focus();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('End');
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByRole('region', { name: 'Fluorine' }).getByText('Electronegativity (Pauling)')).toBeVisible();
});

test('the units sheet searches and the chemistry tab balances and weighs', async ({ page }) => {
  await openReference(page);
  await page.getByRole('tab', { name: 'Units' }).click();
  await page.getByRole('textbox', { name: 'Search' }).fill('newton');
  await expect(page.getByRole('tabpanel', { name: 'Units' })).toContainText(/newton/i);
  await page.getByRole('tab', { name: 'Chemistry' }).click();
  await expect(page.getByRole('tabpanel', { name: 'Chemistry' }).getByRole('status').first()).toContainText(
    '2H₂ + O₂ → 2H₂O',
  );
  await page.getByRole('textbox', { name: 'Formula' }).fill('H2O');
  await expect(page.getByRole('tabpanel', { name: 'Chemistry' }).getByRole('status').nth(1)).toContainText('18.015');
});
