// Back up now in the real app (A4-50): Settings, Storage and backups, a backup folder, and "Back up now" copies
// the notebooks into that folder and the page says when the last backup ran.

import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { launchApp, skipReason, removeFolder } from '../harness.ts';
import type { AppSession } from '../harness.ts';
import { answerPickers, openSettings } from './steps.ts';

describe('backing up in the real app', { skip: skipReason() }, () => {
  let session: AppSession;
  let destination: string;

  before(async () => {
    destination = mkdtempSync(join(tmpdir(), 'opennote-backup-'));
    session = await launchApp();
  });

  after(async () => {
    await session?.close();
    removeFolder(destination);
  });

  it('chooses a folder, backs up now, and reports the last backup', async () => {
    const { browser } = session;
    await browser.$('[role="tree"][aria-label="Notebooks"]').waitForExist({ timeout: 20_000 });
    await answerPickers(browser, { folder: destination });
    await openSettings(browser, 'Storage and backups');
    const section = browser.$('section[aria-labelledby="qol-backup"]');
    await section.waitForExist({ timeout: 10_000 });
    assert.match(await section.getText(), /No backup has run yet\./);
    await section.$('button=Choose backup folder').click();
    await section
      .$(`//*[contains(normalize-space(.), ${JSON.stringify(basename(destination))})]`)
      .waitForExist({ timeout: 10_000 });
    await section.$('button=Back up now').click();
    await browser.waitUntil(async () => /Last backup: /.test(await section.getText()), {
      timeout: 60_000,
      timeoutMsg: 'The page never reported a finished backup.',
    });
    assert.ok(readdirSync(destination).length > 0, 'The backup folder is empty.');
  });
});
