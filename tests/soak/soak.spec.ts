// The random-editing soak (A4-35): a scripted person edits one 20-page note at random for OPENNOTE_SOAK_MINUTES
// (two hours by default) in the web build. It types, deletes, undoes, redoes, formats, moves, scrolls, makes
// lists and headings, and switches to another page and back. Once a minute it forces a garbage collection and
// reads the heap, the nodes, and the listeners, then times a fixed burst of keys. The file plan.ts holds the verdict:
// memory, nodes, and typing time must stay flat from the first quarter to the last, and nothing may crash.
//
// Environment:
// - OPENNOTE_SOAK_MINUTES sets the length. The nightly run uses 120. A pull request check can use 2.
// - OPENNOTE_SOAK_SEED sets the seed for the random edits. The nightly run uses the run number, so a failure can be
//   replayed.
// - OPENNOTE_SOAK_SAMPLE_SECONDS sets the time between samples. The default is 60, or a tenth of a short soak.
//
// The numbers go to results/soak.json, with every sample, so the lines can be drawn.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { openFixture } from '../perf/typing/conditions';
import { installKeyTimer, readKeys, recordKeys } from '../perf/typing/keyTimer';
import { ensureCaret, key, perform, textLength, trim } from './drive';
import { judge, nextStep, seeded, soakMinutes } from './plan';
import type { ActionId, Sample } from './plan';

const RESULTS = join(import.meta.dirname, 'results');
const PROBE_KEYS = 40;

const minutes = soakMinutes(process.env.OPENNOTE_SOAK_MINUTES);
const seed = Number(process.env.OPENNOTE_SOAK_SEED ?? Date.now() % 1_000_000);
const sampleSeconds = Number(process.env.OPENNOTE_SOAK_SAMPLE_SECONDS ?? Math.min(60, (minutes * 60) / 10));

/** Forces a garbage collection, then reads what the page keeps. */
async function readMetrics(page: Page) {
  const client = await page.context().newCDPSession(page);
  try {
    await client.send('Performance.enable');
    await client.send('HeapProfiler.collectGarbage');
    const { metrics } = await client.send('Performance.getMetrics');
    const value = (name: string) => metrics.find((metric) => metric.name === name)?.value ?? 0;
    return { heap: value('JSHeapUsedSize'), nodes: value('Nodes'), listeners: value('JSEventListeners') };
  } finally {
    await client.detach();
  }
}

/** Types a fixed burst of keys on a fixed schedule and returns the mean painted time in milliseconds. */
async function probe(page: Page): Promise<number> {
  await ensureCaret(page);
  await recordKeys(page, true);
  const start = Date.now();
  for (let i = 0; i < PROBE_KEYS; i += 1) {
    const wait = start + i * 60 - Date.now();
    if (wait > 0) await page.waitForTimeout(wait);
    await page.keyboard.press(i % 2 ? 'x' : 'y');
  }
  await page.waitForTimeout(200);
  await recordKeys(page, false);
  const { painted } = await readKeys(page);
  await key(page, 'Backspace', PROBE_KEYS);
  return painted.reduce((sum, value) => sum + value, 0) / Math.max(1, painted.length);
}

test(`random editing for ${minutes} minutes`, async ({ page }) => {
  test.setTimeout((minutes + 15) * 60_000);
  const crashes: string[] = [];
  page.on('crash', () => crashes.push('The renderer crashed.'));
  page.on('pageerror', (error) => {
    crashes.push(`Uncaught error: ${error.message}`);
    // The stack names the command that threw, so a crash can be turned into a unit repro without a rerun.
    console.log(`Uncaught error:\n${error.stack ?? error.message}`);
  });
  await installKeyTimer(page);
  await openFixture(page, 'twentyPage');
  await page.waitForTimeout(1_000);
  await ensureCaret(page);

  const random = seeded(seed);
  const start = Date.now();
  const startLength = await textLength(page);
  const samples: Sample[] = [];
  let actions = 0;
  let nextSample = start;
  const counts: Partial<Record<ActionId, number>> = {};

  console.log(`Soak: ${minutes} minutes, seed ${seed}, a sample every ${sampleSeconds} s.`);
  while (Date.now() - start < minutes * 60_000 && crashes.length === 0) {
    const step = nextStep(random);
    try {
      await ensureCaret(page);
      await perform(page, step);
    } catch (error) {
      if (crashes.length > 0) break;
      throw new Error(`Action ${actions} (${step.id}, seed ${seed}) failed.`, { cause: error });
    }
    counts[step.id] = (counts[step.id] ?? 0) + 1;
    actions += 1;
    if (actions % 50 === 0 && (await textLength(page)) > startLength * 1.2) await trim(page, startLength);
    if (Date.now() >= nextSample) {
      nextSample = Date.now() + sampleSeconds * 1000;
      const probeMs = await probe(page);
      const metrics = await readMetrics(page);
      const sample: Sample = { minute: (Date.now() - start) / 60_000, probeMs, actions, ...metrics };
      samples.push(sample);
      console.log(
        `${sample.minute.toFixed(1).padStart(6)} min  ${actions} actions  heap ${(sample.heap / 1048576).toFixed(0)} MB  ` +
          `nodes ${sample.nodes}  listeners ${sample.listeners}  keys ${probeMs.toFixed(1)} ms`,
      );
    }
  }

  const verdict = judge(samples, crashes);
  mkdirSync(RESULTS, { recursive: true });
  writeFileSync(
    join(RESULTS, 'soak.json'),
    `${JSON.stringify({ when: new Date().toISOString(), minutes, seed, actions, counts, verdict, samples }, null, 2)}\n`,
  );
  console.log(verdict.ok ? 'Soak passed.' : `Soak failed:\n- ${verdict.problems.join('\n- ')}`);
  expect(verdict.problems, `The soak (seed ${seed}) found problems`).toEqual([]);
});
