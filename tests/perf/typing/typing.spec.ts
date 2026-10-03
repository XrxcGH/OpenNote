// The typing benchmark (Phase 4 ARCHITECTURE.md sections 24.2, 24.5, and 26.4) on the web build. Each condition
// opens its page fresh and places the caret. It sends 10 warm-up keys, then 100 measured keys, through the DevTools
// Protocol, 120 ms apart (33 ms in the burst condition). It reports painted p50, p95, and maximum, script per key,
// and long animation frames, in results/typing.json.
//
// Environment:
// - OPENNOTE_TYPING_GATE=1 fails a condition whose painted p95 is over 16 ms: the exit gate and the nightly run on
//   the reference laptop. Script per key is reported against its 4.5 ms budget.
// - OPENNOTE_TYPING_THROTTLE=calibrated (or a number) slows the CPU to the reference laptop, as Phase 2's perf
//   project does, for runs on faster or slower machines.
// - OPENNOTE_TYPING_BASELINE=<typing.json from main> fails a condition whose painted p95 is more than 10% worse.
// - OPENNOTE_TYPING_ONLY=<comma-separated ids> runs only those conditions.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import type { Page, PlaywrightWorkerArgs, TestInfo } from '@playwright/test';
import { CONDITIONS, openFixture } from './conditions';
import type { Condition } from './conditions';
import { installKeyTimer, percentile, readKeys, recordKeys } from './keyTimer';

const WARM_UP = 10;
const KEYS = 100;
const PAINTED_BUDGET_MS = 16;
/** The fixed benchmark's time on the reference laptop, in ms (tests/ui/perf/tree.perf.spec.ts). */
const REFERENCE_BENCHMARK_MS = 60;
/** What the keys type: words and spaces, so word-end checks such as AutoCorrect run too. */
const TEXT = 'the quick brown fox jumps over a lazy dog ';

const RESULTS = join(import.meta.dirname, 'results');
const only = process.env.OPENNOTE_TYPING_ONLY?.split(',').map((id) => id.trim());
const gate = process.env.OPENNOTE_TYPING_GATE === '1';

export interface ConditionResult {
  id: string;
  description: string;
  keys: number;
  gapMs: number;
  throttle: number;
  painted: { p50: number; p95: number; max: number };
  script: { p50: number; p95: number; max: number };
  longFrames: number;
}

const results: ConditionResult[] = [];

async function throttle(page: Page): Promise<number> {
  const setting = process.env.OPENNOTE_TYPING_THROTTLE;
  if (!setting) return 1;
  let rate = Number(setting);
  if (setting === 'calibrated') {
    const ms = await page.evaluate(() => {
      const start = performance.now();
      let total = 0;
      for (let round = 0; round < 40; round += 1) {
        const items = Array.from({ length: 20_000 }, (_, i) => (i * 7919) % 10_007);
        items.sort((a, b) => a - b);
        total += items[round];
      }
      return total >= 0 ? performance.now() - start : 0;
    });
    rate = Math.max(1, REFERENCE_BENCHMARK_MS / Math.max(1, ms));
  }
  const client = await page.context().newCDPSession(page);
  await client.send('Emulation.setCPUThrottlingRate', { rate });
  return rate;
}

/** Sends one key per gap on a fixed schedule, so a slow key doesn't stretch the gaps after it. */
async function typeOnSchedule(page: Page, count: number, gapMs: number, offset: number): Promise<void> {
  const start = Date.now();
  for (let i = 0; i < count; i += 1) {
    const wait = start + i * gapMs - Date.now();
    if (wait > 0) await page.waitForTimeout(wait);
    const character = TEXT[(offset + i) % TEXT.length];
    await page.keyboard.press(character === ' ' ? 'Space' : character);
  }
}

const summary = (values: readonly number[]) => ({
  p50: percentile(values, 50),
  p95: percentile(values, 95),
  max: Math.max(...values),
});

/** Opens the condition's page, in a browser with its accessibility tree on when the condition asks for that. */
async function pageFor(
  condition: Condition,
  shared: Page,
  playwright: PlaywrightWorkerArgs['playwright'],
  info: TestInfo,
) {
  if (!condition.accessibility) return shared;
  // What a UI Automation client such as Narrator does to Chromium: build the accessibility tree and keep it.
  const { channel, baseURL, viewport } = info.project.use;
  const browser = await playwright.chromium.launch({ channel, args: ['--force-renderer-accessibility'] });
  return browser.newPage({ baseURL, viewport });
}

/** Types the warm-up and measured keys on the prepared page and returns what the key timer recorded. */
async function measure(page: Page, condition: Condition) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await installKeyTimer(page);
  await openFixture(page, condition.fixture);
  // The page's own idle work (mounting, warming caches) finishes before keys start.
  await page.waitForTimeout(1_000);
  await condition.prepare(page);
  const rate = await throttle(page);
  const gapMs = condition.gapMs ?? 120;
  await typeOnSchedule(page, WARM_UP, gapMs, 0);
  await page.waitForTimeout(500);
  await recordKeys(page, true);
  await typeOnSchedule(page, KEYS, gapMs, WARM_UP);
  await page.waitForTimeout(250);
  await recordKeys(page, false);
  const samples = await readKeys(page);
  expect(errors).toEqual([]);
  expect(samples.painted).toHaveLength(KEYS);
  const result: ConditionResult = {
    id: condition.id,
    description: condition.description,
    keys: KEYS,
    gapMs,
    throttle: Number(rate.toFixed(2)),
    painted: summary(samples.painted),
    script: summary(samples.script),
    longFrames: samples.longFrames,
  };
  return result;
}

/** Logs the result, then holds it to the budget and to main's numbers when the run asks for either. */
function check(result: ConditionResult): void {
  const ms = (value: number) => `${value.toFixed(1)} ms`;
  console.log(
    `${result.id.padEnd(12)} painted p50 ${ms(result.painted.p50)}, p95 ${ms(result.painted.p95)}, ` +
      `max ${ms(result.painted.max)}; script p95 ${ms(result.script.p95)}; long frames ${result.longFrames}`,
  );
  if (gate) expect(result.painted.p95, 'painted p95').toBeLessThanOrEqual(PAINTED_BUDGET_MS);
  const baselinePath = process.env.OPENNOTE_TYPING_BASELINE;
  if (baselinePath && existsSync(baselinePath)) {
    const baseline = (JSON.parse(readFileSync(baselinePath, 'utf8')) as { conditions: ConditionResult[] }).conditions;
    const before = baseline.find((entry) => entry.id === result.id);
    if (before) expect(result.painted.p95, 'painted p95 against main').toBeLessThanOrEqual(before.painted.p95 * 1.1);
  }
}

test.describe('typing', () => {
  for (const condition of CONDITIONS) {
    if (only && !only.includes(condition.id)) continue;
    test(`${condition.id}: ${condition.description}`, async ({ page: shared, playwright }, info) => {
      test.setTimeout(120_000);
      const page = await pageFor(condition, shared, playwright, info);
      try {
        const result = await measure(page, condition);
        results.push(result);
        check(result);
      } finally {
        if (page !== shared) await page.context().browser()?.close();
      }
    });
  }

  test.afterAll(() => {
    mkdirSync(RESULTS, { recursive: true });
    const file = join(RESULTS, 'typing.json');
    // Runs of a few conditions add to the file rather than replace the others.
    const before = existsSync(file)
      ? (JSON.parse(readFileSync(file, 'utf8')) as { conditions?: ConditionResult[] })
      : {};
    const kept = (before.conditions ?? []).filter((entry) => !results.some((result) => result.id === entry.id));
    const order = CONDITIONS.map((condition) => condition.id);
    const conditions = [...kept, ...results].sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
    writeFileSync(file, `${JSON.stringify({ when: new Date().toISOString(), conditions }, null, 2)}\n`);
  });
});
