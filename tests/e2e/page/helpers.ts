// Shared steps for the page E2E specs (WP7): a profile with flags on, and opening Mitosis's text box.

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Browser } from '../harness.ts';

/** A profile whose settings turn on the flags a spec needs. */
export function flaggedProfile(prefix: string, flags: Record<string, boolean>): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  mkdirSync(join(dir, 'roaming'), { recursive: true });
  mkdirSync(join(dir, 'local'), { recursive: true });
  const settings = { schemaVersion: 1, minWriterSchema: 1, experimental: { flags } };
  writeFileSync(join(dir, 'roaming', 'settings.json'), JSON.stringify(settings));
  writeFileSync(join(dir, 'local', 'state.json'), JSON.stringify({ stateVersion: 1, setup: { status: 'done' } }));
  return dir;
}

/** Opens Lectures, then Mitosis, and puts the caret at the end of its first text box. */
export async function openMitosisText(browser: Browser): Promise<void> {
  for (const [tree, name] of [
    ['Notebooks', 'Lectures'],
    ['Pages', 'Mitosis'],
  ]) {
    await browser.waitUntil(
      () =>
        browser.execute(
          (tree, name) => {
            const rows = document.querySelectorAll(`[role="tree"][aria-label="${tree}"] [role="treeitem"]`);
            const row = [...rows].find(
              (item) => document.getElementById(item.getAttribute('aria-labelledby') ?? '')?.textContent === name,
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
  const box = browser.$('[role="textbox"][aria-label="Text"]');
  await box.waitForExist({ timeout: 20_000 });
  await box.click();
  await browser.keys(['Control', 'End']);
}
