// NVDA and the code editor's suggestions (code:L01, DESIGN 5.3.1 and 14). The ghost text is aria-hidden, so NVDA
// must hear it only through the polite announcement, with the Accept chord, and then hear what was inserted. Like
// nvda.spec.ts, it runs only with OPENNOTE_NVDA=1 on Windows (the nightly workflow), against a `--mode test` build,
// whose test hook mounts an editor with a fake suggestion source.
//
// What NVDA hears, measured on the runner (nightly run of 2026-11-27):
// - A key that Playwright sends is not input to NVDA. NVDA says nothing for a live region that changes after it.
//   Keys go through NVDA (nvda.press), which sends real ones to the window.
// - NVDA says a live region that changes within about half a second of a real key.
// - NVDA does not say one that changes while a character is typed, or a second or more after the key.
// So the spec cannot type and wait for the suggestion. A real F9, which does nothing else, runs a test hook. The hook
// asks the source for the suggestion, as Alt+\ does. A second F9 accepts it. Edge keeps a real Ctrl+Tab for its own
// tabs, so the accept goes through the hook too. The announcements are the app's own.

import { chromium, expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { browserChannel } from '../browser';
import { explainStartFailure } from './checklist';
import { CODE_EDITOR_PHRASES } from './phrases';
import { listenFor } from './speech';

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

async function openEditor(page: Page): Promise<void> {
  await page.goto(`${BASE_URL}/?fixture=short`);
  await page.waitForFunction(() =>
    Boolean((window as unknown as { __OPENNOTE_TEST__?: Hooks }).__OPENNOTE_TEST__?.codeEditorMount),
  );
  await page.evaluate(async () => {
    const hooks = (window as unknown as { __OPENNOTE_TEST__: Hooks }).__OPENNOTE_TEST__;
    // The text is in place, so nothing is typed and no suggestion shows until the first F9.
    await hooks.codeEditorMount({
      language: 'python',
      text: 'pri',
      suggest: { when: 'pri', then: 'nt(total)' },
    });
    // The first F9 shows the suggestion, the second accepts it. The page does nothing else with F9.
    let presses = 0;
    document.addEventListener(
      'keydown',
      (event) => {
        if (event.key !== 'F9') return;
        event.preventDefault();
        event.stopImmediatePropagation();
        presses += 1;
        hooks.codeEditorSuggest(presses === 1 ? 'show' : 'accept');
      },
      true,
    );
  });
  await page.locator('[data-testid="code-editor-host"] .cm-content').click();
  await page.keyboard.press('End');
}

test.describe('NVDA in the code editor', () => {
  test.skip(!enabled, 'Needs NVDA: set OPENNOTE_NVDA=1 on Windows, as for nvda.spec.ts.');
  test.setTimeout(5 * 60_000);

  test('reads a suggestion with its chord, and what Ctrl+Tab inserted', async () => {
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
      await openEditor(page);
      await nvda.start().catch((error: unknown) => {
        throw explainStartFailure(error);
      });
      await page.bringToFront();
      await nvda.clearSpokenPhraseLog();
      await nvda.press('F9');
      await listenFor(nvda, CODE_EDITOR_PHRASES.slice(0, 1));
      await nvda.press('F9');
      log = await listenFor(nvda, CODE_EDITOR_PHRASES);
      expect(
        await page.evaluate(() =>
          (window as unknown as { __OPENNOTE_TEST__: Hooks }).__OPENNOTE_TEST__.codeEditorText(),
        ),
        'The second F9 inserts the suggestion.',
      ).toBe('print(total)');
    } finally {
      await nvda.stop().catch(() => undefined);
      await browser.close();
    }
    for (const phrase of CODE_EDITOR_PHRASES) {
      expect(log, `NVDA did not say ${phrase}. It said:\n${log}`).toMatch(phrase);
    }
  });
});
