// First-run setup with the keyboard alone, with Windows set to Light and then to Dark (ARCHITECTURE.md section
// 21.5). Match Windows is preselected, its caption names the Windows setting, the shown theme matches, and
// settings.json holds the choice before the workspace opens.
//
// The spec changes AppsUseLightTheme under HKCU and restores it afterward, so it runs only in CI, or where
// OPENNOTE_E2E_REGISTRY=1 says the machine may be changed. Anywhere else it skips.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { Key } from 'webdriverio';
import { launchApp, skipReason } from '../harness.ts';
import type { AppSession } from '../harness.ts';

const PERSONALIZE = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize';
const VALUE = 'AppsUseLightTheme';
const MAY_CHANGE_REGISTRY = Boolean(process.env.CI) || process.env.OPENNOTE_E2E_REGISTRY === '1';

function skip(): string | false {
  if (process.platform !== 'win32') return 'Setup E2E needs Windows';
  if (!MAY_CHANGE_REGISTRY) return 'Set OPENNOTE_E2E_REGISTRY=1 to let this spec change and restore the Windows theme';
  return skipReason();
}

/** The current value, or null when Windows has none. */
function readWindowsTheme(): number | null {
  try {
    const out = execFileSync('reg', ['query', PERSONALIZE, '/v', VALUE], { encoding: 'utf8' });
    const match = /REG_DWORD\s+0x([0-9a-f]+)/i.exec(out);
    return match ? parseInt(match[1], 16) : null;
  } catch {
    return null;
  }
}

function writeWindowsTheme(light: number | null): void {
  if (light === null) execFileSync('reg', ['delete', PERSONALIZE, '/v', VALUE, '/f']);
  else execFileSync('reg', ['add', PERSONALIZE, '/v', VALUE, '/t', 'REG_DWORD', '/d', String(light), '/f']);
}

async function press(session: AppSession, ...keys: string[]): Promise<void> {
  await session.browser.keys(keys);
}

async function focusedText(session: AppSession): Promise<string> {
  return session.browser.execute(() => document.activeElement?.textContent ?? '');
}

describe('setup with the keyboard alone', { skip: skip() }, () => {
  const original = MAY_CHANGE_REGISTRY ? readWindowsTheme() : null;

  after(() => {
    if (MAY_CHANGE_REGISTRY && !skip()) writeWindowsTheme(original);
  });

  for (const windows of ['Light', 'Dark'] as const) {
    describe(`with Windows set to ${windows}`, () => {
      let session: AppSession;

      before(async () => {
        writeWindowsTheme(windows === 'Light' ? 1 : 0);
        session = await launchApp({ keyboardOnly: true });
      });

      after(async () => {
        await session?.close();
      });

      it('preselects Match Windows, names the Windows setting, and stores the choice', async () => {
        const { browser } = session;
        await browser.$('button=Get started').waitForExist({ timeout: 20_000 });
        await press(session, Key.Enter);

        const windowsCard = browser.$('[role="radio"][aria-checked="true"]');
        await windowsCard.waitForExist({ timeout: 10_000 });
        assert.match(await focusedText(session), /Match Windows/);
        assert.match(await windowsCard.getText(), new RegExp(`Windows is set to ${windows}\\.`));
        const shown = await browser.execute(() => document.documentElement.dataset.theme ?? null);
        assert.equal(shown, windows.toLowerCase());

        // Moving away and back saves the choice at once, so settings.json holds it before any page opens.
        await press(session, Key.ArrowRight);
        await press(session, Key.ArrowLeft);
        const file = join(session.profileDir, 'roaming', 'OpenNote', 'settings.json');
        await browser.waitUntil(() => existsSync(file), { timeout: 5_000 });
        await browser.waitUntil(() => JSON.parse(readFileSync(file, 'utf8')).appearance?.theme === 'system', {
          timeout: 5_000,
        });
        assert.equal(JSON.parse(readFileSync(file, 'utf8')).appearance.theme, 'system');
      });
    });
  }
});
