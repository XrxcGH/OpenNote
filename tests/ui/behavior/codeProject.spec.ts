// Code projects in the built app: Insert code project from the palette, import a file into it, find a word that
// is only in that file with search, export the project as a .zip, and open it in the Code studio.

import { expect, test } from '../fixtures';
import { newLine, openSmart, runCommand } from './smart';

test.describe.configure({ timeout: 120_000 });

test('inserts a code project, imports a file, finds its code, exports, and opens the studio', async ({ page }) => {
  await openSmart(page);
  await newLine(page);
  await runCommand(page, 'Insert code project');
  const card = page.getByRole('region', { name: 'Untitled project' });
  await expect(card).toBeVisible();
  await expect(card).toContainText('Python · 1 file');
  await expect(card.getByRole('button', { name: 'Run' })).toBeVisible();

  await card.getByLabel('Choose files or a .zip to import into the project').setInputFiles({
    name: 'helper.py',
    mimeType: 'text/x-python',
    buffer: Buffer.from('def quokka_count(rows):\n    return len(rows)\n'),
  });
  await expect(card.getByRole('status').filter({ hasText: 'Imported 1 file.' })).toBeVisible();
  await expect(card).toContainText('Python · 2 files');

  // The project's fallback lists every file, and search indexes it, so a word only in the file is found.
  const held = () =>
    page.evaluate(() => {
      const hooks = (window as unknown as { __OPENNOTE_TEST__: Record<string, () => unknown> }).__OPENNOTE_TEST__;
      return JSON.stringify(hooks.pagesHeld());
    });
  await expect.poll(held).toContain('#### helper.py');
  await page.keyboard.press('Control+Shift+KeyF');
  const box = page.getByRole('combobox', { name: 'Search notes' });
  await box.fill('quokka');
  await expect(page.getByRole('option', { name: /Membranes/ })).toBeVisible();
  await page.keyboard.press('Escape');

  const download = page.waitForEvent('download');
  await card.getByRole('button', { name: 'Export as .zip' }).click();
  expect((await download).suggestedFilename()).toBe('Untitled project.zip');

  await card.getByRole('button', { name: 'Open in Code studio' }).click();
  await expect(page.getByRole('dialog', { name: 'Code studio' })).toBeVisible();
});
