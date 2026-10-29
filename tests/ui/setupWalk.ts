// Walks first-run setup forward to the last step, from the welcome step or a later one. The keys step, the smart
// features step, and the import step each come and go with their flags, so it clicks Continue until it gets there.

import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';

export async function walkToStorage(page: Page): Promise<void> {
  const heading = page.getByRole('heading', { level: 1 }).first();
  // The welcome step's button says Get started, and it is not drawn yet when the page first shows: no looking once and
  // moving on without it.
  const next = page.getByRole('button', { name: /^(Continue|Get started)$/ });
  const seen: string[] = [];
  // What the page shows, for the error when the walk gets stuck.
  const describe = async () =>
    `seen ${JSON.stringify(seen)}, buttons ${JSON.stringify(await page.getByRole('button').allInnerTexts())}`;
  for (let step = 0; step < 12; step += 1) {
    await heading.waitFor();
    // A step loads on its own, so for a moment the old heading can sit beside the new step's button, which on the last
    // step says Finish. Wait for a heading that is the last one, or a Continue button that goes on from it.
    let current = '';
    let arrived = false;
    try {
      await expect
        .poll(
          async () => {
            current = ((await heading.textContent()) ?? '').trim();
            arrived = current === 'Where to keep things';
            return arrived || (await next.isVisible());
          },
          { timeout: 20_000 },
        )
        .toBe(true);
    } catch (error) {
      throw new Error(`Setup stopped at "${current}": ${await describe()}`, { cause: error });
    }
    seen.push(current);
    if (arrived) return;
    await next.click();
    await expect(heading).not.toHaveText(current, { timeout: 20_000 });
  }
  throw new Error(`Setup did not reach Where to keep things: ${await describe()}`);
}
