// Insert > From phone, in the production build on the web platform's fake local API: the command opens a dialog
// with a named QR code, the certificate fingerprint, and how long the code works; Done closes it.

import { expect, test } from '../fixtures';

test('opens the phone code from the Insert tab and closes it with Done', async ({ page }) => {
  await page.goto('/?fixture=sampler');
  await page.getByRole('tree', { name: 'Notebooks' }).getByRole('treeitem', { name: 'Lectures' }).click();
  await page.getByRole('tree', { name: 'Pages' }).getByRole('treeitem', { name: 'Membranes' }).click();
  await expect(page.getByText('Every kind of text')).toBeVisible({ timeout: 20_000 });

  await page.getByRole('tab', { name: 'Insert' }).click();
  // The bar shows what fits; the rest waits in More.
  const fromPhone = page.getByRole('toolbar').getByRole('button', { name: 'From phone' });
  if (await fromPhone.isVisible()) await fromPhone.click();
  else {
    await page.getByRole('toolbar').getByRole('button', { name: 'More' }).click();
    await page.getByRole('menuitem', { name: 'From phone' }).click();
  }

  const dialog = page.getByRole('dialog', { name: 'Add photos from your phone' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('img', { name: /QR code that opens a page on your phone/ })).toBeVisible();
  await expect(dialog.getByText(/certificate fingerprint/)).toBeVisible();
  await expect(dialog.getByText(/(AB:){31}AB/)).toBeVisible();
  await expect(dialog.getByText(/stops in \d+ min/)).toBeVisible();

  // While the code works, Done is the only button; Show a new code comes back once it stops.
  await expect(dialog.getByRole('button', { name: 'Show a new code' })).toHaveCount(0);

  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(dialog).toHaveCount(0);
});
