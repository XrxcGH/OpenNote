// Turns results/soak.json into a Markdown table for the job summary: about ten rows, spread over the run, and the
// verdict's problems. `node tests/soak/summary.ts [file]` prints it.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Sample, Verdict } from './plan.ts';

export interface SoakFile {
  minutes: number;
  seed: number;
  actions: number;
  verdict: Verdict;
  samples: Sample[];
}

export function summary(file: SoakFile, rows = 10): string {
  const step = Math.max(1, Math.ceil(file.samples.length / rows));
  const picked = file.samples.filter((_, i) => i % step === 0 || i === file.samples.length - 1);
  const lines = [
    `Soak of ${file.minutes} minutes, seed ${file.seed}, ${file.actions} actions: ${file.verdict.ok ? 'passed' : 'failed'}.`,
    '',
    '| Minute | Actions | Heap (MB) | Nodes | Listeners | Keys (ms) |',
    '|---|---|---|---|---|---|',
    ...picked.map(
      (s) =>
        `| ${Math.floor(s.minute)} | ${s.actions} | ${Math.round(s.heap / 1048576)} | ${s.nodes} | ${s.listeners} | ${s.probeMs.toFixed(1)} |`,
    ),
    '',
    ...file.verdict.problems.map((problem) => `- ${problem}`),
  ];
  return `${lines.join('\n')}\n`;
}

if (process.argv[1] === import.meta.filename) {
  const path = process.argv[2] ?? join(import.meta.dirname, 'results', 'soak.json');
  if (existsSync(path)) process.stdout.write(summary(JSON.parse(readFileSync(path, 'utf8')) as SoakFile));
}
