// Shared steps for the real-app specs of Phases 6 to 13 (A4-50): open a page by its tree rows, run a command from
// the palette, and answer the file and folder pickers. Windows draws the real pickers, which a WebDriver session
// cannot reach, so a spec starts the test build with the paths the pickers answer (pickerEnv). Every other command
// goes to the real core. The app, its notes, and its exports are real; only the picker window is skipped.

import { Key } from 'webdriverio';
import type { Browser } from '../harness.ts';

/** Clicks the row of a tree whose label reads `name`, once it shows. */
export async function clickRow(browser: Browser, tree: string, name: string): Promise<void> {
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
    { timeout: 20_000, timeoutMsg: `The ${tree} tree never showed "${name}".` },
  );
}

/** Opens Lectures and then a page of it, and waits for the page's text. */
export async function openPage(browser: Browser, title = 'Mitosis'): Promise<void> {
  await clickRow(browser, 'Notebooks', 'Lectures');
  await clickRow(browser, 'Pages', title);
  await browser.$('[role="textbox"][aria-label="Page text"]').waitForExist({ timeout: 20_000 });
}

/** Presses the keys together, in order, and releases them in reverse, as a person holds a chord. */
export async function chord(browser: Browser, ...keys: string[]): Promise<void> {
  const action = browser.action('key');
  for (const key of keys) action.down(key);
  for (const key of [...keys].reverse()) action.up(key);
  await action.perform();
}

/** Opens the palette, types `search`, and runs the first command whose name contains `title`. */
export async function runCommand(browser: Browser, search: string, title: string): Promise<void> {
  await chord(browser, Key.Ctrl, 'k');
  const box = browser.$('[role="combobox"]');
  await box.waitForExist({ timeout: 5_000 });
  await box.setValue(search);
  const option = browser.$(`//*[@role="option"][contains(normalize-space(.), ${JSON.stringify(title)})]`);
  await option.waitForExist({ timeout: 5_000, timeoutMsg: `The palette never offered "${title}".` });
  await option.click();
}

export interface Picks {
  /** What the folder pickers answer. */
  folder?: string;
  /** What the file picker answers. */
  file?: string;
}

/**
 * The environment that makes the folder and file pickers answer at once with the paths given. Windows draws the real
 * pickers, which a WebDriver session cannot reach, and the page cannot stand in for them: Tauri defines
 * `__TAURI_INTERNALS__` and its `invoke` as read-only, and the import and export commands accept only a path that
 * the picker command returned. So the test build (the `test-endpoints` feature, app/src-tauri/src/test_pick.rs) reads
 * the answers when the app starts, and the picker commands return them. Pass the result to launchApp as `env`.
 */
export function pickerEnv(picks: Picks): Record<string, string> {
  return {
    ...(picks.folder ? { OPENNOTE_TEST_PICK_FOLDER: picks.folder } : {}),
    ...(picks.file ? { OPENNOTE_TEST_PICK_FILE: picks.file } : {}),
  };
}

/** The dialog that is open and mentions `text`. A native dialog has no role attribute, so it is found by its text. */
export function dialogWith(browser: Browser, text: string) {
  return browser.$(`//dialog[@open][contains(normalize-space(.), ${JSON.stringify(text)})]`);
}

/** Opens a section of Settings with Ctrl+, and the link of its name. */
export async function openSettings(browser: Browser, section: string): Promise<void> {
  await chord(browser, Key.Ctrl, ',');
  const link = browser.$(`//nav[@aria-label="Settings sections"]//a[normalize-space(.)=${JSON.stringify(section)}]`);
  await link.waitForExist({ timeout: 10_000 });
  await link.click();
  await browser.$(`h1=${section}`).waitForExist({ timeout: 10_000 });
}
