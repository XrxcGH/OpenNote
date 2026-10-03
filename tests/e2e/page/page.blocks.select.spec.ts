// Selecting blocks in the real app (Phase 4 PLAN.md section 7.5): a marquee on empty page selects the boxes it
// touches and shows the count badge, and Delete removes them with an Undo toast that brings them back.

import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { skipReason } from '../harness.ts';
import type { AppSession } from '../harness.ts';
import { clientPoint, drag, makeBox, openEmptyPage, textBoxes } from './pageSession.ts';

describe('selecting blocks', { skip: skipReason() }, () => {
  let session: AppSession | undefined;

  after(async () => {
    await session?.close();
  });

  it('selects boxes with a marquee and deletes them with an Undo toast', async () => {
    session = await openEmptyPage();
    const { browser } = session;
    await makeBox(browser, 200, 300, 'One');
    await makeBox(browser, 420, 320, 'Two');
    await browser.keys('Escape');
    await browser.keys('Escape');
    await drag(browser, await clientPoint(browser, 150, 260), await clientPoint(browser, 700, 420));
    const badge = await browser.execute(() =>
      [...document.querySelectorAll<HTMLElement>('[aria-hidden="true"] *')]
        .map((element) => element.textContent)
        .find((text) => text?.endsWith('selected')),
    );
    assert.equal(badge, '2 selected');
    await browser.keys('Delete');
    await browser.waitUntil(async () => (await textBoxes(browser)).length === 0, { timeout: 5_000 });
    const undo = await browser.$('button=Undo');
    await undo.click();
    await browser.waitUntil(async () => (await textBoxes(browser)).length === 2, { timeout: 5_000 });
  });
});
