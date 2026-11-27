// TEMPORARY diagnostic: what does NVDA say for live regions, and who has the foreground. Removed before merge.
import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { browserChannel } from '../browser';

interface Nvda {
  start(): Promise<void>;
  stop(): Promise<void>;
  press(key: string): Promise<void>;
  type(text: string): Promise<void>;
  perform(command: unknown): Promise<unknown>;
  spokenPhraseLog(): Promise<string[]>;
  clearSpokenPhraseLog(): Promise<void>;
}
type Hooks = Record<string, (...args: unknown[]) => unknown>;
const BASE_URL = `http://127.0.0.1:${process.env.OPENNOTE_NVDA_PORT ?? 4188}`;
const OUT = join(import.meta.dirname, 'results', 'probe.txt');
const enabled = process.env.OPENNOTE_NVDA === '1' && process.platform === 'win32';
const log = (line: string) => {
  console.log(line);
  appendFileSync(OUT, `${line}\n`);
};
const PS = [
  'Add-Type -TypeDefinition @"',
  'using System; using System.Runtime.InteropServices; using System.Text;',
  'public class W { [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();',
  '[DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);',
  '[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint p); }',
  '"@',
  '$h = [W]::GetForegroundWindow(); $sb = New-Object Text.StringBuilder 256; [void][W]::GetWindowText($h, $sb, 256)',
  '$p = [uint32]0; [void][W]::GetWindowThreadProcessId($h, [ref]$p)',
  'Write-Output ("[" + $sb.ToString() + "] " + (Get-Process -Id $p).ProcessName)',
].join('\n');
const PS_FILE = join(import.meta.dirname, 'results', 'fg.ps1');
function foreground(): string {
  try {
    return execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-File', PS_FILE], { encoding: 'utf8' }).trim();
  } catch (error) {
    return `fg error ${String(error).slice(0, 120)}`;
  }
}

async function open(page: Page, mount: () => Promise<unknown>): Promise<void> {
  await page.goto(`${BASE_URL}/?fixture=short`);
  await page.waitForFunction(() =>
    Boolean((window as unknown as { __OPENNOTE_TEST__?: Hooks }).__OPENNOTE_TEST__?.codeEditorMount),
  );
  await mount();
  await page.locator('[data-testid="code-editor-host"] .cm-content').click();
}

test.describe('probe', () => {
  test.skip(!enabled, 'NVDA only');
  test.setTimeout(8 * 60_000);
  test('what NVDA says', async () => {
    mkdirSync(join(import.meta.dirname, 'results'), { recursive: true });
    writeFileSync(OUT, '');
    writeFileSync(PS_FILE, PS);
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
    const watch = async (label: string, ms = 8000, full = false) => {
      const start = Date.now();
      let said: string[] = [];
      while (Date.now() - start < ms) {
        await page.waitForTimeout(500);
        said = await nvda.spokenPhraseLog();
        if (!full && said.length > 0 && Date.now() - start > 2500) break;
      }
      const state = await page.evaluate(() => ({
        focus: document.hasFocus(),
        vis: document.visibilityState,
        live: [...document.querySelectorAll('[aria-live]')].map((e) => e.textContent),
      }));
      log(
        `${label}: ${Date.now() - start} ms; fg=${foreground()}; page=${JSON.stringify(state)}\n   NVDA said: ${JSON.stringify(said)}`,
      );
      await nvda.clearSpokenPhraseLog();
    };
    try {
      const suggest = () =>
        page.evaluate(() =>
          (window as unknown as { __OPENNOTE_TEST__: Hooks }).__OPENNOTE_TEST__.codeEditorMount({
            language: 'python',
            text: '',
            suggest: { when: 'pri', then: 'nt(total)' },
          }),
        );
      await open(page, suggest);
      await page.evaluate(() => {
        const el = document.createElement('div');
        el.id = 'pre-static';
        el.setAttribute('aria-live', 'polite');
        document.body.append(el);
      });
      log(`before start: fg=${foreground()}`);
      await nvda.start();
      await page.waitForTimeout(3000);
      log(`after start: fg=${foreground()}`);
      await nvda.clearSpokenPhraseLog();
      await page.bringToFront();
      const live = async (id: string, text: string) => {
        await page.evaluate(
          ([i, t]) => {
            let el = document.getElementById(i!);
            if (!el) {
              el = document.createElement('div');
              el.setAttribute('aria-live', 'polite');
              el.id = i!;
              document.body.append(el);
            }
            return new Promise<void>((resolve) =>
              setTimeout(() => {
                el!.textContent = t!;
                resolve();
              }, 800),
            );
          },
          [id, text],
        );
      };
      // Time stamps: when the page announced, and when NVDA's log grew.
      const stamped = async (pg: Page, label: string, act: () => Promise<void>, ms = 7000) => {
        await pg.evaluate(() => {
          const w = window as unknown as { __seen?: string[]; __obs?: MutationObserver };
          w.__seen = [];
          w.__obs?.disconnect();
          const t0 = performance.now();
          w.__obs = new MutationObserver(() => {
            const texts = [...document.querySelectorAll('[aria-live]')].map((e) => e.textContent).filter(Boolean);
            w.__seen!.push(`${Math.round(performance.now() - t0)}ms:${texts.join('|')}`);
          });
          w.__obs.observe(document.body, { childList: true, subtree: true, characterData: true });
        });
        await nvda.clearSpokenPhraseLog();
        const t0 = Date.now();
        await act();
        const acted = Date.now() - t0;
        let last = 0;
        const events: string[] = [];
        while (Date.now() - t0 < ms) {
          await pg.waitForTimeout(250);
          const said = await nvda.spokenPhraseLog();
          if (said.length !== last) {
            events.push(`${Date.now() - t0}ms:${JSON.stringify(said.slice(last))}`);
            last = said.length;
          }
        }
        const seen = await pg.evaluate(() => (window as unknown as { __seen: string[] }).__seen);
        log(`${label}: act took ${acted} ms
   page live changes: ${JSON.stringify(seen)}
   NVDA: ${events.join(' ')}`);
      };
      const text = () =>
        page.evaluate(() =>
          (window as unknown as { __OPENNOTE_TEST__: Hooks }).__OPENNOTE_TEST__.codeEditorText(),
        );
      for (const then of ['nt(total)', 'ntotal']) {
        await open(page, () =>
          page.evaluate(
            (t) =>
              (window as unknown as { __OPENNOTE_TEST__: Hooks }).__OPENNOTE_TEST__.codeEditorMount({
                language: 'python',
                text: 'pri',
                suggest: { when: 'pri', then: t },
              }),
            then,
          ),
        );
        await page.keyboard.press('End');
        await page.waitForTimeout(3000);
        await stamped(page, `T1 ${then}: OS Alt+Backslash`, async () => {
          await nvda.press('Alt+Backslash');
        });
        await stamped(page, `T2 ${then}: OS Ctrl+Right`, async () => {
          await nvda.press('Control+ArrowRight');
        });
        log(`text after accept: ${JSON.stringify(await text())}`);
      }
    } finally {
      await nvda.stop().catch(() => undefined);
      await browser.close();
    }
  });
});
