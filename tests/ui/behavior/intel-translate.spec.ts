// Translate: choose a language, see the pack and its size, download it only when asked, and the translation is added
// below the original with Undo. The web build's stand-in marks each line with the target language, so this checks the
// flow, the consent, and that the original is never changed. Real translations come from the packs in the app.

import { expect, test } from '../fixtures';
import { openMembranes, runCommand, startWith } from '../intel';

test('asks for the pack before translating, adds the translation below the original, and can undo it', async ({
  page,
}) => {
  await startWith(page, []);
  await openMembranes(page);
  const box = page.getByRole('textbox', { name: 'Text' }).first();
  await box.click();
  await page.keyboard.type('Cells make energy.');
  await runCommand(page, 'Translate');
  const dialog = page.getByRole('dialog', { name: 'Translate on this device' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Translate to').selectOption('es');
  await expect(dialog).toContainText('English to Spanish');
  await expect(dialog).toContainText('119 MB');
  // Translate is not offered until the pack is on this computer.
  await expect(dialog.getByRole('button', { name: 'Translate', exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: /^Download English to Spanish/ }).click();
  await expect(dialog.getByText('The English to Spanish pack is on this device.')).toBeVisible({ timeout: 30_000 });
  await dialog.getByRole('button', { name: 'Translate', exact: true }).click();
  await expect(page.getByText('Added the translation below the original.')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('[es] Cells make energy.').first()).toBeVisible();
  await expect(box).toContainText('Cells make energy.');

  await page
    .locator('[role=status]')
    .filter({ hasText: 'Added the translation below the original.' })
    .getByRole('button', { name: 'Undo' })
    .click();
  await expect(page.getByText('[es] Cells make energy.')).toHaveCount(0);
  await expect(box).toContainText('Cells make energy.');
});

test('with Cancel, nothing is downloaded or added', async ({ page }) => {
  await startWith(page, []);
  await openMembranes(page);
  await page.getByRole('textbox', { name: 'Text' }).click();
  await page.keyboard.type('Cells make energy.');
  await runCommand(page, 'Translate');
  const dialog = page.getByRole('dialog', { name: 'Translate on this device' });
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText('[es] Cells make energy.')).toHaveCount(0);
});
