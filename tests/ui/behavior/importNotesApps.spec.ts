// Import from Goodnotes, Notability, and Samsung Notes (ADR 0053), in the production build on the web platform's
// fake host. The dialog lists the three apps with their file types and the PDF export hint. A Goodnotes file
// reaches the review, which names the handwriting left out and the PDF route, and imports. A PDF points to Import
// PDF instead.

import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures';

type Hooks = Record<string, (...args: unknown[]) => unknown>;

async function openImport(page: Page, pick: string) {
  await page.goto('/');
  await expect(page.getByText('Biology 101')).toBeVisible();
  await page.evaluate(
    (path) => (window as unknown as { __OPENNOTE_TEST__: Hooks }).__OPENNOTE_TEST__.interopPickNext(path),
    pick,
  );
  await page.keyboard.press('Control+KeyK');
  await page
    .getByRole('combobox', { name: 'Search commands and pages' })
    .pressSequentially('import notes', { delay: 10 });
  await page.getByRole('option', { name: /Import notes/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Import notes' });
  await expect(dialog).toBeVisible();
  return dialog;
}

test('a Goodnotes document reaches the review, names what stays behind, and imports', async ({ page }) => {
  const dialog = await openImport(page, 'C:\\Notes\\Physics.goodnotes');
  const apps = dialog.getByRole('region', { name: 'Handwriting apps' });
  await expect(apps.getByText('Goodnotes documents (.goodnotes) and backups of them')).toBeVisible();
  await expect(apps.getByText(/Notability notes \(\.note\)/)).toBeVisible();
  await expect(apps.getByText('Samsung Notes files (.sdocx)')).toBeVisible();
  await expect(apps.getByText(/In Samsung Notes, choose Share, then PDF file/)).toBeVisible();

  await dialog.getByRole('button', { name: 'Choose a file…' }).click();
  await expect(
    dialog.getByRole('heading', { name: /5 pages will come into a new notebook called "Physics"/ }),
  ).toBeFocused();
  await expect(dialog.getByText('Goodnotes document: Physics.goodnotes')).toBeVisible();
  await expect(dialog.getByText(/private format that OpenNote cannot read yet/)).toBeVisible();

  await dialog.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(dialog.getByRole('heading', { name: 'Import finished' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Open notebook' }).click();
  await expect(page.getByRole('tree', { name: 'Notebooks' }).getByRole('treeitem', { name: 'Physics' })).toHaveCount(1);
});

test('a PDF points to Import PDF, which the dialog can start', async ({ page }) => {
  const dialog = await openImport(page, 'C:\\Notes\\Lecture.pdf');
  await dialog.getByRole('button', { name: 'Choose a file…' }).click();
  await expect(dialog.getByRole('heading', { name: "OpenNote can't import this yet" })).toBeVisible();
  await expect(dialog.getByText(/export them as a PDF in the app, then import that PDF/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Import a PDF…' }).click();
  await expect(dialog).toHaveCount(0);
});

test.describe('in a narrow window', () => {
  test.use({ viewport: { width: 360, height: 740 } });

  test('the handwriting apps list fits without sideways scrolling', async ({ page }) => {
    const dialog = await openImport(page, 'C:\\Notes\\Biology.note');
    const apps = dialog.getByRole('region', { name: 'Handwriting apps' });
    await apps.scrollIntoViewIfNeeded();
    await expect(apps).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
