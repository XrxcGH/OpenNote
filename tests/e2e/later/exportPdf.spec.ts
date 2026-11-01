// Export a PDF in the real app (A4-50): the Export dialog on the Lectures section writes PDF files into a folder the
// spec chose, and each file is a real PDF. The WebView2 print path and the app's PDF writer both run.

import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { launchApp, skipReason, removeFolder } from '../harness.ts';
import type { AppSession } from '../harness.ts';
import { answerPickers, clickRow, dialogWith, runCommand } from './steps.ts';

/** Every file under a folder. */
function filesUnder(folder: string): string[] {
  return readdirSync(folder, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? filesUnder(join(folder, entry.name)) : [join(folder, entry.name)],
  );
}

describe('exporting a PDF from the real app', { skip: skipReason() }, () => {
  let session: AppSession;
  let out: string;

  before(async () => {
    out = mkdtempSync(join(tmpdir(), 'opennote-export-'));
    session = await launchApp();
  });

  after(async () => {
    await session?.close();
    removeFolder(out);
  });

  it('exports a section as PDF files that open as PDFs', async () => {
    const { browser } = session;
    await clickRow(browser, 'Notebooks', 'Lectures');
    await answerPickers(browser, { folder: out });
    await runCommand(browser, 'export', 'Export…');
    const dialog = dialogWith(browser, 'Choose a format and a folder');
    await dialog.waitForExist({ timeout: 10_000 });
    await dialog.$('//*[@role="radio"][contains(normalize-space(.), "PDF files")]').click();
    await dialog.$('button=Choose a folder…').click();
    await dialog.$(`//*[contains(normalize-space(.), ${JSON.stringify(basename(out))})]`).waitForExist({ timeout: 10_000 });
    await dialog.$('//button[normalize-space(.)="Export"]').click();
    await dialog
      .$('//*[normalize-space(.)="Export finished"]')
      .waitForExist({ timeout: 180_000, timeoutMsg: 'The export never finished.' });
    const pdfs = filesUnder(out).filter((file) => file.toLowerCase().endsWith('.pdf'));
    assert.ok(pdfs.length > 0, `No PDF was written under ${out}: ${filesUnder(out).join(', ')}`);
    for (const file of pdfs) {
      assert.ok(statSync(file).size > 500, `${file} is too small to be a page`);
      assert.equal(readFileSync(file).subarray(0, 5).toString('latin1'), '%PDF-', `${file} is not a PDF`);
    }
  });
});
