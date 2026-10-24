// Search in the real app (A4-50): words typed into a page are saved and indexed by the Rust core, Ctrl+Shift+F finds
// the page by them, and choosing the result opens it.

import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { Key } from 'webdriverio';
import { launchApp, skipReason } from '../harness.ts';
import type { AppSession } from '../harness.ts';
import { chord, clickRow, openPage } from './steps.ts';

describe('searching in the real app', { skip: skipReason() }, () => {
  let session: AppSession;

  before(async () => {
    session = await launchApp();
  });

  after(async () => {
    await session?.close();
  });

  it('finds a page by words typed into it, and opens it', async () => {
    const { browser } = session;
    await openPage(browser, 'Mitosis');
    const box = browser.$('[role="textbox"][aria-label="Page text"]');
    await box.click();
    await browser.keys('Zyglorbium moves water across a membrane');
    // Move to another page, so the match has to be opened again.
    await clickRow(browser, 'Pages', 'Meiosis');
    await chord(browser, Key.Ctrl, Key.Shift, 'f');
    const search = browser.$('[role="combobox"][aria-label="Search notes"]');
    await search.waitForExist({ timeout: 10_000 });
    // The index follows the page's save, so ask again until it has the words.
    const result = browser.$('//*[@role="option"][contains(normalize-space(.), "Mitosis")]');
    await browser.waitUntil(
      async () => {
        await search.setValue('zyglorbium');
        return result.waitForExist({ timeout: 2_000 }).then(
          () => true,
          () => false,
        );
      },
      { timeout: 60_000, timeoutMsg: 'Search never found the page by its words.' },
    );
    assert.match(await result.getText(), /Zyglorbium/);
    await result.click();
    await browser
      .$('//h1[normalize-space(.)="Mitosis"] | //*[@role="textbox"][@aria-label="Page title"]')
      .waitForExist({ timeout: 10_000 });
    await search.waitForExist({ reverse: true, timeout: 10_000 });
  });
});
