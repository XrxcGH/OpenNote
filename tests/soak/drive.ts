// What the soak does to the page, apart from the loop that picks the actions (soak.spec.ts) and the replay of one
// failure (replay.spec.ts). Everything here takes a Step that plan.ts has already drawn, so it makes no random choice.

import type { Page } from '@playwright/test';
import { placeCaret } from '../perf/typing/conditions';
import type { Step } from './plan';

export const TEXT_BLOCKS = '[data-scope="editor"][data-block]';

export const key = (page: Page, name: string, times = 1) =>
  page.keyboard.press(name, { delay: 5 }).then(async () => {
    for (let i = 1; i < times; i += 1) await page.keyboard.press(name, { delay: 5 });
  });

/** The characters in the page's text blocks, so the soak can keep the note about the size it started. */
export const textLength = (page: Page) =>
  page.evaluate(
    (selector) =>
      [...document.querySelectorAll(selector)].reduce((sum, block) => sum + (block.textContent?.length ?? 0), 0),
    TEXT_BLOCKS,
  );

/** Puts the caret back in the longest text box if a page switch or a click took it out. */
export async function ensureCaret(page: Page): Promise<void> {
  const inEditor = await page.evaluate(() => {
    const active = document.activeElement;
    return active instanceof HTMLElement && active.isContentEditable && active.closest('[data-block]') !== null;
  });
  if (inEditor) return;
  const id = await page.evaluate((selector) => {
    const blocks = [...document.querySelectorAll<HTMLElement>(selector)];
    const lengths = blocks.map((block) => block.textContent?.length ?? 0);
    return blocks[lengths.indexOf(Math.max(...lengths))]?.dataset.block ?? null;
  }, TEXT_BLOCKS);
  if (id === null) throw new Error('The page has no text block.');
  await placeCaret(page, page.locator(`${TEXT_BLOCKS}[data-block=${JSON.stringify(id)}]`), 'middle');
}

/**
 * Deletes the oldest text, a screen at a time from the top of the note, until the note is no longer than `limit`
 * characters. It never takes more than one screen past the limit, so the note stays about the size it started. The
 * soak used to delete from the caret back to the start, which empties the note whenever the caret is at the end.
 *
 * Each Backspace must delete the screen the browser shows selected: some text, and no more than that. Nightly run
 * 46047189415 left 14,730 of 44,947 characters. The Backspace had come before the browser's selectionchange event,
 * so the editor deleted an old selection or none (app/src/editor/keySelection.ts).
 */
export async function trim(page: Page, limit: number): Promise<void> {
  await key(page, 'Control+Home');
  for (let round = 0; round < 40; round += 1) {
    const before = await textLength(page);
    if (before <= limit) return;
    await key(page, 'Shift+PageDown');
    const selected = await selectedLength(page);
    await key(page, 'Backspace');
    const deleted = before - (await textLength(page));
    if (deleted <= 0 || deleted > selected) {
      throw new Error(`Trim round ${round}: Backspace deleted ${deleted} characters with ${selected} selected.`);
    }
  }
}

/** The characters in the browser's selection, with one for each line break between blocks. */
const selectedLength = (page: Page) => page.evaluate(() => window.getSelection()?.toString().length ?? 0);

/** Opens the next page in the list and comes back to this one. */
export async function switchPages(page: Page): Promise<void> {
  const pages = page.getByRole('tree', { name: 'Pages' }).getByRole('treeitem');
  const count = await pages.count();
  if (count < 2) return;
  const here = await pages.evaluateAll((items) =>
    items.findIndex((item) => item.getAttribute('aria-selected') === 'true'),
  );
  await pages.nth((Math.max(here, 0) + 1) % count).click();
  await page.waitForTimeout(150);
  await pages.nth(Math.max(here, 0)).click();
  await page.locator('html[data-page-commands="ready"]').waitFor({ state: 'attached' });
  await page.waitForTimeout(150);
}

export async function perform(page: Page, step: Step): Promise<void> {
  switch (step.id) {
    case 'type':
      await page.keyboard.type(step.words, { delay: 4 });
      return;
    case 'enter':
      await key(page, 'Enter');
      return;
    case 'backspace':
      await key(page, 'Backspace', step.times);
      return;
    case 'undo':
      await key(page, 'Control+z', step.times);
      return;
    case 'redo':
      await key(page, 'Control+Shift+z', step.times);
      return;
    case 'bold':
    case 'italic': {
      const chord = step.id === 'bold' ? 'Control+b' : 'Control+i';
      await key(page, chord);
      await page.keyboard.type(step.words, { delay: 4 });
      await key(page, chord);
      return;
    }
    case 'move':
      for (const arrow of step.keys) await key(page, arrow);
      return;
    case 'jump':
      await key(page, step.key);
      return;
    case 'scroll':
      await page.mouse.wheel(0, step.delta);
      await page.waitForTimeout(40);
      return;
    case 'switch':
      await switchPages(page);
      return;
    case 'list':
      await key(page, 'Enter');
      await page.keyboard.type(`- ${step.words}`, { delay: 4 });
      await key(page, 'Enter');
      await key(page, 'Enter');
      return;
    case 'heading':
      await key(page, 'Enter');
      await page.keyboard.type(`## ${step.words}`, { delay: 4 });
      await key(page, 'Enter');
      return;
  }
}
