// Daily notes, collections, quick capture, and the accessibility checker: each one's main path in the web build.
import type { Page } from '@playwright/test';
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

type TestHooks = Record<string, (...args: unknown[]) => unknown>;

/** Opens the quick capture window, with the shell's calls recorded and the named ones refused. */
async function openCapture(page: Page, refuse: string[]): Promise<void> {
  await page.addInitScript(() => {
    (window as unknown as { __OPENNOTE_WINDOW__: unknown }).__OPENNOTE_WINDOW__ = { kind: 'capture' };
    // The web build has no window to close: count the calls to the page's own close.
    (window as unknown as { closes: number }).closes = 0;
    window.close = () => void ((window as unknown as { closes: number }).closes += 1);
  });
  await page.goto('/?fixture=smart');
  await page.evaluate(
    (names) => (window as unknown as { __OPENNOTE_TEST__: TestHooks }).__OPENNOTE_TEST__.shellRecord(names),
    refuse,
  );
}

const shellCalls = (page: Page) =>
  page.evaluate(() => {
    const hooks = (window as unknown as { __OPENNOTE_TEST__: TestHooks }).__OPENNOTE_TEST__;
    return (hooks.shellCalls() as { name: string }[]).map((call) => call.name);
  });

test('quick capture: Ctrl+Enter saves the note and asks the shell to close the window', async ({ page }) => {
  await openCapture(page, []);
  const save = page.getByRole('button', { name: 'Save note' });
  const box = page.getByRole('textbox', { name: 'Quick note' });
  await expect(box).toBeVisible();
  await expect(save).toBeDisabled();
  await box.fill('Buy ink\nBlack and blue');
  await expect(save).toBeEnabled();
  await page.keyboard.press('Control+Enter');
  // A saved note hands over to the shell to close the window, and the text stays until the window is gone.
  await expect.poll(() => shellCalls(page)).toEqual(['window.closeCapture']);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(box).toHaveValue('Buy ink\nBlack and blue');
});

test('quick capture: when the shell cannot close the window, the window closes itself', async ({ page }) => {
  await openCapture(page, ['window.closeCapture']);
  await page.getByRole('textbox', { name: 'Quick note' }).fill('Call the lab');
  await page.keyboard.press('Control+Enter');
  await expect.poll(() => page.evaluate(() => (window as unknown as { closes: number }).closes)).toBe(1);
});

test('quick capture: Escape closes without saving', async ({ page }) => {
  await openCapture(page, []);
  await page.getByRole('textbox', { name: 'Quick note' }).fill('Never mind');
  await page.keyboard.press('Escape');
  await expect.poll(() => shellCalls(page)).toEqual(['window.closeCapture']);
});

test('accessibility checker: a clean page has no problems', async ({ page }) => {
  await openSmart(page);
  await runCommand(page, 'Check accessibility');
  const dialog = page.getByRole('dialog', { name: 'Check accessibility' });
  await expect(dialog).toContainText('No accessibility problems found.');
});

test('accessibility checker: finds an image with no description, and the fix clears it', async ({ page }) => {
  await openSmart(page, 'unlabeled');
  await runCommand(page, 'Check accessibility');
  const dialog = page.getByRole('dialog', { name: 'Check accessibility' });
  await expect(dialog).toContainText('Found 1 problem.');
  await expect(dialog).toContainText('An image has no description for screen readers.');
  await dialog.getByRole('textbox', { name: 'Description of the image' }).fill('A sketch of a cell membrane');
  await dialog.getByRole('button', { name: 'Add description' }).click();
  await expect(dialog).toContainText('No accessibility problems found.');
  await expect(dialog).not.toContainText('An image has no description for screen readers.');
});
