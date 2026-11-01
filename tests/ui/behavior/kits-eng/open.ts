// Shared step for the engineering kit specs: open the sampler page, run a palette command, and return the window.
import { expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { openSmart, runCommand } from '../smart';

const problems = new WeakMap<Page, string[]>();

/** Starts collecting what a page logs as an error and every script exception, for `expectNoErrors`. */
function watchErrors(page: Page): void {
  const found: string[] = [];
  problems.set(page, found);
  page.on('console', (message) => {
    if (message.type() === 'error') found.push(`${message.text()} ${message.location().url}`);
  });
  page.on('pageerror', (error) => found.push(error.message));
}

/** Expects that the page logged no console error and threw no exception since `openKit`. */
export function expectNoErrors(page: Page): void {
  expect(problems.get(page) ?? []).toEqual([]);
}

export async function openKit(page: Page, command: string, title: string): Promise<Locator> {
  watchErrors(page);
  await openSmart(page);
  await runCommand(page, command);
  const dialog = page.getByRole('dialog', { name: title });
  await expect(dialog).toBeVisible({ timeout: 20_000 });
  return dialog;
}

/** The value cell in the row of a results table whose first cell reads `label`. */
export function resultRow(dialog: Locator, label: string | RegExp): Locator {
  return dialog.getByRole('row', { name: label }).first();
}

/** Checks a result row, changes one input, and checks that the row recomputed. */
export async function expectRecompute(
  dialog: Locator,
  row: RegExp,
  before: string,
  input: Locator,
  value: string,
  after: string,
): Promise<void> {
  await expect(resultRow(dialog, row)).toContainText(before);
  await input.fill(value);
  await expect(resultRow(dialog, row)).toContainText(after);
}
