// Latency gate (DESIGN 6.1 and 15): one checker run on a 1,000-line file takes under 50 ms. The test's module runner
// rewrites every import into a property read, which makes the parser several times slower than in the app. So the
// harness is bundled as the app bundles it and timed in a plain Node process, as the diagnostics worker runs it.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rolldown } from 'rolldown';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { analyze } from './analyze';
import { sampleFile } from './bench';
import type { EditorLanguage } from './types';

const BUDGET_MS = 50;
const LANGUAGES: EditorLanguage[] = ['python', 'javascript', 'typescript', 'c', 'cpp', 'lua'];

let dir = '';
let times: Record<string, number> = {};

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'opennote-diagnostics-bench-'));
  const entry = join(dir, 'entry.ts');
  const bench = join(import.meta.dirname, 'bench.ts').replace(/\\/g, '/');
  writeFileSync(
    entry,
    `import { benchmark } from '${bench}';\nconsole.log(JSON.stringify(await benchmark(${JSON.stringify(LANGUAGES)})));\n`,
  );
  const bundle = await rolldown({ input: entry, platform: 'node', cwd: import.meta.dirname });
  await bundle.write({ dir, format: 'esm', entryFileNames: 'bench.mjs' });
  await bundle.close();
  times = JSON.parse(execFileSync(process.execPath, [join(dir, 'bench.mjs')], { encoding: 'utf8' })) as Record<
    string,
    number
  >;
}, 120_000);

afterAll(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe('checker latency', () => {
  for (const language of LANGUAGES) {
    it(`checks a 1,000-line ${language} file in under ${BUDGET_MS} ms`, async () => {
      const text = sampleFile(language, 1000);
      expect(text.split('\n').length).toBeGreaterThanOrEqual(1000);
      // The sample is clean code: a run that only reports noise would not be a fair timing.
      const { checker } = await analyze({ language, text, layers: ['checker'] });
      expect(checker.filter((f) => f.severity === 'error')).toEqual([]);
      expect(times[language]).toBeGreaterThan(0);
      expect(times[language]).toBeLessThan(BUDGET_MS);
    }, 60_000);
  }
});
