// The calculator and graphing lane on the page: an equation on a page line shows its solution in gray and Tab adds
// it, Settings turns that off, and an equation shows its answer beside it.

import { expect, test } from '../fixtures';
import { newLine, openSmart } from './smart';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('opennote.math.visual', 'latex');
    } catch {
      // Storage is blocked, and the visual editor stays.
    }
  });
});

test('offers the solution of an equation as it is typed, and Tab adds it as a line', async ({ page }) => {
  await openSmart(page);
  await newLine(page);
  await page.keyboard.type('2x + 3 = 11');
  const ghost = page.locator('[data-note-ghost]');
  await expect(ghost).toContainText('x = 4');
  await page.keyboard.press('Tab');
  await expect(ghost).toHaveCount(0);
  const box = page.getByRole('textbox', { name: 'Text' }).first();
  await expect(box.locator('p').filter({ hasText: /^x = 4$/ })).toHaveCount(1);
  // The added line is a page variable that later lines use.
  await page.keyboard.press('Enter');
  await page.keyboard.type('x * 10 =');
  await expect(page.locator('[data-note-answer]').last()).toHaveText(' 40');
});

test('a switch in Settings, then Editing, turns the solutions off', async ({ page }) => {
  await openSmart(page);
  await page.keyboard.press('Control+Comma');
  const nav = page.getByRole('navigation', { name: 'Settings sections' });
  await nav.getByRole('link', { name: 'Editing' }).click();
  const solve = page.getByRole('switch', { name: 'Suggest solutions as I write an equation' });
  await expect(solve).toBeChecked();
  await solve.click();
  await expect(solve).not.toBeChecked();
  await page.keyboard.press('Escape');
  await newLine(page);
  await page.keyboard.type('2x + 3 = 11');
  await page.keyboard.type(' ');
  await expect(page.locator('[data-note-ghost]')).toHaveCount(0);
});

test('shows the answer beside an equation', async ({ page }) => {
  await openSmart(page);
  await newLine(page);
  await page.keyboard.press('Alt+=');
  await expect(page.getByRole('textbox', { name: 'Math source' })).toBeFocused();
  await page.keyboard.insertText('2x+3=11');
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-math-answer]').last()).toHaveText('x = 4');
});
