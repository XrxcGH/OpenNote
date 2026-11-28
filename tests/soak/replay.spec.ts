// Replays of the soak's failures, in seconds instead of hours. The first is nightly run 41792295946, seed 58.
// Action 13250 of that seed is a switch to another page and back, and action 13251 is an italic that needs the caret
// in the note. The soak failed there with "Cannot read properties of undefined (reading 'data')" in placeCaret,
// because the note had no text left. The soak's trim deleted from the caret back to the start of the note, which
// empties the whole note when the caret is at its end, and placeCaret had no caret to give a box with no text.
// Nothing the editor did was wrong: an emptied note is a state a person can reach too.
//
// plan.test.ts pins that seed 58 gives those two actions. This file runs them on an emptied note, and checks that
// the trim keeps the note about the size it was.

import { expect, test } from '@playwright/test';
import { openFixture } from '../perf/typing/conditions';
import { caretInEditor, ensureCaret, key, perform, textLength, trim } from './drive';
import { stepAt } from './plan';

const SEED = 58;
const SWITCH_INDEX = 13_250;

test('an italic after a page switch finds a caret in a note with no text', async ({ page }) => {
  const before = stepAt(SEED, SWITCH_INDEX);
  const after = stepAt(SEED, SWITCH_INDEX + 1);
  expect(before.id).toBe('switch');
  expect(after.id).toBe('italic');

  await openFixture(page, 'twentyPage');
  await ensureCaret(page);
  await key(page, 'Control+a');
  await key(page, 'Backspace');
  expect(await textLength(page)).toBe(0);

  await perform(page, before);
  await ensureCaret(page);
  await perform(page, after);
  expect(await textLength(page)).toBeGreaterThan(0);
});

// Nightly run 45943934575 (seed 87) threw "Cannot join bulletList onto paragraph" twice on the Enter at action
// 37502, after an undo at 37501. The selection covered a whole list item, and Tiptap's splitBlock split the list
// where the deleted item had been. The editor now deletes the selection first and splits at the caret it leaves.
const ENTER_SEED = 87;
const ENTER_INDEX = 37_502;

test('Enter over a selection that holds a whole list item splits without an error', async ({ page }) => {
  expect(stepAt(ENTER_SEED, ENTER_INDEX - 1).id).toBe('undo');
  const enter = stepAt(ENTER_SEED, ENTER_INDEX);
  expect(enter.id).toBe('enter');
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));

  await openFixture(page, 'twentyPage');
  await ensureCaret(page);
  await key(page, 'End');
  // A list whose second item holds a list of its own: "cd", then "ef" with "ab" under it.
  await key(page, 'Enter');
  await page.keyboard.type('- cd', { delay: 4 });
  await key(page, 'Enter');
  await page.keyboard.type('ef', { delay: 4 });
  await key(page, 'Enter');
  await key(page, 'Tab');
  await page.keyboard.type('ab', { delay: 4 });
  // From the end of the nested item ("ab" and the rest of the line it split) up to the start of "ef": the selection
  // holds the whole second item.
  await key(page, 'End');
  await key(page, 'Shift+ArrowUp');
  await key(page, 'Shift+Home');
  const selected = await page.evaluate(() => window.getSelection()?.toString().replace(/\s+/g, ' ').trim());
  expect(selected).toMatch(/^ef ab/);
  // No wait for the browser's selectionchange event: the editor reads the selection before it handles a key
  // (app/src/editor/keySelection.ts).
  await perform(page, enter);
  await page.waitForTimeout(200);
  expect(errors).toEqual([]);
  const items = page.locator('[data-scope="editor"] li').filter({ hasText: /^(cd|ef|ab)$/ });
  await expect(items).toHaveText(['cd']);
});

test('the trim takes the oldest text and leaves the note near its limit', async ({ page }) => {
  await openFixture(page, 'twentyPage');
  await ensureCaret(page);
  const length = await textLength(page);
  const limit = Math.floor(length * 0.8);
  // The caret at the end of the note is where deleting back to the start emptied it.
  await key(page, 'Control+End');
  await trim(page, limit);
  const left = await textLength(page);
  expect(left).toBeLessThanOrEqual(limit);
  expect(left).toBeGreaterThan(limit * 0.6);
});

// Nightly run 46095329270 (seed 93) threw "Trim round 0: Backspace deleted 0 characters with 0 selected." The soak's
// loop starts a trim after every 50th action, and action 18799 was a page switch. The switch leaves the focus on the
// page list, so the trim's Control+Home and Shift+PageDown selected nothing in the note. Nothing the editor did was
// wrong: a person who clicks a page in the list has the focus there too. The trim now puts the caret in the note.
const TRIM_SEED = 93;
const TRIM_SWITCH_INDEX = 18_799;

test('the trim right after a page switch puts the caret back in the note first', async ({ page }) => {
  const step = stepAt(TRIM_SEED, TRIM_SWITCH_INDEX);
  expect(step.id).toBe('switch');
  await openFixture(page, 'twentyPage');
  await ensureCaret(page);
  const length = await textLength(page);
  const limit = Math.floor(length * 0.8);

  await perform(page, step);
  // The state the soak's trim met: the focus on the page list, not in the note.
  expect(await caretInEditor(page)).toBe(false);
  await trim(page, limit);
  const left = await textLength(page);
  expect(left).toBeLessThanOrEqual(limit);
  expect(left).toBeGreaterThan(limit * 0.6);
});
