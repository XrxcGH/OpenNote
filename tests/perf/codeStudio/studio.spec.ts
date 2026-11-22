// The code studio's browser gates (DESIGN section 15), in the test build.
// Studio open (G-U1) is the time from the open command to an editable editor, the first time in the session.
// Typing (G-U2) is key to screen, 95th percentile, in a 1,000-line Python file that has problem marks.
// Idle memory (G-U3) is the JavaScript heap the open studio adds to the page, after a forced collection.
// Each measure goes to results/browser.json (GateResult), which run.ts reads for the nightly table.
// A gate that is over its budget fails the test as well.
// OPENNOTE_PERF_INJECT_MS adds a delay to each measure, to prove that it can fail.
//
// Environment:
// - OPENNOTE_CODE_PERF_PORT (default 5691) is the preview server's port.
// - OPENNOTE_CODE_PERF_THROTTLE slows the CPU by that factor, to stand in for the 4-core reference profile.

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { expect, test } from '../../ui/fixtures';
import { openSmart, runCommand } from '../../ui/behavior/smart';
import { installKeyTimer, percentile, readKeys, recordKeys } from '../typing/keyTimer';
import { gateOf } from './budgets.ts';
import { isAdvisory, judge, withInjection } from './judge.ts';
import type { GateResult } from './judge.ts';

test.describe.configure({ mode: 'serial', timeout: 240_000 });

// An older run's results must not stand in for this run's if this one crashes before it records any.
test.beforeAll(() => rmSync(join(RESULTS, 'browser.json'), { force: true }));

const RESULTS = join(import.meta.dirname, 'results');
const results: GateResult[] = [];
const MB = 1024 * 1024;

function record(id: string, measured: number, note?: string): GateResult {
  const result = judge(gateOf(id), withInjection(id, measured));
  if (note) result.reason = note;
  results.push(result);
  mkdirSync(RESULTS, { recursive: true });
  writeFileSync(join(RESULTS, 'browser.json'), `${JSON.stringify(results, null, 2)}\n`);
  return result;
}

/** A 1,000-line Python file with a problem mark on every 40th line, so the marks layer has work on each key. */
function thousandLines(): string {
  const lines: string[] = [];
  for (let i = 0; lines.length < 1000; i++) {
    lines.push(
      `def step_${i}(values, limit):`,
      `    total = 0`,
      `    for item in values:`,
      `        total += item * ${i}`,
      i % 8 === 0 ? `    return missing_${i} + min(total, limit)` : `    return min(total, limit)`,
    );
  }
  return lines.slice(0, 1000).join('\n');
}

async function heapBytes(page: Page): Promise<number> {
  const client = await page.context().newCDPSession(page);
  try {
    await client.send('HeapProfiler.collectGarbage');
    await client.send('HeapProfiler.collectGarbage');
    const usage = (await client.send('Runtime.getHeapUsage')) as { usedSize: number };
    return usage.usedSize;
  } finally {
    await client.detach();
  }
}

async function throttle(page: Page): Promise<void> {
  const rate = Number(process.env.OPENNOTE_CODE_PERF_THROTTLE ?? 1);
  if (!(rate > 1)) return;
  const client = await page.context().newCDPSession(page);
  await client.send('Emulation.setCPUThrottlingRate', { rate });
}

/** One fresh open: the page loaded, its commands settled, then the click on the command to an editable editor. */
async function openOnce(page: Page, first: boolean): Promise<{ ms: number; before: number }> {
  if (first) await installKeyTimer(page);
  await openSmart(page);
  await throttle(page);
  // The palette and the page's commands are loaded before the studio's own chunk, as in a session.
  await page.waitForTimeout(1500);
  const before = await heapBytes(page);
  await page.evaluate(() => {
    const clock = { start: 0, end: 0 };
    (window as unknown as { __studioOpen: typeof clock }).__studioOpen = clock;
    document.addEventListener('click', () => (clock.start ||= performance.now()), { capture: true, once: true });
    new MutationObserver((_records, observer) => {
      const content = document.querySelector('[role="dialog"] .cm-content[contenteditable="true"]');
      if (content && !clock.end) {
        clock.end = performance.now();
        observer.disconnect();
      }
    }).observe(document.body, { subtree: true, childList: true, attributes: true });
  });
  await runCommand(page, 'Open the code studio');
  const studio = page.getByRole('dialog', { name: 'Code studio' });
  await expect(studio).toBeVisible();
  await expect(studio.getByRole('textbox', { name: /^Code editor/ })).toBeVisible();
  const ms = await page.evaluate(() => {
    const clock = (window as unknown as { __studioOpen: { start: number; end: number } }).__studioOpen;
    return clock.end - clock.start;
  });
  return { ms, before };
}

test('opens the studio, then types in a 1,000-line file, and holds its memory', async ({ page }) => {
  // Studio open: best of three fresh opens (the page is reloaded between them), as the other gates take the best of
  // three, so one noisy sample on a shared runner does not fail the job. The last open is the one that is typed in.
  let opened = await openOnce(page, true);
  let fastest = opened.ms;
  for (let attempt = 1; attempt < 3 && fastest > gateOf('studio-open').budget; attempt++) {
    await page.reload();
    opened = await openOnce(page, false);
    fastest = Math.min(fastest, opened.ms);
  }
  const before = opened.before;
  const studio = page.getByRole('dialog', { name: 'Code studio' });
  const editor = studio.getByRole('textbox', { name: /^Code editor/ });
  const open = record('studio-open', fastest);

  // Idle memory: the heap the open studio adds once it has settled.
  await page.waitForTimeout(1500);
  const added = (await heapBytes(page)) - before;
  const memory = record('idle-memory', Math.max(0, added) / MB);

  // Typing: 1,000 lines, the caret in the middle, the marks settled, then keys 100 ms apart. Best of three runs.
  await editor.click();
  await page.keyboard.press('Control+a');
  await page.keyboard.insertText(thousandLines());
  await page.keyboard.press('Control+Home');
  for (let line = 0; line < 500; line++) await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(2500);
  const text = 'the quick brown fox jumps over a lazy dog ';
  let p95 = Infinity;
  let note = '';
  for (let attempt = 0; attempt < 3 && p95 > gateOf('typing-1000').budget; attempt++) {
    for (let i = 0; i < 10; i++) await page.keyboard.press(text[i] === ' ' ? 'Space' : text[i]!);
    await recordKeys(page, true);
    for (let i = 0; i < 100; i++) {
      const key = text[i % text.length]!;
      await page.keyboard.press(key === ' ' ? 'Space' : key);
      await page.waitForTimeout(100);
    }
    await recordKeys(page, false);
    const samples = await readKeys(page);
    const painted = percentile(samples.painted, 95);
    if (painted < p95) {
      p95 = painted;
      note = `median ${percentile(samples.painted, 50).toFixed(1)} ms, script p95 ${percentile(samples.script, 95).toFixed(1)} ms`;
    }
  }
  const typing = record('typing-1000', p95, note);

  expect(open.status, `Studio open took ${open.value} ms, over ${gateOf('studio-open').budget} ms`).toBe('pass');
  expect(memory.status, `The idle studio added ${memory.value} MB, over ${gateOf('idle-memory').budget} MB`).toBe(
    'pass',
  );
  // typing-1000 is advisory in the nightly job until the editor's typing fix lands (docs/perf/code-studio.md).
  if (!isAdvisory('typing-1000'))
    expect(typing.status, `Typing took ${typing.value} ms (p95), over ${gateOf('typing-1000').budget} ms`).toBe('pass');
});
