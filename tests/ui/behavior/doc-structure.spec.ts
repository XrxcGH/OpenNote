// Document structure (flags doc.*): numbered equations that references follow, practice mode, and the problem-set
// templates in the new-page chooser.

import { expect, test } from '../fixtures';
import { newLine, openSmart, runCommand } from './smart';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('opennote.math.visual', 'latex');
    } catch {
      // Storage is blocked, and the visual editor stays.
    }
  });
});

test('numbers an equation and shows a reference to it', async ({ page }) => {
  await openSmart(page);
  await newLine(page);
  await page.keyboard.type(String.raw`$$F = m a$$`);
  const equation = page.locator('[data-math-block]').last();
  await expect(equation).toBeVisible();
  await equation.click();
  await runCommand(page, 'Number this equation');
  await expect(page.locator('[data-math-block][data-eq-number]').last()).toHaveAttribute('data-eq-number', /^\d+$/);
  await page.getByRole('textbox', { name: 'Text' }).first().click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('See ');
  // The command inserts at the caret, so it waits until the typed text has reached the page.
  await expect(page.getByRole('textbox', { name: 'Text' }).first()).toContainText('See');
  await runCommand(page, 'Insert equation reference');
  const ref = page.locator('[data-eq-ref]').last();
  await expect(ref).toHaveAttribute('data-eq-ref', /^\(\d+\)$/);
});

test('lists the problem-set templates in the new-page chooser', async ({ page }) => {
  await openSmart(page);
  await runCommand(page, 'New page from template');
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('radio', { name: 'Problem set' })).toBeVisible();
  await expect(dialog.getByRole('radio', { name: 'Cornell notes' })).toBeVisible();
  await expect(dialog.getByRole('radio', { name: 'Lab report' })).toBeVisible();
});

test('practice mode keeps steps hidden until they are asked for', async ({ page }) => {
  await openSmart(page);
  await newLine(page);
  await page.keyboard.type('## Solution');
  await page.keyboard.press('Enter');
  await page.keyboard.type('1. Add the forces');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Divide by the mass');
  await runCommand(page, 'Practice this problem');
  const dialog = page.getByRole('dialog', { name: 'Practice mode' });
  await expect(dialog.getByText('Step 1 is hidden.')).toBeVisible();
  await expect(dialog.getByText('Add the forces')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Show next step' }).click();
  await expect(dialog.getByText('Add the forces')).toBeVisible();
  await expect(dialog.getByText('Divide by the mass')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Start over' }).click();
  await expect(dialog.getByText('Add the forces')).toHaveCount(0);
});
