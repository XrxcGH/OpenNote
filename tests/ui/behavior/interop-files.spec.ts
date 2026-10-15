// PDF export of a section, Share as a file, and Open file, on the web platform's fake host. The extra host
// operations these need (staging printed pages, reading, and writing an opened file) are off in the web build, like a
// copy of OpenNote without them, until a test turns them on before the app loads (platform/web/interopMore.ts).

import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures';

type Hooks = Record<string, (...args: unknown[]) => unknown>;

const hook = <T>(page: Page, name: string, ...args: unknown[]) =>
  page.evaluate(
    ([n, a]) => (window as unknown as { __OPENNOTE_TEST__: Hooks }).__OPENNOTE_TEST__[n as string](...(a as unknown[])),
    [name, args] as const,
  ) as Promise<T>;

const withHost = (page: Page) =>
  page.addInitScript(() => {
    (window as unknown as { __OPENNOTE_INTEROP_MORE__: boolean }).__OPENNOTE_INTEROP_MORE__ = true;
  });

async function menuOn(page: Page, row: string, item: string) {
  const notebooks = page.getByRole('tree', { name: 'Notebooks' });
  await notebooks.getByRole('treeitem', { name: row }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: item }).click();
}

test('PDF is offered only where pages can be printed', async ({ page }) => {
  await page.goto('/');
  await menuOn(page, 'Lectures', 'Export…');
  const dialog = page.getByRole('dialog', { name: /^Export "Lectures"/ });
  await expect(dialog.getByRole('radio', { name: /Word document/ })).toBeVisible();
  await expect(dialog.getByRole('radio', { name: /PDF files/ })).toHaveCount(0);
});

test('a section exports as one PDF file for each page and an index', async ({ page }) => {
  await withHost(page);
  await page.goto('/');
  await menuOn(page, 'Lectures', 'Export…');
  const dialog = page.getByRole('dialog', { name: /^Export "Lectures"/ });
  await dialog.getByRole('radio', { name: /PDF files/ }).click();
  await dialog.getByRole('button', { name: 'Choose a folder…' }).click();
  await dialog.getByRole('button', { name: 'Export', exact: true }).click();
  await expect(dialog.getByRole('heading', { name: 'Export finished' })).toBeVisible({ timeout: 30_000 });
  const log = await hook<{ exports: { format: string; sections: { pages: unknown[] }[] }[] }>(page, 'interopLog');
  expect(log.exports.at(-1)?.format).toBe('pdf');
  const pages = log.exports.at(-1)?.sections[0].pages.length ?? 0;
  const staged = await hook<Record<string, Record<string, number>>>(page, 'interopStaged');
  const printed = Object.values(staged).flatMap((job) => Object.values(job));
  expect(printed).toHaveLength(pages);
  for (const bytes of printed) expect(bytes).toBeGreaterThan(40);
});

test('Share as a file asks for the password twice and can take the page history', async ({ page }) => {
  await page.goto('/');
  await menuOn(page, 'Lectures', 'Share as a file…');
  const dialog = page.getByRole('dialog', { name: 'Share "Lectures" as a file' });
  await expect(dialog).toBeVisible();
  const first = ['pen', 'cil'].join('');
  await dialog.getByLabel('Password (optional)').fill(first);
  await dialog.getByLabel('Type the password again').fill(`${first}s`);
  await dialog.getByRole('button', { name: 'Share', exact: true }).click();
  await expect(dialog.getByText('The two passwords are not the same.').first()).toBeVisible();
  await dialog.getByLabel('Type the password again').fill(first);
  await dialog.getByRole('switch', { name: 'Include page history' }).click();
  await dialog.getByRole('button', { name: 'Share', exact: true }).click();
  await expect(dialog.getByRole('heading', { name: 'Export finished' })).toBeVisible();
  const log = await hook<{ exports: { format: string; history?: boolean; password?: string }[] }>(page, 'interopLog');
  expect(log.exports.at(-1)).toMatchObject({ format: 'share', history: true });
  expect(log.exports.at(-1)?.password).toBe(first);
});

test('Open file makes a page that saves back to the file and takes outside edits', async ({ page }) => {
  await withHost(page);
  await page.goto('/');
  await expect(page.getByText('Biology 101')).toBeVisible();
  const path = 'C:\\Users\\Sample\\Documents\\Groceries.md';
  await hook(page, 'interopFile', path, 'Milk and eggs');
  await hook(page, 'interopPickNext', path);
  await page.keyboard.press('Control+KeyK');
  await page.getByRole('combobox', { name: 'Search commands and pages' }).pressSequentially('Open file', { delay: 10 });
  await page.getByRole('option', { name: /^Open file…/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Groceries' })).toBeVisible();
  const box = page.getByRole('textbox', { name: 'Text' }).first();
  await expect(box).toHaveText('Milk and eggs');
  await box.click();
  await page.keyboard.press('End');
  await page.keyboard.type(' and bread');
  await expect.poll(() => hook<string | null>(page, 'interopFileText', path), { timeout: 15_000 }).toBe(
    'Milk and eggs and bread',
  );
  // Another app changes the file; the page shows it a moment later.
  await hook(page, 'interopFile', path, 'Only apples', { granted: true });
  await expect(box).toHaveText('Only apples', { timeout: 15_000 });
});
