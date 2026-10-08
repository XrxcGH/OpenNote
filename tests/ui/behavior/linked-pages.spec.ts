// The linked pages pane in the production build on the web platform (Phase 8): Ctrl+Alt+G shows the pages that
// link to the open page and the pages that say its title without linking it, and Link turns those mentions into
// links.

import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures';

async function openPage(page: Page, title: string) {
  await page.getByRole('tree', { name: 'Notebooks' }).getByRole('treeitem', { name: 'Lectures' }).click();
  await page.getByRole('tree', { name: 'Pages' }).getByRole('treeitem', { name: title }).click();
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
}

const held = (page: Page) => () =>
  page.evaluate(() => {
    const hooks = (window as unknown as { __OPENNOTE_TEST__: Record<string, () => unknown> }).__OPENNOTE_TEST__;
    return JSON.stringify(hooks.pagesHeld());
  });

async function typeInPage(page: Page, text: string, saved: string) {
  const box = page.getByRole('textbox', { name: 'Text' }).first();
  await box.click();
  await page.keyboard.type(text);
  await expect.poll(held(page)).toContain(saved);
}

test('lists the pages that link here and opens one', async ({ page }) => {
  await page.goto('/');
  await openPage(page, 'Membranes');
  await typeInPage(page, 'See [[Mitosis]] now', 'now');
  await openPage(page, 'Mitosis');
  await page.keyboard.press('Control+Alt+KeyG');
  const pane = page.getByRole('region', { name: 'Linked pages' });
  await expect(pane.getByRole('heading', { name: '1 page links here' })).toBeVisible();
  await pane.getByRole('button', { name: 'Membranes' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Membranes' })).toBeVisible();
  // The pane follows the page that is open, and Escape closes it.
  await expect(pane.getByText('No page links here yet.')).toBeVisible();
  await pane.getByRole('heading', { name: 'Linked pages' }).focus();
  await page.keyboard.press('Escape');
  await expect(pane).toHaveCount(0);
});

test('links the pages that mention the title without a link', async ({ page }) => {
  await page.goto('/');
  await openPage(page, 'Meiosis');
  await typeInPage(page, 'Mitosis happens before this', 'before');
  await openPage(page, 'Mitosis');
  await page.keyboard.press('Control+Alt+KeyG');
  const pane = page.getByRole('region', { name: 'Linked pages' });
  await expect(pane.getByRole('heading', { name: '1 page mentions this title' })).toBeVisible();
  await pane.getByRole('button', { name: 'Link the mentions on Meiosis' }).click();
  await expect(pane.getByText('No page says this title without linking to it.')).toBeVisible();
  await openPage(page, 'Meiosis');
  await expect.poll(held(page)).toContain('](opennote:page/');
});
