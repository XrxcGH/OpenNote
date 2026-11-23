// NVDA and the Code studio's squiggles and debugger (code:L21). Like codeEditor.nvda.spec.ts it runs only with
// OPENNOTE_NVDA=1 on Windows (the nightly workflow), against a `--mode test` build. The editor test hook mounts an
// editor and puts one problem on it; F8 moves to the problem, and NVDA must say the line and the message.
// The debugger has no screen yet, so its phrases are fixed here and its script waits (test.fixme below).

import { chromium, expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { browserChannel } from '../browser';
import { explainStartFailure } from './checklist';

interface Nvda {
  start(): Promise<void>;
  stop(): Promise<void>;
  press(key: string): Promise<void>;
  spokenPhraseLog(): Promise<string[]>;
  clearSpokenPhraseLog(): Promise<void>;
}

type Hooks = Record<string, (...args: unknown[]) => unknown>;

const BASE_URL = process.env.OPENNOTE_UI_URL ?? `http://127.0.0.1:${process.env.OPENNOTE_NVDA_PORT ?? 4188}`;
const enabled = process.env.OPENNOTE_NVDA === '1' && process.platform === 'win32';
const SETTLE_MS = 1500;

/** What NVDA must say for a squiggle: the line, then the message (strings codeStudio.editor.say.problem). */
export const SQUIGGLE_PHRASES: readonly RegExp[] = [/Line 1: Undefined name 'totl'/i];

/** What NVDA must say when a run pauses on a line, once the debugger screen exists (R3). */
export const DEBUGGER_PHRASES: readonly RegExp[] = [/Paused at line \d+/i];

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
    let spoken: string[];
    try {
      await openProblemEditor(page);
      await nvda.start().catch((error: unknown) => {
        throw explainStartFailure(error);
      });
      await page.bringToFront();
      await nvda.clearSpokenPhraseLog();
      await page.keyboard.press('F8');
      await page.waitForTimeout(SETTLE_MS);
      spoken = await nvda.spokenPhraseLog();
    } finally {
      await nvda.stop().catch(() => undefined);
      await browser.close();
    }
    const log = spoken.join('\n');
    for (const phrase of SQUIGGLE_PHRASES) {
      expect(log, `NVDA did not say ${phrase}. It said:\n${log}`).toMatch(phrase);
    }
  });

  test.fixme('reads a paused debugger line', () => {
    // Waits for the debugger screen. It will step to a line and expect DEBUGGER_PHRASES.
    expect(DEBUGGER_PHRASES.length).toBeGreaterThan(0);
  });
});
