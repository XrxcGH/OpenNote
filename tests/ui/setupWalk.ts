// Walks first-run setup forward to the last step, from the welcome step or a later one. The keys step, the smart
// features step, and the import step each come and go with their flags, so it clicks Continue until it gets there.

import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';

export async function walkToStorage(page: Page): Promise<void> {
  const heading = page.getByRole('heading', { level: 1 }).first();
  const next = page.getByRole('button', { name: /^(Get started|Continue)$/ });
  for (let step = 0; step < 9; step += 1) {
    await heading.waitFor();
    const current = (await heading.textContent()) ?? '';
    if (current.trim() === 'Where to keep things') return;
    await next.click();
    await expect(heading).not.toHaveText(current);
  }
  throw new Error('Setup did not reach Where to keep things.');
}
