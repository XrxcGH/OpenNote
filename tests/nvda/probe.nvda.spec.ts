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
      log(`config: ${JSON.stringify((nvda as unknown as { getConfig(): unknown }).getConfig())}`);
      await page.locator('[data-testid="code-editor-host"] .cm-content').click();
      // Plain live regions by script after different kinds of real input.
      await live('q1', 'Probe one after Tab and Shift+Tab');
      await nvda.press('Tab');
      await nvda.press('Shift+Tab');
      await live('q2', 'Probe two after Tab and Shift+Tab');
      await watch('V1 after real Tab, Shift+Tab', 6000, true);
      await nvda.type('x');
      await live('q3', 'Probe three right after an OS key');
      await watch('V2 live region 0.8 s after an OS typed key', 6000, true);
      await nvda.press('ArrowLeft');
      await page.evaluate(() => {
        document.getElementById('q4')?.remove();
        const el = document.createElement('div');
        el.setAttribute('aria-live', 'assertive');
        el.id = 'q4';
        document.body.append(el);
        setTimeout(() => (el.textContent = 'Probe four assertive after ArrowLeft'), 800);
      });
      await watch('V3 assertive live region after an OS key', 6000, true);
      await page.evaluate(() => {
        document.getElementById('q5')?.remove();
        const el = document.createElement('div');
        el.setAttribute('role', 'alert');
        el.id = 'q5';
        document.body.append(el);
        setTimeout(() => (el.textContent = 'Probe five role alert'), 800);
      });
      await watch('V4 role alert after the same', 6000, true);
      await page.evaluate(() => {
        const el = document.createElement('div');
        el.setAttribute('role', 'status');
        el.id = 'q6';
        el.textContent = 'Probe six status present at insert';
        document.body.append(el);
      });
      await watch('V5 status element inserted with text', 6000, true);
      // The app, fresh editor, OS keys only.
      await open(page, suggest);
      await nvda.clearSpokenPhraseLog();
      await nvda.type('pri');
      await watch('E suggestion typed with OS keys', 9000, true);
      await open(page, async () => {
        await page.evaluate(async () => {
          const hooks = (window as unknown as { __OPENNOTE_TEST__: Hooks }).__OPENNOTE_TEST__;
          await hooks.codeEditorMount({ language: 'python', text: 'print(totl)\n' });
          hooks.codeEditorProblem(6, 4, "Undefined name 'totl'");
        });
      });
      await nvda.clearSpokenPhraseLog();
      await nvda.press('F8');
      await watch('H fresh editor, OS F8 only', 6000, true);
    } finally {
      await nvda.stop().catch(() => undefined);
      await browser.close();
    }
  });
});
