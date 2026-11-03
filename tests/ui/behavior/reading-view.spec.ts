// The Reading view switch follows the window's size class as it is now, not as it was when the page opened
// (full walk A1-A08-7): a window made narrow offers it, and the page goes back to the canvas from it.
import { expect, test } from '../fixtures';
import { runCommand } from '../intel';
import { openPage } from '../ink';

test('a window made narrow after the page opened can switch to the Reading view and back', async ({ page }) => {
  await openPage(page);
  await page.setViewportSize({ width: 420, height: 800 });
  await page.waitForTimeout(300);
  const world = page.locator('[data-layout="reading"]');
  await runCommand(page, 'Switch between reading view');
  await expect(world).toHaveCount(1);
  await runCommand(page, 'Switch between reading view');
  await expect(world).toHaveCount(0);
});
