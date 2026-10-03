// [[Page links]] in the production build on the web platform (Phase 8): typing [[ lists pages, a link shows its
// state, Ctrl+click opens the page, a resting pointer shows what the page says, and renaming a linked page
// updates the links that name it.

import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures';

async function openPage(page: Page, section: string, title: string) {
  await page.getByRole('tree', { name: 'Notebooks' }).getByRole('treeitem', { name: section }).click();
  await page.getByRole('tree', { name: 'Pages' }).getByRole('treeitem', { name: title }).click();
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
}

const held = (page: Page) => () =>
  page.evaluate(() => {
    const hooks = (window as unknown as { __OPENNOTE_TEST__: Record<string, () => unknown> }).__OPENNOTE_TEST__;
    return JSON.stringify(hooks.pagesHeld());
  });

async function typeInPage(page: Page, text: string, saved = text) {
  const box = page.getByRole('textbox', { name: 'Text' }).first();
  await box.click();
  await page.keyboard.type(text);
  await expect.poll(held(page)).toContain(saved);
  return box;
}

test('typing [[ lists pages, Enter links one, and the link shows its state', async ({ page }) => {
  await page.goto('/');
  await openPage(page, 'Lectures', 'Mitosis');
  await typeInPage(page, 'Cells divide in two');
  await openPage(page, 'Lectures', 'Membranes');
  const box = page.getByRole('textbox', { name: 'Text' }).first();
  await box.click();
  await page.keyboard.type('See [[Mit');
  const list = page.getByRole('listbox', { name: 'Pages to link' });
  await expect(list.getByRole('option', { name: 'Mitosis' })).toBeVisible();
  await expect(box).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Enter');
  await expect(list).toHaveCount(0);
  await page.keyboard.type(' and [[Nowhere]] too');
  const resolved = box.locator('.on-page-link[data-title="Mitosis"]');
  await expect(resolved).toHaveAttribute('data-status', 'resolved');
  await expect(resolved).toHaveText('[[Mitosis]]');
  await expect(box.locator('.on-page-link[data-title="Nowhere"]')).toHaveAttribute('data-status', 'broken');
  // The page keeps plain text, which crates/search reads.
  await expect.poll(held(page)).toContain('Mitosis');
});

test('Ctrl+click opens the linked page, and a resting pointer shows the first lines of it', async ({ page }) => {
  await page.goto('/');
  await openPage(page, 'Lectures', 'Mitosis');
  await typeInPage(page, 'Cells divide in two');
  await openPage(page, 'Lectures', 'Membranes');
  const box = await typeInPage(page, 'See [[Mitosis]] now', 'Mitosis');
  const link = box.locator('.on-page-link[data-title="Mitosis"]');
  await expect(link).toHaveAttribute('data-status', 'resolved');
  await link.hover();
  const card = page.getByRole('dialog', { name: 'Preview of Mitosis' });
  await expect(card).toContainText('Cells divide in two');
  await page.keyboard.press('Escape');
  await expect(card).toHaveCount(0);
  await link.click({ modifiers: ['Control'] });
  await expect(page.getByRole('heading', { level: 1, name: 'Mitosis' })).toBeVisible();
});

test('renaming a linked page updates the links to it', async ({ page }) => {
  await page.goto('/');
  await openPage(page, 'Lectures', 'Mitosis');
  await typeInPage(page, 'Cells divide in two');
  await openPage(page, 'Lectures', 'Membranes');
  await typeInPage(page, 'See [[Mitosis]] now', 'Mitosis');
  // Rename the page in the tree, then leave it so the title settles.
  const pages = page.getByRole('tree', { name: 'Pages' });
  await pages.getByRole('treeitem', { name: 'Mitosis' }).click();
  await page.keyboard.press('F2');
  await page.keyboard.type('Cell division');
  await page.keyboard.press('Enter');
  await expect(pages.getByRole('treeitem', { name: 'Cell division' })).toBeVisible();
  await pages.getByRole('treeitem', { name: 'Membranes' }).click();
  // The other page holds the link, so the app asks before it changes it.
  const ask = page.getByRole('dialog', { name: 'Update links to the renamed page?' });
  await expect(ask).toContainText('"Mitosis" to "Cell division"');
  await ask.getByRole('button', { name: 'Update links' }).click();
  await expect.poll(held(page)).toContain('Cell division');
  await expect(page.getByRole('textbox', { name: 'Text' }).first()).toContainText('See [[Cell division]] now');
});
