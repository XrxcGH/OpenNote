// Latency gate (DESIGN 6.1 and 15): one checker run on a 1,000-line file takes under 50 ms. Many agents share the
// build machine, so each language gets the best of three medians, as the editor's typing gate does.

import { describe, expect, it } from 'vitest';
import { measureChecker, sampleFile } from './bench';
import { analyze } from './analyze';
import type { EditorLanguage } from './types';

const BUDGET_MS = 50;

describe('checker latency', () => {
  for (const language of ['python', 'javascript', 'typescript', 'c', 'cpp', 'lua'] as EditorLanguage[]) {
    it(`checks a 1,000-line ${language} file in under ${BUDGET_MS} ms`, async () => {
      const text = sampleFile(language, 1000);
      expect(text.split('\n').length).toBeGreaterThanOrEqual(1000);
      const { checker } = await analyze({ language, text, layers: ['checker'] });
      // The sample is clean code: a run that only reports noise would not be a fair timing.
      expect(checker.filter((f) => f.severity === 'error')).toEqual([]);
      let best = Infinity;
      for (let attempt = 0; attempt < 3 && best >= BUDGET_MS; attempt += 1) {
        best = Math.min(best, await measureChecker(language, text));
      }
      expect(best).toBeLessThan(BUDGET_MS);
    }, 60_000);
  }
});
