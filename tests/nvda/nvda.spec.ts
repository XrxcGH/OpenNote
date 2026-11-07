// The NVDA run (A4-42): Guidepup starts NVDA on Windows, this spec opens the web build in a headed browser, walks
// the checklist in checklist.ts with the keys a person would press, and records what NVDA said. It runs in the
// nightly workflow, where `guidepup setup --ci` and `guidepup install nvda` (run in this folder) have put NVDA in
// place. Nowhere else: it skips unless OPENNOTE_NVDA=1 on Windows, because it needs a screen reader and takes over
// the machine's speech.
//
// The Guidepup packages are not dependencies of the repository. They have a package.json and a lock file of their
// own in this folder (`npm ci` here), so nothing else has to install NVDA's tooling. The spec loads them by name
// when it runs. A missing NVDA fails with the steps that fix it.
//
// The results go to results/nvda.json (every item with what NVDA said) and results/nvda.md (the table).

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { browserChannel } from '../browser';
import { explainStartFailure, failures, ITEMS, result, table } from './checklist';
import type { Item, Result, Run } from './checklist';

/** The part of Guidepup's NVDA class this spec uses. */
interface Nvda {
  start(): Promise<void>;
  stop(): Promise<void>;
  press(key: string): Promise<void>;
  spokenPhraseLog(): Promise<string[]>;
  perform(command: unknown): Promise<unknown>;
  clearSpokenPhraseLog(): Promise<void>;
  lastSpokenPhrase(): Promise<string>;
}

const RESULTS = join(import.meta.dirname, 'results');
const BASE_URL = process.env.OPENNOTE_UI_URL ?? `http://127.0.0.1:${process.env.OPENNOTE_NVDA_PORT ?? 4188}`;
const enabled = process.env.OPENNOTE_NVDA === '1' && process.platform === 'win32';

const SETTLE_MS = 1200;

async function openApp(page: Page): Promise<void> {
  await page.goto(`${BASE_URL}/?fixture=short`);
  await page.getByRole('tree', { name: 'Notebooks' }).getByRole('treeitem', { name: 'Lectures' }).click();
  await page.getByRole('tree', { name: 'Pages' }).getByRole('treeitem', { name: 'Membranes' }).click();
  await page.getByRole('textbox', { name: 'Page text' }).waitFor();
  await page.locator('html[data-page-commands="ready"]').waitFor({ state: 'attached', timeout: 30_000 });
  await page.waitForTimeout(1000);
}

/** Puts keyboard focus where the item starts, with Playwright, before NVDA's log is cleared. */
async function setUp(page: Page, item: Item): Promise<void> {
  const { setup } = item;
  if (setup.role === 'page') {
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page
      .locator('body')
      .click({ position: { x: 1, y: 1 } })
      .catch(() => undefined);
  } else if (setup.role === 'tree') {
    await page.getByRole('tree', { name: setup.name }).getByRole('treeitem', { name: setup.item }).focus();
  } else {
    await page.getByRole(setup.role, { name: setup.name }).first().focus();
  }
  await page.waitForTimeout(SETTLE_MS);
}

test.describe('NVDA', () => {
  test.skip(
    !enabled,
    'Needs NVDA: set OPENNOTE_NVDA=1 on Windows, after `npm ci`, `guidepup setup --ci` and `guidepup install nvda`.',
  );
  test.setTimeout(10 * 60_000);

  test('walks the keyboard and screen reader checklist', async () => {
    // The package name is held in a variable so TypeScript does not look for types the repository does not install.
    const packageName = '@guidepup/guidepup';
    const guidepup = (await import(packageName)) as {
      nvda: Nvda;
      NVDAKeyCodeCommands: { reportCurrentFocus: unknown };
    };
    const { nvda } = guidepup;
    const channel = browserChannel();
    const browser = await chromium.launch({ channel, headless: false, args: ['--force-renderer-accessibility'] });
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const results: Result[] = [];
    const reportFocus = async () => {
      await nvda.perform(guidepup.NVDAKeyCodeCommands.reportCurrentFocus);
      await page.waitForTimeout(SETTLE_MS);
    };
    try {
      await openApp(page);
      await nvda.start().catch((error: unknown) => {
        throw explainStartFailure(error);
      });
      for (const item of ITEMS) {
        // The log starts empty for each item, so a phrase of an earlier item cannot count for this one.
        await nvda.clearSpokenPhraseLog();
        await page.bringToFront();
        await setUp(page, item);
        if (item.reportFocus) await reportFocus();
        for (const key of item.keys) {
          await nvda.press(key);
          await page.waitForTimeout(SETTLE_MS);
        }
        const spoken = await nvda.spokenPhraseLog();
        results.push(result(item, spoken));
        // Close the palette or anything else the item opened.
        await page.keyboard.press('Escape');
        await page.waitForTimeout(300);
      }
    } finally {
      await nvda.stop().catch(() => undefined);
      await browser.close();
    }
    const run: Run = {
      nvda: process.env.OPENNOTE_NVDA_VERSION ?? 'as installed by @guidepup/setup',
      browser: channel,
      date: new Date().toISOString().slice(0, 10),
      results,
    };
    mkdirSync(RESULTS, { recursive: true });
    writeFileSync(join(RESULTS, 'nvda.json'), `${JSON.stringify(run, null, 2)}\n`);
    writeFileSync(join(RESULTS, 'nvda.md'), table(run));
    expect(failures(run), 'Phrases NVDA did not say. nvda.json has everything it did say.').toEqual([]);
  });
});
