// Export in the production build, on the web platform's fake host. The tree's context menu opens a dialog.
// The dialog offers the page, section, and notebook, a format, and a folder. It then exports with progress
// and shows a summary.

import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures';

type Hooks = Record<string, (...args: unknown[]) => unknown>;

async function openExportFor(page: Page, row: string, title: RegExp) {
  await page.goto('/');
  const notebooks = page.getByRole('tree', { name: 'Notebooks' });
  await notebooks.getByRole('treeitem', { name: row }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Export…' }).click();
  const dialog = page.getByRole('dialog', { name: title });
  await expect(dialog).toBeVisible();
  return dialog;
}

test('exports a section as a Word document into the chosen folder', async ({ page }) => {
  const dialog = await openExportFor(page, 'Lectures', /^Export "Lectures"/);
  const scope = dialog.getByRole('radiogroup', { name: 'What to export' });
  await expect(scope.getByRole('radio', { name: /This section: "Lectures"/ })).toBeChecked();
  await dialog.getByRole('radio', { name: /Word document/ }).click();
  await dialog.getByRole('button', { name: 'Choose a folder…' }).click();
  await expect(dialog.getByText('C:\\Users\\Sample\\Documents')).toBeVisible();
  await dialog.getByRole('button', { name: 'Export', exact: true }).click();
  await expect(dialog.getByRole('heading', { name: 'Export finished' })).toBeVisible();

  const log = await page.evaluate(
    () => (window as unknown as { __OPENNOTE_TEST__: Hooks }).__OPENNOTE_TEST__.interopLog() as { exports: unknown[] },
  );
  expect(log.exports).toHaveLength(1);
  expect(log.exports[0]).toMatchObject({
    format: 'docx',
    scope: 'section',
    title: 'Biology 101',
    folder: 'C:\\Users\\Sample\\Documents',
    sections: [{ title: 'Lectures' }],
  });
  await dialog.getByRole('button', { name: 'Show in folder' }).click();
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(dialog).toHaveCount(0);
});

test('Export without a folder asks for one first', async ({ page }) => {
  const dialog = await openExportFor(page, 'Lectures', /^Export "Lectures"/);
  await dialog.getByRole('button', { name: 'Export', exact: true }).click();
  await expect(dialog.getByRole('heading', { name: 'Export finished' })).toBeVisible();
});

test('a notebook export sends every section, and Cancel keeps nothing', async ({ page }) => {
  const dialog = await openExportFor(page, 'Biology 101', /^Export "Biology 101"/);
  await expect(dialog.getByRole('radiogroup', { name: 'What to export' })).toHaveCount(0);
  await page.evaluate(() => (window as unknown as { __OPENNOTE_TEST__: Hooks }).__OPENNOTE_TEST__.interopStepMs(300));
  await dialog.getByRole('radio', { name: /^Web pages/ }).click();
  await dialog.getByRole('button', { name: 'Export', exact: true }).click();
  await expect(dialog.getByRole('progressbar', { name: 'Exporting your notes' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog.getByRole('button', { name: 'Export', exact: true })).toBeVisible();
  const log = await page.evaluate(
    () =>
      (window as unknown as { __OPENNOTE_TEST__: Hooks }).__OPENNOTE_TEST__.interopLog() as {
        exports: { sections: { title: string }[] }[];
        canceled: string[];
      },
  );
  expect(log.exports[0].sections.map((section) => section.title)).toEqual([
    'Lectures',
    'Labs',
    'Exam prep - Midterm',
    'Exam prep - Final',
  ]);
  expect(log.canceled).toHaveLength(1);
});
