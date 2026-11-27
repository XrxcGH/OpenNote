// TEMPORARY diagnostic: what does NVDA say for live regions, and who has the foreground. Removed before merge.
import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
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
    const watch = async (label: string, ms = 8000) => {
      const start = Date.now();
      let said: string[] = [];
      while (Date.now() - start < ms) {
        await page.waitForTimeout(500);
        said = await nvda.spokenPhraseLog();
        if (said.length > 0 && Date.now() - start > 2500) break;
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
      log(`before start: fg=${foreground()}`);
      await nvda.start();
      await page.waitForTimeout(3000);
      log(`after start: fg=${foreground()}`);
      await nvda.clearSpokenPhraseLog();
      await page.bringToFront();
      await watch('A bringToFront only');

      // 1. A plain live region of our own, changed by script.
      await page.evaluate(() => {
        const live = document.createElement('div');
        live.setAttribute('aria-live', 'polite');
        live.id = 'probe-live';
        document.body.append(live);
      });
      await page.waitForTimeout(1000);
      await page.evaluate(() => {
        document.getElementById('probe-live')!.textContent = 'Probe live region one';
      });
      await watch('B plain live region by script');

      // 2. The app's suggestion, typed by CDP.
      await page.locator('[data-testid="code-editor-host"] .cm-content').click();
      await page.keyboard.type('pri');
      await watch('C suggestion, typed with CDP keys');
      await page.keyboard.press('Control+Tab');
      await watch('D accepted with CDP Ctrl+Tab');

      // 3. The same with real keys.
      await open(page, suggest);
      await nvda.clearSpokenPhraseLog();
      await nvda.type('pri');
      await watch('E suggestion, typed with NVDA/OS keys');
      await nvda.press('Control+Tab');
      await watch('F accepted with OS Ctrl+Tab');

      // 4. The squiggle, with CDP F8 and real F8.
      await open(page, async () => {
        await page.evaluate(async () => {
          const hooks = (window as unknown as { __OPENNOTE_TEST__: Hooks }).__OPENNOTE_TEST__;
          await hooks.codeEditorMount({ language: 'python', text: 'print(totl)\n' });
          hooks.codeEditorProblem(6, 4, "Undefined name 'totl'");
        });
      });
      await nvda.clearSpokenPhraseLog();
      await page.keyboard.press('F8');
      await watch('G F8 with CDP key');
      await nvda.press('F8');
      await watch('H F8 with OS key');
      await nvda.perform(guidepup.NVDAKeyCodeCommands.reportCurrentFocus);
      await watch('I report focus');
    } finally {
      await nvda.stop().catch(() => undefined);
      await browser.close();
    }
  });
});
