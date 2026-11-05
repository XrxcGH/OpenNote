// Page history in the real app (Phase 4 PLAN.md section 11): after an edit and a save, the panel lists the earlier
// version, compares it with <ins> and <del>, and restores the old paragraph.

import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { launchApp, skipReason, removeFolder } from '../harness.ts';
import type { AppSession, Browser } from '../harness.ts';
import { clickRow, flaggedProfile, openMitosisText } from './helpers.ts';

/** Runs a command from the palette by its title. */
async function runCommand(browser: Browser, title: string): Promise<void> {
  // Ctrl+K opens the palette in the text box when nothing is selected. Ctrl+Shift+P is not a key of the app.
  await browser.keys(['Control', 'k']);
  const input = browser.$('[role="combobox"]');
  await input.waitForExist({ timeout: 5_000 });
  await browser.keys(title);
  await browser.keys(['Enter']);
}

describe('page history', { skip: skipReason() }, () => {
  const profileDir = flaggedProfile('opennote-e2e-history-', { 'page.history': true });
  let session: AppSession | undefined;

  after(async () => {
    await session?.close();
    removeFolder(profileDir);
  });

  it('compares with an earlier version and restores a paragraph', async () => {
    session = await launchApp({ profileDir });
    const { browser } = session;
    await openMitosisText(browser);
    await browser.keys(['Enter', ...'An earlier line.']);
    // The core keeps a version of a page that was edited when the page closes, so go to another page and come back.
    await clickRow(browser, 'Pages', 'Cell structure');
    await openMitosisText(browser);
    // A modifier stays down until its keys call ends, so each chord has a call of its own.
    await browser.keys(['Shift', 'Home']);
    await browser.keys(['Backspace', ...'A later line.']);
    await runCommand(browser, 'Page history');
    const panel = browser.$('aside[aria-label="Page history"]');
    await panel.waitForExist({ timeout: 5_000 });
    const versionButtons = 'ul[aria-label="Versions"] button:not([disabled])';
    // The panel shows "Loading versions" until the core has listed them.
    await browser
      .waitUntil(
        async () => {
          const found = await panel.$$(versionButtons);
          return [...found].length > 0;
        },
        { timeout: 15_000 },
      )
      .catch(() => assert.fail('The panel lists no earlier version after the page closed with an edit.'));
    const versions = await panel.$$(versionButtons);
    await versions[0].click();
    await panel.$('del').waitForExist({ timeout: 5_000 });
    await panel.$('button=Restore this paragraph').click();
    const box = browser.$('[role="textbox"][aria-label="Page text"]');
    await browser
      .waitUntil(async () => (await box.getText()).includes('An earlier line.'), { timeout: 5_000 })
      .catch(async (error: unknown) => {
        const notes = await browser.execute(() =>
          [...document.querySelectorAll('[aria-live]')].map((node) => node.textContent).join(' | '),
        );
        const reason = error instanceof Error ? error.message : String(error);
        throw new Error(`${reason} Page text: ${JSON.stringify(await box.getText())}. Announced: ${notes}`);
      });
  });
});
