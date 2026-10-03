// Page history in the real app (Phase 4 PLAN.md section 11): after an edit and a save, the panel lists the earlier
// version, compares it with <ins> and <del>, and restores the old paragraph.

import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { after, describe, it } from 'node:test';
import { launchApp, skipReason } from '../harness.ts';
import type { AppSession, Browser } from '../harness.ts';
import { flaggedProfile, openMitosisText } from './helpers.ts';

/** Runs a command from the palette by its title. */
async function runCommand(browser: Browser, title: string): Promise<void> {
  await browser.keys(['Control', 'Shift', 'p']);
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
    rmSync(profileDir, { recursive: true, force: true });
  });

  it('compares with an earlier version and restores a paragraph', async () => {
    session = await launchApp({ profileDir });
    const { browser } = session;
    await openMitosisText(browser);
    await browser.keys(['Enter', ...'An earlier line.']);
    await browser.keys(['Control', 's']);
    await browser.keys(['Shift', 'Home', 'Backspace', ...'A later line.']);
    await runCommand(browser, 'Page history');
    const panel = browser.$('aside[aria-label="Page history"]');
    await panel.waitForExist({ timeout: 5_000 });
    const versions = await panel.$$('ul[aria-label="Versions"] button:not([disabled])');
    if (!versions.length) {
      assert.fail('The panel lists no earlier version after a save.');
    }
    await versions[0].click();
    await panel.$('del').waitForExist({ timeout: 5_000 });
    await panel.$('button=Restore this paragraph').click();
    const box = browser.$('[role="textbox"][aria-label="Text"]');
    await browser.waitUntil(async () => (await box.getText()).includes('An earlier line.'), { timeout: 5_000 });
  });
});
