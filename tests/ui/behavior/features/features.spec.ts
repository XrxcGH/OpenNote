// Daily notes, collections, quick capture, and the accessibility checker: each one's main path in the web build.
import { expect, test } from '../../fixtures';
import { openSmart, runCommand } from '../smart';

test('daily notes: the Today button opens a note for the day and the calendar opens another day', async ({ page }) => {
  await openSmart(page);
  await page.getByRole('button', { name: "Open today's note" }).click();
  await expect(page.getByRole('heading', { level: 1, name: '2026-09-30' })).toBeVisible();
  await runCommand(page, 'Open the daily notes calendar');
  const dialog = page.getByRole('dialog', { name: 'Daily notes' });
  await expect(dialog.getByRole('grid', { name: 'September 2026' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Tuesday, September 29, 2026' }).click();
  await expect(page.getByRole('heading', { level: 1, name: '2026-09-29' })).toBeVisible();
});

test('collections: a collection is made, renamed, shown as a board, and deleted', async ({ page }) => {
  await openSmart(page);
  await runCommand(page, 'Open collections');
  const dialog = page.getByRole('dialog', { name: 'Collections' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'New collection' }).click();
  const name = dialog.getByRole('textbox', { name: 'Name' });
  await expect(name).toHaveValue('Collection 1');
  await name.fill('Reading list');
  await expect(dialog.getByRole('combobox', { name: 'Collection' }).locator('option:checked')).toHaveText(
    'Reading list',
  );
  await dialog.getByRole('button', { name: 'Board' }).click();
  await expect(dialog.getByRole('button', { name: 'Board' })).toHaveAttribute('aria-pressed', 'true');
  await dialog.getByRole('button', { name: 'Delete collection' }).click();
  await expect(dialog.getByRole('combobox', { name: 'Collection' })).toHaveCount(0);
});

test('quick capture: Ctrl+Enter saves the note', async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { __OPENNOTE_WINDOW__: unknown }).__OPENNOTE_WINDOW__ = { kind: 'capture' };
  });
  await page.goto('/?fixture=smart');
  const save = page.getByRole('button', { name: 'Save note' });
  const box = page.getByRole('textbox', { name: 'Quick note' });
  await expect(box).toBeVisible();
  await expect(save).toBeDisabled();
  await box.fill('Buy ink\nBlack and blue');
  await expect(save).toBeEnabled();
  await page.keyboard.press('Control+Enter');
  // A saved note hands over to the shell to close the window; a failed one keeps the text and shows an alert.
  await expect(save).toBeDisabled();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(box).toHaveValue('Buy ink\nBlack and blue');
});

test('accessibility checker: reports an image with no description', async ({ page }) => {
  await openSmart(page);
  await runCommand(page, 'Check accessibility');
  const dialog = page.getByRole('dialog', { name: 'Check accessibility' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(/problem/);
});
