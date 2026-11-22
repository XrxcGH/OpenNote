// The Tests panel in the built app: add a case, run it, see the failing difference between the expected and the
// actual output, fix the code, and see it pass. The runtimes are lanes of their own, so the run goes through a
// stand-in runner (testing/testHooks.ts) that prints the text of each print("...") line of the main file.

import { expect, test } from '../fixtures';
import { newLine, openSmart, runCommand } from './smart';

test.describe.configure({ timeout: 120_000 });

test('adds a case, runs it, reads the failing difference, fixes the code, and sees it pass', async ({ page }) => {
  await openSmart(page);
  await newLine(page);
  await runCommand(page, 'New code project');
  const studio = page.getByRole('dialog', { name: 'Code studio' });
  await expect(studio).toBeVisible();
  await page.evaluate(() =>
    (
      window as unknown as { __OPENNOTE_TEST__: { codeTestsFakeRunner(): void } }
    ).__OPENNOTE_TEST__.codeTestsFakeRunner(),
  );

  // A program with a slip in its output.
  const editor = studio.getByRole('textbox', { name: 'Code editor, main.py' });
  await editor.click();
  await page.keyboard.press('Control+a');
  await page.keyboard.insertText('print("Hello, Wrold!")\n');
  await expect(editor).toContainText('Wrold');

  // Add a case that expects the right output.
  await studio.getByRole('tab', { name: 'Tests' }).click();
  await studio.getByRole('button', { name: 'Add case' }).click();
  const form = studio.getByRole('form', { name: 'Test case' });
  await form.getByLabel('Name').fill('Greets the world');
  await form.getByLabel('Expected', { exact: true }).fill('Hello, World!');
  await form.getByRole('button', { name: 'Save case' }).click();
  await expect(studio.getByRole('button', { name: 'Greets the world', exact: true })).toBeVisible();
  await expect(studio.getByText('Not run', { exact: true })).toBeVisible();

  // Run all: it fails, with the text "Failed" and not only a color.
  await studio.getByRole('button', { name: 'Run all', exact: true }).click();
  await expect(studio.getByText('Failed', { exact: true })).toBeVisible();
  await expect(studio.getByText('0 of 1 passed, 1 did not')).toBeVisible();

  // The difference names each side.
  await studio.getByRole('button', { name: 'Greets the world', exact: true }).click();
  const diff = studio.getByLabel('Difference between the expected and the actual output');
  await expect(diff).toContainText('Expected');
  await expect(diff).toContainText('Hello, World!');
  await expect(diff).toContainText('Actual');
  await expect(diff).toContainText('Hello, Wrold!');

  // Fix the code and run only the failed cases.
  await editor.click();
  await page.keyboard.press('Control+a');
  await page.keyboard.insertText('print("Hello, World!")\n');
  await expect(editor).toContainText('World');
  await studio.getByRole('button', { name: 'Run failed', exact: true }).click();
  await expect(studio.getByText('Passed', { exact: true })).toBeVisible();
  await expect(studio.getByText('1 of 1 passed')).toBeVisible();
});

test('edits and deletes a case, and a time limit is part of the case', async ({ page }) => {
  await openSmart(page);
  await newLine(page);
  await runCommand(page, 'New code project');
  const studio = page.getByRole('dialog', { name: 'Code studio' });
  await studio.getByRole('tab', { name: 'Tests' }).click();
  await studio.getByRole('button', { name: 'Add case' }).click();
  const form = studio.getByRole('form', { name: 'Test case' });
  await form.getByLabel('Kind').selectOption('call');
  await form.getByLabel('Function to call').fill('two_sum');
  await form.getByLabel('Arguments as a JSON list').fill('[[2,7,11,15], 9]');
  await form.getByLabel('Expected value as JSON').fill('[0, 1]');
  await form.getByLabel('Time limit in seconds').fill('1.5');
  await form.getByRole('button', { name: 'Save case' }).click();
  await expect(studio.getByRole('button', { name: 'Case 1', exact: true })).toBeVisible();

  // Bad arguments cannot be saved.
  await studio.getByRole('button', { name: 'Edit Case 1' }).click();
  const again = studio.getByRole('form', { name: 'Test case' });
  await expect(again.getByLabel('Time limit in seconds')).toHaveValue('1.5');
  await again.getByLabel('Arguments as a JSON list').fill('[1, ');
  await expect(again.getByText('This is not a JSON list.')).toBeVisible();
  await expect(again.getByRole('button', { name: 'Save case' })).toBeDisabled();

  // Delete it.
  await again.getByRole('button', { name: 'Delete case' }).click();
  await expect(studio.getByRole('button', { name: 'Case 1', exact: true })).toBeHidden();
  await expect(studio.getByText('This project has no tests yet.')).toBeVisible();
});
