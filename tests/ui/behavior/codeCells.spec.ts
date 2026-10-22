// Code cells in the built app: Insert code cell from the palette, run Python in the sandbox worker of the real bundle
// (its WebAssembly runtime included), switch to JavaScript, and stop a run that would never end.

import { expect, test } from '../fixtures';
import { newLine, openSmart, runCommand } from './smart';

test.describe.configure({ timeout: 120_000 });

test('inserts a code cell, runs Python and JavaScript, and stops a long run', async ({ page }) => {
  await openSmart(page);
  await newLine(page);
  await runCommand(page, 'Insert code cell');
  const code = page.getByRole('textbox', { name: 'Code' });
  await expect(code).toBeVisible();
  await code.fill('print(sum(range(1, 101)))');
  await page.getByRole('button', { name: 'Run' }).click();
  const output = page.getByRole('log', { name: 'Output' });
  await expect(output).toHaveText('5050', { timeout: 30_000 });
  await expect(page.getByRole('status').filter({ hasText: /^Ran in / })).toBeVisible();

  await page.getByRole('combobox', { name: 'Language' }).selectOption('JavaScript');
  await code.fill('[1, 2, 3].map((n) => n * n)');
  await code.press('Control+Enter');
  await expect(output).toHaveText('→ [1,4,9]', { timeout: 30_000 });

  await code.fill('while (true) {}');
  await page.getByRole('button', { name: 'Run' }).click();
  await page.getByRole('button', { name: 'Stop' }).click();
  await expect(page.getByRole('status').filter({ hasText: /^Stopped\.$/ })).toBeVisible();
});
