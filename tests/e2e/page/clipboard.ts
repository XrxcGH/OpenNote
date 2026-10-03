// Shared steps for the page E2E specs that use the real Windows clipboard: load a corpus case with clipset, open
// the seeded Mitosis page, and focus its text box.
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { ROOT } from '../harness.ts';
import type { Browser } from '../harness.ts';

/** Puts a corpus case (tests/fixtures/clipboard/<source>/<case>) on the clipboard with every format it has. */
export function clipset(name: string): void {
  execFileSync(
    'powershell',
    [
      '-NoProfile',
      '-STA',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      join(ROOT, 'tests', 'e2e', 'tools', 'clipset', 'clipset.ps1'),
      join(ROOT, 'tests', 'fixtures', 'clipboard', ...name.split('/')),
    ],
    { stdio: 'inherit' },
  );
}

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

/** Opens the seeded Mitosis page and puts the caret at the end of its text box. */
export async function openTextBox(browser: Browser) {
  await clickRow(browser, 'Notebooks', 'Lectures');
  await clickRow(browser, 'Pages', 'Mitosis');
  const box = browser.$('[role="textbox"][aria-label="Text"]');
  await box.waitForExist({ timeout: 20_000 });
  await box.click();
  await browser.keys(['Control', 'End']);
  return box;
}

/** The page's text, with each block on its own line. */
export function pageText(browser: Browser): Promise<string> {
  return browser.execute(() =>
    [...document.querySelectorAll('[data-block-id]')].map((block) => (block as HTMLElement).innerText).join('\n'),
  );
}
