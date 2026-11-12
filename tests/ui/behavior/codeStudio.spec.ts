// The Code studio in the built app: open it from a new Python project, run the project with input given at start,
// see the output, click the traceback's link to its line, and change the tab size in Settings, then Code. The
// runtimes are lanes of their own, so the run goes through the studio's test runner (window/testHooks.ts), which
// greets each input line and ends a program that has `raise` with a traceback naming that line.

import { expect, test } from '../fixtures';
import { newLine, openSmart, runCommand } from './smart';

test.describe.configure({ timeout: 120_000 });

const PROGRAM = 'name = input()\nprint(f"Hello, {name}!")\nraise ValueError("boom")\n';

test('creates a Python project, runs it with input, follows an error link, and changes the tab size', async ({
  page,
}) => {
  await openSmart(page);
  await newLine(page);
  await runCommand(page, 'New code project');
  const studio = page.getByRole('dialog', { name: 'Code studio' });
  await expect(studio).toBeVisible();
  await expect(page.getByRole('region', { name: 'Untitled project' })).toBeVisible();
  await expect(studio.getByRole('button', { name: 'main.py', exact: true })).toBeVisible();
  await page.evaluate(() =>
    (
      window as unknown as { __OPENNOTE_TEST__: { codeStudioFakeRunner(): void } }
    ).__OPENNOTE_TEST__.codeStudioFakeRunner(),
  );

  // Write the program: the editor's text replaced in one input.
  const editor = studio.getByRole('textbox', { name: 'Code editor, main.py' });
  await editor.click();
  await page.keyboard.press('Control+a');
  await page.keyboard.insertText(PROGRAM);
  await expect(editor).toContainText('raise ValueError');

  // Input at start, then Run.
  await studio.getByRole('button', { name: 'Input at start' }).click();
  await studio.getByLabel('Input the program reads at start').fill('Ada');
  await studio.getByRole('button', { name: 'Run', exact: true }).click();
  const log = studio.getByRole('log', { name: 'Console output' });
  await expect(log).toContainText('Hello, Ada!');
  await expect(log).toContainText('ValueError: boom');
  await expect(studio.getByRole('status').filter({ hasText: 'Ready' })).toBeVisible();

  // The traceback's file and line is a link to the line.
  await studio.getByRole('button', { name: 'Open main.py at line 3' }).click();
  await expect(studio.getByText('Line 3, column 1')).toBeVisible();
  await studio.getByRole('tab', { name: /Problems/ }).click();
  await expect(studio.getByRole('tabpanel')).toContainText('boom');

  // Settings, then Code: Python's tab size to 2. The open editor indents by 2 at once.
  await studio.getByRole('button', { name: 'Code settings' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Code' })).toBeVisible();
  const size = page.getByRole('spinbutton', { name: 'Tab size' });
  await expect(size).toHaveValue('4');
  await size.fill('2');
  await expect(size).toHaveValue('2');
  await editor.click();
  await page.keyboard.press('Control+Home');
  await page.keyboard.press('Tab');
  await expect(editor.locator('.cm-line').first()).toHaveText('  name = input()');
});

test('keeps text typed just before a page switch, and sends it to the page', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openSmart(page);
  await newLine(page);
  await runCommand(page, 'New code project');
  const studio = page.getByRole('dialog', { name: 'Code studio' });
  const editor = studio.getByRole('textbox', { name: 'Code editor, main.py' });
  await editor.click();
  await page.keyboard.press('Control+a');
  await page.keyboard.insertText('kept = 42\n');

  // Another page at once, well inside the studio's typing delay, then back.
  const pages = page.getByRole('tree', { name: 'Pages' });
  await pages.getByRole('treeitem').filter({ hasNotText: 'Membranes' }).first().click();
  await expect(page.getByRole('heading', { level: 1, name: 'Membranes' })).toBeHidden();
  await pages.getByRole('treeitem', { name: 'Membranes' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Membranes' })).toBeVisible();
  await expect(editor).toContainText('kept = 42');
  await expect(studio.getByText('Not on the page yet')).toHaveCount(0);

  // The page holds it: the studio opened again from the card shows it.
  await studio.getByRole('button', { name: 'Close Code studio' }).click();
  await expect(studio).toBeHidden();
  await page
    .getByRole('region', { name: 'Untitled project' })
    .getByRole('button', { name: 'Open in Code studio' })
    .click();
  await expect(editor).toContainText('kept = 42');
  expect(errors).toEqual([]);
});
