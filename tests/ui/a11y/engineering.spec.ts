// The engineering blocks pass axe (WCAG 2.2 AA and best practices) on a page that has one of each.
import { expect, test } from '../fixtures';
import { expectNoAxeViolations } from '../axe';
import { newLine, openSmart } from '../behavior/smart';

const BLOCKS = [
  ['/free', 'Insert free-body diagram', 'Free-body diagram'],
  ['/beam', 'Insert beam solver', 'Beam'],
  ['/truss', 'Insert truss solver', 'Truss'],
  ['/circuit', 'Insert circuit', 'Circuit'],
] as const;

test('free-body, beam, truss, and circuit blocks have no axe violations', async ({ page }) => {
  await openSmart(page);
  for (const [text, option, canvas] of BLOCKS) {
    await newLine(page);
    await page.keyboard.type(text);
    await expect(page.getByRole('option', { name: option })).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('group', { name: canvas, exact: true }).first()).toBeVisible();
  }
  await expectNoAxeViolations(page);
});
