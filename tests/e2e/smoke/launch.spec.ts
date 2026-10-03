// The first E2E smoke spec: the real app starts in a fresh profile, shows the dark mode switch, and Ctrl+Shift+D
// switches the theme, with the keyboard alone.

import { after, before, describe, it } from 'node:test';
import { Key } from 'webdriverio';
import { launchApp, skipReason } from '../harness.ts';
import type { AppSession } from '../harness.ts';

describe('the app starts', { skip: skipReason() }, () => {
  let session: AppSession;

  before(async () => {
    session = await launchApp({ keyboardOnly: true });
  });

  after(async () => {
    await session?.close();
  });

  it('shows the dark mode switch, and Ctrl+Shift+D switches the theme', async () => {
    const { browser } = session;
    const toggle = browser.$('[role="switch"][aria-label="Dark mode"]');
    await toggle.waitForExist({ timeout: 20_000 });
    const before = await toggle.getAttribute('aria-checked');
    await browser.action('key').down(Key.Ctrl).down(Key.Shift).down('d').up('d').up(Key.Shift).up(Key.Ctrl).perform();
    await browser.waitUntil(async () => (await toggle.getAttribute('aria-checked')) !== before, { timeout: 5_000 });
    // The switch changes at once, and the theme follows when the crossfade starts, so wait for it.
    const expected = before === 'true' ? 'light' : 'dark';
    await browser.waitUntil(
      async () => (await browser.execute(() => document.documentElement.dataset.theme)) === expected,
      {
        timeout: 5_000,
        timeoutMsg: `the page never showed the ${expected} theme`,
      },
    );
  });
});
