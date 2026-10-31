// Check my work on typed lines: select the working, run Check my work from the text menu, and each line gets a mark
// beside it. The first broken step says why, with a corrected line, and the step after it says it follows. Check
// again redraws the marks, and Dismiss (or Escape on the card) takes them away. Handwriting goes through the same
// marks, but the web build's stand-in recognizer cannot read real math, so that path is for a pen on Windows.

import { expect, test } from '../fixtures';
import { newLine, openSmart } from './smart';

test('marks each typed step, explains the first broken one, and dismisses', async ({ page }) => {
  await openSmart(page);
  await newLine(page);
  for (const [i, line] of ['2x + 3 = 7', '2x = 10', 'x = 5'].entries()) {
    if (i > 0) await page.keyboard.press('Enter');
    await page.keyboard.type(line);
  }
  await page.keyboard.press('Shift+ArrowUp');
  await page.keyboard.press('Shift+ArrowUp');
  await page.keyboard.press('Shift+Home');
  // Ctrl+K on selected text makes a link, so the text menu runs it here; the palette has it too (test below).
  const box = page.getByRole('textbox', { name: 'Text' }).first();
  await box
    .locator('p')
    .filter({ hasText: /^2x = 10$/ })
    .click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Check my work' }).click();

  const marks = page.locator('[data-step-mark]');
  await expect(marks).toHaveCount(3);
  await expect(page.locator('[data-step-mark="broken"]')).toHaveCount(1);
  const broken = page.getByRole('button', { name: /^Line 2: needs a look/ });
  await expect(broken).toBeVisible();
  await expect(broken).toHaveAccessibleName(/x = 5 solves this line, but not the line before it\. Try: 2x = 4/);
  await expect(page.getByRole('button', { name: /^Line 3: follows/ })).toHaveAccessibleName(
    /This follows from your previous line/,
  );

  const card = page.getByRole('region', { name: 'Check my work' });
  await expect(card).toContainText('1 step follows, 1 needs a look.');
  await expect(card).toContainText('Try: 2x = 4');
  await expect(card).toContainText('Checked on this device.');

  // The mark is a button: pressing it moves to its finding in the card.
  await broken.click();
  await expect(card.locator('li[data-verdict="broken"]')).toBeFocused();

  await card.getByRole('button', { name: 'Check again' }).click();
  await expect(marks).toHaveCount(3);
  await card.getByRole('button', { name: 'Dismiss' }).click();
  await expect(marks).toHaveCount(0);
  await expect(card).toHaveCount(0);
  // The page itself is unchanged: the three lines are still there, and nothing was inserted.
  await expect(box.locator('p').filter({ hasText: /^2x = 10$/ })).toHaveCount(1);
});

test('the palette offers Check my work, and the switch in Settings, then Editing, takes it out', async ({ page }) => {
  await openSmart(page);
  await page.keyboard.press('Control+Comma');
  const nav = page.getByRole('navigation', { name: 'Settings sections' });
  await nav.getByRole('link', { name: 'Editing' }).click();
  const toggle = page.getByRole('switch', { name: 'Check my work' });
  await expect(toggle).toBeChecked();
  await toggle.click();
  await expect(toggle).not.toBeChecked();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+KeyK');
  const search = page.getByRole('combobox', { name: 'Search commands and pages' });
  await search.fill('Check my work');
  await expect(page.getByRole('option', { name: /^Check my work/ })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+Comma');
  await nav.getByRole('link', { name: 'Editing' }).click();
  await toggle.click();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+KeyK');
  await search.fill('Check my work');
  await expect(page.getByRole('option', { name: /^Check my work/ }).first()).toBeVisible();
});
