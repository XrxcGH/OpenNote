// Walks first-run setup forward to the last step, from the welcome step or a later one. The keys step, the smart
// features step, and the import step each come and go with their flags, so it clicks Continue until it gets there.

import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';

export async function walkToStorage(page: Page): Promise<void> {
  const heading = page.getByRole('heading', { level: 1 }).first();
  const start = page.getByRole('button', { name: 'Get started' });
  if (await start.isVisible()) await start.click();
  const next = page.getByRole('button', { name: 'Continue' });
  for (let step = 0; step < 8; step += 1) {
    await heading.waitFor();
    // A step loads on its own, so for a moment the old heading can sit beside the new step's button, which on the last
    // step says Finish. Wait for a heading that is the last one, or a Continue button that goes on from it.
    let current = '';
    let arrived = false;
    await expect
      .poll(async () => {
        current = ((await heading.textContent()) ?? '').trim();
        arrived = current === 'Where to keep things';
        return arrived || (await next.isVisible());
      })
      .toBe(true);
    if (arrived) return;
    await next.click();
    await expect(heading).not.toHaveText(current);
  }
  throw new Error('Setup did not reach Where to keep things.');
}
