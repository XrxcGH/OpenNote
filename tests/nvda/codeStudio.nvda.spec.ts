// NVDA and the Code studio's squiggles and debugger (code:L21). Like codeEditor.nvda.spec.ts it runs only with
// OPENNOTE_NVDA=1 on Windows (the nightly workflow), against a `--mode test` build. The editor test hook mounts an
// editor and puts one problem on it; F8 moves to the problem, and NVDA must say the line and the message.
// The console and the Problems panel have scripts too: a run's error line is a link, and a problem is a row. The
// debugger has no screen yet, so its phrases are fixed here and its script waits (test.fixme below).
//
// The keys go through NVDA (nvda.press), as real keys: a key that Playwright sends is not input to NVDA, and NVDA
// says nothing for what changes after it (see codeEditor.nvda.spec.ts). Moving focus by script is not spoken either,
// so the console and Problems scripts ask NVDA to report the focus, as nvda.spec.ts does.

import { chromium, expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { browserChannel } from '../browser';
import { explainStartFailure } from './checklist';
import { CONSOLE_PHRASES, DEBUGGER_PHRASES, PROBLEMS_PHRASES, SQUIGGLE_PHRASES } from './phrases';
import { listenFor } from './speech';

interface Nvda {
  start(): Promise<void>;
  stop(): Promise<void>;
  press(key: string): Promise<void>;
  perform(command: unknown): Promise<unknown>;
  spokenPhraseLog(): Promise<string[]>;
  clearSpokenPhraseLog(): Promise<void>;
}

type Hooks = Record<string, (...args: unknown[]) => unknown>;

const BASE_URL = process.env.OPENNOTE_UI_URL ?? `http://127.0.0.1:${process.env.OPENNOTE_NVDA_PORT ?? 4188}`;
const enabled = process.env.OPENNOTE_NVDA === '1' && process.platform === 'win32';
const SETTLE_MS = 1500;

/** A Python project whose run ends in an error on line 3, with the studio open and the run finished. */
async function openRunStudio(page: Page): Promise<void> {
  await page.goto(`${BASE_URL}/?fixture=smart`);
  await page.getByRole('tree', { name: 'Notebooks' }).getByRole('treeitem', { name: 'Lectures' }).click();
  await page.getByRole('tree', { name: 'Pages' }).getByRole('treeitem', { name: 'Membranes' }).click();
  const text = page.getByRole('textbox', { name: 'Text' }).first();
  await text.click();
  await expect(text).toHaveAttribute('contenteditable', 'true');
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Enter');
  // The palette is a lazy chunk and its key handler is installed late: press Ctrl+K until the box has focus, and
  // only then type, so the text is not lost into the page.
  const palette = page.locator('[data-scope="palette"]').getByRole('combobox').first();
  await expect(async () => {
    if (!(await palette.isVisible())) await page.keyboard.press('Control+k');
    await expect(palette).toBeFocused({ timeout: 2000 });
  }).toPass({ timeout: 30_000 });
  await page.keyboard.type('New code project');
  await page.getByRole('option', { name: 'New code project' }).first().click();
  const studio = page.getByRole('dialog', { name: 'Code studio' });
  await studio.waitFor();
  await page.evaluate(() =>
    (window as unknown as { __OPENNOTE_TEST__: Hooks }).__OPENNOTE_TEST__['codeStudioFakeRunner']!(),
  );
  const editor = studio.getByRole('textbox', { name: 'Code editor, main.py' });
  await editor.click();
  await page.keyboard.press('Control+a');
  await page.keyboard.insertText('a = 1\nb = 2\nraise ValueError("boom")\n');
  await studio.getByRole('button', { name: 'Run', exact: true }).click();
  await studio.getByRole('button', { name: 'Open main.py at line 3' }).waitFor();
}

/**
 * Starts NVDA on a page opened by `open`, runs `act`, asks NVDA to report the focus, and returns what NVDA said once
 * it has said `phrases` (or after a timeout), whatever happens.
 */
async function speak(
  open: (page: Page) => Promise<void>,
  act: (page: Page) => Promise<void>,
  phrases: readonly RegExp[],
): Promise<string> {
  const packageName = '@guidepup/guidepup';
  const guidepup = (await import(packageName)) as {
    nvda: Nvda;
    NVDAKeyCodeCommands: { reportCurrentFocus: unknown };
  };
  const { nvda } = guidepup;
  const browser = await chromium.launch({
    channel: browserChannel(),
    headless: false,
    args: ['--force-renderer-accessibility'],
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  try {
    await open(page);
    await nvda.start().catch((error: unknown) => {
      throw explainStartFailure(error);
    });
    await page.bringToFront();
    await nvda.clearSpokenPhraseLog();
    await act(page);
    await page.waitForTimeout(SETTLE_MS);
    await nvda.perform(guidepup.NVDAKeyCodeCommands.reportCurrentFocus);
    return await listenFor(nvda, phrases);
  } finally {
    await nvda.stop().catch(() => undefined);
    await browser.close();
  }
}

async function openProblemEditor(page: Page): Promise<void> {
  await page.goto(`${BASE_URL}/?fixture=short`);
  await page.waitForFunction(() =>
    Boolean((window as unknown as { __OPENNOTE_TEST__?: Hooks }).__OPENNOTE_TEST__?.codeEditorMount),
  );
  await page.evaluate(async () => {
    const hooks = (window as unknown as { __OPENNOTE_TEST__: Hooks }).__OPENNOTE_TEST__;
    await hooks.codeEditorMount({ language: 'python', text: 'print(totl)\n' });
    hooks.codeEditorProblem(6, 4, "Undefined name 'totl'");
  });
  await page.locator('[data-testid="code-editor-host"] .cm-content').click();
}

test.describe('NVDA in the Code studio', () => {
  test.skip(!enabled, 'Needs NVDA: set OPENNOTE_NVDA=1 on Windows, as for nvda.spec.ts.');
  test.setTimeout(5 * 60_000);

  test('reads a squiggle with its line and message when F8 reaches it', async () => {
    const packageName = '@guidepup/guidepup';
    const { nvda } = (await import(packageName)) as { nvda: Nvda };
    const browser = await chromium.launch({
      channel: browserChannel(),
      headless: false,
      args: ['--force-renderer-accessibility'],
    });
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    let log: string;
    try {
      await openProblemEditor(page);
      await nvda.start().catch((error: unknown) => {
        throw explainStartFailure(error);
      });
      await page.bringToFront();
      await nvda.clearSpokenPhraseLog();
      await nvda.press('F8');
      log = await listenFor(nvda, SQUIGGLE_PHRASES);
    } finally {
      await nvda.stop().catch(() => undefined);
      await browser.close();
    }
    for (const phrase of SQUIGGLE_PHRASES) {
      expect(log, `NVDA did not say ${phrase}. It said:\n${log}`).toMatch(phrase);
    }
  });

  test('reads the error line link of the console', async () => {
    const log = await speak(
      openRunStudio,
      async (page) => {
        await page.getByRole('button', { name: 'Open main.py at line 3' }).focus();
      },
      CONSOLE_PHRASES,
    );
    for (const phrase of CONSOLE_PHRASES) expect(log, `NVDA did not say ${phrase}. It said:\n${log}`).toMatch(phrase);
  });

  test('reads a row of the Problems panel', async () => {
    const log = await speak(
      openRunStudio,
      async (page) => {
        await page.getByRole('tab', { name: /Problems/ }).click();
        // The ribbon has tab panels of its own, so the row is found inside the studio.
        await page.getByRole('dialog', { name: 'Code studio' }).getByRole('button', { name: /boom/ }).focus();
      },
      PROBLEMS_PHRASES,
    );
    for (const phrase of PROBLEMS_PHRASES) expect(log, `NVDA did not say ${phrase}. It said:\n${log}`).toMatch(phrase);
  });

  test.fixme('reads a paused debugger line', () => {
    // Waits for the debugger screen. It will step to a line and expect DEBUGGER_PHRASES.
    expect(DEBUGGER_PHRASES.length).toBeGreaterThan(0);
  });
});
