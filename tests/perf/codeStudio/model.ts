// The code models' speed (R2): time to the first token and tokens per second for each model, with the language model
// program (crates/llm-host, built with its llama feature) and the model files. Run it on the reference laptop and on a
// 4-core, 8 GB profile:
//   node tests/perf/codeStudio/model.ts --machine "Surface Laptop Studio 2" [--host path/to/opennote-llm]
// Environment:
// - OPENNOTE_LLM_MODEL: one .gguf file. It is measured as the gate whose file name it carries.
// - OPENNOTE_LLM_MODELS: a folder with the gates' files (budgets.ts MODEL_GATES). Each file found is measured.
// - OPENNOTE_LLM_HOST: the program's path (or --host). Default target/release/opennote-llm.
// Without a model file the run is skipped, and the table says so; no model is downloaded.
//
// The program answers once per request (crates/intel-engines protocol), so the first token is timed as a request for one
// token (the prompt's processing plus one token), and the speed comes from the extra time a longer answer takes.

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { createInterface } from 'node:readline';
import { parseArgs } from 'node:util';
import { MODEL_GATES } from './budgets.ts';
import { injectedMs, judgeModel, median, spin } from './judge.ts';
import { modelTable } from './table.ts';
import type { ModelResult } from './table.ts';

const ROOT = join(import.meta.dirname, '..', '..', '..');
const RESULTS = join(import.meta.dirname, 'results');

/** Tokens per second from two timed answers: one of `short` tokens and one of `long` tokens, on the same prompt. */
export function tokensPerSecond(shortMs: number, longMs: number, short: number, long: number): number {
  const extra = longMs - shortMs;
  return extra > 0 ? ((long - short) * 1000) / extra : Infinity;
}

/** About 400 tokens of code that stops in the middle of a function: what the completion asks the model to continue. */
const PROMPT = Array.from(
  { length: 18 },
  (_, i) => `def step_${i}(values, limit):\n    total = 0\n    for item in values:\n        total += item * ${i}\n`,
)
  .join('\n')
  .concat('\ndef last(values, limit):\n    result = []\n    for item in values:\n        if item <');

export interface Host {
  generate(model: string, tokens: number): Promise<number>;
  stop(): void;
}

/** Starts the program and waits for its Ready line. `generate` returns the answer's time in milliseconds. */
export async function startHost(path: string, args: string[] = []): Promise<Host> {
  const child = spawn(path, args, { stdio: ['pipe', 'pipe', 'inherit'] });
  const lines = createInterface({ input: child.stdout! });
  const waiting: ((line: string) => void)[] = [];
  lines.on('line', (line) => waiting.shift()?.(line));
  const next = () => new Promise<string>((resolve) => waiting.push(resolve));
  const ready = JSON.parse(await next()) as { kind: string };
  if (ready.kind !== 'ready') throw new Error(`The program said ${JSON.stringify(ready)}.`);
  let id = 0;
  return {
    async generate(model, tokens) {
      const start = performance.now();
      const request = {
        op: 'generate',
        id: ++id,
        model,
        system: 'Continue the code.',
        prompt: PROMPT,
        maxTokens: tokens,
        temperature: 0,
      };
      child.stdin!.write(`${JSON.stringify(request)}\n`);
      const answer = JSON.parse(await next()) as { kind: string; message?: string };
      if (answer.kind !== 'done') throw new Error(`The program failed: ${answer.message ?? answer.kind}.`);
      spin(injectedMs('model'));
      return performance.now() - start;
    },
    stop() {
      child.stdin!.write(`${JSON.stringify({ op: 'quit' })}\n`);
      child.kill();
    },
  };
}

export async function measureModel(host: Host, id: string, file: string): Promise<ModelResult> {
  const gate = MODEL_GATES.find((candidate) => candidate.id === id);
  await host.generate(file, 1); // loads the model; not timed
  const first: number[] = [];
  for (let i = 0; i < 5; i++) first.push(await host.generate(file, 1));
  const longRuns: number[] = [];
  for (let i = 0; i < 3; i++) longRuns.push(await host.generate(file, 65));
  const firstTokenMs = Math.round(median(first));
  const speed = Math.round(tokensPerSecond(median(first), median(longRuns), 1, 65) * 10) / 10;
  if (!gate) return { id, status: 'skipped', firstTokenMs, tokensPerSecond: speed, reason: 'A model without a gate.' };
  const verdict = judgeModel(gate, firstTokenMs, speed);
  return {
    id,
    status: verdict.ok ? 'pass' : 'fail',
    firstTokenMs,
    tokensPerSecond: speed,
    ...(verdict.ok ? {} : { reason: verdict.problems.join('; ') }),
  };
}

if (import.meta.main) {
  const { values } = parseArgs({
    options: {
      machine: { type: 'string', default: process.env.OPENNOTE_PERF_MACHINE ?? 'unnamed machine' },
      host: {
        type: 'string',
        default: process.env.OPENNOTE_LLM_HOST ?? join(ROOT, 'target', 'release', 'opennote-llm'),
      },
    },
  });
  const files = new Map<string, string>();
  const folder = process.env.OPENNOTE_LLM_MODELS;
  if (folder) {
    for (const gate of MODEL_GATES)
      if (existsSync(join(folder, gate.file))) files.set(gate.id, join(folder, gate.file));
  }
  const single = process.env.OPENNOTE_LLM_MODEL;
  if (single && existsSync(single)) {
    const gate = MODEL_GATES.find((candidate) => candidate.file === basename(single));
    files.set(gate?.id ?? 'custom', single);
  }
  const results: ModelResult[] = [];
  if (files.size === 0 || !existsSync(values.host!)) {
    const reason =
      files.size === 0 ? 'No model file (OPENNOTE_LLM_MODEL or OPENNOTE_LLM_MODELS).' : `No program at ${values.host}.`;
    for (const gate of MODEL_GATES) results.push({ id: gate.id, status: 'skipped', reason });
  } else {
    const host = await startHost(values.host!);
    try {
      for (const [id, file] of files) results.push(await measureModel(host, id, file));
      for (const gate of MODEL_GATES) {
        if (!files.has(gate.id))
          results.push({ id: gate.id, status: 'skipped', reason: 'The model file is not here.' });
      }
    } finally {
      host.stop();
    }
  }
  const table = modelTable(results, values.machine!);
  console.log(table);
  mkdirSync(RESULTS, { recursive: true });
  writeFileSync(join(RESULTS, 'model.md'), `${table}\n`);
  writeFileSync(join(RESULTS, 'model.json'), `${JSON.stringify(results, null, 2)}\n`);
  process.exit(results.some((result) => result.status === 'fail') ? 1 : 0);
}
