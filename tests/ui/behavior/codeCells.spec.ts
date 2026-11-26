// Code cells in the built app. Insert code cell from the palette and run Python in the run core's worker.
// Then JavaScript, TypeScript, and SQL, and Stop on a run that never ends. Then open a cell in the Code studio.
// Last, the cell's keys with two page tabs open (the L01 keymap, unchanged).

import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import { newLine, openSmart, runCommand } from './smart';

test.describe.configure({ timeout: 120_000 });

async function insertCell(page: Page) {
  await openSmart(page);
  await newLine(page);
  await runCommand(page, 'Insert code cell');
  const code = page.getByRole('textbox', { name: 'Code' });
  await expect(code).toBeVisible();
  return code;
}

/** Replaces the cell's text: the editor is a contenteditable, so select all and type. */
async function setCode(page: Page, text: string) {
  const code = page.getByRole('textbox', { name: 'Code' });
  await code.click();
  await page.keyboard.press('Control+a');
  await page.keyboard.insertText(text);
}

test('inserts a code cell, runs Python and JavaScript, and stops a long run', async ({ page }) => {
  await insertCell(page);
  const code = page.getByRole('textbox', { name: 'Code' });
  await setCode(page, 'print(sum(range(1, 101)))');
  await page.getByRole('button', { name: 'Run' }).click();
  const output = page.getByRole('log', { name: 'Output' });
  await expect(output).toHaveText('5050', { timeout: 30_000 });
  await expect(page.getByRole('status').filter({ hasText: /^Ran in / })).toBeVisible();

  await page.getByRole('combobox', { name: 'Language' }).selectOption('JavaScript');
  await setCode(page, '[1, 2, 3].map((n) => n * n)');
  await code.press('Control+Enter');
  await expect(output).toHaveText('→ [ 1, 4, 9 ]', { timeout: 30_000 });

  await setCode(page, 'while (true) {}');
  await page.getByRole('button', { name: 'Run' }).click();
  await page.getByRole('button', { name: 'Stop' }).click();
  await expect(page.getByRole('status').filter({ hasText: /^Stopped\.$/ })).toBeVisible();
});

test('runs a TypeScript cell', async ({ page }) => {
  await insertCell(page);
  await page.getByRole('combobox', { name: 'Language' }).selectOption('TypeScript');
  await setCode(page, 'const total: number = [1, 2, 3, 4].reduce((a, b) => a + b, 0);\nconsole.log(total);');
  await page.getByRole('button', { name: 'Run' }).click();
  await expect(page.getByRole('log', { name: 'Output' })).toHaveText('10', { timeout: 60_000 });
});

test('runs a SQL cell when the SQL runtime is installed', async ({ page }) => {
  await insertCell(page);
  await page.getByRole('combobox', { name: 'Language' }).selectOption('SQL');
  await setCode(page, 'SELECT 6 * 7 AS answer;');
  await page.getByRole('button', { name: 'Run' }).click();
  const done = page.getByRole('status').filter({ hasText: /^Ran in |cannot run in this version/ });
  await expect(done).toBeVisible({ timeout: 60_000 });
  // The SQL runtime (code:L07) is its own lane; until it is part of the build the cell says so.
  test.skip(
    (await done.textContent())?.includes('cannot run in this version') ?? false,
    'The SQL runtime is not in this build yet (code:L07).',
  );
  await expect(page.getByRole('log', { name: 'Output' })).toContainText('42');
});

test('opens the cell in the Code studio as a project with the same text', async ({ page }) => {
  await insertCell(page);
  await setCode(page, 'print("quokka")');
  const open = page.getByRole('button', { name: 'Open in Code studio' });
  test.skip((await open.count()) === 0, 'The Code studio is off in this build.');
  await open.click();
  const dialog = page.getByRole('dialog', { name: 'Open this code in the Code studio?' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Open in Code studio' }).click();
  const card = page.getByRole('region', { name: 'Untitled project' });
  await expect(card).toBeVisible();
  await expect(card).toContainText('Python · 1 file');
  const held = () =>
    page.evaluate(() => {
      const hooks = (window as unknown as { __OPENNOTE_TEST__: Record<string, () => unknown> }).__OPENNOTE_TEST__;
      return JSON.stringify(hooks.pagesHeld());
    });
  await expect.poll(held).toContain('print(\\"quokka\\")');
  // The cell is gone: the conversion replaced it.
  await expect(page.getByRole('textbox', { name: 'Code' })).toHaveCount(0);
});

test('the palette command opens the cell the caret is in, and one undo brings the cell back', async ({ page }) => {
  await insertCell(page);
  await setCode(page, 'print("wombat")');
  test.skip((await page.getByRole('button', { name: 'Open in Code studio' }).count()) === 0, 'The Code studio is off.');
  // The caret is in the cell's editor; the palette takes focus when it opens.
  await runCommand(page, 'Open code cell in Code studio');
  const dialog = page.getByRole('dialog', { name: 'Open this code in the Code studio?' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Open in Code studio' }).click();
  await expect(page.getByRole('region', { name: 'Untitled project' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Code', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Code', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Untitled project' })).toHaveCount(0);
});

async function openTwoTabs(page: Page): Promise<void> {
  await page.getByRole('tree', { name: 'Notebooks' }).getByRole('treeitem', { name: 'Labs' }).click();
  await page.getByRole('tree', { name: 'Pages' }).getByRole('treeitem', { name: 'Photosynthesis lab' }).focus();
  await page.keyboard.press('Control+Enter');
  await expect(page.getByRole('tablist', { name: 'Open pages' }).getByRole('tab')).toHaveCount(2);
}

/** The index of the selected page tab. Both tabs may show the same page, so the index tells them apart. */
const selectedTab = (page: Page) =>
  page
    .getByRole('tablist', { name: 'Open pages' })
    .getByRole('tab')
    .evaluateAll((tabs) => tabs.findIndex((tab) => tab.getAttribute('aria-selected') === 'true'));

test('a cell keeps the editor keys: Ctrl+Tab accepts and stays, Tab indents, Escape then Tab leaves', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByRole('tree', { name: 'Notebooks' })).toBeVisible();
  await openTwoTabs(page);
  const before = await selectedTab(page);
  await newLine(page);
  await runCommand(page, 'Insert code cell');
  const code = page.getByRole('textbox', { name: 'Code' });
  await expect(code).toBeVisible();
  await setCode(page, '');
  await page.keyboard.type('import numpy as ');
  const ghost = page.locator('.cm-ghost-text');
  await expect(ghost).toHaveText('np', { timeout: 20_000 });
  await page.keyboard.press('Control+Tab');
  await expect(code).toHaveText('import numpy as np');
  expect(await selectedTab(page)).toBe(before);

  // Tab indents by 4 spaces in a Python cell and the page tab stays.
  await page.keyboard.press('Home');
  await page.keyboard.press('Tab');
  await expect(code).toHaveText(/^\s{4}import numpy as np$/);
  expect(await selectedTab(page)).toBe(before);

  // Escape, then Tab, moves focus out of the cell; then Ctrl+Tab switches the page tab.
  await page.keyboard.press('Escape');
  await page.keyboard.press('Tab');
  await expect(code).not.toBeFocused();
  await page.keyboard.press('Control+Tab');
  await expect.poll(() => selectedTab(page)).not.toBe(before);
});

test('Ctrl+Shift+Tab inside a cell switches to the previous page tab', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('tree', { name: 'Notebooks' })).toBeVisible();
  await openTwoTabs(page);
  await newLine(page);
  await runCommand(page, 'Insert code cell');
  const code = page.getByRole('textbox', { name: 'Code' });
  await code.click();
  const before = await selectedTab(page);
  await page.keyboard.press('Control+Shift+Tab');
  await expect.poll(() => selectedTab(page)).not.toBe(before);
});
