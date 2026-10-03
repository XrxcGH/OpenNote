// Objects from the keyboard in the real app (Phase 4 PLAN.md section 7.5): Escape selects the text box, arrows
// move it, Tab moves between boxes in reading order, and focus, the selection, and the caret survive a nudge that
// changes the reading order.

import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { skipReason } from '../harness.ts';
import type { AppSession, Browser } from '../harness.ts';
import { makeBox, openEmptyPage, textBoxes } from './pageSession.ts';

const focused = (browser: Browser) =>
  browser.execute(() => {
    const element = document.activeElement as HTMLElement | null;
    return { block: element?.dataset.blockId ?? null, label: element?.getAttribute('aria-label') ?? null };
  });

describe('objects from the keyboard', { skip: skipReason() }, () => {
  let session: AppSession | undefined;

  after(async () => {
    await session?.close();
  });

  it('selects with Escape, moves with arrows, and keeps focus through a reading order change', async () => {
    session = await openEmptyPage();
    const { browser } = session;
    await makeBox(browser, 100, 300, 'Upper');
    await makeBox(browser, 100, 330, 'Lower');
    await browser.keys('Escape');
    const wrapper = await focused(browser);
    assert.equal(wrapper.label, 'Lower', 'Escape focuses the box as an object');
    for (let i = 0; i < 6; i += 1) await browser.keys('ArrowUp');
    await browser.waitUntil(async () => (await textBoxes(browser))[0]?.text === 'Lower', { timeout: 5_000 });
    assert.deepEqual(await focused(browser), wrapper, 'focus stayed on the moved box');
    await browser.keys('Enter');
    await browser.keys(' first');
    await browser.waitUntil(async () => (await textBoxes(browser))[0]?.text === 'Lower first', { timeout: 5_000 });
  });

  it('moves between boxes with Tab in reading order', async () => {
    const { browser } = session!;
    await browser.keys('Escape');
    await browser.keys('Tab');
    assert.equal((await focused(browser)).label, 'Upper');
  });
});
