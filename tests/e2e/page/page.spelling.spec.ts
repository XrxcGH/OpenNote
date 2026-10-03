// Spell check in the real app (Phase 4 PLAN.md section 11): typed misspellings get squiggles from the Windows spelling
// service within a second after typing pauses, and F7 opens the spelling menu, where Enter takes the first suggestion.
// Runners without an English spell checker skip the check rather than fail.

import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { after, describe, it } from 'node:test';
import { launchApp, skipReason } from '../harness.ts';
import type { AppSession, Browser } from '../harness.ts';
import { flaggedProfile, openMitosisText } from './helpers.ts';

const squiggles = (browser: Browser) =>
  browser.execute(() => [...(CSS.highlights.get('spelling-error') ?? [])].map((range) => range.toString()));

describe('spell check', { skip: skipReason() }, () => {
  const profileDir = flaggedProfile('opennote-e2e-spelling-', { 'editor.spelling': true });
  let session: AppSession | undefined;

  after(async () => {
    await session?.close();
    rmSync(profileDir, { recursive: true, force: true });
  });

  it('underlines a misspelling and fixes it from F7', async (context) => {
    session = await launchApp({ profileDir });
    const { browser } = session;
    await openMitosisText(browser);
    await browser.keys(' I recieve mail');
    const found = await browser
      .waitUntil(async () => (await squiggles(browser)).includes('recieve'), { timeout: 3_000 })
      .catch(() => false);
    if (!found) {
      context.skip('No English spell checker on this runner.');
      return;
    }
    await browser.keys(['F7']);
    const menu = browser.$('[role="menu"][aria-label="Spelling"]');
    await menu.waitForExist({ timeout: 5_000 });
    await browser.keys(['Enter']);
    const box = browser.$('[role="textbox"][aria-label="Text"]');
    await browser.waitUntil(async () => (await box.getText()).includes('I receive mail'), { timeout: 5_000 });
    assert.ok(!(await squiggles(browser)).includes('recieve'));
  });
});
