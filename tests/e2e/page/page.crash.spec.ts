// Killing the app while typing loses nothing typed more than a second before (PLAN.md section 6.5; owner: WP2). Each
// run types into a page, kills the app's process at a random moment, starts it again on the same profile, and
// checks the text. OPENNOTE_CRASH_RUNS sets the number of runs: 50 per pull request and 200 nightly.
// Run with: node --test tests/e2e/page/page.crash.spec.ts

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { describe, it } from 'node:test';
import { launchApp, skipReason, tools } from '../harness.ts';
import type { Browser } from '../harness.ts';

const RUNS = Number(process.env.OPENNOTE_CRASH_RUNS ?? 50);
/** Typing this long before the kill must survive it (BRAND.md's crash promise). */
const SAFE_MS = 1000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Kills the newest app process with no chance to flush, as a power cut or a crash does. */
function killApp(): void {
  const exe = basename(tools().exe ?? 'opennote.exe');
  const script =
    `Get-Process -Name '${exe.replace(/\.exe$/i, '')}' -ErrorAction SilentlyContinue | ` +
    'Sort-Object StartTime -Descending | Select-Object -First 1 | Stop-Process -Force';
  execFileSync('powershell.exe', ['-NoProfile', '-Command', script]);
}

async function openTextBox(browser: Browser) {
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
  const box = browser.$('[role="textbox"][aria-label="Text"]');
  await box.waitForExist({ timeout: 20_000 });
  return box;
}

describe('typing survives a crash', { skip: skipReason() }, () => {
  for (let run = 1; run <= RUNS; run++) {
    it(`keeps what was typed a second before the kill, run ${run}`, async () => {
      const profileDir = mkdtempSync(join(tmpdir(), 'opennote-e2e-crash-'));
      try {
        const first = await launchApp({ profileDir });
        const box = await openTextBox(first.browser);
        await box.click();
        const marker = `R${run}:`;
        const typed: { at: number; char: string }[] = [];
        const killAt = Date.now() + 1500 + Math.random() * 2500;
        for (let i = 0; Date.now() < killAt; i++) {
          const char = String(i % 10);
          await first.browser.keys(i === 0 ? marker + char : char);
          typed.push({ at: Date.now(), char: i === 0 ? marker + char : char });
        }
        killApp();
        const killed = Date.now();
        await first.close().catch(() => undefined);
        await sleep(500);
        const safe = typed
          .filter((entry) => entry.at <= killed - SAFE_MS)
          .map((entry) => entry.char)
          .join('');
        const again = await launchApp({ profileDir });
        try {
          const text = await (await openTextBox(again.browser)).getText();
          assert.ok(
            text.includes(safe),
            `run ${run}: "${safe}" was typed a second before the kill, but the page has "${text}"`,
          );
        } finally {
          await again.close();
        }
      } finally {
        rmSync(profileDir, { recursive: true, force: true });
      }
    });
  }
});
