// The function grapher (Phase 10): a graph code block draws its functions live, zooms, and pans from the keyboard,
// reads values and slopes, and gives each letter besides x a slider. The block's text is the whole graph.

import { expect, test } from '../fixtures';
import { newLine, openSmart } from './smart';

async function addGraph(page: import('@playwright/test').Page): Promise<void> {
  await openSmart(page);
  await newLine(page);
  await page.keyboard.type('/graph');
  await expect(page.getByRole('option', { name: 'Insert graph' })).toBeVisible();
  await page.keyboard.press('Enter');
  // The grapher loads on first use, which a development server takes a moment over.
  await expect(page.getByRole('application', { name: /^Graph of/ })).toBeVisible({ timeout: 20_000 });
}

test('draws a graph from a slash command and shows its functions as text', async ({ page }) => {
  await addGraph(page);
  await expect(page.getByRole('application', { name: /^Graph of 1 function/ })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Function 1' })).toHaveValue('y = sin(x)');
  await expect(page.locator('pre', { hasText: 'y = sin(x)' }).last()).toBeVisible();
});

test('zooms from the keyboard and keeps the view in the text', async ({ page }) => {
  await addGraph(page);
  const plot = page.getByRole('application', { name: /^Graph of/ });
  await plot.focus();
  await page.keyboard.press('+');
  await expect(page.locator('pre', { hasText: '@view' }).last()).toContainText(/@view -8 8 -4\.5 4\.5/);
});

test('reads a value and a slope with Shift and the arrows', async ({ page }) => {
  await addGraph(page);
  await page.getByRole('application', { name: /^Graph of/ }).focus();
  await page.keyboard.press('Shift+ArrowRight');
  await expect(page.getByText(/^x = .*, y = .*, slope = /)).toBeVisible();
});

test('gives a slider to a letter a function uses and draws the change', async ({ page }) => {
  await addGraph(page);
  const input = page.getByRole('textbox', { name: 'Function 1' });
  await input.fill('y = a sin(x)');
  const slider = page.getByRole('slider', { name: 'Value of a' });
  await expect(slider).toBeVisible();
  const path = page
    .getByRole('application', { name: /^Graph of/ })
    .locator('path')
    .last();
  const before = await path.getAttribute('d');
  await slider.fill('4');
  await expect(page.locator('pre', { hasText: 'a = 4' }).last()).toBeVisible();
  await expect.poll(async () => path.getAttribute('d')).not.toBe(before);
});

test('says what is wrong with a function and still draws the others', async ({ page }) => {
  await addGraph(page);
  await page.getByRole('button', { name: 'Add a function' }).click();
  await page.getByRole('textbox', { name: 'Function 2' }).fill('y = 2 +');
  await expect(page.getByRole('textbox', { name: 'Function 2' })).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByRole('application', { name: /^Graph of 2 functions/ })).toBeVisible();
});

test('inserts a graph from the Insert tab before the page is clicked into (Beta 5 walk W2-17)', async ({ page }) => {
  await openSmart(page);
  await page.getByRole('tab', { name: 'Insert' }).click();
  // The Insert tab shows what fits, and the rest is under More.
  const bar = page.getByRole('toolbar', { name: 'Insert' });
  const button = bar.getByRole('button', { name: 'Insert graph' });
  const item = page.getByRole('menuitem', { name: 'Insert graph' });
  // The toolbar measures what fits after it first shows, so the button can move under More while this runs: look
  // again each time instead of trusting the first look.
  await expect(async () => {
    if (await button.isVisible()) await button.click({ timeout: 2000 });
    else {
      if (!(await item.isVisible())) await bar.getByRole('button', { name: 'More' }).click({ timeout: 2000 });
      await item.click({ timeout: 2000 });
    }
  }).toPass({ timeout: 20_000 });
  await expect(page.getByRole('application', { name: /^Graph of/ })).toBeVisible({ timeout: 20_000 });
});
