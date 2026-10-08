// Palm rejection settings on the web platform: the Pen and touch section sets the writing hand and when a finger
// draws.
import { expect, test } from '../fixtures';
import { openPage } from '../ink';

test('sets the writing hand and drawing with a finger in Settings', async ({ page }) => {
  await openPage(page);
  await page.keyboard.press('Control+Comma');
  const nav = page.getByRole('navigation', { name: 'Settings sections' });
  await nav
    .getByRole('link', { name: 'Pen and touch' })
    .or(nav.getByRole('button', { name: 'Pen and touch' }))
    .click();
  const hand = page.getByRole('radiogroup', { name: 'Writing hand' });
  await hand.getByRole('radio', { name: 'Left hand' }).click();
  await expect(hand.getByRole('radio', { name: 'Left hand' })).toHaveAttribute('aria-checked', 'true');
  const finger = page.getByRole('radiogroup', { name: 'Draw with a finger' });
  await expect(finger.getByRole('radio', { name: 'Until a pen is used' })).toHaveAttribute('aria-checked', 'true');
  await finger.getByRole('radio', { name: 'Never' }).click();
  await expect(finger.getByRole('radio', { name: 'Never' })).toHaveAttribute('aria-checked', 'true');
});
