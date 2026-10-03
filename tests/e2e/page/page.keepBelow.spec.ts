// Keep-below in the real app (Phase 4 PLAN.md section 7.5): typing new lines into a text box moves the box just
// below it down by the same amount, and undo puts both back in one step.

import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { skipReason } from '../harness.ts';
import type { AppSession } from '../harness.ts';
import { clickAt, clientPoint, makeBox, openEmptyPage, textBoxes } from './pageSession.ts';

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
        document.querySelector<HTMLElement>('[aria-label="Text box 1 of 1"]')!.closest<HTMLElement>('[data-block-id]')!
          .offsetHeight,
    );
    await makeBox(browser, 100, 200 + height + 10, 'Below');
    await clickAt(browser, await clientPoint(browser, 110, 210));
    await browser.keys(['End', 'Enter', 'A', 'n', 'o', 't', 'h', 'e', 'r']);
    await browser.waitUntil(async () => (await textBoxes(browser))[1]!.top > 200 + height + 10, { timeout: 5_000 });
    const moved = (await textBoxes(browser))[1]!.top - (200 + height + 10);
    assert.ok(moved > 10, 'the lower box moved down by the new line');
    await browser.keys(['Control', 'z']);
    await browser.waitUntil(async () => (await textBoxes(browser))[1]!.top === 200 + height + 10, { timeout: 5_000 });
  });
});
