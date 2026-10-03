// Read aloud in the real app, nightly (Phase 4 PLAN.md section 11; spike S2): WebView2 lists local voices, Ctrl+Shift+U
// starts reading, the spoken word is highlighted from boundary events, and pause holds the highlight still. Runners
// without a local voice skip.

import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { after, describe, it } from 'node:test';
import { launchApp, skipReason } from '../harness.ts';
import type { AppSession, Browser } from '../harness.ts';
import { flaggedProfile, openMitosisText } from './helpers.ts';

const spoken = (browser: Browser) =>
  browser.execute(() => [...(CSS.highlights.get('read-aloud') ?? [])].map((range) => range.toString()).join(''));

describe('read aloud', { skip: skipReason() }, () => {
  const profileDir = flaggedProfile('opennote-e2e-read-aloud-', { 'editor.readAloud': true });
  let session: AppSession | undefined;

  after(async () => {
    await session?.close();
    rmSync(profileDir, { recursive: true, force: true });
  });

  it('reads with a local voice and highlights each word', async (context) => {
    session = await launchApp({ profileDir });
    const { browser } = session;
    const local = await browser.executeAsync((done: (count: number) => void) => {
      const count = () => speechSynthesis.getVoices().filter((voice) => voice.localService).length;
      if (count()) done(count());
      else speechSynthesis.addEventListener('voiceschanged', () => done(count()), { once: true });
      setTimeout(() => done(count()), 3_000);
    });
    if (!local) {
      context.skip('No local voices on this runner.');
      return;
    }
    await openMitosisText(browser);
    await browser.keys(['Control', 'Home']);
    await browser.keys(['Control', 'Shift', 'u']);
    await browser.$('[role="region"][aria-label="Read aloud"]').waitForExist({ timeout: 5_000 });
    await browser.waitUntil(async () => (await spoken(browser)).length > 0, { timeout: 10_000 });
    await browser.keys(['Control', 'Shift', 'u']);
    const paused = await spoken(browser);
    await browser.pause(1_000);
    assert.equal(await spoken(browser), paused, 'the highlight holds while paused');
    await browser.keys(['Control', 'Shift', 'u']);
    await browser.waitUntil(async () => (await spoken(browser)) !== paused, { timeout: 10_000 });
  });
});
