// Windows contrast themes (ARCHITECTURE.md section 9.6), in both color schemes. The toggle is aria-disabled with
// the reason. Its "on" state is drawn with the system Highlight color, which the test reads with a probe.

import { expect, test } from '../fixtures';

test.use({ boot: { os: { contrast: true, dark: true }, settings: { appearance: { theme: 'dark' } } } });

for (const colorScheme of ['light', 'dark'] as const) {
  test(`keeps the theme toggle visible and explained in forced colors, ${colorScheme}`, async ({ page }) => {
    await page.emulateMedia({ forcedColors: 'active', colorScheme });
    await page.goto('/');
    const toggle = page.getByRole('switch', { name: 'Dark mode' });
    await expect(toggle).toHaveAttribute('aria-disabled', 'true');
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('html')).toHaveAttribute('data-contrast', 'on');
    await expect(page.locator('[data-theme-toggle] span').last()).toHaveText(
      'A Windows contrast theme is on, so Windows sets the colors.',
    );

    const colors = await page.evaluate(() => {
      const probe = document.body.appendChild(document.createElement('div'));
      probe.style.background = 'Highlight';
      const control = document.querySelector('[role="switch"]') as HTMLElement;
      return { highlight: getComputedStyle(probe).backgroundColor, toggle: getComputedStyle(control).backgroundColor };
    });
    expect(colors.toggle).toBe(colors.highlight);
  });
}
