// Shared step for the engineering kit specs: open the sampler page, run a palette command, and return the window.
import { expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { openSmart, runCommand } from '../smart';

export async function openKit(page: Page, command: string, title: string): Promise<Locator> {
  await openSmart(page);
  await runCommand(page, command);
  const dialog = page.getByRole('dialog', { name: title });
  await expect(dialog).toBeVisible();
  return dialog;
}

/** The value cell in the row of a results table whose first cell reads `label`. */
export function resultRow(dialog: Locator, label: string | RegExp): Locator {
  return dialog.getByRole('row', { name: label }).first();
}
