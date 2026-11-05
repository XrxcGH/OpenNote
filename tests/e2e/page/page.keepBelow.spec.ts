// Keep-below in the real app (Phase 4 PLAN.md section 7.5): typing new lines into a text box moves the box just
// below it down by the same amount, and undo puts both back in one step.

import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { skipReason } from '../harness.ts';
import type { AppSession } from '../harness.ts';
import { clickAt, clientPoint, explain, makeBox, openEmptyPage, textBoxes } from './pageSession.ts';

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
    // Into the text of the upper box, not onto its grip at the left edge, and wait until the caret is there.
    await clickAt(browser, await clientPoint(browser, 130, 210));
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
