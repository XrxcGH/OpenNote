// Freeform pages by pointer in the real app (Phase 4 PLAN.md section 7.5): a click on empty page places a caret
// that becomes a text box when typed in, a click that types nothing leaves nothing behind, and the grip moves a box.

import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { skipReason } from '../harness.ts';
import type { AppSession } from '../harness.ts';
import { clickAt, clientPoint, drag, makeBox, openEmptyPage, textBoxes } from './pageSession.ts';

describe('freeform pages by pointer', { skip: skipReason() }, () => {
  let session: AppSession | undefined;

  after(async () => {
    await session?.close();
  });

  it('makes a text box where the page is clicked, and only once something is typed', async () => {
    session = await openEmptyPage();
    const { browser } = session;
    await clickAt(browser, await clientPoint(browser, 500, 300));
    await clickAt(browser, await clientPoint(browser, 600, 500));
    assert.deepEqual(await textBoxes(browser), [], 'an untouched caret leaves nothing behind');
    await makeBox(browser, 400, 260, 'Stomata');
    const [box] = await textBoxes(browser);
    assert.equal(box?.name, 'Text box 1 of 1');
    assert.equal(box?.left, 400);
  });

  it('moves a text box by its grip', async () => {
    const { browser } = session!;
    const [before] = await textBoxes(browser);
    const grip = await browser.execute(() => {
      const handle = document.querySelector<HTMLElement>('[data-handle="grip"]');
      const rect = handle?.getBoundingClientRect();
      return rect ? { x: rect.left + 12, y: rect.top + rect.height / 2 } : null;
    });
    assert.ok(grip, 'the edited box shows its grip');
    await drag(browser, grip, { x: grip.x + 80, y: grip.y + 40 });
    await browser.waitUntil(async () => (await textBoxes(browser))[0]?.left === before!.left + 80, { timeout: 5_000 });
    assert.equal((await textBoxes(browser))[0]?.top, before!.top + 40);
  });
});
