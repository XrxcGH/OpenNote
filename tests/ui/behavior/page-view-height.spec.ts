// Switching between pages with breaks and the infinite canvas leaves the page as tall as it was. The paper under the
// canvas is drawn to the world's size, and counting it as content grew the world by half a screen each time (full
// walk A2-A11-1).
import { expect, test } from '../fixtures';
import { runCommand } from '../intel';
import { openPage } from '../ink';

test('switching page views does not grow the page', async ({ page }) => {
  await openPage(page);
  const height = () =>
    page.evaluate(() => (document.querySelector('[data-scope="page"]')?.firstElementChild as HTMLElement).offsetHeight);
  const sizes: number[] = [];
  for (let i = 0; i < 3; i += 1) {
    for (const name of ['Pages with breaks', 'Infinite canvas']) {
      await runCommand(page, name);
      await page.waitForTimeout(300);
    }
    sizes.push(await height());
  }
  expect(sizes[2]).toBe(sizes[0]);
});
