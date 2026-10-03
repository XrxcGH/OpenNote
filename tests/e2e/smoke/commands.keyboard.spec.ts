// The real app, with the keyboard alone: Ctrl+K runs "Toggle dark mode", Ctrl+/ lists the shortcuts, and Ctrl+,
// opens Settings, where Escape goes back.

import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { Key } from 'webdriverio';
import { launchApp, skipReason } from '../harness.ts';
import type { AppSession } from '../harness.ts';

describe('commands work from the keyboard', { skip: skipReason() }, () => {
  let session: AppSession;

  before(async () => {
    session = await launchApp({ keyboardOnly: true });
  });

  after(async () => {
    await session?.close();
  });

  const chord = async (modifier: string, key: string) => {
    await session.browser.action('key').down(modifier).down(key).up(key).up(modifier).perform();
  };

  it('Ctrl+K finds and runs Toggle dark mode', async () => {
    const { browser } = session;
    const toggle = browser.$('[role="switch"][aria-label="Dark mode"]');
    await toggle.waitForExist({ timeout: 20_000 });
    const before = await toggle.getAttribute('aria-checked');
    await chord(Key.Ctrl, 'k');
    const box = browser.$('[role="combobox"]');
    await box.waitForExist({ timeout: 5_000 });
    await box.setValue('toggle dark');
    await browser.$('[role="option"]').waitForExist({ timeout: 5_000 });
    await browser.keys(Key.Enter);
    await browser.waitUntil(async () => (await toggle.getAttribute('aria-checked')) !== before, { timeout: 5_000 });
  });

  it('Ctrl+/ lists the shortcuts, and Escape closes the list', async () => {
    const { browser } = session;
    await chord(Key.Ctrl, '/');
    // The list is a native <dialog>, so it has no role attribute to select by, and the palette's dialog may still be
    // closing. The list is the dialog that names the palette command.
    const dialog = browser.$('//dialog[@open][contains(normalize-space(.), "Open command palette")]');
    await dialog.waitForExist({ timeout: 5_000 });
    assert.match(await dialog.getText(), /Open command palette/);
    await browser.keys(Key.Escape);
    await dialog.waitForExist({ reverse: true, timeout: 5_000 });
  });

  it('Ctrl+, opens Settings, and Escape goes back', async () => {
    const { browser } = session;
    await chord(Key.Ctrl, ',');
    const heading = browser.$('h1=General');
    await heading.waitForExist({ timeout: 5_000 });
    await browser.keys(Key.Escape);
    await heading.waitForExist({ reverse: true, timeout: 5_000 });
  });
});
