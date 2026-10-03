// Flash safety (ARCHITECTURE.md section 9.4): no key held down, and no shortcut pressed quickly, changes the theme
// more than three times in any one second. WCAG 2.3.1 sets the limit.

import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures';

test.use({ boot: { firstRun: true, state: { setup: { status: 'notStarted' } } } });

/** Records when data-theme changes, and returns a function that reads the times in ms. */
async function watchTheme(page: Page) {
  await page.evaluate(() => {
    const changes: number[] = [];
    new MutationObserver(() => changes.push(performance.now())).observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
    (window as unknown as { __themeChanges: number[] }).__themeChanges = changes;
  });
  return () => page.evaluate(() => (window as unknown as { __themeChanges: number[] }).__themeChanges);
}

/** The most changes inside any window of one second. */
function busiestSecond(times: readonly number[]): number {
  return Math.max(0, ...times.map((start) => times.filter((time) => time >= start && time < start + 1000).length));
}

async function openTheme(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Get started' }).click();
  await expect(page.getByRole('radio', { name: 'Match Windows' })).toBeFocused();
}

test('holding an arrow key on the theme cards moves one step', async ({ page }) => {
  await openTheme(page);
  const changes = await watchTheme(page);
  await page.keyboard.down('ArrowRight');
  for (let i = 0; i < 40; i += 1) {
    await page.keyboard.down('ArrowRight');
    await page.waitForTimeout(50);
  }
  await page.keyboard.up('ArrowRight');
  expect(busiestSecond(await changes())).toBeLessThanOrEqual(3);
});

test('pressing Ctrl+Shift+D twenty times in two seconds changes the theme at most three times a second', async ({
  page,
}) => {
  await openTheme(page);
  const changes = await watchTheme(page);
  for (let i = 0; i < 20; i += 1) {
    await page.keyboard.press('Control+Shift+KeyD');
    await page.waitForTimeout(100);
  }
  await page.waitForTimeout(500);
  const times = await changes();
  expect(times.length).toBeGreaterThan(0);
  expect(busiestSecond(times)).toBeLessThanOrEqual(3);
});
