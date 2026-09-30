// Start-up never shows the wrong theme (ARCHITECTURE.md section 21.7). With settings.json set to Dark, or to Light,
// the perf log's window color and first painted theme both match the setting, whatever Windows is set to: the
// setting wins, and the window's color is known before the page exists.

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { ROOT, launchApp, skipReason } from '../harness.ts';

interface PerfLine {
  mark: string;
  source: string;
  detail?: string;
}

const tokens = JSON.parse(readFileSync(join(ROOT, 'brand', 'tokens.json'), 'utf8')) as {
  color: Record<'light' | 'dark', { surface: { app: string } }>;
};

function readPerfLog(file: string): PerfLine[] {
  try {
    return readFileSync(file, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as PerfLine);
  } catch {
    return [];
  }
}

describe('the first frame matches the saved theme', { skip: skipReason() }, () => {
  for (const theme of ['dark', 'light'] as const) {
    it(`paints ${theme} when settings.json says ${theme}`, async () => {
      const profileDir = mkdtempSync(join(tmpdir(), `opennote-theme-${theme}-`));
      const perfLog = join(profileDir, 'perf.jsonl');
      mkdirSync(join(profileDir, 'roaming'), { recursive: true });
      writeFileSync(
        join(profileDir, 'roaming', 'settings.json'),
        JSON.stringify({ schemaVersion: 1, minWriterSchema: 1, appearance: { theme } }),
      );
      const session = await launchApp({ profileDir, env: { OPENNOTE_PERF_LOG: perfLog } });
      try {
        await session.browser.$('[role="switch"]').waitForExist({ timeout: 20_000 });
        await session.browser.waitUntil(() => readPerfLog(perfLog).some((line) => line.mark === 'firstPaint'), {
          timeout: 10_000,
        });
        const lines = readPerfLog(perfLog);
        const shown = lines.find((line) => line.mark === 'windowShown');
        const painted = lines.find((line) => line.mark === 'firstPaint');
        assert.equal(shown?.detail?.toLowerCase(), tokens.color[theme].surface.app.toLowerCase());
        assert.equal(painted?.detail, theme);
      } finally {
        await session.close();
        rmSync(profileDir, { recursive: true, force: true });
      }
    });
  }
});
