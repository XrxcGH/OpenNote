// A replay of the soak's one failure so far, in seconds instead of half an hour (nightly run 41792295946, seed 58).
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
import { ensureCaret, key, perform, textLength, trim } from './drive';
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
