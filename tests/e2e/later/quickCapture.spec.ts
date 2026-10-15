// Quick capture in the real app (A4-50): the Quick note button opens the capture window, Ctrl+Enter saves the text as
// a page in the Quick notes section, and the window closes. The first line is the page's title.

import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { Key } from 'webdriverio';
import { launchApp, skipReason } from '../harness.ts';
import type { AppSession } from '../harness.ts';
import { chord, clickRow } from './steps.ts';

describe('quick capture in the real app', { skip: skipReason() }, () => {
  let session: AppSession;

  before(async () => {
    session = await launchApp();
  });

  after(async () => {
    await session?.close();
  });

  it('saves a note typed in the capture window as a page of Quick notes', async () => {
    const { browser } = session;
    await clickRow(browser, 'Notebooks', 'Lectures');
    const main = await browser.getWindowHandle();
    const button = browser.$('button[aria-label="Quick note"]');
    await button.waitForExist({ timeout: 20_000 });
    await button.click();
    await browser.waitUntil(async () => (await browser.getWindowHandles()).length === 2, {
      timeout: 20_000,
      timeoutMsg: 'The capture window never opened.',
    });
    const capture = (await browser.getWindowHandles()).find((handle) => handle !== main);
    assert.ok(capture, 'There is a second window');
    await browser.switchToWindow(capture);
    const field = browser.$('#capture-text');
    await field.waitForExist({ timeout: 10_000 });
    await field.setValue('Heron seen at the weir\nStood still for ten minutes.');
    await chord(browser, Key.Ctrl, Key.Enter);
    await browser.waitUntil(async () => (await browser.getWindowHandles()).length === 1, {
      timeout: 20_000,
      timeoutMsg: 'The capture window never closed.',
    });
    await browser.switchToWindow(main);
    await clickRow(browser, 'Notebooks', 'Quick notes');
    await clickRow(browser, 'Pages', 'Heron seen at the weir');
  });
});
