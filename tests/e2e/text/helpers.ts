// Shared steps for the text end-to-end specs: the boot payload with the text flags on, opening the seeded page,
// and putting a caret or a selection in its text.

import { axeViolations } from '../../ui/axe';
import { test as base, expect } from '../../ui/fixtures';
import type { Locator, Page } from '@playwright/test';

/** Every text formatting flag (app/src/features/page/flags.ts). They are off in every channel until each feature ships. */
export const TEXT_FLAGS = [
  'text.runFormats',
  'text.paraFormats',
  'text.fontPicker',
  'text.styles2',
  'text.formatPane',
  'text.ruler',
  'text.symbols',
  'text.language',
  'text.footnotes',
  'text.review',
  'text.layout',
  'text.pasteFidelity',
  'text.findFormat',
  'page.findReplace',
] as const;

export const test = base.extend({
  // eslint-disable-next-line no-empty-pattern
  boot: async ({}, use) => {
    await use({ flagOverrides: Object.fromEntries(TEXT_FLAGS.map((flag) => [flag, true])) });
  },
});

export { expect };

/** The text blocks' editing roots. Each is static text until a press mounts its editor in place. */
export const TEXT_BLOCK = '[data-scope="editor"][data-block]';

/** Opens the Membranes page of the Lectures notebook, holding the page fixture's text, and waits for its text. */
export async function openNote(page: Page, fixture = 'short', text = 'A few words'): Promise<Locator> {
  await page.goto(`/?fixture=${fixture}`);
  await page.getByRole('tree', { name: 'Notebooks' }).getByRole('treeitem', { name: 'Lectures' }).click();
  await page.getByRole('tree', { name: 'Pages' }).getByRole('treeitem', { name: 'Membranes' }).click();
  await page.locator('html[data-page-commands="ready"]').waitFor({ state: 'attached', timeout: 30_000 });
  const box = page.locator(TEXT_BLOCK).first();
  await expect(box).toContainText(text);
  return box;
}

/** Mounts the editor in the box and selects the paragraph with `text` in it, so a command acts on that text. */
export async function selectParagraph(page: Page, box: Locator, text: string): Promise<Locator> {
  await box.click({ position: { x: 8, y: 8 } });
  await expect(box).toHaveAttribute('contenteditable', 'true', { timeout: 15_000 });
  const paragraph = box.locator('p', { hasText: text });
  await paragraph.click({ clickCount: 3 });
  return paragraph;
}

/** Runs a command from the command palette, which opens from the page list so the text selection stays put. */
export async function runCommand(page: Page, query: string, name: RegExp | string): Promise<void> {
  await page.getByRole('tree', { name: 'Pages' }).getByRole('treeitem', { name: 'Membranes' }).focus();
  await page.keyboard.press('Control+KeyK');
  const box = page.getByRole('combobox', { name: 'Search commands and pages' });
  await box.pressSequentially(query, { delay: 15 });
  await page.getByRole('option', { name }).first().click();
}

/**
 * Fails on any axe violation. With forced colors on, the browser picks every text and background color from the
 * system palette and axe's contrast rule can't see them, so that one rule is skipped there: the forced-colors check
 * of the formatted note covers it.
 */
export async function expectAxeClean(page: Page, include?: string): Promise<void> {
  const forced = await page.evaluate(() => matchMedia('(forced-colors: active)').matches);
  const found = await axeViolations(page, { include });
  expect(forced ? found.filter((line) => !line.startsWith('color-contrast')) : found).toEqual([]);
}
