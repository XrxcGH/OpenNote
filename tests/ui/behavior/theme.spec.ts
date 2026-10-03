// Switching the theme changes an attribute and CSS variables, nothing more (ARCHITECTURE.md section 9.5): scroll
// offsets, focus, text selection, and DOM nodes stay where they were. Also the menu and the density follow-up.

import { expect, test } from '../fixtures';

test.use({ fixture: 'large' });

test('keeps scroll, focus, selection, and DOM nodes through a theme change', async ({ page }) => {
  await page.goto('/');
  const notebooks = page.getByRole('navigation', { name: 'Notebooks' });
  await expect(notebooks).toBeVisible();
  const row = notebooks.getByRole('button').first();
  await row.focus();
  await page.evaluate(() => {
    const pane = document.querySelector('[data-region="notebooks"]') as HTMLElement;
    pane.scrollTop = 40;
    const button = document.activeElement as HTMLElement;
    (button as unknown as { __kept: string }).__kept = 'same node';
    const range = document.createRange();
    range.selectNodeContents(button);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
  });
  const before = await page.evaluate(() => ({
    scroll: (document.querySelector('[data-region="notebooks"]') as HTMLElement).scrollTop,
    selected: window.getSelection()?.toString(),
  }));

  await page.keyboard.press('Control+Shift+KeyD');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

  const after = await page.evaluate(() => ({
    scroll: (document.querySelector('[data-region="notebooks"]') as HTMLElement).scrollTop,
    selected: window.getSelection()?.toString(),
    kept: (document.activeElement as unknown as { __kept?: string }).__kept,
  }));
  expect(after).toEqual({ ...before, kept: 'same node' });
});

test('opens the theme menu with right-click and chooses Match Windows', async ({ page }) => {
  await page.goto('/');
  const toggle = page.getByRole('switch', { name: 'Dark mode' });
  await toggle.click({ button: 'right' });
  await expect(page.getByRole('menu', { name: 'Theme' })).toBeVisible();
  await page.getByRole('menuitemradio', { name: 'Dark' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(toggle).toBeFocused();
  await toggle.press('Shift+F10');
  await expect(page.getByRole('menuitemradio', { name: 'Dark' })).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
});

test('density follows the last pointer on pointerup', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-density', 'mouse');
  await page.evaluate(() => window.dispatchEvent(new PointerEvent('pointerup', { pointerType: 'touch' })));
  await expect(page.locator('html')).toHaveAttribute('data-density', 'touch');
  await page.mouse.click(700, 500);
  await expect(page.locator('html')).toHaveAttribute('data-density', 'mouse');
});
