// Changing the unit system must not change the problem. Every example of every tool is run in SI, then in US units
// after its texts are pinned and its tables turned, then back in SI, and gives the same answers each time.
import '../text';
import { describe, expect, it } from 'vitest';
import { SPECS } from '../specs';
import { firstTexts, pinUnits, runTool, type Run } from './read';
import type { StepValue } from './types';

const numberOf = (value: StepValue | undefined): number | null =>
  typeof value === 'number' ? value : typeof value === 'object' ? value.v : null;

function answers(run: Run): (number | string | null)[] {
  if (!run.ok) return [`failed ${run.error?.code ?? run.fields.map((f) => `${f.field}:${f.error.code}`).join(',')}`];
  const rows = run.outcome.rows.map((row) => row.word ?? numberOf(row.value));
  const tables = (run.outcome.tables ?? []).flatMap((table) => table.rows.flatMap((row) => row.map(numberOf)));
  return [...rows, ...tables];
}

function same(a: (number | string | null)[], b: (number | string | null)[], label: string) {
  expect(b, label).toHaveLength(a.length);
  // A value that should be zero comes out as round-off, small beside the largest value of its kind.
  const largest = Math.max(...a.map((x) => (typeof x === 'number' ? Math.abs(x) : 0)));
  a.forEach((x, i) => {
    const y = b[i];
    if (typeof x === 'number' && typeof y === 'number') {
      const scale = Math.max(Math.abs(x), Math.abs(y));
      // Pinned tables keep 6 significant figures, so a value may move in its sixth figure.
      const near = Math.abs(x - y) <= 1e-4 * scale || Math.abs(x - y) <= 1e-7 * largest;
      expect(near, `${label} #${i}: ${x} vs ${y}`).toBe(true);
    } else expect(y, `${label} #${i}`).toEqual(x);
  });
}

describe('SI to US and back', () => {
  it.each(Object.keys(SPECS))('%s gives the same answers in either system', async (tool) => {
    const spec = await SPECS[tool]();
    const examples = spec.examples ?? [];
    expect(examples.length).toBeGreaterThan(0);
    for (const example of [{ id: 'first', values: {} }, ...examples]) {
      const texts = { ...firstTexts(spec), ...example.values };
      const si = runTool(spec, texts, 'si');
      expect(si.ok, `${tool} ${example.id}`).toBe(true);
      const usTexts = pinUnits(spec, texts, 'si', 'us');
      const us = runTool(spec, usTexts, 'us');
      same(answers(si), answers(us), `${tool} ${example.id} in US`);
      const back = runTool(spec, pinUnits(spec, usTexts, 'us', 'si'), 'si');
      same(answers(si), answers(back), `${tool} ${example.id} back in SI`);
    }
  });
});
