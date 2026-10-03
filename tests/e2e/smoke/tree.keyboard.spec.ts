// The navigation tree with the keyboard alone, in the real app: Tab enters the tree, the arrows, and Enter open a
// section and a page, F2 renames, Delete moves a page to Trash, and Ctrl+Z brings it back. Focus is checked after
// each step, because it must never fall to the page.

import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { Key } from 'webdriverio';
import { launchApp, skipReason } from '../harness.ts';
import type { AppSession, Browser } from '../harness.ts';

/** The accessible name of the focused tree row, or null when focus isn't on one. */
const focusedRow = (browser: Browser) =>
  browser.execute(() => {
    const row = document.activeElement;
    if (row?.getAttribute('role') !== 'treeitem') return null;
    return document.getElementById(row.getAttribute('aria-labelledby') ?? '')?.textContent ?? null;
  });

/**
 * Waits until the focused tree row is `title`. When it never is, the failure says where focus is, what the rename
 * field holds, and which rows exist, because "timed out" alone doesn't say which step went wrong.
 */
async function expectFocusedRow(browser: Browser, title: string): Promise<void> {
  const reached = await browser
    .waitUntil(async () => (await focusedRow(browser)) === title, { timeout: 5_000 })
    .then(() => true)
    .catch(() => false);
  if (reached) return;
  const state = await browser.execute(() => ({
    focus: `${document.activeElement?.tagName} ${document.activeElement?.getAttribute('aria-label') ?? ''}`,
    field: document.querySelector<HTMLInputElement>('input[aria-label^="Rename"]')?.value ?? null,
    rows: [...document.querySelectorAll('[role="treeitem"]')].map(
      (row) => document.getElementById(row.getAttribute('aria-labelledby') ?? '')?.textContent,
    ),
    status: document.querySelector('[role="status"]')?.textContent ?? null,
  }));
  assert.fail(`Focus never reached the "${title}" row: ${JSON.stringify(state)}`);
}

/** Presses the keys together, in order, and releases them in reverse, as a person holds a chord. */
async function chord(browser: Browser, ...keys: string[]): Promise<void> {
  const action = browser.action('key');
  for (const key of keys) action.down(key);
  for (const key of [...keys].reverse()) action.up(key);
  await action.perform();
}

describe('the tree with the keyboard alone', { skip: skipReason() }, () => {
  let session: AppSession;

  before(async () => {
    session = await launchApp({ keyboardOnly: true });
  });

  after(async () => {
    await session?.close();
  });

  it('enters the tree with Tab, and opens a section and a page with Enter', async () => {
    const { browser } = session;
    await browser.$('[role="tree"][aria-label="Notebooks"]').waitForExist({ timeout: 20_000 });
    for (let presses = 0; presses < 40 && (await focusedRow(browser)) === null; presses += 1) {
      await chord(browser, Key.Tab);
    }
    assert.equal(await focusedRow(browser), 'Biology 101');
    await chord(browser, Key.ArrowDown);
    assert.equal(await focusedRow(browser), 'Lectures');
    await chord(browser, Key.Enter);
    await browser.waitUntil(async () => (await focusedRow(browser)) === 'Cell structure', { timeout: 5_000 });
    await chord(browser, Key.ArrowDown, Key.ArrowDown);
    assert.equal(await focusedRow(browser), 'Mitosis');
  });

  it('renames with F2 and Enter, and focus stays on the row', async () => {
    const { browser } = session;
    await chord(browser, Key.F2);
    await browser.$('input[aria-label="Rename Mitosis"]').waitForExist({ timeout: 5_000 });
    // Keys go to the field only once it holds focus.
    await browser.waitUntil(
      async () => browser.execute(() => document.activeElement?.getAttribute('aria-label') === 'Rename Mitosis'),
      { timeout: 5_000 },
    );
    await chord(browser, Key.Ctrl, 'a');
    await browser.keys(['Cell division', Key.Enter]);
    await expectFocusedRow(browser, 'Cell division');
  });

  it('deletes with Delete, focuses the neighbor, and undoes with Ctrl+Z', async () => {
    const { browser } = session;
    await chord(browser, Key.Delete);
    await expectFocusedRow(browser, 'Meiosis');
    const toast = browser.$('[role="status"][aria-label="Notifications"]');
    await toast.waitUntil(async () => (await toast.getText()).includes('Moved "Cell division" to Trash.'));
    await chord(browser, Key.Ctrl, 'z');
    await expectFocusedRow(browser, 'Cell division');
  });

  it('moves a row down with Ctrl+Shift+Down and keeps focus on it', async () => {
    const { browser } = session;
    await chord(browser, Key.Ctrl, Key.Shift, Key.ArrowDown);
    await browser.waitUntil(
      async () =>
        (
          await browser.execute(() => {
            const rows = [...document.querySelectorAll('[role="tree"][aria-label="Pages"] [role="treeitem"]')];
            return rows.map((row) => document.getElementById(row.getAttribute('aria-labelledby') ?? '')?.textContent);
          })
        ).indexOf('Cell division') === 3,
      { timeout: 5_000 },
    );
    assert.equal(await focusedRow(browser), 'Cell division');
  });
});
