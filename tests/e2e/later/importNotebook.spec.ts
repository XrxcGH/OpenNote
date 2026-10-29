// Import a notebook in the real app (A4-50): a folder of Markdown files is checked, reviewed, and imported as a new
// notebook that shows in the tree with its pages. Nothing is added before the person presses Import.

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { launchApp, skipReason } from '../harness.ts';
import type { AppSession } from '../harness.ts';
import { answerPickers, dialogWith, runCommand } from './steps.ts';

describe('importing a notebook into the real app', { skip: skipReason() }, () => {
  let session: AppSession;
  let root: string;

  before(async () => {
    root = mkdtempSync(join(tmpdir(), 'opennote-import-'));
    const vault = join(root, 'Field Guide');
    mkdirSync(join(vault, 'Plants'), { recursive: true });
    writeFileSync(join(vault, 'Plants', 'Ferns.md'), '# Ferns\n\nFerns reproduce by spores, not seeds.\n');
    writeFileSync(join(vault, 'Plants', 'Mosses.md'), '# Mosses\n\nMosses have no true roots.\n');
    writeFileSync(join(vault, 'Birds.md'), '# Birds\n\nA heron stands still in shallow water.\n');
    session = await launchApp();
  });

  after(async () => {
    await session?.close();
    rmSync(root, { recursive: true, force: true });
  });

  it('shows what will come over, then adds the notebook with its pages', async () => {
    const { browser } = session;
    await browser.$('[role="tree"][aria-label="Notebooks"]').waitForExist({ timeout: 20_000 });
    await answerPickers(browser, { folder: join(root, 'Field Guide') });
    await runCommand(browser, 'import notes', 'Import notes…');
    const dialog = dialogWith(browser, 'Choose a file or folder exported from another app');
    await dialog.waitForExist({ timeout: 10_000 });
    await dialog.$('button=Choose a folder…').click();
    const summary = dialog.$('//*[contains(normalize-space(.), "will come into a new notebook called")]');
    await summary.waitForExist({ timeout: 60_000, timeoutMsg: 'The review never showed.' });
    assert.match(await summary.getText(), /\d+ pages? will come into a new notebook called "Field Guide"/);
    // The review adds nothing yet.
    assert.equal(
      await browser.$$('//*[@role="tree"][@aria-label="Notebooks"]//*[contains(., "Field Guide")]').length,
      0,
    );
    await dialog.$('//button[normalize-space(.)="Import"]').click();
    await dialog
      .$('//*[normalize-space(.)="Import finished"]')
      .waitForExist({ timeout: 120_000, timeoutMsg: 'The import never finished.' });
    await dialog.$('button=Open notebook').click();
    await browser
      .$('//*[@role="tree"][@aria-label="Notebooks"]//*[@role="treeitem"][contains(., "Field Guide")]')
      .waitForExist({ timeout: 20_000 });
  });
});
