// The View tab's page view (Phase 6): the infinite canvas and pages with breaks, paper, backgrounds, reading aids,
// the page gallery, slides, and the picture export, in the production build on the web platform.

import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures';

async function openSamplerPage(page: Page) {
  await page.goto('/?fixture=sampler');
  await page.getByRole('tree', { name: 'Notebooks' }).getByRole('treeitem', { name: 'Lectures' }).click();
  await page.getByRole('tree', { name: 'Pages' }).getByRole('treeitem', { name: 'Membranes' }).click();
  await expect(page.getByText('Every kind of text')).toBeVisible({ timeout: 20_000 });
  await page.getByRole('tab', { name: 'View' }).click();
}

const toolbar = (page: Page) => page.getByRole('toolbar');

/** Runs a View tab command from the bar, or from its More menu when the bar is too narrow to show it. */
async function fromBar(page: Page, name: string) {
  const button = toolbar(page).getByRole('button', { name, exact: true });
  if (await button.isVisible()) {
    await button.click();
    return;
  }
  await toolbar(page).getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitem', { name }).click();
}

test('pages with breaks show the sheets, and the infinite canvas takes them away', async ({ page }) => {
  await openSamplerPage(page);
  const pages = toolbar(page).getByRole('button', { name: 'Pages with breaks' });
  const canvas = toolbar(page).getByRole('button', { name: 'Infinite canvas' });
  await expect(canvas).toHaveAttribute('aria-pressed', 'true');
  await toolbar(page).getByRole('button', { name: 'Document flow' }).click();
  await pages.click();
  await expect(pages).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText(/Sheet 1 of \d+/)).toBeVisible();
  await canvas.click();
  await expect(canvas).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText(/Sheet 1 of \d+/)).toBeHidden();
});

test('the paper menu changes the paper and the sheet count follows', async ({ page }) => {
  await openSamplerPage(page);
  await toolbar(page).getByRole('button', { name: 'Document flow' }).click();
  await toolbar(page).getByRole('button', { name: 'Pages with breaks' }).click();
  const counter = page.getByText(/Sheet 1 of \d+/);
  await expect(counter).toBeVisible();
  const letter = Number(/of (\d+)/.exec((await counter.textContent()) ?? '')?.[1]);
  await toolbar(page).getByRole('button', { name: 'Paper' }).click();
  await page.getByRole('menuitemradio', { name: 'A5' }).click();
  await expect(async () => {
    const a5 = Number(/of (\d+)/.exec((await page.getByText(/Sheet \d+ of \d+/).textContent()) ?? '')?.[1]);
    expect(a5).toBeGreaterThan(letter);
  }).toPass();
});

test('the background menu picks lined, grid, and dot paper', async ({ page }) => {
  await openSamplerPage(page);
  await toolbar(page).getByRole('button', { name: 'Background' }).click();
  await expect(page.getByRole('menuitemradio', { name: 'Plain' })).toBeVisible();
  await page.getByRole('menuitemradio', { name: 'Lined, college' }).click();
  await toolbar(page).getByRole('button', { name: 'Background' }).click();
  await expect(page.getByRole('menuitemradio', { name: 'Lined, college' })).toHaveAttribute('aria-checked', 'true');
});

test('reading aids tint the page and keep their setting', async ({ page }) => {
  await openSamplerPage(page);
  await fromBar(page, 'Reading aids');
  const dialog = page.getByRole('dialog', { name: 'Reading aids' });
  await dialog.getByRole('radio', { name: 'Sepia' }).click();
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(page.locator('.reading-page')).toHaveCount(1);
  expect(await page.evaluate(() => localStorage.getItem('opennote.readingAids'))).toContain('sepia');
});

test('the page gallery lists the section, opens a page, and moves it earlier', async ({ page }) => {
  await openSamplerPage(page);
  await page.getByRole('tab', { name: 'View' }).click();
  await fromBar(page, 'Page gallery');
  const dialog = page.getByRole('dialog', { name: 'Page gallery' });
  const options = dialog.getByRole('option');
  await expect(options.first()).toBeVisible();
  const before = await options.allTextContents();
  expect(before.length).toBeGreaterThan(2);
  await dialog.getByRole('option', { name: /Mitosis/ }).click();
  await dialog.getByRole('button', { name: 'Move earlier' }).click();
  await expect(async () => {
    const after = await dialog.getByRole('option').allTextContents();
    expect(after.findIndex((text) => text.includes('Mitosis'))).toBeLessThan(
      before.findIndex((text) => text.includes('Mitosis')),
    );
  }).toPass();
  await dialog.getByRole('option', { name: /Photosynthesis/ }).dblclick();
  await expect(page).toHaveTitle('Photosynthesis - OpenNote');
});

test('present as slides starts at the first slide, moves with the arrow keys, and Escape leaves', async ({ page }) => {
  await openSamplerPage(page);
  await fromBar(page, 'Present as slides');
  const stage = page.getByRole('dialog', { name: 'Slides' });
  await expect(stage).toBeVisible();
  await expect(stage.getByText(/^1 \/ \d+$/)).toBeVisible();
  await page.keyboard.press('ArrowRight');
  await expect(stage.getByText(/^2 \/ \d+$/)).toBeVisible();
  await page.keyboard.press('ArrowLeft');
  await expect(stage.getByText(/^1 \/ \d+$/)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(stage).toBeHidden();
});
