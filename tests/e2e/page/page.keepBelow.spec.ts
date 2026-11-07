// Keep-below in the real app (Phase 4 PLAN.md section 7.5): typing new lines into a text box moves the box just
// below it down by the same amount, and undo puts both back in one step.

import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { skipReason } from '../harness.ts';
import type { AppSession } from '../harness.ts';
import { explain, makeBox, openEmptyPage, textBoxes } from './pageSession.ts';

describe('keep-below', { skip: skipReason() }, () => {
  let session: AppSession | undefined;

  after(async () => {
    await session?.close();
  });

  it('moves the box below a growing box, and undoes both together', async () => {
    session = await openEmptyPage();
    const { browser } = session;
    await makeBox(browser, 100, 200, 'Above');
    const height = await browser.execute(
      () =>
        document
          .querySelector<HTMLElement>('[role="textbox"][aria-label^="Text box"]')!
          .closest<HTMLElement>('[data-block-id]')!.offsetHeight,
    );
    await makeBox(browser, 100, 200 + height + 10, 'Below');
    // A box is placed with its first line centered on the click, so its top is not the point that was clicked.
    const lowerTop = (await textBoxes(browser))[1]!.top;
    // Back to the upper box from the keyboard: Escape selects the lower box, Shift+Tab goes to the one before it in
    // reading order, and Enter edits it. A click on a box that is already drawn does not move the caret.
    await browser.keys('Escape');
    await browser.keys(['Shift', 'Tab']);
    await browser.keys('Enter');
    await explain(
      browser,
      browser.waitUntil(
        () =>
          browser.execute(
            () => document.activeElement?.closest<HTMLElement>('[data-block-id]')?.textContent === 'Above',
          ),
        { timeout: 5_000 },
      ),
    );
    await browser.keys(['End', 'Enter', 'A', 'n', 'o', 't', 'h', 'e', 'r']);
    await explain(
      browser,
      browser.waitUntil(async () => (await textBoxes(browser))[1]!.top > lowerTop, { timeout: 5_000 }),
    );
    const moved = (await textBoxes(browser))[1]!.top - lowerTop;
    assert.ok(moved > 10, 'the lower box moved down by the new line');
    await browser.keys(['Control', 'z']);
    await explain(
      browser,
      browser.waitUntil(async () => (await textBoxes(browser))[1]!.top === lowerTop, { timeout: 5_000 }),
    );
  });
});
