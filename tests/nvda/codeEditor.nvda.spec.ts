// NVDA and the code editor's suggestions (code:L01, DESIGN 5.3.1 and 14). The ghost text is aria-hidden, so NVDA
// must hear it only through the polite announcement, with the Accept chord, and then hear what was inserted. Like
// nvda.spec.ts, it runs only with OPENNOTE_NVDA=1 on Windows (the nightly workflow), against a `--mode test` build,
// whose test hook mounts an editor with a fake suggestion source.

import { chromium, expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { browserChannel } from '../browser';
import { explainStartFailure } from './checklist';

interface Nvda {
  start(): Promise<void>;
  stop(): Promise<void>;
  press(key: string): Promise<void>;
  type(text: string): Promise<void>;
  spokenPhraseLog(): Promise<string[]>;
  clearSpokenPhraseLog(): Promise<void>;
}

type Hooks = Record<string, (...args: unknown[]) => unknown>;

const BASE_URL = process.env.OPENNOTE_UI_URL ?? `http://127.0.0.1:${process.env.OPENNOTE_NVDA_PORT ?? 4188}`;
const enabled = process.env.OPENNOTE_NVDA === '1' && process.platform === 'win32';
const SETTLE_MS = 1500;

/** The phrases NVDA must say, in order, as case-insensitive patterns. */
export const CODE_EDITOR_PHRASES: readonly RegExp[] = [
  /Suggestion: nt\(total\)\. Ctrl\+Tab to accept\./i,
  /Inserted: nt\(total\)/i,
];

async function openEditor(page: Page): Promise<void> {
  await page.goto(`${BASE_URL}/?fixture=short`);
  await page.waitForFunction(() =>
    Boolean((window as unknown as { __OPENNOTE_TEST__?: Hooks }).__OPENNOTE_TEST__?.codeEditorMount),
  );
  await page.evaluate(() =>
    (window as unknown as { __OPENNOTE_TEST__: Hooks }).__OPENNOTE_TEST__.codeEditorMount({
      language: 'python',
      text: '',
      suggest: { when: 'pri', then: 'nt(total)' },
    }),
  );
  await page.locator('[data-testid="code-editor-host"] .cm-content').click();
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
    let spoken: string[] = [];
    try {
      await openEditor(page);
      await nvda.start().catch((error: unknown) => {
        throw explainStartFailure(error);
      });
      await page.bringToFront();
      await nvda.clearSpokenPhraseLog();
      await page.keyboard.type('pri');
      await page.waitForTimeout(SETTLE_MS);
      await nvda.press('Control+Tab');
      await page.waitForTimeout(SETTLE_MS);
      spoken = await nvda.spokenPhraseLog();
    } finally {
      await nvda.stop().catch(() => undefined);
      await browser.close();
    }
    const log = spoken.join('\n');
    let from = 0;
    for (const phrase of CODE_EDITOR_PHRASES) {
      const at = log.slice(from).search(phrase);
      expect(at, `NVDA did not say ${phrase}. It said:\n${log}`).toBeGreaterThanOrEqual(0);
      from += at + 1;
    }
  });
});
