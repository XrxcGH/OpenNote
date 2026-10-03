// Typed text in the real app reaches Phase 3's core and survives a restart (Phase 4 PLAN.md section 4.4): open
// a page, type into its text box, close the app, start it again on the same profile, and find the text.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { after, describe, it } from 'node:test';
import { launchApp, skipReason, tools } from '../harness.ts';
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

/**
 * Closes the app's window as its close button does, and waits for the process to go. Rust holds the close until the
 * interface has flushed the page, so the process leaves only after the typed text is with the core. Ending the
 * WebDriver session instead stops the app at once, and text typed in the last moments is lost, as in a crash.
 */
function closeWindow(): void {
  const name = basename(tools().exe ?? 'opennote.exe').replace(/\.exe$/i, '');
  const script =
    `$app = Get-Process -Name '${name}' -ErrorAction SilentlyContinue | Sort-Object StartTime -Descending | ` +
    'Select-Object -First 1; if (-not $app) { exit 2 }; [void]$app.CloseMainWindow(); ' +
    '[void]$app.WaitForExit(20000); exit [int](-not $app.HasExited)';
  execFileSync('powershell.exe', ['-NoProfile', '-Command', script]);
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
    closeWindow();
    await session.close();
    session = await launchApp({ profileDir });
    await openMitosis(session.browser);
    const again = textBox(session.browser);
    await again.waitForExist({ timeout: 20_000 });
    const text = await again.getText();
    assert.ok(text.includes(TEXT), `the text came back after the restart, but the page has "${text.slice(0, 200)}"`);
  });
});
