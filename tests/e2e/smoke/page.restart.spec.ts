// Typed text in the real app reaches Phase 3's core and survives a restart (Phase 4 PLAN.md section 4.4): open
// a page, type into its text box, close the app, start it again on the same profile, and find the text.

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { launchApp, skipReason } from '../harness.ts';
import type { AppSession, Browser } from '../harness.ts';

const TEXT = 'Typed before a restart';

/** Clicks the row of a tree whose label reads `name`, once it shows. */
async function clickRow(browser: Browser, tree: string, name: string): Promise<void> {
  await browser.waitUntil(
    () =>
      browser.execute(
        (tree, name) => {
          const rows = document.querySelectorAll(`[role="tree"][aria-label="${tree}"] [role="treeitem"]`);
          const row = [...rows].find(
            (candidate) =>
              document.getElementById(candidate.getAttribute('aria-labelledby') ?? '')?.textContent === name,
          );
          (row as HTMLElement | undefined)?.click();
          return Boolean(row);
        },
        tree,
        name,
      ),
    { timeout: 20_000 },
  );
}

async function openMitosis(browser: Browser): Promise<void> {
  await clickRow(browser, 'Notebooks', 'Lectures');
  await clickRow(browser, 'Pages', 'Mitosis');
}

const textBox = (browser: Browser) => browser.$('[role="textbox"][aria-label="Page text"]');

describe('typed text survives a restart', { skip: skipReason() }, () => {
  const profileDir = mkdtempSync(join(tmpdir(), 'opennote-e2e-page-'));
  let session: AppSession | undefined;

  after(async () => {
    await session?.close();
    rmSync(profileDir, { recursive: true, force: true });
  });

  it('keeps what was typed into a page', async () => {
    session = await launchApp({ profileDir });
    await openMitosis(session.browser);
    const box = textBox(session.browser);
    await box.waitForExist({ timeout: 20_000 });
    await box.click();
    await session.browser.keys(TEXT);
    await session.browser.waitUntil(async () => (await box.getText()).includes(TEXT), { timeout: 5_000 });
    await session.close();
    session = await launchApp({ profileDir });
    await openMitosis(session.browser);
    const again = textBox(session.browser);
    await again.waitForExist({ timeout: 20_000 });
    assert.ok((await again.getText()).includes(TEXT), 'the text came back after the restart');
  });
});
