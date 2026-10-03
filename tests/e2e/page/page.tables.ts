// Tables in the real app (Phase 4 PLAN.md section 10.5). Insert a table from the palette, type its header cells
// with Tab between them, and add a row with Ctrl+Enter. The table is a real <table>, named by its header cells,
// and it survives a restart. It skips where the WebDriver tools aren't installed, like the smoke specs.

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { launchApp, skipReason } from '../harness.ts';
import type { AppSession, Browser } from '../harness.ts';

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

/** Runs a command by its title from the command palette. */
async function runCommand(browser: Browser, title: string): Promise<void> {
  await browser.keys(['Control', 'k']);
  const input = browser.$('[role="combobox"]');
  await input.waitForExist({ timeout: 5_000 });
  await input.setValue(title);
  await browser.keys('Enter');
}

/** The table's name and its rows' cell text. */
function readTable(browser: Browser): Promise<{ name: string | null; rows: string[][] } | null> {
  return browser.execute(() => {
    const table = document.querySelector('[data-block-id] table');
    if (!table) return null;
    const rows = [...table.querySelectorAll('tr')].map((row) =>
      [...row.querySelectorAll('th, td')].map((cell) => cell.textContent ?? ''),
    );
    return { name: table.closest('[role="group"]')?.getAttribute('aria-label') ?? null, rows };
  });
}

describe('tables in a page', { skip: skipReason() }, () => {
  const profileDir = mkdtempSync(join(tmpdir(), 'opennote-e2e-tables-'));
  let session: AppSession | undefined;

  after(async () => {
    await session?.close();
    rmSync(profileDir, { recursive: true, force: true });
  });

  it('inserts a table, types its cells, adds a row, and keeps it all after a restart', async () => {
    session = await launchApp({ profileDir });
    const { browser } = session;
    await openMitosis(browser);
    const box = browser.$('[role="textbox"][aria-label="Text"]');
    await box.waitForExist({ timeout: 20_000 });
    await box.click();
    await runCommand(browser, 'Insert table');
    await browser.waitUntil(async () => (await readTable(browser)) !== null, { timeout: 10_000 });
    await browser.keys(['S', 't', 'a', 'g', 'e', 'Tab', 'W', 'h', 'e', 'r', 'e']);
    await browser.keys(['Control', 'Enter']);
    await browser.waitUntil(async () => (await readTable(browser))?.rows.length === 4, { timeout: 5_000 });
    const table = await readTable(browser);
    assert.equal(table?.name, 'Table: Stage, Where');
    assert.deepEqual(table?.rows[0].slice(0, 2), ['Stage', 'Where']);
    await session.close();
    session = await launchApp({ profileDir });
    await openMitosis(session.browser);
    await session.browser.waitUntil(async () => (await readTable(session!.browser)) !== null, { timeout: 20_000 });
    const again = await readTable(session.browser);
    assert.equal(again?.rows.length, 4, 'the added row came back after the restart');
    assert.deepEqual(again?.rows[0].slice(0, 2), ['Stage', 'Where']);
  });
});
