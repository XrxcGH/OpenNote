// The layout, with the keyboard alone (ARCHITECTURE.md section 11.6): F6 goes between regions and focus never sits
// on the body, Ctrl+Shift+1 hides and shows the notebooks pane, and Alt+Left goes back after a page opens from a row.
// The window keeps its native frame (ADR 0012), so Windows handles moving and closing it.

import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { Key } from 'webdriverio';
import { launchApp, skipReason } from '../harness.ts';
import type { AppSession, Browser } from '../harness.ts';

const activeRegion = (browser: Browser) =>
  browser.execute(() => document.activeElement?.closest('[data-region]')?.getAttribute('data-region') ?? 'none');

const activeTag = (browser: Browser) => browser.execute(() => document.activeElement?.tagName ?? 'none');

async function press(browser: Browser, ...keys: string[]) {
  const action = browser.action('key');
  keys.forEach((key) => action.down(key));
  [...keys].reverse().forEach((key) => action.up(key));
  await action.perform();
}

describe('the layout, with the keyboard alone', { skip: skipReason() }, () => {
  let session: AppSession;

  before(async () => {
    session = await launchApp({ keyboardOnly: true });
    await session.browser.$('button=Lectures').waitForExist({ timeout: 20_000 });
  });

  after(async () => {
    await session?.close();
  });

  it('puts focus on a control at start-up, and F6 visits the regions without ever landing on the body', async () => {
    const { browser } = session;
    await browser.waitUntil(async () => (await activeTag(browser)) !== 'BODY', { timeout: 5_000 });
    const visited = new Set<string>();
    for (let step = 0; step < 6; step += 1) {
      await press(browser, Key.F6);
      assert.notEqual(await activeTag(browser), 'BODY');
      visited.add(await activeRegion(browser));
    }
    for (const region of ['titleBar', 'notebooks', 'page']) assert.ok(visited.has(region), `F6 reaches ${region}`);
  });

  it('hides the notebooks pane to its rail with Ctrl+Shift+1, and shows it again', async () => {
    const { browser } = session;
    await press(browser, Key.Ctrl, Key.Shift, '1');
    await browser.$('button=Lectures').waitForDisplayed({ timeout: 5_000, reverse: true });
    assert.notEqual(await activeTag(browser), 'BODY');
    await press(browser, Key.Ctrl, Key.Shift, '1');
    await browser.$('button=Lectures').waitForDisplayed({ timeout: 5_000 });
  });

  it('opens a section from its row with Enter, and Alt+Left goes back', async () => {
    const { browser } = session;
    await browser.execute(() => document.querySelector<HTMLElement>('[data-region="notebooks"] button')?.focus());
    const before = await browser.getTitle();
    await press(browser, Key.Enter);
    await browser.waitUntil(async () => (await browser.getTitle()) !== before, { timeout: 5_000 });
    await press(browser, Key.Alt, Key.ArrowLeft);
    await browser.waitUntil(async () => (await browser.getTitle()) === before, { timeout: 5_000 });
  });
});
